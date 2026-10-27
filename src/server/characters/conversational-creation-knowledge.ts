import type { SqlExecutor } from "@/server/local-core/postgres";
import type { CharacterSnapshot } from "./character-canon";
import { RULE_SOURCE_ID, retrieveCanonicalSectionByHeading } from "@/lib/canonical-rules.server";
import { BOOK_SOURCE_SHA256, BOOK_SOURCE_VERSION } from "./conversational-creation-book-manifest";
import { CREATION_PROPOSAL_PATHS } from "./conversational-creation";
import { resolveBookMemoryEntities } from "./conversational-creation-memory-graph";

export { BOOK_SOURCE_SHA256, BOOK_SOURCE_VERSION } from "./conversational-creation-book-manifest";

export function canonicalRuleEvidenceId(sourceId: string, section: string) {
  return `canonical-rule:${sourceId}:${section}`;
}

export type CreationBookSource = {
  sourceKind?: "book" | "canonical_rule";
  sourceVersion: string;
  sourceHash: string;
  chunkId: string;
  bookTitle: string;
  chapter: string;
  section: string;
  headingPath: string[];
  startLine?: number;
  endLine?: number;
  text: string;
  route4Id?: string;
  route10Id?: string;
  route50Id?: string;
  relatedChunkIds?: string[];
  ruleTags?: string[];
  memoryEntityIds?: string[];
  memoryRelationIds?: string[];
  retrievalReasons?: string[];
};

export type CreationConversationMemory = {
  qa: Array<{
    qaId: string;
    questionShort: string;
    answerShort: string;
    sourceChunkIds: string[];
    sourceVersion: string;
    sourceSha256?: string;
    confidence: "source-backed" | "unverified";
    supportStatus?:
      | "VERIFIED"
      | "SUPPORTED"
      | "PARTIAL"
      | "UNSUPPORTED"
      | "UNVERIFIED"
      | "CONTRADICTED"
      | "SUPERSEDED";
    supportMethod?: "independent-evaluator-v1";
    answerClaims?: Array<{
      claim: string;
      answerSpan?: string;
      kind: "mechanical" | "factual" | "narrative";
      status: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "CONTRADICTED" | "UNVERIFIED";
      answerAnchor?: "MATCHED" | "MISSING";
      provenanceStatus?: "VERIFIED" | "MISSING";
      semanticStatus?: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "CONTRADICTED";
      contradictionStatus?: "CONTRADICTED" | "NONE";
      sourceKind?: "book" | "canonical_rule";
      evidence: Array<{
        quote: string;
        chunkId: string;
        sourceKind?: "book" | "canonical_rule";
        sourceVersion?: string;
        sourceSha256?: string;
        provenance?: "literal_source_match";
      }>;
      sourceChunkIds?: string[];
    }>;
    supportedClaims?: Array<{
      claim: string;
      quote: string;
      chunkId: string;
      status?: "SUPPORTED";
      sourceKind?: "book" | "canonical_rule";
      sourceVersion?: string;
      sourceSha256?: string;
    }>;
    status: "answered";
    createdAt: string;
  }>;
  narrativeIdentity: Array<{ text: string; source: "player"; updatedAt: string }>;
  choices: Array<{
    fieldPath: string;
    currentValue: unknown;
    proposalValue?: unknown;
    status: "UNMENTIONED" | "INFERRED" | "PROPOSED" | "CONFIRMED" | "REJECTED" | "SUPERSEDED";
    evidenceTurnId: string | null;
    sourceChunkIds: string[];
    characterVersion: number;
  }>;
  inferences: Array<{
    text: string;
    evidence: string;
    status: "inferred";
    confidence: "low" | "medium" | "high";
    updatedAt: string;
  }>;
  pendingContradictions: Array<{ path: string; value: unknown; status: string; note?: string }>;
  consultedSources: Array<
    Pick<
      CreationBookSource,
      "chunkId" | "chapter" | "section" | "startLine" | "endLine" | "sourceKind"
    > & {
      sourceVersion: string;
      sourceSha256: string;
    }
  >;
};

type BookChunkRow = {
  chunk_id: string;
  book_title: string;
  chapter: string;
  section: string;
  heading_path: unknown;
  start_line: number;
  end_line: number;
  content: string;
  route4_id: string;
  route10_id: string;
  route50_id: string;
  keywords: string[];
  entities: string[];
  rule_tags: string[];
  related_chunk_ids: string[];
  score: number;
  lexical_score?: number;
  keyword_hits?: number;
  entity_hits?: number;
  tag_hits?: number;
};

export type CreationBookCandidate = {
  chunkId: string;
  chapter: string;
  section: string;
  headingPath: string[];
  keywords: string[];
  entities: string[];
  ruleTags: string[];
  relatedChunkIds: string[];
  route4Id: string;
  route10Id: string;
  route50Id: string;
  score: number;
  reason: string;
};

