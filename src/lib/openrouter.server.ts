import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AI_MODELS } from "@/lib/ai-models.server";

const DEFAULT_CHAT_TIMEOUT_MS = 30_000;
const DEFAULT_CHAT_MAX_RETRIES = 1;

export class ProviderTimeoutError extends Error {
  readonly code = "provider_timeout";

  constructor() {
    super("O provider não respondeu dentro do tempo limite.");
    this.name = "ProviderTimeoutError";
  }
}

export function getOpenRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");
  return key;
}

export function isTransientProviderStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function chatProviderTimeoutMs(): number {
  const configured = Number(process.env.OPENROUTER_CHAT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1_000
    ? Math.min(configured, 120_000)
    : DEFAULT_CHAT_TIMEOUT_MS;
}

export function chatProviderMaxRetries(): number {
  const configured = Number(process.env.OPENROUTER_CHAT_MAX_RETRIES);
  return Number.isInteger(configured) && configured >= 0
    ? Math.min(configured, 2)
    : DEFAULT_CHAT_MAX_RETRIES;
}

function providerLog(input: {
  requestId: string;
  model: string;
  attempt: number;
  status: number | "network_error" | "timeout";
  errorStage?: "provider_http_response";
  errorClass?: string | null;
  errorParameter?: string | null;
}) {
  console.info(
    JSON.stringify({
      level: "info",
      type: "provider_attempt",
      provider: "openrouter",
      model: input.model,
      attempt: input.attempt,
      status: input.status,
      ...(input.errorStage ? { error_stage: input.errorStage } : {}),
      ...(input.errorClass ? { error_class: input.errorClass } : {}),
      ...(input.errorParameter ? { error_parameter: input.errorParameter } : {}),
      request_id: input.requestId,
    }),
  );
}

const SAFE_ERROR_CLASSES = [
  "UNSUPPORTED_PARAMETER",
  "INVALID_PARAMETER_VALUE",
  "INVALID_JSON_MODE",
  "INVALID_RESPONSE_FORMAT",
  "MODEL_NOT_SUPPORTED",
  "INSUFFICIENT_CREDITS",
  "AUTHENTICATION_FAILED",
  "RATE_LIMIT",
  "UPSTREAM_FAILURE",
  "UNKNOWN",
] as const;

type SafeErrorClass = (typeof SAFE_ERROR_CLASSES)[number];

const SAFE_PARAMETERS = new Set([
  "temperature",
  "response_format",
  "max_tokens",
  "max_completion_tokens",
  "tools",
  "tool_choice",
  "reasoning_effort",
  "verbosity",
]);

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorClassFromIdentifier(value: unknown): SafeErrorClass | null {
  if (typeof value !== "string") return null;
  const identifier = value.toLowerCase();
  if (/(unsupported_parameter|unsupported_param)/.test(identifier)) return "UNSUPPORTED_PARAMETER";
  if (/(invalid_json_mode|json_mode_invalid)/.test(identifier)) return "INVALID_JSON_MODE";
  if (/(invalid_response_format|response_format_invalid|structured_output)/.test(identifier))
    return "INVALID_RESPONSE_FORMAT";
  if (/(invalid_parameter|parameter_invalid|invalid_param)/.test(identifier))
    return "INVALID_PARAMETER_VALUE";
  if (/(model_not_found|model_not_supported|unknown_model)/.test(identifier))
    return "MODEL_NOT_SUPPORTED";
  if (/(insufficient_quota|insufficient_credits|credit_balance|billing_limit)/.test(identifier))
    return "INSUFFICIENT_CREDITS";
  if (/(invalid_api_key|authentication_error|unauthorized)/.test(identifier))
    return "AUTHENTICATION_FAILED";
  if (/(rate_limit|too_many_requests)/.test(identifier)) return "RATE_LIMIT";
  if (/(server_error|upstream_error|internal_error)/.test(identifier)) return "UPSTREAM_FAILURE";
  return null;
}

function errorClassFromStatus(status: unknown): SafeErrorClass | null {
  if (typeof status !== "number") return null;
  if (status === 401 || status === 403) return "AUTHENTICATION_FAILED";
  if (status === 402) return "INSUFFICIENT_CREDITS";
  if (status === 429) return "RATE_LIMIT";
  if (status >= 500) return "UPSTREAM_FAILURE";
  return null;
}

function collectProviderErrorObjects(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4) return [];
  const record = parseJsonObject(value);
  if (!record) return [];
  const result = [record];
  for (const key of ["error", "data", "cause", "metadata", "raw"]) {
    const nested = record[key];
    if (key === "raw" && typeof nested === "string") {
      const parsed = parseJsonObject(nested);
      if (parsed) result.push(...collectProviderErrorObjects(parsed, depth + 1));
    } else if (nested && typeof nested === "object") {
      result.push(...collectProviderErrorObjects(nested, depth + 1));
    }
  }
  return result;
}

