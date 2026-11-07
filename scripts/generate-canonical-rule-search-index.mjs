import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
if (process.argv[2] !== "book")
  throw new Error("Uso: bun scripts/generate-canonical-rule-search-index.mjs book");
const sourcePath = resolve(root, "CANON/KALLISTIS_LIVRO_COMPLETO_NEXO_MOTOR_PROGRESSAO_2026-11-05.md");
const outputPath = resolve(root, "src/lib/canonical-book-search-index.generated.json");
const source = readFileSync(sourcePath, "utf8");

function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[\u0027\u2018\u2019\u201B\u2032\u0060\u00B4]/g, "")
    .replace(/[\u002D\u2010-\u2015]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function termVariants(term) {
  const normalized = normalize(term);
  if (!normalized) return [];
  const compact = normalized.replace(/\s+/g, "");
  const variants = [normalized, compact];
  if (normalized.endsWith("s")) {
    const singular = normalized.slice(0, -1);
    variants.push(singular, singular.replace(/\s+/g, ""));
  } else {
    variants.push(`${normalized}s`, `${compact}s`);
  }
  return [...new Set(variants)].map((value) => ({
    normalized: value,
    compact: value.replace(/\s+/g, ""),
  }));
}

const terms = new Set(
  [
    "teste",
    "predominancia",
    "ressonancia",
    "fluxo",
    "vitalidade",
    "lucidez",
    "povo",
    "oficio",
    "merge",
    "movimento",
    "grade",
    "zonas",
    "montaria",
    "pet",
    "refugio",
    "magia",
    "sintonia",
    "terreno",
    "voo",
    "teleporte",
    "cobertura",
    "queda",
    "evocacao",
    "argumento",
    "marco",
    "d10",
    "margem",
    "vanguarda",
    "iniciativa",
    "coro",
    "pulso",
    "barra",
    "sombra",
    "escuridao",
    "grande cristal",
    "fratura",
    "trocados",
    "guarda",
    "atributos",
    "criacao",
    "historia",
    "cosmologia",
    "comunidade",
    "velarim",
    "resistencia",
  ].map(normalize),
);

for (const line of source.split("\n")) {
  if (/^#{1,6}\s/.test(line)) {
    const lockId = line.match(/^#{1,6}\s+(LOCK-\d{2})\b/i)?.[1];
    if (lockId) terms.add(normalize(lockId));
    const title = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(?:[A-Za-z]\.)?\d+(?:\.\d+)*\.?\s+/, "")
      .trim();
    const normalizedTitle = normalize(title);
    if (normalizedTitle.length >= 3) terms.add(normalizedTitle);
  }

  const glossaryEntry = line.match(/^\s*\*\*(.+?)\.\*\*/)?.[1];
  if (glossaryEntry) {
    const normalizedEntry = normalize(glossaryEntry);
    if (normalizedEntry.length >= 3) terms.add(normalizedEntry);
  }
}

const sections = [];
let heading = "Documento canônico";
let headingPath = [];
let currentBook = null;
let block = [];
let blockStart = 0;
let offset = 0;
const flush = () => {
  const body = block.join("\n").trim();
  const pathHeadings = headingPath.length ? headingPath.map(({ title }) => title) : [heading];
  const searchHeadings = currentBook && !pathHeadings.includes(currentBook)
    ? [currentBook, ...pathHeadings]
    : pathHeadings;
  if (body) {
    const leadingWhitespace = block.join("\n").length - block.join("\n").trimStart().length;
    const start = blockStart + leadingWhitespace;
    const text = normalize(body);
    const compact = text.replace(/\s+/g, "");
    const headings = searchHeadings.map(normalize);
    const normalizedSearchText = normalize(`${searchHeadings.join("\n")}\n${body}`);
    const section = normalize(heading);
    const glossaryEntries = body.split("\n").flatMap((line) => {
      const label = line.match(/^\s*\*\*(.+?)\.\*/)?.[1];
      return label ? [normalize(label)] : [];
    });

    sections.push({
      start,
      end: start + body.length,
      originalSection: heading,
      searchHeadings,
      section,
      sectionCompact: section.replace(/\s+/g, ""),
      searchText: normalizedSearchText,
      compactSearchText: normalizedSearchText.replace(/\s+/g, ""),
      headings,
      headingsCompact: headings.map((value) => value.replace(/\s+/g, "")),
      parents: headings.slice(0, -1),
      parentsCompact: headings.slice(0, -1).map((value) => value.replace(/\s+/g, "")),
      glossaryEntries,
      glossaryEntriesCompact: glossaryEntries.map((value) => value.replace(/\s+/g, "")),
      text,
      compact,
    });
  }
  block = [];
};

for (const line of source.split("\n")) {
  const lineStart = offset;
  offset += line.length + 1;
  const match = line.match(/^(#{1,6})\s+(.+)$/);
  if (match) {
    flush();
    const level = match[1].length;
    heading = match[2].trim();
    if (level === 1 && /^LIVRO (?:I|II|III|IV)\b/.test(heading)) currentBook = heading;
    headingPath = headingPath.filter(({ level: parentLevel }) => parentLevel < level);
    headingPath.push({ level, title: heading });
    blockStart = offset;
  } else {
    if (!block.length) blockStart = lineStart;
    block.push(line);
  }
}
flush();

const artifact = {
  sourceHash: createHash("sha256").update(source).digest("hex"),
  normalizedSource: normalize(source),
  compactSource: normalize(source).replace(/\s+/g, ""),
  terms: [...terms].map((term) => ({
    exactCompact: term.replace(/\s+/g, ""),
    variants: termVariants(term),
  })),
  sections,
};
writeFileSync(outputPath, `${JSON.stringify(artifact)}\n`);
console.log(
  `Generated canonical search index: ${sections.length} sections, ${Buffer.byteLength(JSON.stringify(artifact))} bytes`,
);