const emptyMemory = (): CreationConversationMemory => ({
  qa: [],
  narrativeIdentity: [],
  choices: [],
  inferences: [],
  pendingContradictions: [],
  consultedSources: [],
});

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function searchCreationBook(
  sql: SqlExecutor,
  query: string,
): Promise<CreationBookSource[]> {
  const normalized = query.trim().slice(0, 500);
  if (!normalized) return [];
  const graph = resolveBookMemoryEntities(normalized);
  const terms = searchTerms(normalized);
  const candidates = await sql.query<BookChunkRow>(
    `SELECT c.chunk_id, c.book_title, c.chapter, c.section, c.heading_path, c.start_line, c.end_line,
            c.route4_id, c.route10_id, c.route50_id, c.keywords, c.entities, c.rule_tags,
            c.related_chunk_ids,
            ts_rank_cd(c.search_document, websearch_to_tsquery('simple', $1)) AS lexical_score,
            (SELECT count(*) FROM unnest(c.keywords) item WHERE item = ANY($2::text[])) AS keyword_hits,
            (SELECT count(*) FROM unnest(c.entities) item WHERE item = ANY($2::text[])) AS entity_hits,
            (SELECT count(*) FROM unnest(c.rule_tags) item WHERE item = ANY($3::text[])) AS tag_hits,
            ts_rank_cd(c.search_document, websearch_to_tsquery('simple', $1))
              + (SELECT count(*) FROM unnest(c.keywords) item WHERE item = ANY($2::text[])) * 0.08
              + (SELECT count(*) FROM unnest(c.entities) item WHERE item = ANY($2::text[])) * 0.2
              + (SELECT count(*) FROM unnest(c.rule_tags) item WHERE item = ANY($3::text[])) * 0.12
              + CASE WHEN c.chunk_id = ANY($5::text[]) THEN 8 ELSE 0 END AS score
       FROM public.character_creation_book_chunks c
       JOIN public.character_creation_book_sources s ON s.source_sha256 = c.source_sha256
      WHERE s.status = 'active' AND c.source_sha256 = $4
        AND (c.search_document @@ websearch_to_tsquery('simple', $1)
             OR c.keywords && $2::text[] OR c.entities && $2::text[] OR c.rule_tags && $3::text[]
             OR c.chunk_id = ANY($5::text[]))
      ORDER BY score DESC, c.chunk_id ASC
      LIMIT 200`,
    [normalized, terms, ruleTagsForQuery(normalized), BOOK_SOURCE_SHA256, graph.chunkIds],
  );
  if (!candidates.length) return [];
  const r1 = routeR1Candidates(candidates, graph.chunkIds);
  const r2 = routeR2RefineCandidates(r1, normalized, graph.chunkIds);
  const r3 = routeR3SelectChunks(r2, graph.chunkIds);
  if (!r3.length) return [];
  const selected = [...r3];
  const needsDirectedExpansion =
    (graph.relations.length > 0 && graph.matchedEntityIds.length > 1) ||
    graph.matchedEntityIds.includes("povos");
  if (needsDirectedExpansion) {
    const selectedIds = new Set(selected.map((candidate) => candidate.chunkId));
    for (const candidate of r2) {
      if (selectedIds.has(candidate.chunkId) || !graph.chunkIds.includes(candidate.chunkId))
        continue;
      selected.push(candidate);
      selectedIds.add(candidate.chunkId);
      if (selected.length === 10) break;
    }
  }
  const rows = await sql.query<BookChunkRow>(
    `SELECT chunk_id, book_title, chapter, section, heading_path, start_line, end_line, content,
            route4_id, route10_id, route50_id, related_chunk_ids, rule_tags, 0::real AS score
       FROM public.character_creation_book_chunks
      WHERE source_sha256 = $1 AND chunk_id = ANY($2::text[])`,
    [BOOK_SOURCE_SHA256, selected.map((candidate) => candidate.chunkId)],
  );
  const byId = new Map(rows.map((row) => [row.chunk_id, row]));
  return selected.flatMap((candidate) => {
    const row = byId.get(candidate.chunkId);
    if (!row) return [];
    return [
      {
        chunkId: row.chunk_id,
        sourceVersion: BOOK_SOURCE_VERSION,
        sourceHash: BOOK_SOURCE_SHA256,
        bookTitle: row.book_title,
        chapter: row.chapter,
        section: row.section,
        headingPath: stringArray(row.heading_path),
        startLine: Number(row.start_line),
        endLine: Number(row.end_line),
        text: row.content,
        route4Id: row.route4_id,
        route10Id: row.route10_id,
        route50Id: row.route50_id,
        relatedChunkIds: stringArray(row.related_chunk_ids),
        ruleTags: stringArray(row.rule_tags),
        memoryEntityIds: graph.entities
          .filter((entity) => entity.sourceChunkIds.includes(row.chunk_id))
          .map((entity) => entity.id),
        memoryRelationIds: graph.relations
          .filter((relation) => relation.sourceChunkId === row.chunk_id)
          .map((relation) => `${relation.from}:${relation.relation}:${relation.to}`),
        retrievalReasons: graph.chunkIds.includes(row.chunk_id)
          ? ["canonical_entity_or_relation"]
          : ["lexical_or_book_metadata"],
      },
    ];
  });
}

const SEARCH_SYNONYMS: Record<string, string[]> = {
  atributo: [
    "atributos",
    "distribuicao",
    "corpo",
    "agilidade",
    "presenca",
    "intelecto",
    "vontade",
    "percepcao",
  ],
  oficio: ["oficios", "papel", "papeis", "caminho"],
  povo: ["povos", "ancestralidade"],
  origem: ["origens", "heranca", "herancas"],
  pericia: ["pericias", "habilidade", "habilidades", "skills"],
  combate: ["ataque", "dano", "iniciativa", "defesa", "armadura"],
  sintonia: ["ressonancia", "fluxo", "convergencia"],
};

const QUERY_TAGS: Record<string, string[]> = {
  atributo: ["attributes"],
  oficio: ["offices_roles"],
  povo: ["peoples"],
  origem: ["heritage_origin"],
  pericia: ["skills"],
  combate: ["combat"],
  sintonia: ["magic", "evocation"],
};

