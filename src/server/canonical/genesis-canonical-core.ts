import generated from "./genesis-canonical.generated.json";

export type CanonicalBook = "ABERTURA" | "LIVRO I — HISTÓRIA" | "LIVRO II — ATLAS" | "LIVRO III — SISTEMA" | "LIVRO IV — NARRANDO O JOGO" | "APÊNDICES";
export type CanonicalEvidence = {
  canonicalId: string;
  revision: string;
  markdownSha256: string;
  pdfSha256: string;
  book: CanonicalBook;
  section: string;
  sectionPath: string[];
  headings: string[];
  page: number;
  text: string;
};

const index = generated as {
  manifest: {
    canonicalId: string;
    revision: string;
    title: string;
    markdownFile: string;
    markdownSha256: string;
    pdfFile: string;
    pdfSha256: string;
    pageCount: number;
    editorialMarker: string;
    editorialMarkerPdfPage: number;
  };
  choices: Record<string, { status: "available" | "gap"; items: Array<{ name: string; pageNumber: number; definition?: string; source?: { canonicalId: string; revision: string; markdownSha256: string; pdfSha256: string; book: CanonicalBook; section: string; page: number; sectionPath: string[] } }>; note?: string; pageNumber?: number }>;
  pages: Array<{ pageNumber: number; book: CanonicalBook; sectionPath: string[]; headings: string[]; text: string }>;
};

export const CANONICAL_MANIFEST = Object.freeze(index.manifest);
const pages = index.pages;

if (pages.length !== CANONICAL_MANIFEST.pageCount
  || CANONICAL_MANIFEST.canonicalId !== "KALLISTIS_NEXO_FINAL"
  || CANONICAL_MANIFEST.editorialMarker !== "MOVIMENTO B — COMUNIDADES VIVAS") {
  throw new Error("genesis_canonical_index_contract_mismatch");
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function evidenceFor(page: (typeof pages)[number], query = ""): CanonicalEvidence {
  const terms = normalize(query).split(" ").filter((term) => term.length > 1);
  const headings = [...page.headings, ...page.sectionPath];
  const matchingHeading = headings
    .map((heading, order) => ({ heading, order, score: terms.filter((term) => normalize(heading).includes(term)).length }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.order - a.order)[0]?.heading;
  return {
    canonicalId: CANONICAL_MANIFEST.canonicalId,
    revision: CANONICAL_MANIFEST.revision,
    markdownSha256: CANONICAL_MANIFEST.markdownSha256,
    pdfSha256: CANONICAL_MANIFEST.pdfSha256,
    book: page.book,
    section: matchingHeading ?? page.headings.at(-1) ?? page.sectionPath.at(-1) ?? page.book,
    sectionPath: [...page.sectionPath],
    headings: [...page.headings],
    page: page.pageNumber,
    text: page.text,
  };
}

export function getCanonicalCharacterChoices() {
  return structuredClone(index.choices);
}

export function getCanonicalOptionDefinition(category: "peoples" | "offices", name: string): CanonicalEvidence[] {
  const option = index.choices[category]?.items.find((item) => item.name === name);
  if (!option?.definition) return [];
  const page = pages.find((item) => item.pageNumber === option.pageNumber);
  if (!page || !option.source) return [];
  return [{
    ...evidenceFor(page, name),
    canonicalId: option.source.canonicalId,
    revision: option.source.revision,
    markdownSha256: option.source.markdownSha256,
    pdfSha256: option.source.pdfSha256,
    book: option.source.book,
    section: option.source.section,
    sectionPath: [...option.source.sectionPath],
    page: option.source.page,
    text: option.definition,
  }];
}

export function getCanonicalCharacterSources(query: string, limit = 12): CanonicalEvidence[] {
  return searchCanonical(query, { books: ["LIVRO III — SISTEMA"], limit });
}

export function searchCanonical(
  query: string,
  options: { books?: CanonicalBook[]; limit?: number } = {},
): CanonicalEvidence[] {
  const terms = [...new Set(normalize(query).split(" ").filter((term) => term.length > 1))];
  if (!terms.length) return [];
  const allowedBooks = options.books ? new Set(options.books) : null;
  const ranked = pages.flatMap((page) => {
    if (allowedBooks && !allowedBooks.has(page.book)) return [];
    const body = normalize(page.text);
    const headings = normalize(`${page.headings.join(" ")} ${page.sectionPath.join(" ")}`);
    const matched = terms.filter((term) => body.includes(term));
    if (!matched.length) return [];
    const headingMatches = terms.filter((term) => headings.includes(term)).length;
    const phraseMatch = normalize(query).length >= 4 && body.includes(normalize(query)) ? 4 : 0;
    return [{ page, score: matched.length * 2 + headingMatches * 3 + phraseMatch }];
  });
  ranked.sort((a, b) => b.score - a.score || a.page.pageNumber - b.page.pageNumber);
  return ranked.slice(0, Math.max(0, options.limit ?? 8)).map(({ page }) => evidenceFor(page, query));
}

export function getCanonicalSourceGap(topic: string) {
  const key = normalize(topic);
  if (key === "origem" || key === "origins") {
    const contract = index.choices.origins;
    return {
      status: contract.status,
      note: contract.note,
      evidence: typeof contract.pageNumber === "number"
        ? pages.filter((page) => page.pageNumber === contract.pageNumber).map((page) => evidenceFor(page, "Criação de personagem NEXO Origem"))
        : [],
    } as const;
  }
  return { status: "gap", note: "Nenhuma opção fechada correspondente foi identificada no catálogo extraído desta revisão.", evidence: [] } as const;
}

/** Returns the conditional creation rule stated on the canonical Book III page 92. */
export function getCanonicalTrocadoCreationRule() {
  const page = pages.find((item) =>
    item.book === "LIVRO III — SISTEMA"
      && item.pageNumber === 92
      && item.text.includes("Origem Trocado"),
  );
  if (!page) return { status: "gap", evidence: [] } as const;
  const origin = page.text.match(
    /A pessoa de\s+Origem Trocado nasceu em um mundo e foi criada no outro:\s*escolha\s+([^.]+)\./i,
  );
  const options = origin?.[1].split(/\s+ou\s+/i).map((option) => option.trim()) ?? [];
  const roll = page.text.match(/Na rolagem,\s*([\s\S]*?)(?=\s*A opção Outro|$)/i)?.[1]?.trim();
  if (!origin || options.length !== 2 || !roll)
    return { status: "gap", evidence: [evidenceFor(page, "Criação de personagem NEXO Origem Trocado")] } as const;
  return {
    status: "available",
    condition: origin[0].split(":")[0],
    options,
    rollException: `Na rolagem, ${roll}`,
    evidence: evidenceFor(page, "Criação de personagem NEXO Origem Trocado"),
  } as const;
}
