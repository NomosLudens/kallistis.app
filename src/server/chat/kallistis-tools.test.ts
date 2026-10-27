import { describe, expect, it, vi } from "vitest";
import { buildCharacterDraft } from "@/server/characters/chat-creation";
import {
  applyCharacterCreationPatch,
  createKallistisTools,
  reconstructCharacterCreationPatchFromHistory,
} from "./kallistis-tools";
import { characterChoiceOptions } from "@/server/characters/character-choice-registry";

function runtimeForDraft(office = "Evocador") {
  const draft = {
    id: "draft-1",
    ownerUserId: "user-1",
    masterUserId: "",
    status: "draft" as const,
    ruleset: "KALLISTIS_REGRAS_CANONICAS_2.0",
    name: "Ari",
    playerName: "",
    version: 2,
    snapshot: buildCharacterDraft("Ari", "", office),
    mechanicalFingerprint: "before",
    createdAt: "",
    updatedAt: "",
    mesas: [],
  };
  const save = vi.fn(async (_userId: string, _id: string, snapshot: typeof draft.snapshot) => ({
    ...draft,
    snapshot,
    version: draft.version + 1,
  }));
  const createCharacterCreationPatchPreview = vi.fn(async (input: Record<string, unknown>) => ({
    ...input,
    id: "confirmation-1",
    status: "pending" as const,
    operation: "character_creation_patch" as const,
    operationId: "operation-1",
    createdAt: "",
    expiresAt: String(input.expiresAt),
    confirmedAt: null,
    beforeBiography: null,
    nextBiography: null,
    payload: { patch: input.patch, preview: input.preview },
  }));
  return {
    draft,
    save,
    createCharacterCreationPatchPreview,
    runtime: {
      characters: {
        get: vi.fn(async () => draft),
        list: vi.fn(async () => [draft]),
        save,
      },
      chat: {
        updatePlayerExperience: vi.fn(async () => null),
        listThreadMessages: vi.fn(async () => []),
      },
      mutations: { createCharacterCreationPatchPreview },
    } as any,
  };
}

function runtimeForNewDraft(cancelledPreview: Record<string, unknown> | null = null) {
  const createCharacterCreatePreview = vi.fn(async (input: Record<string, any>) => ({
    ...input,
    id: "create-confirmation-1",
    status: "pending" as const,
    operation: "character_create" as const,
    operationId: input.operationId,
    createdAt: "",
    expiresAt: String(input.expiresAt),
    confirmedAt: null,
    payload: { ...input.payload, plannedCharacterId: input.plannedCharacterId },
  }));
  const getLatestCancelledCharacterCreatePreview = vi.fn(async () => cancelledPreview);
  return {
    createCharacterCreatePreview,
    getLatestCancelledCharacterCreatePreview,
    create: vi.fn(),
    runtime: {
      characters: { get: vi.fn(), list: vi.fn(async () => []), create: vi.fn() },
      chat: { listThreadMessages: vi.fn(async () => []) },
      mutations: { createCharacterCreatePreview, getLatestCancelledCharacterCreatePreview },
    } as any,
  };
}