function fold(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function searchTerms(query: string) {
  const terms = new Set<string>();
  for (const token of fold(query).match(/[a-z0-9-]{2,}/g) ?? []) {
    if (
      !/^(a|ao|as|com|como|da|das|de|do|dos|e|em|na|nas|no|nos|o|os|ou|para|por|que|se|um|uma|uns|umas)$/.test(
        token,
      )
    )
      terms.add(token);
    for (const synonym of SEARCH_SYNONYMS[token] ?? []) terms.add(synonym);
  }
  return [...terms].slice(0, 48);
}

function ruleTagsForQuery(query: string) {
  const folded = fold(query);
  return [
    ...new Set(
      Object.entries(QUERY_TAGS).flatMap(([term, tags]) => (folded.includes(term) ? tags : [])),
    ),
  ];
}

function candidateFromRow(row: BookChunkRow): CreationBookCandidate {
  const lexical = Number(row.lexical_score ?? row.score ?? 0);
  const keywordHits = Number(row.keyword_hits ?? 0);
  const entityHits = Number(row.entity_hits ?? 0);
  const tagHits = Number(row.tag_hits ?? 0);
  const reasons = [
    lexical > 0 ? "correspondência textual" : "",
    keywordHits ? `palavras-chave:${keywordHits}` : "",
    entityHits ? `entidades:${entityHits}` : "",
    tagHits ? `tags:${tagHits}` : "",
  ].filter(Boolean);
  return {
    chunkId: row.chunk_id,
    chapter: row.chapter,
    section: row.section,
    headingPath: stringArray(row.heading_path),
    keywords: row.keywords ?? [],
    entities: row.entities ?? [],
    ruleTags: row.rule_tags ?? [],
    relatedChunkIds: row.related_chunk_ids ?? [],
    route4Id: row.route4_id,
    route10Id: row.route10_id,
    route50Id: row.route50_id,
    score: Number(row.score ?? lexical + keywordHits * 0.08 + entityHits * 0.2 + tagHits * 0.12),
    reason: reasons.join(", ") || "relevância lexical",
  };
}

export function routeR1Candidates(
  rows: readonly BookChunkRow[],
  preferredChunkIds: readonly string[] = [],
): CreationBookCandidate[] {
  const preferred = new Set(preferredChunkIds);
  return rows
    .map(candidateFromRow)
    .sort(
      (left, right) =>
        Number(preferred.has(right.chunkId)) - Number(preferred.has(left.chunkId)) ||
        right.score - left.score ||
        left.chunkId.localeCompare(right.chunkId),
    )
    .slice(0, 50);
}

export function routeR2RefineCandidates(
  candidates: readonly CreationBookCandidate[],
  query: string,
  preferredChunkIds: readonly string[] = [],
): CreationBookCandidate[] {
  const tags = ruleTagsForQuery(query);
  const preferred = new Set(preferredChunkIds);
  const reranked = candidates
    .map((candidate) => ({
      ...candidate,
      score: candidate.score + candidate.ruleTags.filter((tag) => tags.includes(tag)).length * 0.25,
      reason: tags.some((tag) => candidate.ruleTags.includes(tag))
        ? `${candidate.reason}, prioridade temática`
        : candidate.reason,
    }))
    .sort(
      (left, right) =>
        Number(preferred.has(right.chunkId)) - Number(preferred.has(left.chunkId)) ||
        right.score - left.score ||
        left.chunkId.localeCompare(right.chunkId),
    );
  const selected: CreationBookCandidate[] = [];
  const routeCounts = new Map<string, number>();
  for (const candidate of reranked) {
    const count = routeCounts.get(candidate.route50Id) ?? 0;
    if (count >= 2) continue;
    selected.push(candidate);
    routeCounts.set(candidate.route50Id, count + 1);
    if (selected.length === 10) break;
  }
  return selected;
}

export function routeR3SelectChunks(
  candidates: readonly CreationBookCandidate[],
  preferredChunkIds: readonly string[] = [],
): CreationBookCandidate[] {
  const selected: CreationBookCandidate[] = [];
  const sections = new Set<string>();
  const preferred = new Set(preferredChunkIds);
  for (const candidate of candidates) {
    if (!preferred.has(candidate.chunkId)) continue;
    selected.push(candidate);
    sections.add(`${candidate.route10Id}:${candidate.section}`);
    if (selected.length === 4) return selected;
  }
  for (const candidate of candidates) {
    if (selected.some((item) => item.chunkId === candidate.chunkId)) continue;
    const section = `${candidate.route10Id}:${candidate.section}`;
    if (sections.has(section)) continue;
    selected.push(candidate);
    sections.add(section);
    if (selected.length === 4) break;
  }
  if (selected.length < 4) {
    const selectedIds = new Set(selected.map((candidate) => candidate.chunkId));
    for (const candidate of candidates) {
      if (selectedIds.has(candidate.chunkId)) continue;
      selected.push(candidate);
      if (selected.length === 4) break;
    }
  }
  return selected;
}

export function canonicalEvidenceIdsForRevalidation(
  qa: CreationConversationMemory["qa"],
): string[] {
  const ids = new Set<string>();
  for (const item of qa) {
    if (
      !["SUPPORTED", "VERIFIED"].includes(item.supportStatus ?? "") ||
      item.sourceVersion !== BOOK_SOURCE_VERSION ||
      item.sourceSha256 !== BOOK_SOURCE_SHA256
    )
      continue;
    for (const claim of item.supportedClaims ?? []) {
      if (claim.sourceKind === "canonical_rule") ids.add(claim.chunkId);
    }
    for (const claim of item.answerClaims ?? []) {
      if (claim.status !== "SUPPORTED") continue;
      for (const evidence of claim.evidence) {
        if (evidence.sourceKind === "canonical_rule") ids.add(evidence.chunkId);
      }
    }
  }
  return [...ids];
}

export async function readCreationConversationMemory(
  sql: SqlExecutor,
  characterId: string,
  ownerUserId: string,
): Promise<CreationConversationMemory> {
  const rows = await sql.query<Record<string, unknown>>(
    `SELECT qa, narrative_identity, choices, inferences, pending_contradictions, consulted_sources
       FROM public.character_creation_conversation_memory
      WHERE character_id = $1 AND owner_user_id = $2 LIMIT 1`,
    [characterId, ownerUserId],
  );
  const row = rows[0];
  if (!row) return emptyMemory();
  const storedQa = Array.isArray(row.qa) ? (row.qa as CreationConversationMemory["qa"]) : [];
  const verifiedSourceIds = [
    ...new Set(
      storedQa
        .filter(
          (item) =>
            ["VERIFIED", "SUPPORTED"].includes(item.supportStatus ?? "") &&
            item.sourceVersion === BOOK_SOURCE_VERSION &&
            item.sourceSha256 === BOOK_SOURCE_SHA256,
        )
        .flatMap((item) => [
          ...(item.supportedClaims ?? []).filter((claim) => claim.sourceKind !== "canonical_rule"),
          ...(item.answerClaims ?? []).flatMap((claim) =>
            claim.status === "SUPPORTED" && claim.sourceKind !== "canonical_rule"
              ? claim.evidence.map((evidence) => ({ ...evidence, claim: claim.claim }))
              : [],
          ),
        ])
        .map((claim) => claim.chunkId),
    ),
  ];
  const verifiedSourceRows = verifiedSourceIds.length
    ? await sql.query<{ chunk_id: string; content: string }>(
        `SELECT c.chunk_id, c.content
           FROM public.character_creation_book_chunks c
           JOIN public.character_creation_book_sources s ON s.source_sha256 = c.source_sha256
          WHERE s.status = 'active' AND c.source_sha256 = $1 AND c.chunk_id = ANY($2::text[])`,
        [BOOK_SOURCE_SHA256, verifiedSourceIds],
      )
    : [];
  const sourceContent = new Map<
    string,
    {
      text: string;
      sourceKind: "book" | "canonical_rule";
      sourceVersion: string;
      sourceHash: string;
    }
  >(
    verifiedSourceRows.map((source) => [
      source.chunk_id,
      {
        text: source.content,
        sourceKind: "book" as const,
        sourceVersion: BOOK_SOURCE_VERSION,
        sourceHash: BOOK_SOURCE_SHA256,
      },
    ]),
  );
  // Only already-supported citations need canonical revalidation. Searching every
  // historical question here makes each POST re-run rule retrieval dozens of times
  // (including for unverified answers) and exhausts the Workers Free CPU budget.
  const canonicalIds = canonicalEvidenceIdsForRevalidation(storedQa);
  const canonicalPrefix = `canonical-rule:${RULE_SOURCE_ID}:`;
  for (const chunkId of canonicalIds) {
    if (!chunkId.startsWith(canonicalPrefix)) continue;
    const section = chunkId.slice(canonicalPrefix.length);
    const source = retrieveCanonicalSectionByHeading(section);
    if (!source) continue;
    sourceContent.set(chunkId, {
      text: source.text,
      sourceKind: "canonical_rule",
      sourceVersion: source.sourceVersion,
      sourceHash: source.sourceHash,
    });
  }
  const verifiedQuote = (
    quote: string,
    chunkId: string,
    sourceKind: "book" | "canonical_rule" = "book",
    sourceVersion?: string,
    sourceHash?: string,
  ) => {
    const source = sourceContent.get(chunkId);
    return Boolean(
      source &&
      source.sourceKind === sourceKind &&
      source.sourceVersion === (sourceVersion ?? BOOK_SOURCE_VERSION) &&
      source.sourceHash === (sourceHash ?? BOOK_SOURCE_SHA256) &&
      source.text.includes(quote),
    );
  };
  return {
    qa: storedQa.map((item) => {
      const claims = Array.isArray(item.supportedClaims) ? item.supportedClaims : [];
      const sourceCurrent =
        item.sourceVersion === BOOK_SOURCE_VERSION && item.sourceSha256 === BOOK_SOURCE_SHA256;
      const legacyVerified =
        item.supportStatus === "VERIFIED" &&
        sourceCurrent &&
        claims.length > 0 &&
        claims.every(
          (claim) =>
            claim.claim
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase() ===
              claim.quote
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase() &&
            verifiedQuote(
              claim.quote,
              claim.chunkId,
              claim.sourceKind ?? "book",
              claim.sourceVersion ?? item.sourceVersion,
              claim.sourceSha256 ?? item.sourceSha256,
            ),
        ) &&
        claims.every((claim) =>
          normalizeMemoryText(item.answerShort).includes(normalizeMemoryText(claim.quote)),
        );
      const answerClaims = Array.isArray(item.answerClaims) ? item.answerClaims : [];
      const independentlySupported =
        item.supportStatus === "SUPPORTED" &&
        item.supportMethod === "independent-evaluator-v1" &&
        sourceCurrent &&
        answerClaims.length > 0 &&
        answerClaims.every(
          (claim) =>
            claim.status === "SUPPORTED" &&
            claim.answerAnchor === "MATCHED" &&
            claim.provenanceStatus === "VERIFIED" &&
            claim.semanticStatus === "SUPPORTED" &&
            claim.contradictionStatus === "NONE" &&
            Boolean(claim.answerSpan) &&
            normalizeMemoryText(item.answerShort).includes(
              normalizeMemoryText(claim.answerSpan!),
            ) &&
            claim.evidence.length > 0 &&
            claim.evidence.every(
              (evidence) =>
                evidence.sourceKind !== undefined &&
                evidence.sourceVersion !== undefined &&
                evidence.sourceSha256 !== undefined &&
                evidence.provenance === "literal_source_match" &&
                verifiedQuote(
                  evidence.quote,
                  evidence.chunkId,
                  evidence.sourceKind,
                  evidence.sourceVersion,
                  evidence.sourceSha256,
                ),
            ),
        );
      const verified = legacyVerified || independentlySupported;
      return {
        ...item,
        confidence: verified ? ("source-backed" as const) : ("unverified" as const),
        supportStatus:
          !sourceCurrent && ["VERIFIED", "SUPPORTED"].includes(item.supportStatus ?? "")
            ? ("SUPERSEDED" as const)
            : verified
              ? independentlySupported
                ? ("SUPPORTED" as const)
                : ("VERIFIED" as const)
              : ["VERIFIED", "SUPPORTED"].includes(item.supportStatus ?? "")
                ? ("UNVERIFIED" as const)
                : (item.supportStatus ?? ("UNVERIFIED" as const)),
        supportedClaims: verified ? claims : [],
      };
    }),
    narrativeIdentity: Array.isArray(row.narrative_identity)
      ? (row.narrative_identity as CreationConversationMemory["narrativeIdentity"])
      : [],
    choices: Array.isArray(row.choices)
      ? (row.choices as CreationConversationMemory["choices"])
      : [],
    inferences: Array.isArray(row.inferences)
      ? (row.inferences as CreationConversationMemory["inferences"])
      : [],
    pendingContradictions: Array.isArray(row.pending_contradictions)
      ? (row.pending_contradictions as CreationConversationMemory["pendingContradictions"])
      : [],
    consultedSources: Array.isArray(row.consulted_sources)
      ? (row.consulted_sources as CreationConversationMemory["consultedSources"])
      : [],
  };
}

function valueAtPath(snapshot: CharacterSnapshot, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => {
    const key = /^\d+$/.test(part) ? Number(part) : part;
    return value && typeof value === "object"
      ? (value as Record<string | number, unknown>)[key]
      : undefined;
  }, snapshot);
}

