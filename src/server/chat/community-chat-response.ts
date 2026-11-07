import { sanitizeAssistantOutput } from "@/lib/sanitize-assistant-output";
import {
  bindCanonicalEvidenceCitations,
  type CanonicalCitationEvidence,
} from "@/lib/canonical-rules.server";
import type { CanonicalChatRoute } from "@/server/chat/canonical-intent-routing";

export function prepareCommunityChatAssistantResponse(
  raw: string,
  route: CanonicalChatRoute,
  evidence: CanonicalCitationEvidence[],
) {
  const content = sanitizeAssistantOutput(raw.trim(), { emptyBehavior: "empty" });
  if (!content) throw new Error("community_chat_empty_assistant");
  const response =
    route.handling === "answer"
      ? bindCanonicalEvidenceCitations(content, evidence, evidence.length > 0)
      : content;
  if (response.length > 4000) throw new Error("community_chat_answer_exceeds_storage_limit");
  return response;
}
