import { describe, expect, it } from "vitest";
import {
  CHARACTER_OFFICES,
  CHARACTER_PEOPLES,
  INITIAL_ATTRIBUTE_DISTRIBUTION,
  INITIAL_SKILL_DISTRIBUTION,
  ATTRIBUTE_NAMES,
  SKILL_NAMES,
  validateCharacterSnapshot,
  tecelaoMagicTotals,
} from "./character-canon";
import {
  cancelNarrativeCreationProposals,
  confirmNarrativeCreationProposals,
  creationConversationState,
  creationOptionsForSnapshot,
  hasConversationalCreationProgress,
  processConversationalCreationTurn,
  stageNarrativeCreationProposals,
  startConversationalCreation,
} from "./conversational-creation";
import { characterChoiceOptions } from "./character-choice-registry";

function advance(state: ReturnType<typeof startConversationalCreation>, text: string) {
  const staged = processConversationalCreationTurn(state.snapshot, text);
  const committed = processConversationalCreationTurn(staged.snapshot, "confirmo");
  return { state: { ...state, snapshot: committed.snapshot }, reply: committed.reply };
}

describe("conversational character creation", () => {
  it("distinguishes ordinary drafts from drafts initialized by the official creation flow", () => {
    const ordinaryDraft = {} as ReturnType<typeof startConversationalCreation>["snapshot"];
    const initializedDraft = startConversationalCreation("QA Player", "Vamos começar.").snapshot;

    expect(hasConversationalCreationProgress(ordinaryDraft)).toBe(false);
    expect(hasConversationalCreationProgress(initializedDraft)).toBe(true);
  });

  it("creates a complete Curador sheet through scoped conversational confirmations", () => {
    let state = startConversationalCreation("QA Player", "Quero criar um personagem.");
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
    let completed = false;
    for (const answer of answers) {
      const result = processConversationalCreationTurn(state.snapshot, answer);
      state = { ...state, snapshot: result.snapshot };
      const confirmation = processConversationalCreationTurn(state.snapshot, "confirmo");
      state = { ...state, snapshot: confirmation.snapshot };
      completed = confirmation.completed;
    }
    expect(completed).toBe(true);
    expect(state.snapshot.completo).toBe(true);
    expect(validateCharacterSnapshot(state.snapshot, true).ok).toBe(true);
    expect(state.snapshot.nome).toBe("Elara");
    expect((state.snapshot.trilhas as Record<string, unknown>[])[0]?.oficio).toBe("Curador");
    expect((state.snapshot.equipamento as Record<string, unknown>).ferramenta).toBe("Kit de cura");
  });

  it("keeps a pending choice separate from confirmation and rejects a noncanonical option", () => {
    let state = startConversationalCreation("QA Player", "Quero criar um personagem.");
    const name = processConversationalCreationTurn(state.snapshot, "Elara");
    expect(
      (name.snapshot.serverCreationProgress as { pending: { path: string; value: unknown } })
        .pending,
    ).toMatchObject({ path: "nome", value: "Elara" });
    state = {
      ...state,
      snapshot: processConversationalCreationTurn(name.snapshot, "confirmo").snapshot,
    };
    for (const text of ["identidade", "objetivo", "perda"]) state = advance(state, text).state;
    const before = structuredClone(state.snapshot);
    const invalid = processConversationalCreationTurn(state.snapshot, "Elfo");
    expect(invalid.reply).toContain("Opções válidas");
    expect(invalid.snapshot).toEqual(before);
    const negated = processConversationalCreationTurn(state.snapshot, "não quero Aelvari");
    expect(negated.reply).toContain("Opções válidas");
    expect(negated.snapshot).toEqual(before);
    const ambiguous = processConversationalCreationTurn(state.snapshot, "Aelvari e Kragor");
    expect(ambiguous.reply).toContain("mais de uma opção");
  });

  it("changes an earlier choice without losing independent confirmed fields", () => {
    let state = startConversationalCreation("QA Player", "Quero criar um personagem.");
    for (const text of ["Elara", "identidade", "objetivo", "perda", "Aelvari", "Cronista"])
      state = advance(state, text).state;
    const changed = processConversationalCreationTurn(
      state.snapshot,
      "mudei de ideia sobre o Povo para Kragor",
    );
    const saved = processConversationalCreationTurn(changed.snapshot, "confirmo");
    expect(saved.snapshot.nome).toBe("Elara");
    expect(saved.snapshot.conceito).toMatchObject({
      identidade: "identidade",
      objetivo: "objetivo",
      perda: "perda",
    });
    expect(saved.snapshot.povo).toBe("Kragor");
    expect(saved.snapshot.heranca).toBe("");
  });

  it("keeps two independent character drafts isolated", () => {
    const first = startConversationalCreation("QA Player", "Quero criar um personagem.");
    const second = startConversationalCreation("QA Player", "Quero criar outro personagem.");
    const firstName = processConversationalCreationTurn(first.snapshot, "Elara");
    const secondName = processConversationalCreationTurn(second.snapshot, "Darian");
    expect(
      (firstName.snapshot.serverCreationProgress as { pending: { value: string } }).pending.value,
    ).toBe("Elara");
    expect(
      (secondName.snapshot.serverCreationProgress as { pending: { value: string } }).pending.value,
    ).toBe("Darian");
  });

  it("apresenta e confirma os módulos obrigatórios de Nomos dentro da conversa", () => {
    let state = startConversationalCreation("Jogadora", "Quero uma Nomos Tecelã.");
    for (const answer of [
      "Sypha de teste",
      "tecelã nomos",
      "proteger aliados",
      "perdeu a memória",
      "Nomos",
    ])
      state = advance(state, answer).state;
    const next = creationConversationState(state.snapshot).nextOptions;
    expect(next).toMatchObject({ path: "escolhasPovo.modulos", kind: "multi", min: 2, max: 2 });
    expect(next?.options).toContain("Interface de dados");
    const chosen = ["Interface de dados", "Compartimento protegido"];
    const sourceText = `Escolho módulos: ${chosen.join(", ")}`;
    const staged = stageNarrativeCreationProposals(
      state.snapshot,
      [{ path: "escolhasPovo.modulos", value: chosen, sourceText }],
      [sourceText],
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    const confirmed = confirmNarrativeCreationProposals(staged.snapshot);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect((confirmed.snapshot.escolhasPovo as { modulos: string[] }).modulos).toEqual(chosen);
    expect(creationConversationState(confirmed.snapshot).nextOptions?.path).toBe("heranca");
  });

  it("completes the canonical Tecelão magic branch", () => {
    let state = startConversationalCreation("QA Player", "Quero criar um personagem.");
    const forms = characterChoiceOptions("trilhas[].knownForms[].formId", {});
    const common = [
      "Elara",
      "identidade",
      "objetivo",
      "perda",
      "Aelvari",
      "Cronista",
      "Criado na Luz",
      "Tecelão",
      "Artilharia",
      "Bastão de Convergência",
    ];
    for (const text of common) state = advance(state, text).state;
    for (const text of [forms.slice(0, tecelaoMagicTotals(1)).join(", ")])
      state = advance(state, text).state;
    expect(forms).toContain("SILMA");
    expect(tecelaoMagicTotals(1)).toBe(4);
    const rest = [
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
    let completed = false;
    for (const text of rest) {
      const staged = processConversationalCreationTurn(state.snapshot, text);
      const saved = processConversationalCreationTurn(staged.snapshot, "confirmo");
      state = { ...state, snapshot: saved.snapshot };
      completed = saved.completed;
    }
    expect(completed).toBe(true);
    expect(validateCharacterSnapshot(state.snapshot, true).ok).toBe(true);
  });

  it("completes the canonical Evocador branch without inventing an evocation", () => {
    let state = startConversationalCreation("QA Player", "Quero criar um personagem.");
    const answers = [
      "Elara",
      "identidade",
      "objetivo",
      "perda",
      "Aelvari",
      "Cronista",
      "Criado na Luz",
      "Evocador",
      "Amparo",
      "Âncora de Pacto",
      "Magia",
      "Eco",
      "Menor",
      "Guardião",
      "Muralha de Ecos",
      "plumas de vidro",
      "um sino",
      "proteger",
      "retornar",
      "preservar vínculos",
      "Corpo 3, Agilidade 2, Intelecto 2, Presença 1, Vontade 1, Sintonia 0",
      "Atletismo 3, Combate 2, Pontaria 2, Furtividade 2, Percepção 1, Sobrevivência 1, Investigação 1, Conhecimento 1, Ofício 0, Influência 0, Empatia 0, Cuidado 0, Magia 0, Evocação 0, Velarim 0",
      "Faca",
      "sim",
      "Roupas reforçadas",
      "Âncora de Evocação",
      "Tônico de Vitalidade e Sal de Memória",
      "vínculo um",
      "vínculo dois",
      "vínculo três",
      "promessa válida",
      "ferida válida",
      "pergunta válida",
    ];
    let completed = false;
    for (const text of answers) {
      const staged = processConversationalCreationTurn(state.snapshot, text);
      const saved = processConversationalCreationTurn(staged.snapshot, "confirmo");
      state = { ...state, snapshot: saved.snapshot };
      completed = saved.completed;
    }
    expect(completed).toBe(true);
    expect(validateCharacterSnapshot(state.snapshot, true).ok).toBe(true);
    expect(
      (state.snapshot.trilhas as Record<string, unknown>[])[0]?.vinculosEvocados,
    ).toMatchObject([
      { nome: "Eco", porte: "Menor", forma: "Guardião", modelo: "Muralha de Ecos" },
    ]);
  });

  it("stages grounded multi-field proposals and writes them only after grouped confirmation", () => {
    const state = startConversationalCreation(
      "QA Player",
      "Quero uma personagem chamada Elara, do Povo Aelvari.",
    );
    const staged = stageNarrativeCreationProposals(
      state.snapshot,
      [
        { path: "nome", value: "Elara", sourceText: "personagem chamada Elara" },
        { path: "povo", value: "Aelvari", sourceText: "Povo Aelvari" },
      ],
      [state.userMessage],
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(staged.snapshot.nome).toBe("");
    expect(staged.snapshot.povo).toBe("");
    expect(staged.pending).toHaveLength(2);
    const confirmed = confirmNarrativeCreationProposals(staged.snapshot);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.saved.map((item) => item.path)).toEqual(["nome", "povo"]);
    expect(confirmed.snapshot.nome).toBe("Elara");
    expect(confirmed.snapshot.povo).toBe("Aelvari");
  });

  it("rejects an ungrounded or noncanonical model proposal without changing the draft", () => {
    const state = startConversationalCreation("QA Player", "Quero uma pessoa de origem Aelvari.");
    const ungrounded = stageNarrativeCreationProposals(
      state.snapshot,
      [{ path: "povo", value: "Aelvari", sourceText: "Kragor" }],
      [state.userMessage],
    );
    expect(ungrounded.ok).toBe(false);
    const invented = stageNarrativeCreationProposals(
      state.snapshot,
      [{ path: "povo", value: "Elfo", sourceText: "Aelvari" }],
      [state.userMessage],
    );
    expect(invented.ok).toBe(false);
    expect(state.snapshot.povo).toBe("");
  });

  it("cancels a grouped proposal without persisting its mechanical values", () => {
    const state = startConversationalCreation("QA Player", "Quero ser do Povo Kragor.");
    const staged = stageNarrativeCreationProposals(
      state.snapshot,
      [{ path: "povo", value: "Kragor", sourceText: "Povo Kragor" }],
      [state.userMessage],
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    const cancelled = cancelNarrativeCreationProposals(staged.snapshot);
    expect(cancelled.povo).toBe("");
    expect(
      (cancelled.serverCreationProgress as { pendingProposals: unknown[] }).pendingProposals,
    ).toEqual([]);
  });

  it("accepts only the exact canonical initial attribute pool in proposals", () => {
    const state = startConversationalCreation("QA Player", "Atributos como na regra.");
    const valid = Object.fromEntries(
      ATTRIBUTE_NAMES.map((name, index) => [name, INITIAL_ATTRIBUTE_DISTRIBUTION[index]]),
    );
    const accepted = stageNarrativeCreationProposals(
      state.snapshot,
      [{ path: "atributosBase", value: valid, sourceText: "Atributos como na regra" }],
      [state.userMessage],
    );
    expect(accepted.ok).toBe(true);
    const invalid = stageNarrativeCreationProposals(
      state.snapshot,
      [
        {
          path: "atributosBase",
          value: { ...valid, Corpo: 4 },
          sourceText: "Atributos como na regra",
        },
      ],
      [state.userMessage],
    );
    expect(invalid.ok).toBe(false);
  });

  it("exposes all nine canonical Peoples and Offices to the conversational layer", () => {
    const state = startConversationalCreation("QA Player", "Vamos escolher as opções canônicas.");
    const options = creationOptionsForSnapshot(state.snapshot);
    expect(options.find((item) => item.path === "povo")?.options).toEqual(CHARACTER_PEOPLES);
    expect(options.find((item) => item.path === "trilhas.0.oficio")?.options).toEqual(
      CHARACTER_OFFICES,
    );
    expect(CHARACTER_PEOPLES).toHaveLength(9);
    expect(CHARACTER_OFFICES).toHaveLength(9);
  });

  it("accepts every canonical People and Office through the same proposal validator", () => {
    for (const povo of CHARACTER_PEOPLES) {
      const heritage = characterChoiceOptions("heranca", { povo })[0];
      const state = startConversationalCreation("QA Player", `Escolho o Povo ${povo}.`);
      const result = stageNarrativeCreationProposals(
        state.snapshot,
        [
          { path: "povo", value: povo, sourceText: `Povo ${povo}` },
          ...(heritage ? [{ path: "heranca", value: heritage, sourceText: `Povo ${povo}` }] : []),
        ],
        [state.userMessage],
      );
      expect(result.ok, povo).toBe(true);
    }
    for (const oficio of CHARACTER_OFFICES) {
      const state = startConversationalCreation("QA Player", `Escolho o Ofício ${oficio}.`);
      const result = stageNarrativeCreationProposals(
        state.snapshot,
        [{ path: "trilhas.0.oficio", value: oficio, sourceText: `Ofício ${oficio}` }],
        [state.userMessage],
      );
      expect(result.ok, oficio).toBe(true);
    }
  });

  it("resolves dependent choices from the proposed People, Origin, and Office", () => {
    const state = startConversationalCreation("QA Player", "Escolhas dependentes canônicas.");
    const povoSnapshot = structuredClone(state.snapshot);
    povoSnapshot.povo = "Aelvari";
    expect(
      creationOptionsForSnapshot(povoSnapshot).find((item) => item.path === "heranca")?.options,
    ).toEqual(characterChoiceOptions("heranca", povoSnapshot));
    const outroSnapshot = structuredClone(state.snapshot);
    outroSnapshot.origem = "Outro";
    expect(creationOptionsForSnapshot(outroSnapshot).map((item) => item.path)).toContain(
      "origemBeneficio",
    );
    const trocadoSnapshot = structuredClone(state.snapshot);
    trocadoSnapshot.origem = "Trocado";
    expect(creationOptionsForSnapshot(trocadoSnapshot).map((item) => item.path)).toContain(
      "origemTrocado.descricao",
    );
    for (const oficio of CHARACTER_OFFICES) {
      const officeSnapshot = structuredClone(state.snapshot);
      (officeSnapshot.trilhas as Record<string, unknown>[])[0]!.oficio = oficio;
      const options = creationOptionsForSnapshot(officeSnapshot);
      expect(options.find((item) => item.path === "trilhas.0.papel")?.options).toEqual(
        characterChoiceOptions("trilhas[].papel", officeSnapshot),
      );
      expect(options.find((item) => item.path === "trilhas.0.chave")?.options).toEqual(
        characterChoiceOptions("trilhas[].chave", officeSnapshot),
      );
    }
  });

  it("validates Livres with Múltiplos Caminhos as one dependent proposal group", () => {
    const text = "Sou Livres com Múltiplos Caminhos, Ofício Curador, técnica do Duelista Abertura.";
    const state = startConversationalCreation("QA Player", text);
    const result = stageNarrativeCreationProposals(
      state.snapshot,
      [
        { path: "povo", value: "Livres", sourceText: "Sou Livres" },
        { path: "heranca", value: "Múltiplos Caminhos", sourceText: "Múltiplos Caminhos" },
        { path: "trilhas.0.oficio", value: "Curador", sourceText: "Ofício Curador" },
        { path: "tecnicaHeranca.oficio", value: "Duelista", sourceText: "técnica do Duelista" },
        {
          path: "tecnicaHeranca.nome",
          value: "Abertura",
          sourceText: "técnica do Duelista Abertura",
        },
      ],
      [text],
    );
    expect(result.ok).toBe(true);
  });

  it("validates the conditional Trocado origin fields only after that origin is proposed", () => {
    const text =
      "Origem Trocado, nascimento no litoral, criação entre cartógrafos, descrição de alguém entre dois povos.";
    const state = startConversationalCreation("QA Player", text);
    const result = stageNarrativeCreationProposals(
      state.snapshot,
      [
        { path: "origem", value: "Trocado", sourceText: "Origem Trocado" },
        {
          path: "origemTrocado.nascimento",
          value: "no litoral",
          sourceText: "nascimento no litoral",
        },
        {
          path: "origemTrocado.criacao",
          value: "entre cartógrafos",
          sourceText: "criação entre cartógrafos",
        },
        {
          path: "origemTrocado.descricao",
          value: "alguém entre dois povos",
          sourceText: "descrição de alguém entre dois povos",
        },
      ],
      [text],
    );
    expect(result.ok).toBe(true);
  });

  it("validates the Tecelão's canonical form count and complete skill pool", () => {
    const state = startConversationalCreation(
      "QA Player",
      "Tecelão com formas conhecidas canônicas.",
    );
    const forms = characterChoiceOptions("trilhas[].knownForms[].formId", {});
    const skills = Object.fromEntries(
      SKILL_NAMES.map((name, index) => [name, INITIAL_SKILL_DISTRIBUTION[index]]),
    );
    const result = stageNarrativeCreationProposals(
      state.snapshot,
      [
        { path: "trilhas.0.oficio", value: "Tecelão", sourceText: "Tecelão" },
        {
          path: "trilhas.0.knownForms",
          value: forms.slice(0, tecelaoMagicTotals(1)),
          sourceText: "formas conhecidas canônicas",
        },
        { path: "periciasBase", value: skills, sourceText: "skill pool" },
      ],
      [state.userMessage, "skill pool"],
    );
    expect(result.ok).toBe(true);
  });

  it("keeps Evocador proposals dependent on an active Office and canonically valid", () => {
    const text =
      "Ofício Evocador, Evocação Eco, porte Menor, forma Guardião, modelo Muralha de Ecos.";
    const state = startConversationalCreation("QA Player", text);
    const result = stageNarrativeCreationProposals(
      state.snapshot,
      [
        { path: "trilhas.0.oficio", value: "Evocador", sourceText: "Ofício Evocador" },
        { path: "evocacao.nome", value: "Eco", sourceText: "Evocação Eco" },
        { path: "evocacao.porte", value: "Menor", sourceText: "porte Menor" },
        { path: "evocacao.forma", value: "Guardião", sourceText: "forma Guardião" },
        { path: "evocacao.modelo", value: "Muralha de Ecos", sourceText: "modelo Muralha de Ecos" },
      ],
      [text],
    );
    expect(result.ok).toBe(true);
  });

  it("reports dependency effects when changing an Office after equipment was confirmed", () => {
    const state = startConversationalCreation("QA Player", "Quero mudar de Ofício para Evocador.");
    const snapshot = structuredClone(state.snapshot);
    snapshot.povo = "Aelvari";
    snapshot.heranca = "Cronista";
    const trail = (snapshot.trilhas as Record<string, unknown>[])[0]!;
    trail.oficio = "Curador";
    trail.papel = "Amparo";
    trail.chave = "Kit de Retorno";
    const equipment = snapshot.equipamento as Record<string, unknown>;
    equipment.arma = "Faca";
    equipment.armadura = "Roupas reforçadas";
    equipment.ferramenta = "Kit de cura";
    equipment.proficienciaConfirmada = true;
    snapshot.serverCreationProgress = {
      ...(snapshot.serverCreationProgress as object),
      confirmedPaths: [
        "trilhas.0.oficio",
        "equipamento.arma",
        "equipamento.armadura",
        "equipamento.ferramenta",
      ],
    };
    const staged = stageNarrativeCreationProposals(
      snapshot,
      [
        {
          path: "trilhas.0.oficio",
          value: "Evocador",
          sourceText: "mudar de Ofício para Evocador",
        },
      ],
      [state.userMessage],
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(staged.effects.length).toBeGreaterThan(0);
    expect(staged.pending[0]?.effects).toEqual(staged.effects);
    const confirmed = confirmNarrativeCreationProposals(staged.snapshot);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect((confirmed.snapshot.equipamento as Record<string, unknown>).ferramenta).toBe("");
    expect(
      (confirmed.snapshot.serverCreationProgress as { confirmedPaths: string[] }).confirmedPaths,
    ).not.toContain("equipamento.ferramenta");
  });
});