function normalizeMemoryText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function supportIsVerified(
  support:
    | {
        status:
          | "VERIFIED"
          | "SUPPORTED"
          | "PARTIAL"
          | "UNSUPPORTED"
          | "UNVERIFIED"
          | "CONTRADICTED"
          | "SUPERSEDED";
        answer?: string;
        claims: Array<
          | {
              claim: string;
              quote: string;
              chunkId: string;
              sourceKind?: "book" | "canonical_rule";
              sourceVersion?: string;
              sourceSha256?: string;
            }
          | {
              claim: string;
              answerQuote: string;
              kind: "mechanical" | "factual" | "narrative";
              status: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "CONTRADICTED" | "UNVERIFIED";
              answerAnchor?: "MATCHED" | "MISSING";
              provenanceStatus?: "VERIFIED" | "MISSING";
              semanticStatus?: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "CONTRADICTED";
              contradictionStatus?: "CONTRADICTED" | "NONE";
              evidence: Array<{
                quote: string;
                chunkId: string;
                sourceKind?: "book" | "canonical_rule";
                sourceVersion?: string;
                sourceHash?: string;
              }>;
            }
        >;
      }
    | undefined,
  sources: CreationBookSource[],
  intent: string,
) {
  if (intent !== "question" || !support || !support.claims.length) return false;
  if (support.status === "SUPPORTED") {
    if (!support.answer) return false;
    return support.claims.every((claim) => {
      if (
        !("evidence" in claim) ||
        claim.status !== "SUPPORTED" ||
        claim.answerAnchor !== "MATCHED" ||
        claim.provenanceStatus !== "VERIFIED" ||
        claim.semanticStatus !== "SUPPORTED" ||
        claim.contradictionStatus !== "NONE"
      )
        return false;
      if (!normalizeMemoryText(support.answer!).includes(normalizeMemoryText(claim.answerQuote)))
        return false;
      return (
        claim.evidence.length > 0 &&
        claim.evidence.every((item) => {
          const source = sources.find((candidate) => candidate.chunkId === item.chunkId);
          const sourceKind = item.sourceKind ?? "book";
          return Boolean(
            source &&
            (source.sourceKind ?? "book") === sourceKind &&
            source.sourceVersion === (item.sourceVersion ?? BOOK_SOURCE_VERSION) &&
            source.sourceHash === (item.sourceHash ?? BOOK_SOURCE_SHA256) &&
            item.quote.length >= 12 &&
            normalizeMemoryText(source.text).includes(normalizeMemoryText(item.quote)),
          );
        })
      );
    });
  }
  if (support.status !== "VERIFIED") return false;
  if (!support.answer) return false;
  return support.claims.every((claim) => {
    if (!("quote" in claim)) return false;
    const source = sources.find((item) => item.chunkId === claim.chunkId);
    return Boolean(
      source &&
      (source.sourceKind ?? "book") === "book" &&
      source.sourceVersion === BOOK_SOURCE_VERSION &&
      source.sourceHash === BOOK_SOURCE_SHA256 &&
      claim.quote.length >= 12 &&
      normalizeMemoryText(support.answer!).includes(normalizeMemoryText(claim.quote)) &&
      source.text.includes(claim.quote),
    );
  });
}