/** Extracts only allowlisted classifications. Never returns provider text or raw metadata. */
export function classifyProviderError(error: unknown): {
  errorClass: SafeErrorClass;
  errorParameter: string | null;
  status: number | null;
} {
  const root = parseJsonObject(error);
  const status = root && typeof root.statusCode === "number" ? root.statusCode : null;
  const objects = collectProviderErrorObjects(error);
  const responseBody = root?.responseBody;
  const parsedBody = parseJsonObject(responseBody);
  if (parsedBody) objects.push(...collectProviderErrorObjects(parsedBody));

  let errorClass: SafeErrorClass | null = null;
  let errorParameter: string | null = null;
  for (const item of objects) {
    const parameter = typeof item.param === "string" ? item.param.toLowerCase() : null;
    if (!errorParameter && parameter && SAFE_PARAMETERS.has(parameter)) errorParameter = parameter;
    errorClass ??= errorClassFromIdentifier(item.code) ?? errorClassFromIdentifier(item.type);
  }

  errorClass ??= errorClassFromStatus(status);
  if (!errorClass && status === 200 && root?.message === "Invalid JSON response") {
    errorClass = "INVALID_RESPONSE_FORMAT";
  }
  if (!errorClass) errorClass = "UNKNOWN";
  if (errorClass === "UNSUPPORTED_PARAMETER" && !errorParameter) {
    errorParameter = objects.some((item) => item.param === "response_format")
      ? "response_format"
      : null;
  }
  return { errorClass, errorParameter, status };
}

async function providerErrorMetadata(response: Response) {
  const payload: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  const diagnostic = classifyProviderError({ statusCode: response.status, data: payload });
  return {
    errorClass: diagnostic.errorClass,
    errorParameter: diagnostic.errorParameter,
  };
}

