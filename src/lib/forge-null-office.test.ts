import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const html = readFileSync(join(process.cwd(), "public/jogar/character-forge.html"), "utf8");
const officeStart = html.indexOf("function passoOficio(c) {");
const officeEnd = html.indexOf("\n      function passoAtributos(c)", officeStart);
const officeSource = html.slice(officeStart, officeEnd);
const dossierStart = html.indexOf("function viewDossie(c) {");
const dossierEnd = html.indexOf("\n      function viewProgressao(c)", dossierStart);
const dossierSource = html.slice(dossierStart, dossierEnd);

type ElementNode = {
  tag: string;
  attrs: Record<string, unknown>;
  children: Array<ElementNode | string>;
  appendChild: (child: ElementNode | string) => void;
};

function node(tag: string, attrs: unknown, children: unknown[]): ElementNode {
  const element: ElementNode = {
    tag,
    attrs: attrs && typeof attrs === "object" ? (attrs as Record<string, unknown>) : {},
    children: [],
    appendChild(child) {
      this.children.push(child as ElementNode | string);
    },
  };
  for (const child of children.flat(Infinity)) {
    if (typeof child === "string" || (child && typeof child === "object"))
      element.children.push(child as ElementNode | string);
  }
  return element;
}

const canonicalOffice = {
  nome: "Curador",
  papeis: ["Guardião"],
  pericias: ["Cuidado"],
  proficiencias: "Armas leves",
  chaves: ["Amparo"],
  tecnica_inicial: { nome: "Pulso Restaurador", texto: "Restaura." },
  notas: [],
  especializacoes: [{ nome: "Especialização QA", texto: "Detalhe QA." }],
  tecnicas: [],
};

function createOfficeStep() {
  const save = vi.fn();
  const render = vi.fn();
  const offices = [canonicalOffice];
  const el = (tag: string, attrs: unknown, ...children: unknown[]) => node(tag, attrs, children);
  const officeStep = new Function(
    "el",
    "trilha",
    "CANON",
    "byName",
    "periciasDoOficio",
    "novaTrilha",
    "configurarTrilhaDoOficio",
    "save",
    "render",
    "campo",
    "md",
    `"use strict"; ${officeSource}; return passoOficio;`,
  )(
    el,
    (character: { trilhas: unknown[]; trilhaAtiva: number }) =>
      character.trilhas[character.trilhaAtiva],
    { oficios: offices, papeis: [{ nome: "Guardião", funcao: "Protege." }] },
    (entries: Array<{ nome: string }>, name: string) =>
      entries.find((entry) => entry.nome === name) ?? null,
    () => ({ opcoes: [] }),
    (oficio: string) => ({
      oficio,
      marco: 1,
      papel: "",
      pericias: [],
      pericaEscolhida: "",
      chave: "",
      chaveNome: "",
    }),
    () => {},
    save,
    render,
    (label: string) => node("input", { label }, []),
    (value: string) => value,
  ) as (character: Record<string, unknown>) => ElementNode;
  return { officeStep, save, render };
}

function fixture(trilhas: Array<{ oficio: string }> = []): Record<string, unknown> {
  return {
    trilhas,
    trilhaAtiva: 0,
    equipamento: {},
    pericaLivre: "",
    tecnicaHeranca: null,
  };
}

describe("regressão do Forge para Trilha sem Ofício canônico", () => {
  it.each([
    ["sem Trilhas", fixture()],
    ["Ofício vazio", fixture([{ oficio: "" }])],
    ["Ofício desconhecido", fixture([{ oficio: "Ofício inexistente" }])],
  ])("mantém a grade e não renderiza mecânicas para %s", (_name, character) => {
    const { officeStep, save } = createOfficeStep();
    const view = officeStep(character as Record<string, unknown>);

    expect(view.children).toHaveLength(1);
    const selectionPanel = view.children[0] as ElementNode;
    expect(
      (
        selectionPanel.children.find(
          (child) => (child as ElementNode).attrs.class === "grid g3",
        ) as ElementNode
      ).children,
    ).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
    expect(() => officeStep(character as Record<string, unknown>)).not.toThrow();
  });

  it("preserva os detalhes do Ofício canônico e salva a seleção no rascunho", () => {
    const { officeStep, save, render } = createOfficeStep();
    const character = fixture([{ oficio: "Curador" }]);
    const view = officeStep(character);

    expect(view.children).toHaveLength(2);
    const details = view.children[1] as ElementNode;
    expect(JSON.stringify(details)).toContain("Proficiências: Armas leves");
    expect(JSON.stringify(details)).toContain("Pulso Restaurador");
    expect(JSON.stringify(details)).toContain("Especialização QA");
    expect(save).not.toHaveBeenCalled();

    const emptyCharacter = fixture([{ oficio: "" }]);
    const emptyView = officeStep(emptyCharacter);
    const panel = emptyView.children[0] as ElementNode;
    const grid = panel.children.find(
      (child) => (child as ElementNode).attrs.class === "grid g3",
    ) as ElementNode;
    const choice = grid.children[0] as ElementNode;
    (choice.attrs.onclick as () => void)();

    expect((emptyCharacter.trilhas as Array<{ oficio: string }>)[0].oficio).toBe("Curador");
    expect(save).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
    expect((officeStep(emptyCharacter).children[0] as ElementNode).children.length).toBeGreaterThan(
      0,
    );
  });

  it("mantém Ofício e conteúdo canônico no personagem completo aprovado", () => {
    const { officeStep } = createOfficeStep();
    const character = fixture([{ oficio: "Curador" }]);
    character._serverStatus = "approved";
    character.completo = true;

    const view = officeStep(character);
    expect(view.children).toHaveLength(2);
    expect(JSON.stringify(view.children[1])).toContain("Curador");
    expect(JSON.stringify(view.children[1])).toContain("Pulso Restaurador");
    expect(dossierSource).toContain('"Ficha protegida: estado " + c._serverStatus');
  });

  it("mostra a indicação discreta no Dossiê e mantém o bloco mecânico para Ofício válido", () => {
    const missingOfficeBranch = dossierSource.match(/if \(!of\) \{([\s\S]*?)\} else \{/);
    expect(missingOfficeBranch?.[1]).toContain('"Ofício ainda não definido"');
    expect(missingOfficeBranch?.[1]).not.toContain("save(");
    expect(dossierSource).toContain('"Proficiências: " + of.proficiencias');
    expect(dossierSource).toContain('el("div", { class: "kicker" }, "Técnicas")');
    expect(dossierSource).toContain("of.especializacoes");
    expect(dossierSource).toContain("includes(c._serverStatus)");
    expect(dossierSource).toContain(
      'el("p", { class: "small muted" }, "Ofício ainda não definido")',
    );
  });
});
