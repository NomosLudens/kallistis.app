import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceContract = JSON.parse(
  readFileSync(resolve(root, "scripts/genesis-canonical-source.json"), "utf8"),
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const markdownPath = resolve(root, sourceContract.markdownFile);
const pdfPath = resolve(root, sourceContract.pdfFile);
const markdownBytes = readFileSync(markdownPath);
const pdfBytes = readFileSync(pdfPath);
const markdown = markdownBytes.toString("utf8");

if (sha256(markdownBytes) !== sourceContract.markdownSha256)
  throw new Error("canonical_markdown_fingerprint_mismatch");
if (sha256(pdfBytes) !== sourceContract.pdfSha256)
  throw new Error("canonical_pdf_fingerprint_mismatch");
if (!markdown.includes(sourceContract.editorialMarker))
  throw new Error("canonical_editorial_marker_missing_from_markdown");

const pdfText = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"], {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
const pdfPages = pdfText.split("\f").map((page) => page.trim()).filter(Boolean);
if (pdfPages.length !== sourceContract.pdfPageCount)
  throw new Error(`canonical_pdf_page_count_mismatch:${pdfPages.length}`);
if (!pdfPages[sourceContract.editorialMarkerPdfPage - 1]?.includes(sourceContract.editorialMarker))
  throw new Error("canonical_editorial_marker_wrong_pdf_page");

const normalize = (value) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("pt-BR")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const headings = [];
for (const [lineIndex, line] of markdown.split(/\r?\n/).entries()) {
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (!match) continue;
  const title = match[2].replace(/\*\*/g, "").trim();
  const needle = normalize(title);
  let pageNumber = null;
  for (let i = headings.length ? headings.at(-1).pageNumber - 1 : 0; i < pdfPages.length; i += 1) {
    if (normalize(pdfPages[i]).includes(needle)) {
      pageNumber = i + 1;
      break;
    }
  }
  if (pageNumber === null) {
    for (let i = 0; i < pdfPages.length; i += 1) {
      if (normalize(pdfPages[i]).includes(needle)) {
        pageNumber = i + 1;
        break;
      }
    }
  }
  headings.push({ level: match[1].length, title, line: lineIndex + 1, pageNumber });
}

const books = ["LIVRO I — HISTÓRIA", "LIVRO II — ATLAS", "LIVRO III — SISTEMA", "LIVRO IV — NARRANDO O JOGO"];
const bookForHeading = (heading) => {
  if (books.includes(heading.title)) return heading.title;
  if (heading.title === "APÊNDICES" || heading.title === "APÊNDICE — TERMOS DO NEXO") return "APÊNDICES";
  return null;
};

const pages = pdfPages.map((rawText, index) => {
  const pageNumber = index + 1;
  const applicable = headings.filter((heading) => heading.pageNumber !== null && heading.pageNumber <= pageNumber);
  const path = [];
  for (const heading of applicable) {
    while (path.length && path.at(-1).level >= heading.level) path.pop();
    path.push({ level: heading.level, title: heading.title });
  }
  const bookHeading = [...applicable].reverse().find((heading) => bookForHeading(heading));
  const pageHeadings = headings.filter((heading) => heading.pageNumber === pageNumber);
  const text = rawText
    .split(/\r?\n/)
    .filter((line) => line.trim() !== String(pageNumber))
    .join("\n")
    .trim();
  return {
    pageNumber,
    book: bookHeading ? bookForHeading(bookHeading) : "ABERTURA",
    sectionPath: [...(bookHeading ? [bookForHeading(bookHeading)] : []), ...path.map((item) => item.title)],
    headings: pageHeadings.map((heading) => heading.title),
    text,
  };
});

function descendantsOf(heading) {
  const start = headings.indexOf(heading);
  for (let i = start + 1; i < headings.length; i += 1) {
    if (headings[i].level <= heading.level) return headings.slice(start + 1, i);
  }
  return headings.slice(start + 1);
}

const systemHeadings = headings.filter((heading) => {
  return heading.pageNumber !== null
    && pages[heading.pageNumber - 1]?.book === "LIVRO III — SISTEMA";
});
const peopleRoot = systemHeadings.find((heading) => heading.title === "Povos");
const peoples = peopleRoot
  ? headings.filter((heading) => heading.level === peopleRoot.level + 1
    && heading.pageNumber !== null
    && pages[heading.pageNumber - 1]?.sectionPath.includes("Povos")
    && descendantsOf(heading).some((child) => /^Traço\s+—/i.test(child.title))
    && descendantsOf(heading).some((child) => /^Dom(?:\s+—|$)/i.test(child.title))
    && descendantsOf(heading).some((child) => child.title === "Heranças"))
    .map((heading) => ({ name: heading.title, pageNumber: heading.pageNumber }))
  : [];

const officeRoot = systemHeadings.find((heading) => heading.title === "Manifestação e Legado");
const offices = officeRoot
  ? systemHeadings.filter((heading) => heading.level === officeRoot.level + 1
    && heading.title !== "Ofícios e Trilhas"
    && heading.pageNumber !== null
    && descendantsOf(heading).some((child) => child.title === "Especializações")
    && pages[heading.pageNumber - 1]?.sectionPath.includes("Manifestação e Legado"))
    .map((heading) => ({ name: heading.title, pageNumber: heading.pageNumber }))
  : [];

const creationHeading = systemHeadings.find((heading) => heading.title === "Criação de personagem NEXO");
const originEvidencePage = creationHeading?.pageNumber ?? null;
const referenceFor = (heading) => ({
  canonicalId: sourceContract.canonicalId,
  revision: sourceContract.revision,
  markdownSha256: sourceContract.markdownSha256,
  pdfSha256: sourceContract.pdfSha256,
  book: "LIVRO III — SISTEMA",
  section: heading.title,
  page: heading.pageNumber,
  sectionPath: [...(pages[heading.pageNumber - 1]?.sectionPath ?? []), heading.title],
});
const markdownLines = markdown.split(/\r?\n/);
const definitionFor = (heading) => {
  const start = headings.indexOf(heading);
  const next = headings.slice(start + 1).find((candidate) => candidate.level <= heading.level);
  return markdownLines.slice(heading.line - 1, next ? next.line - 1 : markdownLines.length).join("\n").trim();
};
const choiceContracts = {
  peoples: { status: peoples.length ? "available" : "gap", items: peoples.map((item) => {
    const heading = headings.find((candidate) => candidate.title === item.name && candidate.pageNumber === item.pageNumber);
    return { ...item, definition: definitionFor(heading), source: referenceFor(heading) };
  }) },
  offices: { status: offices.length ? "available" : "gap", items: offices.map((item) => {
    const heading = headings.find((candidate) => candidate.title === item.name && candidate.pageNumber === item.pageNumber);
    return { ...item, definition: definitionFor(heading), source: referenceFor(heading) };
  }) },
  origins: {
    status: "gap",
    items: [],
    note: "O capítulo de criação menciona Origem, Trocado e Outro, mas não declara um catálogo fechado de origens. Não importar opções de regras anteriores.",
    pageNumber: originEvidencePage,
  },
};

if (peoples.length !== 9) throw new Error(`canonical_people_heading_count_mismatch:${peoples.length}`);
if (offices.length !== 9) throw new Error(`canonical_office_heading_count_mismatch:${offices.length}`);
if (!creationHeading) throw new Error("canonical_character_creation_heading_missing");

const unresolvedHeadings = headings.filter((heading) => heading.pageNumber === null).map((heading) => heading.title);
const index = {
  manifest: {
    canonicalId: sourceContract.canonicalId,
    revision: sourceContract.revision,
    title: sourceContract.title,
    markdownFile: sourceContract.markdownFile,
    markdownSha256: sourceContract.markdownSha256,
    markdownDriveFileId: sourceContract.drive.markdownFileId,
    pdfFile: sourceContract.pdfFile,
    pdfSha256: sourceContract.pdfSha256,
    pdfDriveFileId: sourceContract.drive.pdfFileId,
    pageCount: pdfPages.length,
    editorialMarker: sourceContract.editorialMarker,
    editorialMarkerPdfPage: sourceContract.editorialMarkerPdfPage,
    indexGenerator: "scripts/generate-genesis-canonical-core.mjs",
  },
  choices: choiceContracts,
  unresolvedHeadings,
  pages,
};

const outputPath = resolve(root, "src/server/canonical/genesis-canonical.generated.json");
writeFileSync(outputPath, `${JSON.stringify(index)}\n`);
console.log(JSON.stringify({
  output: "src/server/canonical/genesis-canonical.generated.json",
  markdownSha256: sourceContract.markdownSha256,
  pdfSha256: sourceContract.pdfSha256,
  pages: pages.length,
  sections: headings.length,
  unresolvedHeadings: unresolvedHeadings.length,
  peoples: peoples.length,
  offices: offices.length,
  originCatalog: choiceContracts.origins.status,
}, null, 2));