describe("propostas do Chat de Criação no Forge", () => {
  it("mostra para Curador somente sua ferramenta canônica", () => {
    const snapshot = buildCharacterDraft("QA Jinjo", "", "Curador") as unknown as Record<
      string,
      unknown
    >;

    expect(characterChoiceOptions("equipamento.ferramenta", snapshot)).toEqual(["Kit de cura"]);
    expect(characterChoiceOptions("equipamento.ferramenta", snapshot)).not.toContain(
      "Foco de magia",
    );
  });

  it("gera preview QA para equipamento Curador válido com confirmação natural de proficiência", async () => {
    const qa = runtimeForDraft("Curador");
    const result = await applyCharacterCreationPatch({
      runtime: qa.runtime,
      userId: "qa-player",
      threadId: "qa-equipment-preview",
      activeCharacterId: "draft-1",
      scope: "character_creation",
      patch: {
        equipamento: {
          arma: "Lança curta",
          armadura: "Leve",
          ferramenta: "Kit de cura",
          consumiveis: ["Estabilizador de Fluxo", "Sal de Memória"],
        },
      },
      rawUserText: "Confirmar que Jinjo tem proficiência com lança curta",
    });

    expect(result).toMatchObject({
      status: "requires_confirmation",
      operation: "character_creation_patch",
    });
    expect(qa.createCharacterCreationPatchPreview).toHaveBeenCalledTimes(1);
    expect(qa.createCharacterCreationPatchPreview.mock.calls[0]?.[0]).toMatchObject({
      userId: "qa-player",
      threadId: "qa-equipment-preview",
      patch: {
        equipamento: {
          arma: "Lança curta",
          proficienciaConfirmada: true,
          armadura: "Leve",
          ferramenta: "Kit de cura",
          consumiveis: ["Estabilizador de Fluxo", "Sal de Memória"],
        },
      },
    });
  });

  it("reconhece 'confirmo que tenho proficiência' e gera o preview de lança válida", async () => {
    const qa = runtimeForDraft("Curador");
    const result = await applyCharacterCreationPatch({
      runtime: qa.runtime,
      userId: "qa-player",
      threadId: "qa-equipment-proficiency-wording",
      activeCharacterId: "draft-1",
      scope: "character_creation",
      patch: { equipamento: { arma: "Lança curta" } },
      rawUserText: "Arma: Lança curta. Confirmo que tenho proficiência com lança curta.",
    });

    expect(result).toMatchObject({
      status: "requires_confirmation",
      operation: "character_creation_patch",
    });
    expect(qa.createCharacterCreationPatchPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: { equipamento: { arma: "Lança curta", proficienciaConfirmada: true } },
      }),
    );
  });

  it("recusa ferramenta inválida para Curador sem criar preview", async () => {
    const qa = runtimeForDraft("Curador");
    const result = await applyCharacterCreationPatch({
      runtime: qa.runtime,
      userId: "qa-player",
      threadId: "qa-invalid-equipment",
      activeCharacterId: "draft-1",
      scope: "character_creation",
      patch: { equipamento: { ferramenta: "Foco de magia" } },
      rawUserText: "Ferramenta: Foco de magia",
    });

    expect(result).toMatchObject({
      status: "validation_error",
      code: "character_choice_invalid_or_dependency_missing",
      invalidFields: ["equipamento.ferramenta"],
    });
    expect(qa.createCharacterCreationPatchPreview).not.toHaveBeenCalled();
  });

  it("reconstrói escolhas naturais completas sem perder 'todas as outras 0'", () => {
    const messages = [
      {
        role: "user" as const,
        content:
          "Quero criar personagem. Nome Nara. Povo Livres, Ofício principal Curador, Herança Múltiplos Caminhos. Técnica de Herança Preparação de Campo do Ofício Artífice. Na trilha de Curador, papel Amparo, perícias Cuidado e Empatia, técnica Estabilizar Relação.",
      },
      {
        role: "user" as const,
        content:
          "Origem Criado na Luz. Conceito: curandeira de estrada que leva cuidado comunitário às aldeias isoladas. Atributos Corpo 3, Agilidade 2, Intelecto 2, Presença 1, Vontade 1, Sintonia 0. Perícias: Cuidado 3, Percepção 2, Influência 2, Empatia 2, Atletismo 1, Sobrevivência 1, Investigação 1, Ofício 1, todas as outras 0. Chave Kit de Retorno. Equipamento: Faca, armadura Leve, ferramenta Kit de cura, consumíveis Tônico de Vitalidade e Fio de Retorno. Vínculos: comunidade da estrada, aprendiz de boticária, viajante salvo. Promessa: nunca deixar alguém sem atendimento. Ferida: não conseguiu salvar a primeira mentora. Pergunta: quem ensinou a mentora dela? Use esses dados para o preview.",
      },
      {
        role: "user" as const,
        content:
          "Aprendizagem Cruzada: Sobrevivência. Deixe Conceito · objetivo e Conceito · perda em branco.",
      },
    ];

    const result = reconstructCharacterCreationPatchFromHistory(messages);
    expect(result.unresolvedDistributions).toEqual([]);
    expect(result.patch).toMatchObject({
      nome: "Nara",
      povo: "Livres",
      heranca: "Múltiplos Caminhos",
      origem: "Criado na Luz",
      conceito: {
        identidade: "curandeira de estrada que leva cuidado comunitário às aldeias isoladas",
        objetivo: "",
        perda: "",
      },
      atributosBase: { Corpo: 3, Agilidade: 2, Intelecto: 2, Presença: 1, Vontade: 1, Sintonia: 0 },
      periciasBase: {
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
      },
      pericaLivre: "Sobrevivência",
      trilhas: [
        {
          oficio: "Curador",
          papel: "Amparo",
          chave: "Kit de Retorno",
          tecnicas: ["Estabilizar Relação"],
        },
      ],
      tecnicaHeranca: { oficio: "Artífice", nome: "Preparação de Campo" },
      equipamento: {
        arma: "Faca",
        armadura: "Leve",
        ferramenta: "Kit de cura",
        consumiveis: ["Tônico de Vitalidade", "Fio de Retorno"],
      },
      vinculos: ["comunidade da estrada", "aprendiz de boticária", "viajante salvo"],
      promessa: "nunca deixar alguém sem atendimento",
      ferida: "não conseguiu salvar a primeira mentora",
      pergunta: "quem ensinou a mentora dela?",
    });
  });

  it("usa a distribuição canônica reconstruída do histórico quando o modelo corrompe acentos nas chaves", async () => {
    const messages = [
      {
        role: "user" as const,
        content:
          "Distribuição base das perícias: Atletismo 2, Combate 1, Pontaria 0, Furtividade 1, Percepção 2, Sobrevivência 3, Investigação 0, Conhecimento 0, Ofício 1, Influência 0, Empatia 2, Cuidado 1, Magia 0, Evocação 0, Velarim 0.",
      },
    ];
    const choice = runtimeForNewDraft();
    choice.runtime.chat.listThreadMessages = vi.fn(async () => messages);

    const result = await applyCharacterCreationPatch({
      runtime: choice.runtime,
      userId: "user-1",
      threadId: "thread-1",
      scope: "character_creation",
      patch: {
        periciasBase: {
          Atletismo: 2,
          Combate: 1,
          Pontaria: 0,
          Furtividade: 1,
          "PercepÃ§Ã£o": 2,
          SobrevivÃªncia: 3,
          "InvestigaÃ§Ã£o": 0,
          Conhecimento: 0,
          "OfÃ­cio": 1,
          InfluÃªncia: 0,
          Empatia: 2,
          Cuidado: 1,
          Magia: 0,
          "EvocaÃ§Ã£o": 0,
          Velarim: 0,
        },
        trilhas: [
          {
            oficio: "Curador",
            pericias: [
              "Atletismo",
              "Combate",
              "Pontaria",
              "Furtividade",
              "Percepção",
              "Sobrevivência",
              "Investigação",
              "Conhecimento",
              "Ofício",
              "Influência",
              "Empatia",
              "Cuidado",
              "Magia",
              "Evocação",
              "Velarim",
            ],
          },
        ],
      },
    });

    expect(result).toMatchObject({
      status: "requires_confirmation",
      operation: "character_create",
    });
    const snapshot = choice.createCharacterCreatePreview.mock.calls[0]![0].payload.snapshot;
    expect(snapshot.periciasBase).toEqual({
      Atletismo: 2,
      Combate: 1,
      Pontaria: 0,
      Furtividade: 1,
      Percepção: 2,
      Sobrevivência: 3,
      Investigação: 0,
      Conhecimento: 0,
      Ofício: 1,
      Influência: 0,
      Empatia: 2,
      Cuidado: 1,
      Magia: 0,
      Evocação: 0,
      Velarim: 0,
    });
    expect(snapshot.trilhas[0].pericias).toEqual(["Cuidado", "Empatia"]);
    expect(snapshot.trilhas[0].tecnicas).toEqual(["Estabilizar Relação"]);
  });

  it("reconstrói a escolha corrigida antes do preview com histórico retornado em ordem decrescente", async () => {
    const messages = [
      { role: "assistant" as const, content: "Qual Povo e Ofício você escolhe?" },
      { role: "user" as const, content: "Sou um Livre Curador." },
      { role: "assistant" as const, content: "Qual Herança Livre você quer?" },
      { role: "user" as const, content: "Múltiplos Caminhos" },
      { role: "assistant" as const, content: "Qual origem faz sentido?" },
      { role: "user" as const, content: "Criado na Luz" },
      { role: "assistant" as const, content: "Como distribuir os atributos?" },
      {
        role: "user" as const,
        content: "Corpo 3, Agilidade 2, Intelecto 2, Presença 1, Vontade 1, Sintonia 0.",
      },
      { role: "assistant" as const, content: "Como distribuir as perícias?" },
      {
        role: "user" as const,
        content:
          "Cuidado 3, Empatia 2, Magia 2, Evocação 2, Investigação 1, Conhecimento 1, Ofício 1, Velarim 1 e Influência 0.",
      },
      {
        role: "assistant" as const,
        content: "A distribuição ainda está incompleta. O que fica nas demais perícias?",
      },
      {
        role: "user" as const,
        content:
          "Mantenho Cuidado 3; Empatia 2, Magia 2 e Evocação 2; Investigação 1, Conhecimento 1, Ofício 1 e Velarim 1; as demais perícias ficam em 0.",
      },
      { role: "assistant" as const, content: "Qual Papel e qual Chave?" },
      { role: "user" as const, content: "Papel Amparo e Chave Kit de Retorno." },
      { role: "user" as const, content: "Perícia Livre Influência." },
      {
        role: "user" as const,
        content:
          "Minha técnica inicial é Estabilizar Relação. Técnica de Herança Preparação de Campo do Ofício Artífice.",
      },
      {
        role: "user" as const,
        content:
          "Arma Faca, armadura Leve, ferramenta Kit de cura; consumíveis Tônico de Vitalidade e Fio de Retorno.",
      },
      { role: "user" as const, content: "Prefiro manter a faca sem proficiência." },
      {
        role: "user" as const,
        content:
          "Nome Lira QA-E2E. Vínculos: Nara, minha irmã; Casa de Cura do Farol; e os viajantes que acolho. Promessa: não abandonar quem estiver ferido. Ferida: culpa por não ter salvado uma amiga. Pergunta: como cuidar dos outros sem me perder de mim? Essas são minhas escolhas; ainda quero revisar a prévia antes de finalizar.",
      },
    ];

    const result = reconstructCharacterCreationPatchFromHistory(messages);
    const patch = result.patch as Record<string, any>;
    expect(result.unresolvedDistributions).toEqual([]);
    expect(patch).toMatchObject({
      nome: "Lira QA-E2E",
      povo: "Livres",
      heranca: "Múltiplos Caminhos",
      origem: "Criado na Luz",
      atributosBase: { Corpo: 3, Agilidade: 2, Intelecto: 2, Presença: 1, Vontade: 1, Sintonia: 0 },
      periciasBase: {
        Cuidado: 3,
        Empatia: 2,
        Magia: 2,
        Evocação: 2,
        Influência: 0,
        Ofício: 1,
        Investigação: 1,
        Conhecimento: 1,
        Velarim: 1,
        Atletismo: 0,
        Combate: 0,
        Pontaria: 0,
        Furtividade: 0,
        Percepção: 0,
        Sobrevivência: 0,
      },
      pericaLivre: "Influência",
      trilhas: [
        {
          oficio: "Curador",
          papel: "Amparo",
          chave: "Kit de Retorno",
          tecnicas: ["Estabilizar Relação"],
        },
      ],
      tecnicaHeranca: { oficio: "Artífice", nome: "Preparação de Campo" },
      equipamento: {
        arma: "Faca",
        armadura: "Leve",
        ferramenta: "Kit de cura",
        consumiveis: ["Tônico de Vitalidade", "Fio de Retorno"],
      },
      vinculos: ["Nara, minha irmã", "Casa de Cura do Farol", "os viajantes que acolho"],
      promessa: "não abandonar quem estiver ferido",
      ferida: "culpa por não ter salvado uma amiga",
      pergunta: "como cuidar dos outros sem me perder de mim?",
    });

    const choice = runtimeForNewDraft();
    choice.runtime.chat.listThreadMessages = vi.fn(async () => [...messages].reverse());
    const resultFromTool = await applyCharacterCreationPatch({
      runtime: choice.runtime,
      userId: "qa-user",
      threadId: "qa-thread",
      scope: "character_creation",
      patch: { nome: "Lira QA-E2E" },
      rawUserText: "Confirmo que a Faca atende às proficiências do Ofício.",
    });
    expect(resultFromTool).toMatchObject({
      status: "requires_confirmation",
      operation: "character_create",
    });
    expect(choice.createCharacterCreatePreview).toHaveBeenCalledTimes(1);
    const persistedPreview = choice.createCharacterCreatePreview.mock.calls[0]![0].payload.snapshot;
    expect(persistedPreview).toMatchObject(patch);
    expect(persistedPreview.equipamento.proficienciaConfirmada).toBe(true);
    expect(persistedPreview.trilhas[0]).toMatchObject({
      pericias: expect.arrayContaining(["Cuidado", "Empatia"]),
      tecnicas: expect.arrayContaining(["Estabilizar Relação"]),
    });
    expect(persistedPreview.periciasProveniencia).toBeDefined();
  });

  it("não transforma uma resposta negativa de proficiência em confirmação afirmativa", async () => {
    const snapshot = buildCharacterDraft("", "Livres", "Curador");
    const choice = runtimeForNewDraft({
      id: "cancelled-creation-preview",
      operation: "character_create",
      status: "cancelled",
      payload: { snapshot },
    });
    choice.runtime.chat.listThreadMessages = vi.fn(async () => [
      {
        id: "message-1",
        threadId: "thread-1",
        userId: "user-1",
        role: "user" as const,
        content: "Prefiro manter a faca sem proficiência.",
        createdAt: "",
        derivedFrom: [],
        sourceChannel: null,
      },
    ]);

    const result = await applyCharacterCreationPatch({
      runtime: choice.runtime,
      userId: "user-1",
      threadId: "thread-1",
      scope: "character_creation",
      activeCharacterId: null,
      patch: {
        equipamento: {
          arma: "Faca",
          armadura: "Leve",
          ferramenta: "Kit de cura",
          consumiveis: ["Tônico de Vitalidade", "Fio de Retorno"],
          proficienciaConfirmada: false,
        },
      },
    });

    expect(result).toMatchObject({
      status: "validation_error",
      code: "character_choice_invalid_or_dependency_missing",
      invalidFields: ["equipamento.proficienciaConfirmada (confirmação explícita exigida)"],
    });
    expect(choice.createCharacterCreatePreview).not.toHaveBeenCalled();
  });

  it("propõe criar um rascunho parcial na primeira escolha sem gravar antes da confirmação", async () => {
    const choice = runtimeForNewDraft();
    const result = await applyCharacterCreationPatch({
      runtime: choice.runtime,
      userId: "user-1",
      threadId: "thread-1",
      scope: "character_creation",
      activeCharacterId: null,
      patch: { povo: "Livre", trilhas: [{ oficio: "Curandeiro" }] },
    });

    expect(result).toMatchObject({
      status: "requires_confirmation",
      operation: "character_create",
      preview: { povo: "Livres", trilhas: [{ oficio: "Curador" }] },
    });
    expect(choice.createCharacterCreatePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        threadId: "thread-1",
        payload: expect.objectContaining({
          snapshot: expect.objectContaining({
            povo: "Livres",
            trilhas: [expect.objectContaining({ oficio: "Curador" })],
          }),
          ruleset: "KALLISTIS_REGRAS_CANONICAS_2.0",
        }),
      }),
    );
    expect(choice.create).not.toHaveBeenCalled();
  });

  it("retoma escolhas de preview cancelado ao propor a próxima correção contextual", async () => {
    const snapshot = buildCharacterDraft("", "", "");
    snapshot.povo = "Livres";
    snapshot.heranca = "Múltiplos Caminhos";
    (snapshot.trilhas as Array<Record<string, unknown>>)[0]!.oficio = "Curador";
    const choice = runtimeForNewDraft({
      id: "cancelled-creation-preview",
      operation: "character_create",
      status: "cancelled",
      payload: { snapshot },
    });

    await applyCharacterCreationPatch({
      runtime: choice.runtime,
      userId: "user-1",
      threadId: "thread-1",
      scope: "character_creation",
      activeCharacterId: null,
      patch: { tecnicaHeranca: { oficio: "Artífice", nome: "Preparação de Campo" } },
      rawUserText: "Artífice.",
    });

    expect(choice.createCharacterCreatePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          snapshot: expect.objectContaining({
            povo: "Livres",
            heranca: "Múltiplos Caminhos",
            tecnicaHeranca: { oficio: "Artífice", nome: "Preparação de Campo" },
            trilhas: [expect.objectContaining({ oficio: "Curador" })],
          }),
        }),
      }),
    );
  });

  it("bloqueia preview dependente quando o contexto anterior não está representado", async () => {
    const choice = runtimeForNewDraft();
    const result = await applyCharacterCreationPatch({
      runtime: choice.runtime,
      userId: "user-1",
      threadId: "thread-1",
      scope: "character_creation",
      activeCharacterId: null,
      patch: { tecnicaHeranca: { oficio: "Artífice", nome: "Preparação de Campo" } },
      rawUserText: "Artífice.",
    });

    expect(result).toMatchObject({
      status: "validation_error",
      code: "creation_context_missing",
    });
    expect(choice.createCharacterCreatePreview).not.toHaveBeenCalled();
  });

  it("cria preview canônico e não salva antes da confirmação", async () => {
    const choice = runtimeForDraft();
    const result = await applyCharacterCreationPatch({
      runtime: choice.runtime,
      userId: "user-1",
      threadId: "thread-1",
      scope: "character_creation",
      activeCharacterId: "draft-1",
      patch: { povo: "Livre", trilhas: [{ oficio: "Curandeiro" }] },
    });
    expect(result).toMatchObject({
      status: "requires_confirmation",
      operation: "character_creation_patch",
      preview: { povo: "Livres", trilhas: [{ oficio: "Curador" }] },
    });
    expect(choice.createCharacterCreationPatchPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 2,
        patch: { povo: "Livres", trilhas: [{ oficio: "Curador" }] },
      }),
    );
    expect(choice.save).not.toHaveBeenCalled();
  });

  it("aceita a seleção explícita de Herança como preview sem alterar o Ofício principal", async () => {
    const choice = runtimeForDraft();
    choice.draft.snapshot = buildCharacterDraft("Ari", "Livres", "Curador");
    const result = await applyCharacterCreationPatch({
      runtime: choice.runtime,
      userId: "user-1",
      threadId: "thread-1",
      scope: "character_creation",
      activeCharacterId: "draft-1",
      patch: { heranca: "Múltiplos Caminhos" },
    });
    expect(result).toMatchObject({
      status: "requires_confirmation",
      preview: { heranca: "Múltiplos Caminhos" },
    });
    expect(choice.save).not.toHaveBeenCalled();
    expect(choice.createCharacterCreationPatchPreview).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { heranca: "Múltiplos Caminhos" } }),
    );
    expect((choice.draft.snapshot.trilhas as Array<{ oficio: string }>)[0]?.oficio).toBe("Curador");
  });

  it("não interpreta uma palavra isolada como permissão para mudar o Ofício", async () => {
    const choice = runtimeForDraft();
    const result = await applyCharacterCreationPatch({
      runtime: choice.runtime,
      userId: "user-1",
      threadId: "thread-1",
      scope: "character_creation",
      activeCharacterId: "draft-1",
      patch: { trilhas: [{ oficio: "Artífice" }] },
    });
    expect(result).toMatchObject({
      status: "requires_confirmation",
      preview: { trilhas: [{ oficio: "Artífice" }] },
    });
    expect(choice.save).not.toHaveBeenCalled();
  });

  it("mantém patch contextual pendente sem apagar o restante do snapshot", async () => {
    const choice = runtimeForDraft();
    const result = await applyCharacterCreationPatch({
      runtime: choice.runtime,
      userId: "user-1",
      threadId: "thread-1",
      scope: "character_creation",
      activeCharacterId: "draft-1",
      patch: {
        conceito: {
          identidade: "guardião de memórias",
          objetivo: "preservar nomes",
          perda: "o arquivo ancestral",
        },
        atributosBase: {
          Corpo: 3,
          Agilidade: 2,
          Intelecto: 2,
          Presença: 1,
          Vontade: 1,
          Sintonia: 0,
        },
        equipamento: {
          arma: "Faca",
          proficienciaConfirmada: true,
          consumiveis: ["Tônico de Vitalidade", "Sal de Memória"],
        },
        vinculos: ["Arquivo", "Lira", "Medalhão"],
        promessa: "reconstruir o arquivo",
        ferida: "falhei em protegê-lo",
        pergunta: "quem é esquecido?",
      },
      rawUserText: "Confirmo que a Faca atende às proficiências do Ofício.",
    });
    expect(result).toMatchObject({
      status: "requires_confirmation",
      operation: "character_creation_patch",
    });
    expect(choice.save).not.toHaveBeenCalled();
  });

  it("rejeita patch fora do contrato e não grava", async () => {
    const choice = runtimeForDraft();
    const result = await applyCharacterCreationPatch({
      runtime: choice.runtime,
      userId: "user-1",
      threadId: "thread-1",
      scope: "character_creation",
      activeCharacterId: "draft-1",
      patch: { jogador: "inventado" },
    });
    expect(result).toMatchObject({
      status: "validation_error",
      code: "creation_patch_field_forbidden",
    });
    expect(choice.save).not.toHaveBeenCalled();
  });

  it("exige distribuições numéricas completas e canônicas antes do preview", async () => {
    const choice = runtimeForDraft();
    const result = await applyCharacterCreationPatch({
      runtime: choice.runtime,
      userId: "user-1",
      threadId: "thread-1",
      scope: "character_creation",
      activeCharacterId: "draft-1",
      patch: { atributosBase: { Corpo: 3, Agilidade: 2 } },
    });
    expect(result).toMatchObject({
      status: "validation_error",
      code: "numeric_distribution_invalid",
    });
    expect(choice.createCharacterCreationPatchPreview).not.toHaveBeenCalled();
    expect(choice.save).not.toHaveBeenCalled();
  });

  it("aplica limites do registry a escolhas múltiplas antes de criar preview", async () => {
    const choice = runtimeForDraft();
    const result = await applyCharacterCreationPatch({
      runtime: choice.runtime,
      userId: "user-1",
      threadId: "thread-1",
      scope: "character_creation",
      activeCharacterId: "draft-1",
      patch: { equipamento: { consumiveis: ["Tônico de Vitalidade"] } },
    });
    expect(result).toMatchObject({
      status: "validation_error",
      code: "character_choice_invalid_or_dependency_missing",
    });
    expect(choice.createCharacterCreationPatchPreview).not.toHaveBeenCalled();
    expect(choice.save).not.toHaveBeenCalled();
  });

  it.each([
    { patch: { povo: "Guardião" }, code: "character_choice_invalid_or_dependency_missing" },
    {
      patch: { trilhas: [{ oficio: "Kragor" }] },
      code: "character_choice_invalid_or_dependency_missing",
    },
    {
      patch: { trilhas: [{ oficio: "Guardião" }, { oficio: "Aelvari" }] },
      code: "character_choice_invalid_or_dependency_missing",
    },
  ])("rejeita valores fora do catálogo do Forge sem criar preview", async ({ patch, code }) => {
    const choice = runtimeForDraft();
    const result = await applyCharacterCreationPatch({
      runtime: choice.runtime,
      userId: "user-1",
      threadId: "thread-1",
      scope: "character_creation",
      activeCharacterId: "draft-1",
      patch,
    });
    expect(result).toMatchObject({ status: "validation_error", code });
    expect(choice.save).not.toHaveBeenCalled();
  });
});

describe("ferramenta de campanha do chat", () => {
  it("trata um campaignId que não é UUID sem abortar o turno", async () => {
    const tools = createKallistisTools({
      databaseUrl: "",
      userId: "user-1",
      threadId: "thread-1",
      requestId: "request-1",
      scope: "character_creation",
    });

    const result = await tools.consult_campaign.execute!(
      { campaignId: "QA-RECUPERACAO-20260930" },
      {} as never,
    );

    expect(result).toEqual({ status: "not_found", code: "invalid_campaign_id" });
  });
});