export function updateCreationConversationMemory(input: {
  previous: CreationConversationMemory;
  snapshot: CharacterSnapshot;
  userMessage: string;
  assistantMessage: string;
  intent: "narrative" | "question" | "proposal" | "revision" | "clarification" | "summary";
  sources: CreationBookSource[];
  answerSupport?: {
    status:
      | "VERIFIED"
      | "SUPPORTED"
      | "PARTIAL"
      | "UNSUPPORTED"
      | "UNVERIFIED"
      | "CONTRADICTED"
      | "SUPERSEDED";
    answer?: string;
    claims: Array<
      | {
          claim: string;
          quote: string;
          chunkId: string;
          sourceKind?: "book" | "canonical_rule";
          sourceVersion?: string;
          sourceSha256?: string;
        }
      | {
          claim: string;
          answerQuote: string;
          kind: "mechanical" | "factual" | "narrative";
          status: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "CONTRADICTED" | "UNVERIFIED";
          answerAnchor?: "MATCHED" | "MISSING";
          provenanceStatus?: "VERIFIED" | "MISSING";
          semanticStatus?: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "CONTRADICTED";
          contradictionStatus?: "CONTRADICTED" | "NONE";
          evidence: Array<{
            quote: string;
            chunkId: string;
            sourceKind?: "book" | "canonical_rule";
            sourceVersion?: string;
            sourceHash?: string;
          }>;
        }
    >;
  };
  memoryUpdates?: Array<{
    kind: "declaration" | "inference";
    fieldPath: string | null;
    text: string;
    evidence: string;
    confidence: "low" | "medium" | "high";
  }>;
  evidenceMessages?: string[];
  characterVersion?: number;
  updatedAt?: string;
}): CreationConversationMemory {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const progress = (input.snapshot.serverCreationProgress ?? {}) as {
    confirmedPaths?: unknown;
    pendingProposals?: unknown;
  };
  const confirmedPaths = stringArray(progress.confirmedPaths);
  const pending = Array.isArray(progress.pendingProposals) ? progress.pendingProposals : [];
  const previousChoicesByPath = new Map<string, CreationConversationMemory["choices"]>();
  for (const item of input.previous.choices) {
    const current = previousChoicesByPath.get(item.fieldPath) ?? [];
    current.push(item);
    previousChoicesByPath.set(item.fieldPath, current);
  }
  const pendingByPath = new Map<string, Record<string, unknown>[]>();
  for (const proposal of pending) {
    if (!proposal || typeof proposal !== "object") continue;
    const item = proposal as Record<string, unknown>;
    if (typeof item.path !== "string") continue;
    const current = pendingByPath.get(item.path) ?? [];
    current.push(item);
    pendingByPath.set(item.path, current);
  }
  const userEvidence = input.evidenceMessages?.length
    ? input.evidenceMessages
    : input.userMessage
      ? [input.userMessage]
      : [];
  const validUpdates = (input.memoryUpdates ?? []).filter(
    (entry) =>
      entry.evidence.trim().length > 0 &&
      userEvidence.some((text) => text.includes(entry.evidence.trim())),
  );
  const inferredByPath = new Map<string, (typeof validUpdates)[number]>();
  for (const entry of validUpdates) {
    if (
      entry.kind === "inference" &&
      entry.fieldPath &&
      !confirmedPaths.includes(entry.fieldPath) &&
      !pendingByPath.has(entry.fieldPath)
    ) {
      inferredByPath.set(entry.fieldPath, entry);
    }
  }
  const fieldPaths = [
    ...new Set([
      ...CREATION_PROPOSAL_PATHS,
      ...confirmedPaths,
      ...pendingByPath.keys(),
      ...inferredByPath.keys(),
    ]),
  ];
  const choices = fieldPaths.flatMap((fieldPath) => {
    const prior = previousChoicesByPath.get(fieldPath) ?? [];
    const proposed = pendingByPath.get(fieldPath) ?? [];
    if (proposed.length)
      return proposed.map((item) => ({
        fieldPath,
        currentValue: valueAtPath(input.snapshot, fieldPath),
        proposalValue: item.value,
        status: "PROPOSED" as const,
        evidenceTurnId: null,
        sourceChunkIds: input.sources.map((source) => source.chunkId),
        characterVersion: input.characterVersion ?? 0,
      }));
    const inferred = inferredByPath.get(fieldPath);
    if (inferred)
      return [
        {
          fieldPath,
          currentValue: valueAtPath(input.snapshot, fieldPath),
          proposalValue: inferred.text.slice(0, 800),
          status: "INFERRED" as const,
          evidenceTurnId: null,
          sourceChunkIds: input.sources.map((source) => source.chunkId),
          characterVersion: input.characterVersion ?? 0,
        },
      ];
    if (confirmedPaths.includes(fieldPath)) {
      const value = valueAtPath(input.snapshot, fieldPath);
      const superseded = prior.filter(
        (item) =>
          item.status === "CONFIRMED" &&
          JSON.stringify(item.currentValue) !== JSON.stringify(value),
      );
      return [
        ...superseded.map((item) => ({ ...item, status: "SUPERSEDED" as const })),
        {
          fieldPath,
          currentValue: value,
          status: "CONFIRMED" as const,
          evidenceTurnId: prior.find((item) => item.status === "CONFIRMED")?.evidenceTurnId ?? null,
          sourceChunkIds: input.sources.map((source) => source.chunkId),
          characterVersion: input.characterVersion ?? 0,
        },
      ];
    }
    const rejected = prior
      .filter((item) => item.status === "PROPOSED")
      .map((item) => ({ ...item, status: "REJECTED" as const }));
    const retained = prior.filter((item) =>
      ["REJECTED", "SUPERSEDED", "INFERRED"].includes(item.status),
    );
    if (rejected.length || retained.length) return [...retained, ...rejected];
    return [
      {
        fieldPath,
        currentValue: valueAtPath(input.snapshot, fieldPath),
        status: "UNMENTIONED" as const,
        evidenceTurnId: null,
        sourceChunkIds: [],
        characterVersion: input.characterVersion ?? 0,
      },
    ];
  });
  const pendingContradictions = pending.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const proposal = item as Record<string, unknown>;
    return typeof proposal.path === "string"
      ? [{ path: proposal.path, value: proposal.value, status: "proposed" }]
      : [];
  });
  const sources = input.sources.map(
    ({ sourceKind, sourceVersion, sourceHash, chunkId, chapter, section, startLine, endLine }) => ({
      chunkId,
      chapter,
      section,
      startLine,
      endLine,
      sourceKind: sourceKind ?? "book",
      sourceVersion,
      sourceSha256: sourceHash,
    }),
  );
  const supportVerified = supportIsVerified(input.answerSupport, input.sources, input.intent);
  type PersistedAnswerClaim = NonNullable<
    CreationConversationMemory["qa"][number]["answerClaims"]
  >[number];
  const trustedClaims: Array<{
    claim: string;
    quote: string;
    chunkId: string;
    status?: "SUPPORTED";
    sourceKind?: "book" | "canonical_rule";
    sourceVersion?: string;
    sourceSha256?: string;
  }> = [];
  const answerClaims: PersistedAnswerClaim[] | undefined = input.answerSupport?.claims.map(
    (claim) => {
      if ("evidence" in claim) {
        return {
          claim: claim.claim,
          answerSpan: claim.answerQuote,
          kind: claim.kind,
          status: claim.status,
          answerAnchor: "answerAnchor" in claim ? claim.answerAnchor : undefined,
          provenanceStatus: "provenanceStatus" in claim ? claim.provenanceStatus : undefined,
          semanticStatus: "semanticStatus" in claim ? claim.semanticStatus : undefined,
          contradictionStatus:
            "contradictionStatus" in claim ? claim.contradictionStatus : undefined,
          evidence: claim.evidence.map((item) => {
            const source = input.sources.find((candidate) => candidate.chunkId === item.chunkId);
            return {
              ...item,
              sourceKind: source?.sourceKind ?? "book",
              sourceVersion: source?.sourceVersion,
              sourceSha256: source?.sourceHash,
              provenance: "literal_source_match" as const,
            };
          }),
          sourceChunkIds: [...new Set(claim.evidence.map((item) => item.chunkId))],
        };
      }
      const source = input.sources.find((item) => item.chunkId === claim.chunkId);
      return {
        claim: claim.claim,
        answerSpan: claim.claim,
        kind: "factual",
        status: "SUPPORTED",
        evidence: [
          {
            quote: claim.quote,
            chunkId: claim.chunkId,
            sourceVersion: source?.sourceVersion,
            sourceSha256: source?.sourceHash,
            provenance: "literal_source_match",
          },
        ],
        sourceChunkIds: [claim.chunkId],
      };
    },
  );
  let trustedAnswerLength = 0;
  if (supportVerified) {
    for (const claim of answerClaims ?? []) {
      if (claim.status !== "SUPPORTED") continue;
      for (const evidence of claim.evidence) {
        const separatorLength = trustedClaims.length ? 1 : 0;
        if (trustedAnswerLength + separatorLength + claim.claim.trim().length > 1000) break;
        trustedClaims.push({
          claim: claim.claim,
          quote: evidence.quote,
          chunkId: evidence.chunkId,
          status: "SUPPORTED",
          sourceKind: evidence.sourceKind,
          sourceVersion: evidence.sourceVersion,
          sourceSha256: evidence.sourceSha256,
        });
        trustedAnswerLength += separatorLength + claim.claim.trim().length;
      }
    }
  }
  const trustedAnswer = trustedClaims.map((claim) => claim.claim.trim()).join(" ");
  const newQa =
    input.intent === "question" && input.userMessage
      ? [
          {
            qaId: `${updatedAt}:${input.userMessage.slice(0, 80)}`,
            questionShort: input.userMessage.slice(0, 500),
            answerShort: supportVerified
              ? (input.answerSupport?.answer?.slice(0, 1000) ?? trustedAnswer)
              : input.assistantMessage.slice(0, 1000),
            sourceChunkIds: sources.map((source) => source.chunkId),
            sourceVersion: BOOK_SOURCE_VERSION,
            sourceSha256: BOOK_SOURCE_SHA256,
            confidence: supportVerified ? ("source-backed" as const) : ("unverified" as const),
            supportStatus: input.answerSupport?.status ?? "UNVERIFIED",
            ...(supportVerified && input.answerSupport?.status === "SUPPORTED"
              ? { supportMethod: "independent-evaluator-v1" as const }
              : {}),
            ...(answerClaims?.length ? { answerClaims } : {}),
            supportedClaims: supportVerified ? trustedClaims : [],
            status: "answered" as const,
            createdAt: updatedAt,
          },
        ]
      : [];
  const declaredMessage =
    ["narrative", "proposal", "revision"].includes(input.intent) && input.userMessage.trim()
      ? [{ text: input.userMessage.trim().slice(0, 2500), source: "player" as const, updatedAt }]
      : [];
  const newIdentity = [
    ...declaredMessage,
    ...validUpdates
      .filter((entry) => entry.kind === "declaration")
      .map((entry) => ({ text: entry.evidence.trim(), source: "player" as const, updatedAt })),
  ];
  const newInferences = validUpdates
    .filter((entry) => entry.kind === "inference")
    .map((entry) => ({
      text: entry.text.slice(0, 800),
      evidence: entry.evidence.trim(),
      status: "inferred" as const,
      confidence: entry.confidence,
      updatedAt,
    }));
  return {
    qa: [...input.previous.qa, ...newQa].slice(-60),
    narrativeIdentity: [...input.previous.narrativeIdentity, ...newIdentity].slice(-60),
    choices: choices.slice(-250),
    inferences: [...input.previous.inferences, ...newInferences].slice(-100),
    pendingContradictions,
    consultedSources: [
      ...input.previous.consultedSources.filter(
        (entry) => !sources.some((source) => source.chunkId === entry.chunkId),
      ),
      ...sources,
    ].slice(-80),
  };
}