async function fetchWithTimeout(
  baseFetch: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  let aborted = false;
  const timeoutError = new ProviderTimeoutError();
  const readerRef: { current?: ReadableStreamDefaultReader<Uint8Array> } = {};
  const sourceSignal = init.signal;
  const cleanup = () => {
    clearTimeout(timeout);
    sourceSignal?.removeEventListener("abort", forwardAbort);
  };
  const abortBody = (reason: unknown) => {
    controller.abort(reason);
    void readerRef.current?.cancel(reason).catch(() => undefined);
  };
  const forwardAbort = () => {
    aborted = true;
    abortBody(sourceSignal?.reason);
  };
  if (sourceSignal?.aborted) forwardAbort();
  else sourceSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    abortBody(timeoutError);
  }, timeoutMs);

  let response: Response;
  try {
    response = await baseFetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    cleanup();
    if (timedOut) throw timeoutError;
    throw error;
  }

  if (!response.body) {
    cleanup();
    return response;
  }

  readerRef.current = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      try {
        const result = await readerRef.current!.read();
        if (timedOut) throw timeoutError;
        if (aborted) throw sourceSignal?.reason ?? new DOMException("Aborted", "AbortError");
        if (result.done) {
          cleanup();
          streamController.close();
        } else {
          streamController.enqueue(result.value);
        }
      } catch (error) {
        cleanup();
        streamController.error(timedOut ? timeoutError : error);
      }
    },
    async cancel(reason) {
      cleanup();
      controller.abort(reason);
      await readerRef.current?.cancel(reason).catch(() => undefined);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function createChatProviderFetch(
  baseFetch: typeof fetch,
  options: {
    requestId: string;
    primaryModel?: string;
    fallbackModel?: string;
    timeoutMs?: number;
    maxRetries?: number;
  },
): typeof fetch {
  const primaryModel = options.primaryModel ?? AI_MODELS.chat;
  const fallbackModel = options.fallbackModel ?? AI_MODELS.chatFallback;
  const timeoutMs = options.timeoutMs ?? chatProviderTimeoutMs();
  const maxRetries = options.maxRetries ?? chatProviderMaxRetries();

  return async (input, init = {}) => {
    if (typeof init.body !== "string") {
      return fetchWithTimeout(baseFetch, input, init, timeoutMs);
    }

    let parsed: { model?: string } & Record<string, unknown>;
    try {
      parsed = JSON.parse(init.body);
    } catch {
      return fetchWithTimeout(baseFetch, input, init, timeoutMs);
    }

    const initialModel = parsed.model;
    if (!initialModel) return fetchWithTimeout(baseFetch, input, init, timeoutMs);
    const fallbackForModel =
      initialModel === AI_MODELS.vision
        ? AI_MODELS.visionFallback
        : initialModel === AI_MODELS.documents
          ? AI_MODELS.documentsFallback
          : fallbackModel;
    const attempts = maxRetries + 1;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const model = attempt === 1 ? initialModel : fallbackForModel;
      const headers = new Headers(init.headers);
      headers.set("x-request-id", options.requestId);

      try {
        const response = await fetchWithTimeout(
          baseFetch,
          input,
          {
            ...init,
            headers,
            body: JSON.stringify({ ...parsed, model }),
          },
          timeoutMs,
        );
        providerLog({
          requestId: options.requestId,
          model,
          attempt,
          status: response.status,
          ...(response.ok
            ? {}
            : {
                errorStage: "provider_http_response" as const,
                ...(await providerErrorMetadata(response)),
              }),
        });
        if (response.ok || !isTransientProviderStatus(response.status) || attempt === attempts) {
          return response;
        }
        await response.body?.cancel();
      } catch (error) {
        const timeout = error instanceof ProviderTimeoutError;
        providerLog({
          requestId: options.requestId,
          model,
          attempt,
          status: timeout ? "timeout" : "network_error",
        });
        if (init.signal?.aborted || attempt === attempts) throw error;
      }
    }

    throw new Error("Provider retry loop ended unexpectedly");
  };
}

export function providerFailureStatus(error: unknown): 502 | 503 | 504 {
  if (error instanceof ProviderTimeoutError) return 504;
  const statusCode =
    typeof error === "object" && error !== null && "statusCode" in error
      ? Number(error.statusCode)
      : undefined;
  if (statusCode === 408 || statusCode === 504) return 504;
  if (statusCode === 429) return 503;
  return 502;
}

export function providerFailureMessage(error: unknown, requestId: string): string {
  const status = providerFailureStatus(error);
  const reason =
    status === 504
      ? "O provider excedeu o tempo limite."
      : status === 503
        ? "O provider está temporariamente indisponível."
        : "O provider recusou ou interrompeu a resposta.";
  return `${reason} Referência: ${requestId}`;
}

export function createOpenRouterProvider(
  options: {
    requestId?: string;
    maxRetries?: number;
    timeoutMs?: number;
    supportsStructuredOutputs?: boolean;
    requireParameters?: boolean;
  } = {},
) {
  const requestId = options.requestId ?? crypto.randomUUID();
  return createOpenAICompatible({
    name: "openrouter",
    apiKey: getOpenRouterApiKey(),
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer":
        process.env.OPENROUTER_SITE_URL ??
        process.env.APP_PUBLIC_URL ??
        "https://kallistis-kallistis.local",
      "X-Title": process.env.OPENROUTER_APP_NAME ?? "Kallistis Totalidade",
      "X-Request-ID": requestId,
    },
    supportsStructuredOutputs: options.supportsStructuredOutputs,
    ...(options.requireParameters
      ? {
          transformRequestBody: (body: Record<string, unknown>) => ({
            ...body,
            provider: {
              ...(body.provider && typeof body.provider === "object"
                ? (body.provider as Record<string, unknown>)
                : {}),
              require_parameters: true,
            },
          }),
        }
      : {}),
    fetch: createChatProviderFetch(fetch, {
      requestId,
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    }),
  });
}
