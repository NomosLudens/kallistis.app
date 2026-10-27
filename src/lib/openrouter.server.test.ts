import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyProviderError,
  createChatProviderFetch,
  createOpenRouterProvider,
  isTransientProviderStatus,
  ProviderTimeoutError,
} from "./openrouter.server";
import { AI_MODELS } from "./ai-models.server";
import { generateText } from "ai";

const requestBody = (model = "primary/model") =>
  JSON.stringify({ model, messages: [{ role: "user", content: "private prompt" }] });

describe("OpenRouter retry and timeout policy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("não repete status 400 do provider", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const baseFetch = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    const providerFetch = createChatProviderFetch(baseFetch, {
      requestId: "req-400",
      primaryModel: "primary/model",
      fallbackModel: "fallback/model",
      maxRetries: 1,
    });

    const response = await providerFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: requestBody(),
    });

    expect(response.status).toBe(400);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.flat().join(" ")).not.toContain("private prompt");
  });

  it("classifica erro estruturado aninhado sem expor resposta ou texto bruto", () => {
    const result = classifyProviderError({
      name: "AI_APICallError",
      statusCode: 200,
      message: "Provider error with private prompt data",
      data: {
        error: {
          type: "invalid_request_error",
          code: "unsupported_parameter",
          param: "max_completion_tokens",
          metadata: { raw: JSON.stringify({ error: { code: "unsupported_parameter" } }) },
          message: "Private upstream response and user supplied text",
        },
      },
      responseBody: "private response body",
    });

    expect(result).toEqual({
      errorClass: "UNSUPPORTED_PARAMETER",
      errorParameter: "max_completion_tokens",
      status: 200,
    });
    expect(JSON.stringify(result)).not.toMatch(/private|user supplied/i);
  });

  it("classifica resposta incompatível do SDK sem ler nem registrar o corpo", () => {
    const result = classifyProviderError({
      name: "AI_APICallError",
      statusCode: 200,
      message: "Invalid JSON response",
      responseBody: "private model output",
      cause: new Error("private parser details"),
    });

    expect(result).toEqual({
      errorClass: "INVALID_RESPONSE_FORMAT",
      errorParameter: null,
      status: 200,
    });
    expect(JSON.stringify(result)).not.toMatch(/private|parser/i);
  });

  it("registra apenas categoria allowlisted da resposta de erro do provider", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const baseFetch = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            type: "invalid_request_error",
            code: "unsupported_parameter",
            message: "Provider returned error",
            metadata: {
              raw: "Unsupported parameter: 'max_completion_tokens'. Private provider detail and prompt content",
            },
          },
        },
        { status: 400 },
      ),
    );
    const providerFetch = createChatProviderFetch(baseFetch, {
      requestId: "req-safe-error",
      primaryModel: "primary/model",
      maxRetries: 0,
    });

    await providerFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: requestBody(),
    });

    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain('"error_stage":"provider_http_response"');
    expect(logged).not.toContain('"error_type"');
    expect(logged).not.toContain('"error_code"');
    expect(logged).toContain('"error_class":"UNSUPPORTED_PARAMETER"');
    expect(logged).not.toContain("private provider detail");
    expect(logged).not.toContain("private prompt");
  });

  it("classifica somente campos estruturados allowlisted, sem registrar texto bruto", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const baseFetch = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "unsupported_parameter",
            param: "max_completion_tokens",
            message: "Private detail",
          },
        },
        { status: 400 },
      ),
    );
    const providerFetch = createChatProviderFetch(baseFetch, {
      requestId: "req-safe-direct-error",
      primaryModel: "primary/model",
      maxRetries: 0,
    });

    await providerFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: requestBody(),
    });

    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain('"error_class":"UNSUPPORTED_PARAMETER"');
    expect(logged).toContain('"error_parameter":"max_completion_tokens"');
    expect(logged).not.toContain("Private detail");
  });

  it("faz somente um fallback para falha transitória", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const models: string[] = [];
    const baseFetch = vi.fn(async (_input, init) => {
      models.push(JSON.parse(String(init?.body)).model);
      return models.length === 1
        ? new Response("unavailable", { status: 503 })
        : new Response("ok", { status: 200 });
    });
    const providerFetch = createChatProviderFetch(baseFetch, {
      requestId: "req-503",
      primaryModel: "primary/model",
      fallbackModel: "fallback/model",
      maxRetries: 1,
    });

    const response = await providerFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: requestBody(),
    });

    expect(response.status).toBe(200);
    expect(models).toEqual(["primary/model", "fallback/model"]);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it("usa fallback para um modelo de chat selecionado", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const models: string[] = [];
    const baseFetch = vi.fn(async (_input, init) => {
      models.push(JSON.parse(String(init?.body)).model);
      return new Response(models.length === 1 ? "unavailable" : "ok", {
        status: models.length === 1 ? 503 : 200,
      });
    });
    const providerFetch = createChatProviderFetch(baseFetch, {
      requestId: "req-selected",
      primaryModel: "primary/model",
      fallbackModel: "fallback/model",
      maxRetries: 1,
    });

    await providerFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: requestBody("selected/model"),
    });

    expect(models).toEqual(["selected/model", "fallback/model"]);
  });

  it("mantém fallbacks compatíveis para visão e documentos", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    for (const [model, fallback] of [
      [AI_MODELS.vision, AI_MODELS.visionFallback],
      [AI_MODELS.documents, AI_MODELS.documentsFallback],
    ]) {
      const models: string[] = [];
      const baseFetch = vi.fn(async (_input, init) => {
        models.push(JSON.parse(String(init?.body)).model);
        return new Response(models.length === 1 ? "unavailable" : "ok", {
          status: models.length === 1 ? 503 : 200,
        });
      });
      const providerFetch = createChatProviderFetch(baseFetch, {
        requestId: `req-${model}`,
        maxRetries: 1,
      });
      await providerFetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        body: requestBody(model),
      });
      expect(models).toEqual([model, fallback]);
    }
  });

  it("aborta de verdade a chamada quando o timeout expira", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let observedAbort = false;
    const baseFetch = vi.fn(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            observedAbort = true;
            reject(init.signal?.reason);
          });
        }),
    );
    const providerFetch = createChatProviderFetch(baseFetch, {
      requestId: "req-timeout",
      primaryModel: "primary/model",
      fallbackModel: "fallback/model",
      timeoutMs: 10,
      maxRetries: 0,
    });

    await expect(
      providerFetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        body: requestBody(),
      }),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(observedAbort).toBe(true);
  });

  it("mantém o timeout ativo enquanto o corpo SSE do provider está aberto", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let canceled = false;
    const baseFetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: start\\n\\n"));
            },
            cancel() {
              canceled = true;
            },
          }),
        ),
    );
    const providerFetch = createChatProviderFetch(baseFetch, {
      requestId: "req-stream-timeout",
      primaryModel: "primary/model",
      fallbackModel: "fallback/model",
      timeoutMs: 10,
      maxRetries: 0,
    });

    const response = await providerFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: requestBody(),
    });
    const reader = response.body!.getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await expect(reader.read()).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(canceled).toBe(true);
  });

  it("encaminha timeout específico do fluxo de criação ao fetch do provider", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "qa-test-key");
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
        return new Response(
          new ReadableStream<Uint8Array>({
            pull: () => new Promise(() => undefined),
          }),
          { status: 200 },
        );
      }),
    );

    const model = createOpenRouterProvider({
      requestId: "req-flow-timeout",
      maxRetries: 0,
      timeoutMs: 10,
    })("primary/model");

    await expect(generateText({ model, prompt: "timeout contract" })).rejects.toBeDefined();
    expect(aborted).toBe(true);
  });

  it("encaminha cancelamento externo ao corpo SSE depois dos headers", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let canceled = false;
    const baseFetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: start\\n\\n"));
            },
            cancel() {
              canceled = true;
            },
          }),
        ),
    );
    const providerFetch = createChatProviderFetch(baseFetch, {
      requestId: "req-stream-abort",
      primaryModel: "primary/model",
      fallbackModel: "fallback/model",
      timeoutMs: 1000,
      maxRetries: 0,
    });
    const abort = new AbortController();
    const response = await providerFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: requestBody(),
      signal: abort.signal,
    });
    const reader = response.body!.getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    abort.abort(new Error("client disconnected"));
    await expect(reader.read()).rejects.toThrow("client disconnected");
    expect(canceled).toBe(true);
  });

  it("classifica somente condições transitórias para retry", () => {
    expect([408, 429, 500, 503].every(isTransientProviderStatus)).toBe(true);
    expect([400, 401, 403, 404, 409, 422].some(isTransientProviderStatus)).toBe(false);
  });
});