export async function saveCreationConversationMemory(input: {
  sql: SqlExecutor;
  characterId: string;
  ownerUserId: string;
  memory: CreationConversationMemory;
  lastMessageAt?: string;
}) {
  await input.sql.query(
    `INSERT INTO public.character_creation_conversation_memory
       (character_id, owner_user_id, qa, narrative_identity, choices, inferences,
        pending_contradictions, consulted_sources, last_message_at, updated_at)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,now())
     ON CONFLICT (character_id) DO UPDATE SET
       owner_user_id = EXCLUDED.owner_user_id,
       qa = EXCLUDED.qa,
       narrative_identity = EXCLUDED.narrative_identity,
       choices = EXCLUDED.choices,
       inferences = EXCLUDED.inferences,
       pending_contradictions = EXCLUDED.pending_contradictions,
       consulted_sources = EXCLUDED.consulted_sources,
       last_message_at = EXCLUDED.last_message_at,
       updated_at = now()`,
    [
      input.characterId,
      input.ownerUserId,
      JSON.stringify(input.memory.qa),
      JSON.stringify(input.memory.narrativeIdentity),
      JSON.stringify(input.memory.choices),
      JSON.stringify(input.memory.inferences),
      JSON.stringify(input.memory.pendingContradictions),
      JSON.stringify(input.memory.consultedSources),
      input.lastMessageAt ?? null,
    ],
  );
}

