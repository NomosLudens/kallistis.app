import { describe, expect, it } from "vitest";
import { validateCharacterSnapshot } from "./character-canon";
import {
  processConversationalCreationTurn,
  startConversationalCreation,
} from "./conversational-creation";
import { characterChoiceOptions } from "./character-choice-registry";
import {
  buildConversationalProgressionSnapshot,
  conversationalProgressionState,
  selectConversationalProgressionChoice,
} from "./conversational-progression";

function completeCurador() {
  let snapshot = startConversationalCreation("Jogadora", "Quero criar uma protetora.", 4).snapshot;
  const answers = [
    "Elara",
    "curadora de campo",
    "proteger a comunidade",
    "perder sua memória",
    "Aelvari",
    "Cronista",
    "Criado na Luz",
    "Curador",
    "Amparo",
    "Kit de Retorno",
    "Corpo 3, Agilidade 2, Intelecto 2, Presença 1, Vontade 1, Sintonia 0",
    "Atletismo 3, Combate 2, Pontaria 2, Furtividade 2, Percepção 1, Sobrevivência 1, Investigação 1, Conhecimento 1, Ofício 0, Influência 0, Empatia 0, Cuidado 0, Magia 0, Evocação 0, Velarim 0",
    "Faca",
    "sim",
    "Roupas reforçadas",
    "Kit de cura",
    "Tônico de Vitalidade e Sal de Memória",
    "A colega que me salvou",
    "O aprendiz que protejo",
    "A comunidade que me acolheu",
    "Nunca abandonar alguém ferido",
    "Não conseguir salvar minha irmã",
    "Até onde vai o dever de cuidar?",
  ];
  for (const answer of answers) {
    snapshot = processConversationalCreationTurn(snapshot, answer).snapshot;
    snapshot = processConversationalCreationTurn(snapshot, "confirmo").snapshot;
  }
  expect(validateCharacterSnapshot(snapshot, true).ok).toBe(true);
  return snapshot;
}

describe("progressão conversacional pelo contrato canônico", () => {
  it("aplica sequencialmente os ganhos reais até o Marco 4", () => {
    let snapshot = completeCurador();
    for (const target of [2, 3, 4]) {
      while (conversationalProgressionState(snapshot).next) {
        const step = conversationalProgressionState(snapshot).next!;
        snapshot = selectConversationalProgressionChoice(snapshot, step.id, step.options[0]!);
      }
      snapshot = buildConversationalProgressionSnapshot(snapshot);
      expect((snapshot.trilhas as Array<{ marco: number }>)[0]?.marco).toBe(target);
      expect(validateCharacterSnapshot(snapshot, true).ok).toBe(true);
    }
  });

  it("recusa opção fora do catálogo e Marco sem escolhas confirmadas", () => {
    const snapshot = completeCurador();
    expect(() =>
      selectConversationalProgressionChoice(snapshot, "m2", "Técnica: Inventada"),
    ).toThrow("invalid_proposal");
    expect(() => buildConversationalProgressionSnapshot(snapshot)).toThrow(
      "progression_gain_missing",
    );
    expect((snapshot.trilhas as Array<{ marco: number }>)[0]?.marco).toBe(1);
  });

  it("mantém o repertório obrigatório do Tecelão em cada Marco", () => {
    let snapshot = startConversationalCreation("Jogadora", "Quero criar uma Tecelã.", 4).snapshot;
    const forms = characterChoiceOptions("trilhas[].knownForms[].formId", {});
    const answers = [
      "Elara",
      "tecelã de amparo",
      "proteger a comunidade",
      "perder sua memória",
      "Aelvari",
      "Cronista",
      "Criado na Luz",
      "Tecelão",
      "Amparo",
      "Bastão de Convergência",
      forms.slice(0, 4).join(", "),
      "Corpo 3, Agilidade 2, Intelecto 2, Presença 1, Vontade 1, Sintonia 0",
      "Atletismo 3, Combate 2, Pontaria 2, Furtividade 2, Percepção 1, Sobrevivência 1, Investigação 1, Conhecimento 1, Ofício 0, Influência 0, Empatia 0, Cuidado 0, Magia 0, Evocação 0, Velarim 0",
      "Bastão",
      "sim",
      "Roupas reforçadas",
      "Foco de magia",
      "Tônico de Vitalidade e Sal de Memória",
      "vínculo um",
      "vínculo dois",
      "vínculo três",
      "promessa válida",
      "ferida válida",
      "pergunta válida",
    ];
    for (const answer of answers) {
      snapshot = processConversationalCreationTurn(snapshot, answer).snapshot;
      snapshot = processConversationalCreationTurn(snapshot, "confirmo").snapshot;
    }
    expect(validateCharacterSnapshot(snapshot, true).ok).toBe(true);
    for (const target of [2, 3, 4]) {
      while (conversationalProgressionState(snapshot).next) {
        const step = conversationalProgressionState(snapshot).next!;
        snapshot = selectConversationalProgressionChoice(
          snapshot,
          step.id,
          step.kind === "multi"
            ? step.options.slice(0, step.min)
            : step.id === "m2"
              ? step.options.find((option) => option.startsWith("Forma: "))!
              : step.options[0]!,
        );
      }
      snapshot = buildConversationalProgressionSnapshot(snapshot);
      expect((snapshot.trilhas as Array<{ marco: number }>)[0]?.marco).toBe(target);
      expect(validateCharacterSnapshot(snapshot, true).ok).toBe(true);
    }
  });
});
