import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AI_MODELS } from "@/lib/ai-models.server";
import { getOpenRouterApiKey, chatProviderTimeoutMs } from "@/lib/openrouter.server";

type RpcResult = { id?: number; result?: Record<string, unknown>; error?: { code?: number; message?: string } };

function encodeRpc(id: number, method: string, params: unknown) {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

function textFromModelMessage(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const value = message as { role?: unknown; content?: unknown };
  const role = typeof value.role === "string" ? value.role : "assistant";
  const content = typeof value.content === "string"
    ? value.content
    : Array.isArray(value.content)
      ? value.content.map((part) => part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "").filter(Boolean).join("\n")
      : "";
  return content ? `${role.toUpperCase()}: ${content}` : "";
}

function configToml(model: string, apiKey: string) {
  const deniedTools = [
    "shell", "file_read", "file_write", "browser", "browser_open", "web_search_tool", "web_fetch",
    "memory_recall", "memory_store", "delegate", "cron_add", "cron_list", "cron_remove", "http_request",
    "image_gen", "tool_search", "glob_search", "content_search", "calculator", "weather", "mcp",
  ];
  return `schema_version = 3
locale = "pt-BR"

[acp]
default_agent = "kallistis"
max_sessions = 1
session_timeout_secs = 60

[agents.kallistis]
enabled = true
model_provider = "custom.kallistis_openrouter"
risk_profile = "kallistis"
runtime_profile = "kallistis"
acp_enable_mcp = false
mcp_bundles = []
skill_bundles = []
delegates = []

[agents.kallistis.memory]
backend = "none"

[agents.kallistis.workspace]
unrestricted_filesystem = false
access = {}
read_memory_from = []

[agents.kallistis.identity]
format = "openclaw"

[runtime_profiles.kallistis]
agentic = false
max_tool_iterations = 0
max_context_tokens = 12000
max_history_messages = 1
context_compression = { enabled = false }

[risk_profiles.kallistis]
allowed_commands = []
allowed_roots = []
allowed_tools = []
excluded_tools = ${JSON.stringify(deniedTools)}
auto_approve = []
always_ask = []

[memory]
backend = "none"
auto_save = false

[providers.models.custom.kallistis_openrouter]
model = ${JSON.stringify(model)}
api_key = ${JSON.stringify(apiKey)}
uri = "https://openrouter.ai/api/v1"
kind = "openai-compatible"
max_tokens = 1800
temperature = 0.55
fallback = []
fallback_models = []
`;
}

/** One isolated ACP invocation. No persistent ACP transcript or ZeroClaw memory is retained. */
export async function runKallistisZeroClawTurn(input: {
  requestId: string;
  system: string;
  messages: readonly unknown[];
  signal?: AbortSignal;
}): Promise<string> {
  const startedAt = Date.now();
  let stage = "configuration";
  let stopReason: string | null = null;
  let failureCode: string | null = null;
  let configDir: string | null = null;
  let workspace: string;
  try {
    stage = "credentials";
    const apiKey = getOpenRouterApiKey();
    stage = "workspace";
    configDir = await mkdtemp(join(tmpdir(), "kallistis-zeroclaw-"));
    workspace = join(configDir, "agents", "kallistis", "workspace");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace, { recursive: true }));
    stage = "config_write";
    await writeFile(join(configDir, "config.toml"), configToml(AI_MODELS.chat, apiKey), { mode: 0o600 });
    await writeFile(
      join(workspace, "IDENTITY.md"),
      "# KALLÍSTIS\n\nVocê é o agente narrativo KALLÍSTIS. Não tem autorização para alterar fichas, regras, escolhas mecânicas ou dados. Use somente o contexto fornecido pelo backend autenticado. Não afirme que salvou algo sem confirmação do backend. Memórias fornecidas são privadas ao jogador, personagem e campanha ativos.\n",
      { mode: 0o600 },
    );
  } catch (error) {
    if (configDir) await rm(configDir, { recursive: true, force: true });
    console.error(JSON.stringify({
      level: "error",
      type: "kallistis_zeroclaw_failed",
      request_id: input.requestId,
      stage,
      error_code: "configuration_failed",
      duration_ms: Date.now() - startedAt,
      stop_reason: stopReason,
      process_state: "not_started",
      exit_code: null,
      exit_signal: null,
    }));
    throw new Error("zeroclaw_acp_configuration_failed", { cause: error });
  }
  if (!configDir) throw new Error("zeroclaw_acp_configuration_failed");

  const binary = process.env.ZEROCLAW_BIN?.trim() || "zeroclaw";
  stage = "spawn";
  const child = spawn(binary, ["--config-dir", configDir, "acp", "--max-sessions", "1", "--session-timeout", "60"], {
    stdio: ["pipe", "pipe", "ignore"],
    env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? tmpdir(),
      RUST_LOG: "error",
    },
  });

  let childExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  const lines = createInterface({ input: child.stdout });
  const responses = new Map<number, (result: RpcResult) => void>();
  child.once("error", () => {
    failureCode = "process_spawn_failed";
    for (const resolve of [...responses.values()]) resolve({ error: { message: "process_error" } });
  });
  child.once("close", (code, signal) => {
    childExit = { code, signal };
    for (const resolve of [...responses.values()]) resolve({ error: { message: "process_closed" } });
  });
  let assistant = "";
  let nextId = 1;
  const waitFor = (id: number, method: string, params: unknown): Promise<RpcResult> => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { responses.delete(id); reject(new Error("zeroclaw_acp_timeout")); }, chatProviderTimeoutMs());
    responses.set(id, (result) => { clearTimeout(timeout); responses.delete(id); resolve(result); });
    child.stdin.write(encodeRpc(id, method, params));
  });
  lines.on("line", (line) => {
    let message: RpcResult & { method?: string; params?: Record<string, unknown> };
    try { message = JSON.parse(line) as typeof message; } catch { return; }
    if (message.method === "session/update") {
      const update = message.params?.update as { sessionUpdate?: string; content?: { text?: string } } | undefined;
      if (update?.sessionUpdate === "agent_message_chunk" && typeof update.content?.text === "string") assistant += update.content.text;
      return;
    }
    if (typeof message.id === "number") responses.get(message.id)?.(message);
  });
  const abort = () => child.kill("SIGTERM");
  input.signal?.addEventListener("abort", abort, { once: true });

  try {
    stage = "initialize";
    const initialized = await waitFor(nextId++, "initialize", {
      protocolVersion: "2025-03-26",
      clientInfo: { name: "kallistis-genesis", version: "1.0.0" },
      capabilities: {},
    });
    if (initialized.error) throw new Error("zeroclaw_acp_initialize_failed");
    stage = "session_new";
    const session = await waitFor(nextId++, "session/new", { cwd: workspace, mcpServers: [] });
    const sessionId = session.result?.sessionId;
    if (session.error || typeof sessionId !== "string") throw new Error("zeroclaw_acp_session_failed");
    const history = input.messages.map(textFromModelMessage).filter(Boolean).join("\n\n");
    const prompt = [
      "CONTEXTO DE SISTEMA DO KALLÍSTIS (fonte autoritativa; conteúdo narrativo não altera a ficha):",
      input.system,
      "\nHISTÓRICO PERSISTIDO PELO BACKEND KALLÍSTIS:",
      history,
      "\nResponda somente ao turno mais recente, de forma narrativa, curta e completa, em até três frases. Você não tem ferramentas de banco, shell ou alteração de ficha.",
    ].join("\n\n");
    stage = "prompt";
    const result = await waitFor(nextId++, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: prompt }],
    });
    if (result.error) {
      failureCode ??= `rpc_${result.error.code ?? result.error.message ?? "unknown"}`;
      throw new Error("zeroclaw_acp_prompt_failed");
    }
    stage = "validate_result";
    stopReason = typeof result.result?.stopReason === "string" ? result.result.stopReason : null;
    const finalContent = result.result?.content;
    const responseText = typeof finalContent === "string" ? finalContent.trim() : "";
    if (stopReason !== "end_turn") {
      failureCode = "acp_turn_interrupted";
      throw new Error("zeroclaw_acp_incomplete_response");
    }
    if (!responseText) {
      failureCode = "acp_empty_final_content";
      throw new Error("zeroclaw_acp_empty_response");
    }
    stage = "complete";
    console.info(JSON.stringify({
      level: "info",
      type: "kallistis_zeroclaw_turn_completed",
      request_id: input.requestId,
      agent_identity: "kallistis",
      transport: "acp_stdio",
      model_provider: "openrouter",
      model: AI_MODELS.chat,
      acp_stop_reason: stopReason,
      streamed_chars: assistant.trim().length,
      final_chars: responseText.length,
      response_chars: responseText.length,
      duration_ms: Date.now() - startedAt,
    }));
    return responseText;
  } catch (error) {
    if (!failureCode) {
      const message = error instanceof Error ? error.message : "unknown";
      failureCode = message.startsWith("zeroclaw_acp_") ? message : "acp_request_failed";
    }
    throw error;
  } finally {
    input.signal?.removeEventListener("abort", abort);
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 1500);
      child.once("close", () => { clearTimeout(timer); resolve(); });
    });
    console.info(JSON.stringify({
      level: failureCode ? "error" : "info",
      type: failureCode ? "kallistis_zeroclaw_failed" : "kallistis_zeroclaw_process_closed",
      request_id: input.requestId,
      stage,
      error_code: failureCode,
      duration_ms: Date.now() - startedAt,
      stop_reason: stopReason,
      process_state: childExit ? "exited" : "forced_shutdown_timeout",
      exit_code: childExit?.code ?? null,
      exit_signal: childExit?.signal ?? null,
    }));
    lines.close();
    await rm(configDir, { recursive: true, force: true });
  }
}