export function emptyCreationConversationMemory() {
  return emptyMemory();
}

function memoryRelevance(text: string, terms: Set<string>) {
  const folded = fold(text);
  return [...terms].reduce((score, term) => score + (folded.includes(term) ? 1 : 0), 0);
}

export function selectRelevantCreationMemory(
  memory: CreationConversationMemory,
  query: string,
): CreationConversationMemory {
  const terms = new Set(searchTerms(query));
  const ranked = <T>(items: T[], textOf: (item: T) => string, limit: number) =>
    items
      .map((item, index) => ({ item, index, score: memoryRelevance(textOf(item), terms) }))
      .sort((left, right) => right.score - left.score || right.index - left.index)
      .slice(0, limit)
      .sort((left, right) => left.index - right.index)
      .map(({ item }) => item);
  return {
    qa: ranked(
      memory.qa.filter(
        (item) =>
          item.sourceVersion === BOOK_SOURCE_VERSION &&
          item.sourceSha256 === BOOK_SOURCE_SHA256 &&
          ["VERIFIED", "SUPPORTED"].includes(item.supportStatus ?? "") &&
          item.confidence === "source-backed" &&
          item.sourceChunkIds.length > 0,
      ),
      (item) => `${item.questionShort} ${item.answerShort}`,
      4,
    ),
    narrativeIdentity: ranked(memory.narrativeIdentity, (item) => item.text, 4).map((item) => ({
      ...item,
      text: item.text.slice(0, 600),
    })),
    choices: memory.choices.filter((item) => item.status !== "UNMENTIONED").slice(-12),
    inferences: ranked(memory.inferences, (item) => `${item.text} ${item.evidence}`, 5),
    pendingContradictions: memory.pendingContradictions.slice(-8),
    consultedSources: memory.consultedSources
      .filter(
        (item) =>
          item.sourceVersion === BOOK_SOURCE_VERSION && item.sourceSha256 === BOOK_SOURCE_SHA256,
      )
      .slice(-6),
  };
}

