import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { generateText } from "ai";
import { z } from "zod";
import { AI_MODELS } from "@/lib/ai-models.server";
import { createOpenRouterProvider, chatProviderTimeoutMs } from "@/lib/openrouter.server";
import { isSameOriginRequest } from "@/server/local-core/csrf";
import { requireUser } from "@/lib/require-user.server";
import { createLocalChatRuntime } from "@/server/local-core/chat-runtime";
import { createBunPostgresExecutor, type SqlExecutor } from "@/server/local-core/postgres";
import {
  insertCommunityChatMessage,
  listCommunityChatMessages,
} from "@/server/local-core/community-chat";
import { prepareCommunityChatAssistantResponse } from "@/server/chat/community-chat-response";
import { buildKallistisCommunitySystem, resolveCommunityChatDirectReply } from "@/server/chat/kallistis-chat-runtime";
import { getRuntimeDatabaseUrl } from "@/server/runtime/context";

const headers = { "Cache-Control": "no-store" };
const messageSchema = z.object({ content: z.string().trim().min(1).max(4000) }).strict();

export function hasExplicitKallistisMention(content: string): boolean {
  return /(^|[\s([{])@kallistis\b/i.test(content);
}

function databaseUnavailable() {
  return Response.json({ error: "database_unavailable" }, { status: 503, headers });
}

function databaseExecutor(): SqlExecutor | null {
  const databaseUrl = getRuntimeDatabaseUrl();
  return databaseUrl ? createBunPostgresExecutor(databaseUrl) : null;
}

async function currentUser(request: Request) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth;
  return auth;
}

export const Route = createFileRoute("/api/community-chat")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await currentUser(request);
        if ("error" in auth) return auth.error;
        const sql = databaseExecutor();
        if (!sql) return databaseUnavailable();
        try {
          return Response.json({ messages: await listCommunityChatMessages(sql) }, { headers });
        } finally {
          sql.close();
        }
      },
      POST: async ({ request }) => {
        const expectedOrigin = process.env.KALLISTIS_PUBLIC_ORIGIN || "https://kallistis.app";
        if (!isSameOriginRequest(request, expectedOrigin)) {
          return Response.json({ error: "csrf_rejected" }, { status: 403, headers });
        }
        const auth = await currentUser(request);
        if ("error" in auth) return auth.error;
        const parsed = messageSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ error: "invalid_message" }, { status: 400, headers });
        const sql = databaseExecutor();
        if (!sql) return databaseUnavailable();
        try {
          const human = await insertCommunityChatMessage(sql, {
            id: randomUUID(),
            authorUserId: auth.userId,
            role: "human",
            content: parsed.data.content,
            createdAt: new Date().toISOString(),
          });
          if (!hasExplicitKallistisMention(parsed.data.content)) {
            return Response.json(
              { messages: [human], kallistisResponded: false },
              { status: 201, headers },
            );
          }

          const directReply = resolveCommunityChatDirectReply(parsed.data.content);
          if (directReply) {
            const answer = prepareCommunityChatAssistantResponse(
              directReply.content,
              directReply.route,
              directReply.evidence,
            );
            const assistant = await insertCommunityChatMessage(sql, {
              id: randomUUID(),
              authorUserId: null,
              role: "kallistis",
              content: answer,
              createdAt: new Date().toISOString(),
            });
            console.info(JSON.stringify({
              level: "info",
              type: "community_chat_direct_canonical_reply",
              intent: directReply.route.intent,
              evidence_count: directReply.evidence.length,
            }));
            return Response.json(
              { messages: [human, assistant], kallistisResponded: true },
              { status: 201, headers },
            );
          }

          // This is the one shared General room. No private chat_threads row is
          // created as hidden context, so its history stays global and explicit.
          const runtime = createLocalChatRuntime(getRuntimeDatabaseUrl()!);
          try {
            const history = await listCommunityChatMessages(sql, 60);
            const recentHistory: typeof history = [];
            let historyCharacters = 0;
            for (let index = history.length - 1; index >= 0 && recentHistory.length < 12; index -= 1) {
              const message = history[index]!;
              if (recentHistory.length > 0 && historyCharacters + message.content.length > 12_000) break;
              recentHistory.push(message);
              historyCharacters += message.content.length;
            }
            recentHistory.reverse();
            const modelMessages = recentHistory.map((message) => ({
              role:
                message.role === "kallistis" && !message.publicNpcName
                  ? ("assistant" as const)
                  : ("user" as const),
              content:
                message.role === "kallistis" && !message.publicNpcName
                  ? message.content
                  : `${message.authorName}: ${message.content}`,
            }));
            const context = await buildKallistisCommunitySystem(
              runtime,
              auth.userId,
              randomUUID(),
              parsed.data.content,
            );
            console.info(JSON.stringify({
              level: "info",
              type: "community_chat_prompt_size",
              system_characters: context.system.length,
              evidence_characters: context.canonicalEvidence.reduce((total, item) => total + item.text.length, 0),
              history_messages: modelMessages.length,
              history_characters: modelMessages.reduce((total, message) => total + message.content.length, 0),
            }));
            const provider = createOpenRouterProvider({ requestId: randomUUID() });
            const result = await generateText({
              model: provider(AI_MODELS.chat),
              system: context.system,
              messages: modelMessages,
              temperature: 0.55,
              maxOutputTokens: 2400,
              maxRetries: 0,
              abortSignal: request.signal,
              timeout: { totalMs: chatProviderTimeoutMs() },
            });
            console.info(
              JSON.stringify({
                level: "info",
                type: "community_chat_model_result",
                finish_reason: result.finishReason,
                raw_finish_reason: result.rawFinishReason ?? null,
                response_characters: result.text.length,
                input_tokens: result.usage.inputTokens ?? null,
                output_tokens: result.usage.outputTokens ?? null,
                reasoning_tokens: result.usage.outputTokenDetails.reasoningTokens ?? null,
              }),
            );
            if (result.finishReason !== "stop")
              throw new Error(`community_chat_incomplete_assistant:${result.finishReason}`);
            const answer = prepareCommunityChatAssistantResponse(
              result.text,
              context.route,
              context.canonicalEvidence,
            );
            const assistant = await insertCommunityChatMessage(sql, {
              id: randomUUID(),
              authorUserId: null,
              role: "kallistis",
              content: answer,
              createdAt: new Date().toISOString(),
            });
            return Response.json(
              { messages: [human, assistant], kallistisResponded: true },
              { status: 201, headers },
            );
          } finally {
            runtime.close();
          }
        } catch (error) {
          console.error(
            JSON.stringify({
              level: "error",
              type: "community_chat_failed",
              user_id: auth.userId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          return Response.json({ error: "community_chat_failed" }, { status: 503, headers });
        } finally {
          sql.close();
        }
      },
    },
  },
});
