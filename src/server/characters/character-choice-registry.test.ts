import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalizeCharacterChoice,
  characterChoiceOptions,
  CHARACTER_CHOICE_EQUIVALENCES,
  CHARACTER_CHOICE_REGISTRY,
  FORGE_CLOSED_CHOICE_COUNT,
  characterChoiceCandidatePatch,
  resolveNumericDistribution,
  resolveCharacterChoiceCandidate,
} from "./character-choice-registry";
import { readForgeChoiceCatalog } from "../../../scripts/generate-character-forge-choice-catalog.mjs";

const root = process.cwd();
const generated = JSON.parse(
  readFileSync(
    join(root, "src/server/characters/character-forge-choice-catalog.generated.json"),
    "utf8",
  ),
);

describe("registry de escolhas do Character Forge", () => {
  it.each(["demais 0", "todas as outras 0", "os restantes 0"])(
    "completa somente as escolhas restantes declaradas como zero: %s",
    (zeroRemainder) => {
      const text =
        "cuidado 3 percepcao 2 influencia 2 empatia 2 atletismo 1 sobrevivencia 1 investigacao 1 oficio 1 " +
        zeroRemainder;
      const result = resolveNumericDistribution("periciasBase", text);
      expect(result?.incomplete).toBe(false);
      expect(result?.invalid).toBe(false);
      expect(result?.patch?.periciasBase).toMatchObject({
        Cuidado: 3,
        Percepção: 2,
        Influência: 2,
        Empatia: 2,
        Atletismo: 1,
        Sobrevivência: 1,
        Investigação: 1,
        Ofício: 1,
        Combate: 0,
        Pontaria: 0,
        Furtividade: 0,
        Conhecimento: 0,
        Magia: 0,
        Evocação: 0,
        Velarim: 0,
      });
    },
  );

  it("permanece sincronizado com o catálogo embutido no Forge publicado", () => {
    const extracted = readForgeChoiceCatalog(
      readFileSync(join(root, "public/jogar/character-forge.html"), "utf8"),
    );
    expect(generated).toEqual(extracted);

    const values = (field: string) =>
      CHARACTER_CHOICE_REGISTRY.find((entry) => entry.field === field)?.canonicalValues ?? [];
    expect(values("povo")).toEqual(
      generated.peoples.map((people: { name: string }) => people.name),
    );
    expect(values("heranca")).toEqual(
      expect.arrayContaining(
        generated.peoples.flatMap((people: { heritages: string[] }) => people.heritages),
      ),
    );
    expect(values("origem")).toEqual(generated.origins);
    expect(values("trilhas[].oficio")).toEqual(
      generated.offices.map((office: { name: string }) => office.name),
    );
    expect(values("trilhas[].papel")).toEqual(
      expect.arrayContaining(
        generated.offices.flatMap((office: { roles: string[] }) => office.roles),
      ),
    );
    expect(values("trilhas[].chave")).toEqual(
      expect.arrayContaining(
        generated.offices.flatMap((office: { keys: string[] }) => office.keys),
      ),
    );
    expect(values("trilhas[].pericaEscolhida")).toEqual([
      ...new Set(
        generated.offices.flatMap((office: { optionalSkills: string[] }) => office.optionalSkills),
      ),
    ]);
    expect(values("trilhas[].especializacoes")).toEqual([
      ...new Set(
        generated.offices.flatMap((office: { specializations: Array<{ name: string }> }) =>
          office.specializations.map((item) => item.name),
        ),
      ),
    ]);
    expect(values("trilhas[].tecnicas")).toEqual(
      expect.arrayContaining([
        ...generated.offices.flatMap(
          (office: {
            initialTechnique: string;
            techniques: string[];
            specializations: Array<{ techniques: string[] }>;
          }) => [
            office.initialTechnique,
            ...office.techniques,
            ...office.specializations.flatMap((specialization) => specialization.techniques),
          ],
        ),
        ...generated.universalTechniques,
        ...generated.magic,
      ]),
    );
    expect(values("atributosBase")).toEqual(generated.attributes);
    expect(values("periciasBase")).toEqual(generated.skills);
    expect(values("trilhas[].pericias")).toEqual(generated.skills);
    expect(values("trilhas[].magias")).toEqual(generated.magic);
    expect(values("trilhas[].knownForms[].formId")).toEqual(
      generated.magicForms.map((form: { id: string }) => form.id),
    );
    expect(values("equipamento.arma")).toEqual(generated.weapons);
    expect(values("equipamento.armadura")).toEqual(generated.armors);
    expect(values("equipamento.ferramenta")).toEqual(generated.tools);
    expect(values("equipamento.consumiveis")).toEqual(generated.consumables);
    expect(values("trilhas[].vinculosEvocados[].modelo")).toEqual(generated.evocations);
    expect(values("trilhas[].vinculosEvocados[].porte")).toEqual(generated.evocationSizes);
    expect(values("trilhas[].vinculosEvocados[].forma")).toEqual(generated.evocationForms);
    expect(values("condicoes")).toEqual(generated.conditions);
    expect(values("progressao[].ganho")).toEqual(generated.progressions);
    expect(values("qualidade")).toEqual(generated.qualities);
    for (const [people, choices] of Object.entries(generated.peopleChoices))
      for (const choice of choices as Array<{ key: string; values: string[] }>)
        expect(values(`escolhasPovo.${people}.${choice.key}`)).toEqual(choice.values);
    expect(FORGE_CLOSED_CHOICE_COUNT).toBe(764);
    expect(CHARACTER_CHOICE_EQUIVALENCES).toHaveLength(FORGE_CLOSED_CHOICE_COUNT);
    for (const equivalence of CHARACTER_CHOICE_EQUIVALENCES) {
      const field = CHARACTER_CHOICE_REGISTRY.find((entry) => entry.field === equivalence.field);
      expect(field, `equivalence field missing: ${equivalence.field}`).toBeDefined();
      expect(field?.canonicalValues).toContain(equivalence.canonical);
      expect(equivalence.aliases).toContain(equivalence.canonical);
      for (const alias of equivalence.aliases)
        expect(canonicalizeCharacterChoice(equivalence.field, alias)).toBe(equivalence.canonical);
    }
    for (const field of CHARACTER_CHOICE_REGISTRY.filter(
      (entry) => entry.type === "CLOSED_CHOICE" || entry.type === "MULTI_CHOICE",
    )) {
      expect(field.field.length).toBeGreaterThan(0);
      expect(field.dependencies).toBeDefined();
      for (const canonical of field.canonicalValues)
        expect(canonicalizeCharacterChoice(field.field, canonical)).toBe(canonical);
      for (const [alias, canonical] of Object.entries(field.aliases ?? {}))
        expect(field.canonicalValues).toContain(canonical);
    }
    const registryPaths = CHARACTER_CHOICE_REGISTRY.map((entry) => entry.field);
    const represented = (path: string) =>
      registryPaths.some(
        (registered) =>
          registered === path ||
          (registered.endsWith(".*") && path.startsWith(registered.slice(0, -1))) ||
          (registered.endsWith("[]") && path.startsWith(registered.slice(0, -2))),
      );
    for (const field of generated.snapshotFields as string[])
      expect(represented(field), `snapshot field not classified: ${field}`).toBe(true);
    for (const [group, children] of Object.entries(generated.snapshotNestedFields))
      for (const child of children as string[])
        expect(
          represented(`${group}.${child}`),
          `snapshot child not classified: ${group}.${child}`,
        ).toBe(true);
    for (const field of generated.trailFields as string[])
      expect(represented(`trilhas[].${field}`), `Forge trail field not classified: ${field}`).toBe(
        true,
      );
  });

  it("normaliza somente equivalências aprovadas e sempre com o campo definido", () => {
    expect(canonicalizeCharacterChoice("povo", "LIVRE")).toBe("Livres");
    expect(canonicalizeCharacterChoice("trilhas[0].oficio", "Curandeira")).toBe("Curador");
    expect(canonicalizeCharacterChoice("povo", "Curandeira")).toBeNull();
    expect(canonicalizeCharacterChoice("trilhas[0].oficio", "Guardião")).toBe("Guardião");
  });

  it("mantém colisões de valor dependentes do selector perguntado", () => {
    const snapshot = {
      povo: "Livres",
      heranca: "Múltiplos Caminhos",
      trilhaAtiva: 0,
      trilhas: [{ oficio: "Curador" }],
      tecnicaHeranca: { oficio: "Artífice" },
    };
    expect(characterChoiceOptions("trilhas[0].oficio", snapshot)).toContain("Artífice");
    expect(characterChoiceOptions("tecnicaHeranca.oficio", snapshot)).toContain("Artífice");
    expect(characterChoiceOptions("tecnicaHeranca.oficio", snapshot)).not.toContain("Curador");
    expect(characterChoiceOptions("tecnicaHeranca.nome", snapshot)).toEqual([
      "Preparação de Campo",
    ]);
  });

  it("aplica dependências reais do Forge para especialização, armadura, escudo e evocação", () => {
    const snapshot = {
      povo: "Livres",
      heranca: "Múltiplos Caminhos",
      trilhaAtiva: 0,
      trilhas: [{ oficio: "Guardião", marco: 1, vinculosEvocados: [{ porte: "Menor" }] }],
    };
    const office = generated.offices.find((entry: { name: string }) => entry.name === "Guardião");
    const proficiencies = office.proficiencies.toLocaleLowerCase("pt-BR");
    expect(characterChoiceOptions("trilhas[0].especializacoes", snapshot)).toEqual(
      office.specializations.map((item: { name: string }) => item.name),
    );
    expect(characterChoiceOptions("equipamento.armadura", snapshot)).toEqual([
      "Roupas reforçadas",
      "Leve",
      "Média",
      "Pesada",
    ]);
    expect(characterChoiceOptions("equipamento.extras", snapshot)).toEqual(
      /escudos/.test(proficiencies) ? ["Escudo"] : [],
    );
    expect(characterChoiceOptions("trilhas[0].vinculosEvocados[0].modelo", snapshot)).toEqual(
      generated.evocationModels
        .filter((item: { size: string }) => item.size === "Menor")
        .map((item: { name: string }) => item.name),
    );

    expect(
      characterChoiceOptions("equipamento.armadura", {
        trilhas: [{ oficio: "Curador" }],
      }),
    ).toContain("Leve");
  });

  it("prioriza ferramenta rotulada sem confundir foco legítimo de arma", () => {
    const snapshot = { povo: "Livres", trilhas: [{ oficio: "Curador" }], trilhaAtiva: 0 };

    expect(characterChoiceOptions("equipamento.ferramenta", snapshot)).toEqual(["Kit de cura"]);
    expect(
      resolveCharacterChoiceCandidate("Ferramenta: Kit de cura.", undefined, snapshot),
    ).toMatchObject({ field: "equipamento.ferramenta", values: ["Kit de cura"] });
    expect(
      resolveCharacterChoiceCandidate("Ferramenta: Foco de magia.", undefined, snapshot),
    ).toMatchObject({
      field: "equipamento.ferramenta",
      values: ["Foco de magia"],
      invalid: true,
    });
    expect(
      resolveCharacterChoiceCandidate("Arma/foco: Lança curta.", undefined, snapshot),
    ).toMatchObject({ field: "equipamento.arma", values: ["Lança curta"] });
  });

  it("resolve respostas naturais no campo perguntado e conserva a confirmação antes da escrita", () => {
    const snapshot = {
      povo: "Livres",
      heranca: "Múltiplos Caminhos",
      trilhaAtiva: 0,
      trilhas: [{ oficio: "Curador", marco: 1 }],
      tecnicaHeranca: { oficio: "Artífice" },
    };
    const heritageOffice = resolveCharacterChoiceCandidate(
      "Eu quero Artífice para puxar a técnica, mantendo o Curador como principal.",
      "De qual Ofício você quer obter sua técnica de Múltiplos Caminhos?",
      snapshot,
    );
    expect(heritageOffice?.field).toBe("tecnicaHeranca.oficio");
    expect(characterChoiceCandidatePatch(heritageOffice!)).toEqual({
      tecnicaHeranca: { oficio: "Artífice" },
    });

    const people = resolveCharacterChoiceCandidate(
      "Eu queria ser Livre.",
      "Qual povo você escolhe?",
      snapshot,
    );
    expect(people?.values).toEqual(["Livres"]);
    expect(characterChoiceCandidatePatch(people!)).toEqual({ povo: "Livres" });

    const explicitHeritage = resolveCharacterChoiceCandidate(
      "Quero selecionar a Herança: Múltiplos Caminhos",
      undefined,
      { ...snapshot, heranca: "" },
    );
    expect(explicitHeritage?.field).toBe("heranca");
    expect(explicitHeritage?.values).toEqual(["Múltiplos Caminhos"]);
    const explicitlyLabeledHeritage = resolveCharacterChoiceCandidate(
      "Quero selecionar a Herança: Múltiplos Caminhos",
      "Artífice pode ser seu Ofício principal ou o Ofício de origem da técnica?",
      { ...snapshot, heranca: "" },
    );
    expect(explicitlyLabeledHeritage?.field).toBe("heranca");

    expect(
      resolveCharacterChoiceCandidate(
        "Escolho Artífice, quais opções eu tenho agora?",
        "De qual Ofício você quer obter a técnica?",
        snapshot,
      ),
    ).toBeNull(); // A pergunta completa segue para o modelo responder e propor sem autoescrita.
    expect(
      resolveCharacterChoiceCandidate(
        "Me fala sobre Artífice.",
        "Qual é o Ofício principal?",
        snapshot,
      ),
    ).toBeNull();

    const corrected = resolveCharacterChoiceCandidate(
      "Não Curador; quero Artífice.",
      "Qual é o Ofício principal da personagem?",
      snapshot,
    );
    expect(corrected?.values).toEqual(["Artífice"]);
    expect(characterChoiceCandidatePatch(corrected!)).toEqual({
      trilhas: [{ oficio: "Artífice" }],
    });
  });

  it("pede esclarecimento quando a frase traz duas escolhas fechadas para um campo singular", () => {
    const result = resolveCharacterChoiceCandidate(
      "Talvez Curador ou Artífice",
      "Qual é o Ofício principal da personagem?",
      { trilhas: [{ oficio: "Curador" }] },
    );
    expect(result).toBeNull();

    const unhedged = resolveCharacterChoiceCandidate(
      "Curador ou Artífice, ainda estou decidindo",
      "Qual é o Ofício principal da personagem?",
      { trilhas: [{ oficio: "Curador" }] },
    );
    expect(unhedged?.ambiguous).toBe(true);
  });

  it("aceita distribuição numérica completa e identifica resposta parcial", () => {
    const question = "Como distribui os atributos?";
    const full = resolveCharacterChoiceCandidate(
      "Corpo 3, Agilidade 2, Intelecto 2, Presença 1, Vontade 1, Sintonia 0",
      question,
      {},
    );
    expect(full?.incomplete).toBe(false);
    expect(full?.patch?.atributosBase).toEqual({
      Corpo: 3,
      Agilidade: 2,
      Intelecto: 2,
      Presença: 1,
      Vontade: 1,
      Sintonia: 0,
    });

    const partial = resolveCharacterChoiceCandidate("Corpo 3 e Agilidade 2", question, {});
    expect(partial?.incomplete).toBe(true);
    expect(partial?.patch).toBeUndefined();

    const invalid = resolveCharacterChoiceCandidate(
      "Corpo 3, Agilidade 3, Intelecto 2, Presença 1, Vontade 1, Sintonia 0",
      question,
      {},
    );
    expect(invalid?.invalid).toBe(true);
    expect(invalid?.patch).toBeUndefined();
  });
});