function csvCell(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function creationConversationMemoryCsv(
  conversationId: string,
  memory: CreationConversationMemory,
) {
  const rows: unknown[][] = [
    [
      "conversation_id",
      "sheet",
      "record",
      "value",
      "status",
      "evidence",
      "source_chunk_ids",
      "source_version",
      "updated_at",
    ],
  ];
  const append = (
    sheet: string,
    record: unknown,
    value: unknown,
    status: unknown,
    evidence: unknown,
    sourceChunkIds: unknown,
    sourceVersion: unknown,
    updatedAt: unknown,
  ) =>
    rows.push([
      conversationId,
      sheet,
      record,
      value,
      status,
      evidence,
      sourceChunkIds,
      sourceVersion,
      updatedAt,
    ]);

  memory.qa.forEach((item) =>
    append(
      "Perguntas e respostas",
      item.questionShort,
      item.answerShort,
      item.status,
      item.confidence,
      item.sourceChunkIds,
      item.sourceVersion,
      item.createdAt,
    ),
  );
  memory.narrativeIdentity.forEach((item) =>
    append(
      "Identidade narrativa",
      item.text,
      item.text,
      item.source,
      item.source,
      [],
      "",
      item.updatedAt,
    ),
  );
  memory.choices.forEach((item) =>
    append(
      "Escolhas da ficha",
      item.fieldPath,
      { current: item.currentValue, proposal: item.proposalValue },
      item.status,
      item.evidenceTurnId,
      item.sourceChunkIds,
      "",
      item.characterVersion,
    ),
  );
  memory.inferences.forEach((item) =>
    append(
      "Inferências",
      item.text,
      item.text,
      item.status,
      item.evidence,
      [],
      item.confidence,
      item.updatedAt,
    ),
  );
  memory.pendingContradictions.forEach((item) =>
    append(
      "Pendências e contradições",
      item.path,
      item.value,
      item.status,
      item.note ?? "",
      [],
      "",
      "",
    ),
  );
  memory.consultedSources.forEach((item) =>
    append(
      "Fontes consultadas",
      item.chunkId,
      `${item.chapter} · ${item.section} · linhas ${item.startLine}-${item.endLine}`,
      "consulted",
      "",
      [item.chunkId],
      item.sourceVersion,
      "",
    ),
  );

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
