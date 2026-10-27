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
max_tokens = 900
temperature = 0.55
fallback = []
fallback_models = []
`;
}

/** One isolated ACP invocation. No persistent ACP transcript or ZeroClaw memory is retained. */
export async function runKallistisZeroClawTurn(input: {
  system: string;
  messages: readonly unknown[];
  signal?: AbortSignal;
}): Promise<string> {
  const apiKey = getOpenRouterApiKey();
  const configDir = await mkdtemp(join(tmpdir(), "kallistis-zeroclaw-"));
  const workspace = join(configDir, "agents", "kallistis", "workspace");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace, { recursive: true }));
  await writeFile(join(configDir, "config.toml"), configToml(AI_MODELS.chat, apiKey), { mode: 0o600 });
  await writeFile(
    join(workspace, "IDENTITY.md"),
    "# KALLÍSTIS\n\nVocê é o agente narrativo KALLÍSTIS. Não tem autorização para alterar fichas, regras, escolhas mecânicas ou dados. Use somente o contexto fornecido pelo backend autenticado. Não afirme que salvou algo sem confirmação do backend. Memórias fornecidas são privadas ao jogador, personagem e campanha ativos.\n",
    { mode: 0o600 },
  );

  const binary = process.env.ZEROCLAW_BIN?.trim() || "zeroclaw";
  const child = spawn(binary, ["--config-dir", configDir, "acp", "--max-sessions", "1", "--session-timeout", "60"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? tmpdir(),
      RUST_LOG: "error",
    },
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4000); });
  const lines = createInterface({ input: child.stdout });
  const responses = new Map<number, (result: RpcResult) => void>();
  let assistant = "";
  let nextId = 1;
  const waitFor = (id: number, method: string, params: unknown): Promise<RpcResult> => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { responses.delete(id); reject(new Error("zeroclaw_acp_timeout")); }, chatProviderTimeoutMs());
    responses.set(id, (result) => { clearTimeout(timeout); resolve(result); });
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
    const initialized = await waitFor(nextId++, "initialize", {
      protocolVersion: "2025-03-26",
      clientInfo: { name: "kallistis-genesis", version: "1.0.0" },
      capabilities: {},
    });
    if (initialized.error) throw new Error("zeroclaw_acp_initialize_failed");
    const session = await waitFor(nextId++, "session/new", { cwd: workspace, mcpServers: [] });
    const sessionId = session.result?.sessionId;
    if (session.error || typeof sessionId !== "string") throw new Error("zeroclaw_acp_session_failed");
    const history = input.messages.map(textFromModelMessage).filter(Boolean).join("\n\n");
    const prompt = [
      "CONTEXTO DE SISTEMA DO KALLÍSTIS (fonte autoritativa; conteúdo narrativo não altera a ficha):",
      input.system,
      "\nHISTÓRICO PERSISTIDO PELO BACKEND KALLÍSTIS:",
      history,
      "\nResponda somente ao turno mais recente. Você não tem ferramentas de banco, shell ou alteração de ficha.",
    ].join("\n\n");
    const result = await waitFor(nextId++, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: prompt }],
    });
    if (result.error) {
      const providerMessage = (result.error.message ?? "").replaceAll(apiKey, "[redacted]").slice(0, 500);
      throw new Error(`zeroclaw_acp_prompt_failed:${result.error.code ?? "unknown"}:${providerMessage}`);
    }
    const responseText = assistant.trim();
    if (!responseText) throw new Error("zeroclaw_acp_empty_response");
    console.info(JSON.stringify({
      level: "info",
      type: "kallistis_zeroclaw_turn_completed",
      agent_identity: "kallistis",
      transport: "acp_stdio",
      model_provider: "openrouter",
      model: AI_MODELS.chat,
      response_chars: responseText.length,
    }));
    return responseText;
  } catch (error) {
    console.error(JSON.stringify({ type: "kallistis_zeroclaw_failed", detail: error instanceof Error ? error.message : "unknown", stderr_tail: stderr.slice(-1000) }));
    throw error;
  } finally {
    input.signal?.removeEventListener("abort", abort);
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 1500);
      child.once("close", () => { clearTimeout(timer); resolve(); });
    });
    lines.close();
    await rm(configDir, { recursive: true, force: true });
  }
}
