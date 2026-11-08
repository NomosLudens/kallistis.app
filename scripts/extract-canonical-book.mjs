import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error("Uso: bun scripts/extract-canonical-book.mjs <arquivo.pdf>");
}

const pdfPath = resolve(inputPath);
const pdfBytes = readFileSync(pdfPath);
const pdfHash = createHash("sha256").update(pdfBytes).digest("hex");
const raw = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const pages = raw.replace(/\r/g, "").split("\f");
while (pages.at(-1)?.trim() === "") pages.pop();
if (pages.length !== 187) throw new Error(`Esperadas 187 páginas; extraídas ${pages.length}`);

const toc = [];
for (const pageIndex of [1, 2]) {
  for (const line of pages[pageIndex].split("\n")) {
    const match = line.match(/^(\s*)(.*?)\s+((?:\.\s*){2,})(\d+)\s*$/);
    if (!match) continue;
    const page = Number(match[4]);
    const title = match[2].trim();
    if (!title || page < 1 || page > pages.length) continue;
    toc.push({ title, page });
  }
}

const books = [
  { from: 4, to: 21, title: "LIVRO I — HISTÓRIA" },
  { from: 22, to: 64, title: "LIVRO II — ATLAS" },
  { from: 65, to: 122, title: "LIVRO III — SISTEMA" },
  { from: 123, to: 185, title: "LIVRO IV — NARRANDO O JOGO" },
  { from: 186, to: 187, title: "LIVRO III — SISTEMA" },
];

function bookFor(page) {
  return books.find((book) => page >= book.from && page <= book.to);
}

function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function sectionFor(page, book, pageText) {
  const lines = pageText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map(normalize);
  const samePageHeading = toc.findLast(
    (item) => item.page === page && lines.includes(normalize(item.title)),
  );
  if (samePageHeading) return samePageHeading.title;
  let section = book.title;
  for (const item of toc) {
    if (item.page > page) break;
    section = item.title;
  }
  if (page >= 186) return "APÊNDICE — TERMOS DO NEXO";
  return section;
}

const output = [
  "<!-- source_pdf=KALLISTIS_LIVRO_COMPLETO_NEXO_FINAL_REVISAO.pdf -->",
  `<!-- source_pdf_sha256=${pdfHash} -->`,
  `<!-- source_pdf_pages=${pages.length} -->`,
  "<!-- extracted_with=pdftotext -layout -->",
  "# KALLISTIS — Livro Completo NEXO · Revisão final",
  "",
];

let activeBook = "";
let activeSection = "";
for (let index = 0; index < pages.length; index++) {
  const pageNumber = index + 1;
  const book = bookFor(pageNumber);
  const title = book
    ? sectionFor(pageNumber, book, pages[index])
    : pageNumber <= 3
      ? "Abertura e sumário"
      : "Apêndices";
  if (book && book.title !== activeBook) {
    output.push(`# ${book.title}`, "");
    activeBook = book.title;
    activeSection = "";
  } else if (!book && activeBook) {
    activeBook = "";
    activeSection = "";
  }
  if (title !== activeSection) {
    output.push(`## ${title}`, "");
    activeSection = title;
  }
  output.push(`### PDF p. ${pageNumber}`, "", pages[index].trim(), "");
}

const outputPath = resolve("CANON/KALLISTIS_LIVRO_COMPLETO_NEXO_FINAL_REVISAO.md");
writeFileSync(outputPath, `${output.join("\n").trim()}\n`);
console.log(
  JSON.stringify({ outputPath, pdfSha256: pdfHash, pdfPages: pages.length, extractedBytes: Buffer.byteLength(output.join("\n")) }),
);
