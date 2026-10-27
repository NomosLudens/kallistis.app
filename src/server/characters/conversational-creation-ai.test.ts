import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retrieveCanonicalRules } from "@/lib/canonical-rules.server";
import { INITIAL_ATTRIBUTE_DISTRIBUTION } from "./character-canon";
import { creationOptionsForSnapshot, startConversationalCreation } from "./conversational-creation";
import { numericEvidenceMatchesClaim } from "./conversational-creation-ai";
import { canonicalRuleEvidenceId } from "./conversational-creation-knowledge";

const modelReply = {
  intent: "clarification",
  reply: "Qual parte da história você gostaria de explorar primeiro?",
  needsClarification: true,
  proposals: [],
};

describe("conversational creation provider request", () => {
  it("matches numeric values as whole values in the relevant mechanical context", () => {
    expect(
      numericEvidenceMatchesClaim("A distribuição de atributos tem 3 pontos.", [
        "A distribuição de atributos tem 30 pontos.",
      ]),
    ).toBe(false);
    expect(
      numericEvidenceMatchesClaim("A distribuição de atributos tem 3 pontos.", [
        "A distribuição de atributos tem 3 pontos.",
      ]),
    ).toBe(true);
    expect(numericEvidenceMatchesClaim("3 pontos de atributos", ["30 pontos de armadura"])).toBe(
      false,
    );
  });

  it("keeps a compact human-reviewed reference for CONV-05 mechanical traps", () => {
    const attributes = [...INITIAL_ATTRIBUTE_DISTRIBUTION].sort((left, right) => right - left);
    expect(attributes).toEqual([3, 2, 2, 1, 1, 0]);
    expect(attributes.filter((value) => value === 3)).toHaveLength(1);
    expect(attributes.reduce<number>((sum, value) => sum + value, 0)).toBe(9);

    const referenceCases = [
      {
        id: "P01-09",
        question: "Como funcionam as proficiências de armas?",
        expected: /Proficiência não concede automaticamente \+2/i,
      },
      {
        id: "P01-10",
        question: "O que fazem Munição de Quartzo e Fio de Retorno?",
        expected: /Munição de Quartzo[\s\S]*\+2 dano[\s\S]*Fio de Retorno[\s\S]*6 células/i,
      },
      {
        id: "P01-13",
        question: "Quais são os três papéis possíveis do Evocador?",
        expected: /Papéis[\s\S]*Artilharia[\s\S]*Amparo[\s\S]*Bastião/i,
      },
    ];
    for (const reference of referenceCases) {
      const sources = retrieveCanonicalRules(reference.question);
      expect(sources.length, reference.id).toBeGreaterThan(0);
      expect(
        sources.some((source) => reference.expected.test(source.text)),
        reference.id,
      ).toBe(true);
      expect(
        sources.every((source) => source.sourceVersion && source.sourceHash),
        reference.id,
      ).toBe(true);
      if (reference.id === "P01-13")
        expect(sources.some((source) => source.searchHeadings?.includes("Evocador"))).toBe(true);
    }
  });

  let requestBodies: Record<string, unknown>[];
  let responses: Response[];

  function response(status: number, payload: unknown) {
    return Response.json(payload, { status });
  }

  beforeEach(() => {
    requestBodies = [];
    responses = [
      response(200, {
        id: "chatcmpl-qa",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(modelReply) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 16, completion_tokens: 18, total_tokens: 34 },
      }),
    ];
    vi.stubEnv("OPENROUTER_API_KEY", "qa-test-key");
    vi.stubEnv("OPENROUTER_FAST_MODEL", "openai/gpt-5-nano");
    vi.stubEnv("OPENROUTER_CHAT_TIMEOUT_MS", "30000");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return responses.shift() ?? response(500, { error: { code: "unexpected_test_request" } });
      }),
    );
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function runTurn() {
    const { interpretNarrativeCreationTurn } = await import("./conversational-creation-ai");
    const start = startConversationalCreation("Jogador QA", "Quero contar a história de Darian.");
    return interpretNarrativeCreationTurn({
      requestId: "request-qa-creation",
      authenticatedUserId: "qa-user-test",
      snapshot: start.snapshot,
      history: [{ role: "user", content: "Quero contar a história de Darian." }],
      userMessage: "Quero contar a história de Darian.",
    });
  }

  async function runQuestion(
    question = "Como funciona a Sintonia?",
    chunkId = "K12-0042",
    sourceText = "Sintonia limita formas conhecidas.",
  ) {
    const { interpretNarrativeCreationTurn } = await import("./conversational-creation-ai");
    const start = startConversationalCreation("Jogador QA", "Quero criar uma personagem.");
    return interpretNarrativeCreationTurn({
      requestId: "request-qa-question",
      authenticatedUserId: "qa-user-test",
      snapshot: start.snapshot,
      history: [{ role: "user", content: question }],
      userMessage: question,
      sources: [
        {
          chunkId,
          sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
          sourceHash: "37a558c8119b5b9867389123f871a6a9a1ea2dd9d654fbda7ae7c1e8297de4c7",
          bookTitle: "Livro",
          chapter: "Sistema",
          section: "Sintonia",
          headingPath: ["Sistema", "Sintonia"],
          startLine: 100,
          endLine: 120,
          text: sourceText,
          route4Id: "R4-1",
          route10Id: "R10-1",
          route50Id: "R50-1",
          relatedChunkIds: [],
          ruleTags: ["magic"],
        },
      ],
    });
  }

  it("sends strict JSON Schema only for the narrative creator", async () => {
    const result = await runTurn();
    const requestBody = requestBodies[0];
    const responseFormat = requestBody?.response_format as
      | { type?: string; json_schema?: { strict?: boolean; schema?: { type?: string } } }
      | undefined;

    expect(requestBody?.model).toBe("deepseek/deepseek-v4-flash-0731");
    expect(requestBody?.max_tokens).toBe(4800);
    expect(requestBody?.reasoning_effort).toBe("low");
    expect(requestBody).not.toHaveProperty("temperature");
    expect(responseFormat?.type).toBe("json_schema");
    expect(responseFormat?.json_schema?.strict).toBe(true);
    expect(responseFormat?.json_schema?.schema?.type).toBe("object");
    expect(requestBody?.provider).toEqual({ require_parameters: true });
    expect(result.reply).toBe(modelReply.reply);
    expect(result.providerUnavailable).toBe(false);
  });

  it("limits proposal paths to unresolved fields and keeps memory out of model output", async () => {
    const { interpretNarrativeCreationTurn } = await import("./conversational-creation-ai");
    const start = startConversationalCreation("Jogador QA", "Quero criar uma personagem.");
    const availablePaths = creationOptionsForSnapshot(start.snapshot).map((step) => step.path);
    start.snapshot.serverCreationProgress = {
      ...(start.snapshot.serverCreationProgress as Record<string, unknown>),
      confirmedPaths: availablePaths.filter((path) => path !== "pergunta"),
    };
    await interpretNarrativeCreationTurn({
      requestId: "request-qa-narrow-schema",
      authenticatedUserId: "qa-user-test",
      snapshot: start.snapshot,
      history: [{ role: "user", content: "Quero definir minha pergunta central." }],
      userMessage: "Quero definir minha pergunta central.",
    });
    const schema = (
      requestBodies[0]?.response_format as {
        json_schema?: {
          schema?: {
            properties?: Record<
              string,
              { items?: { properties?: Record<string, { enum?: string[] }> } }
            >;
          };
        };
      }
    )?.json_schema?.schema;
    expect(schema?.properties?.proposals?.items?.properties?.path?.enum).toEqual(["pergunta"]);
    expect(schema?.properties).not.toHaveProperty("memoryUpdates");
  });

  it("answers a standalone rules question with the smaller source-cited contract", async () => {
    responses = [
      response(200, {
        id: "chatcmpl-qa-book",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "A Sintonia limita as formas conhecidas." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
      }),
      response(200, {
        id: "chatcmpl-qa-book-support",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: `\`\`\`json\n${JSON.stringify({
                claims: [
                  {
                    claim: "A Sintonia limita as formas conhecidas.",
                    answerQuote: "A Sintonia limita as formas conhecidas.",
                    kind: "mechanical",
                    status: "SUPPORTED",
                    evidence: [
                      { quote: "Sintonia limita formas conhecidas.", chunkId: "K12-0042" },
                    ],
                  },
                ],
              })}\n\`\`\``,
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
      }),
    ];

    const result = await runQuestion();
    expect(requestBodies[0]?.model).toBe("deepseek/deepseek-v4-flash-0731");
    expect(requestBodies[0]?.max_tokens).toBe(1400);
    expect((requestBodies[0]?.messages as Array<{ content: string }>)[0]?.content).toContain(
      "português brasileiro",
    );
    expect(requestBodies[0]?.reasoning_effort).toBe("minimal");
    expect(requestBodies[0]).not.toHaveProperty("response_format");
    expect(requestBodies[1]?.model).toBe("openai/gpt-oss-20b");
    expect(requestBodies[1]).not.toHaveProperty("response_format");
    expect(requestBodies[1]?.max_tokens).toBe(2400);
    expect(requestBodies[1]?.reasoning_effort).toBe("minimal");
    expect(result.intent).toBe("question");
    expect(result.reply).toContain("A Sintonia limita as formas conhecidas.");
    expect(result.reply).toContain("K12-0042");
    expect(result.answerSupport).toMatchObject({ status: "SUPPORTED" });
    expect(result.pending).toEqual([]);
  });

  it("answers Evocador role questions from the canonical catalog and exact book passage", async () => {
    const result = await runQuestion(
      "Quais papéis um Evocador pode exercer?",
      "K12-0093",
      "### Evocador\n**Papéis:** Artilharia, Amparo ou Bastião\nPerícias: Evocação.",
    );
    const { emptyCreationConversationMemory, updateCreationConversationMemory } =
      await import("./conversational-creation-knowledge");
    const persistedMemory = updateCreationConversationMemory({
      previous: emptyCreationConversationMemory(),
      snapshot: result.snapshot,
      userMessage: "Quais papéis um Evocador pode exercer?",
      assistantMessage: result.reply,
      intent: "question",
      sources: result.sources,
      answerSupport: result.answerSupport,
    });

    expect(requestBodies).toHaveLength(0);
    expect(result.reply).toContain("Artilharia, Amparo, Bastião");
    expect(result.reply).toContain("K12-0093");
    expect(result.answerSupport).toMatchObject({
      status: "SUPPORTED",
      claims: [
        {
          status: "SUPPORTED",
          answerAnchor: "MATCHED",
          provenanceStatus: "VERIFIED",
          semanticStatus: "SUPPORTED",
          contradictionStatus: "NONE",
          evidence: [
            {
              chunkId: "K12-0093",
              quote: "Papéis:** Artilharia, Amparo ou Bastião",
              sourceKind: "book",
              sourceVersion: "KALLISTIS-LIVRO-2026-10-12",
              sourceHash: "37a558c8119b5b9867389123f871a6a9a1ea2dd9d654fbda7ae7c1e8297de4c7",
              provenance: "literal_source_match",
            },
          ],
        },
      ],
    });
    expect(persistedMemory.qa[0]).toMatchObject({
      supportStatus: "SUPPORTED",
      confidence: "source-backed",
      sourceChunkIds: ["K12-0093"],
    });
  });

  it("does not replace a compound Evocador comparison and character-memory question with a role list", async () => {
    const question =
      "O que Nair teme sobre seu mentor? Segundo o livro, qual é a diferença entre os papéis Amparo e Bastião do Evocador?";
    await runQuestion(
      question,
      "K12-0093",
      "### Evocador\n**Papéis:** Artilharia, Amparo ou Bastião\nPerícias: Evocação.",
    );
    expect(requestBodies.length).toBeGreaterThan(0);
    expect(JSON.stringify(requestBodies[0]?.messages)).toContain(question);
  });

  it("stages an explicitly declared dependent Evocador role with its earlier office choice", async () => {
    responses = [
      response(200, {
        id: "chatcmpl-qa-evocador-role",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                intent: "proposal",
                reply: "Posso preparar Bastião para sua Trilha de Evocador.",
                needsClarification: false,
                proposals: [
                  {
                    path: "trilhas.0.papel",
                    value: "Bastião",
                    sourceText: "Quero seguir pelo papel de Bastião.",
                  },
                ],
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 80, completion_tokens: 24, total_tokens: 104 },
      }),
    ];
    const { interpretNarrativeCreationTurn } = await import("./conversational-creation-ai");
    const firstMessage =
      "Quero criar uma Evocadora que cresceu longe da família e foi criada por um velho guerreiro.";
    const start = startConversationalCreation("Jogador QA", firstMessage);

    const result = await interpretNarrativeCreationTurn({
      requestId: "request-qa-evocador-role",
      authenticatedUserId: "qa-user-test",
      snapshot: start.snapshot,
      history: [{ role: "user", content: firstMessage }],
      userMessage: "Quero seguir pelo papel de Bastião.",
    });

    expect(result.pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "trilhas.0.oficio", value: "Evocador" }),
        expect.objectContaining({ path: "trilhas.0.papel", value: "Bastião" }),
      ]),
    );
    expect((result.snapshot.trilhas as Array<{ oficio?: string }>)[0]?.oficio).toBe("");
  });

  it.each([
    ["length", "A Sintonia depende"],
    ["stop", ""],
  ])(
    "rejects %s book generation before evaluation or persistence",
    async (finishReason, content) => {
      responses = [
        response(200, {
          id: "chatcmpl-qa-incomplete-book",
          object: "chat.completion",
          choices: [
            { index: 0, message: { role: "assistant", content }, finish_reason: finishReason },
          ],
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
        }),
      ];
      const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await expect(runQuestion()).rejects.toThrow("generation_incomplete");
      expect(requestBodies).toHaveLength(1);
      expect(warning).toHaveBeenCalledWith(
        "[character-creation] incomplete book answer rejected",
        expect.objectContaining({
          requestId: "request-qa-question",
          stage: "primary_generation",
          finishReason,
        }),
      );
    },
  );

  it("keeps verifier claims with an unknown category while enforcing numeric evidence", async () => {
    responses = [
      response(200, {
        id: "chatcmpl-qa-book-unknown-kind",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "A Sintonia permite 9999 formas." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }),
      response(200, {
        id: "chatcmpl-qa-book-unknown-kind-evaluation",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                claims: [
                  {
                    claim: "A Sintonia permite 9999 formas.",
                    answerQuote: "A Sintonia permite 9999 formas.",
                    kind: "conceptual",
                    status: "SUPPORTED",
                    evidence: [
                      { quote: "Sintonia limita formas conhecidas.", chunkId: "K12-0042" },
                    ],
                  },
                ],
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 14, total_tokens: 44 },
      }),
    ];

    const result = await runQuestion();

    expect(result.answerSupport).toMatchObject({
      status: "UNSUPPORTED",
      claims: [{ kind: "factual", status: "UNSUPPORTED", evidence: [{ chunkId: "K12-0042" }] }],
    });
    expect(result.reply).toContain("Não foi possível confirmar");
  });

  it("verifies executable-rule citations against the current rule source id, version, hash, and text", async () => {
    const question = "Como são distribuídos os seis atributos?";
    const rule = retrieveCanonicalRules(question).find((item) =>
      /atribut/i.test(`${item.section} ${item.text}`),
    );
    expect(rule).toBeDefined();
    const quote = rule!.text.trim().slice(0, 180);
    const chunkId = canonicalRuleEvidenceId(rule!.sourceId, rule!.section);
    const answer = "A regra canônica define a distribuição inicial dos atributos.";
    responses = [
      response(200, {
        id: "chatcmpl-qa-rule-answer",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: answer },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 },
      }),
      response(200, {
        id: "chatcmpl-qa-rule-evaluation",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                claims: [
                  {
                    claim: answer,
                    answerQuote: answer,
                    kind: "mechanical",
                    status: "SUPPORTED",
                    evidence: [{ quote, chunkId }],
                  },
                ],
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 60, completion_tokens: 24, total_tokens: 84 },
      }),
    ];

    const result = await runQuestion(question, "K12-0106", "Distribuição inicial dos atributos.");
    expect(requestBodies[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining(chunkId) }),
      ]),
    );
    expect(result.answerSupport).toMatchObject({
      status: "SUPPORTED",
      claims: [
        {
          evidence: [
            {
              chunkId,
              sourceKind: "canonical_rule",
              sourceVersion: rule!.sourceVersion,
              sourceHash: rule!.sourceHash,
            },
          ],
        },
      ],
    });
  });

  it("keeps a generated explanation unverified when the independent JSON is malformed", async () => {
    responses = [
      response(200, {
        id: "chatcmpl-qa-book-text",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "A Sintonia limita as formas conhecidas." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      }),
      response(200, {
        id: "chatcmpl-qa-book-invalid-evaluation",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "A avaliação não está em JSON válido." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 },
      }),
    ];
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await runQuestion();

    expect(result.reply).toContain("A Sintonia limita as formas conhecidas.");
    expect(result.reply).toContain("verificação independente não foi concluída");
    expect(result.answerSupport).toMatchObject({ status: "UNVERIFIED", claims: [] });
    expect(warning).toHaveBeenCalledWith(
      "[character-creation] book answer support evaluation invalid",
      expect.objectContaining({ jsonParse: false, zodValidation: null, responseEmpty: false }),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("avaliação não está em JSON válido");
  });

  it("answers the central-question book query only with its exact source passage", async () => {
    const quote =
      "Complete a personagem com equipamento, Vínculos, Promessa, Ferida e uma Pergunta pessoal.";
    const result = await runQuestion("O que é uma pergunta central?", "K12-0108", quote);

    expect(requestBodies).toHaveLength(0);
    expect(result.intent).toBe("question");
    expect(result.reply).toContain(quote);
    expect(result.reply).toContain("K12-0108");
    expect(result.answerSupport).toMatchObject({
      status: "SUPPORTED",
      claims: [
        {
          status: "SUPPORTED",
          evidence: [{ quote, chunkId: "K12-0108" }],
        },
      ],
    });
  });

  it("routes a character-specific Anchor question through text generation and independent support evaluation", async () => {
    const { classifyCreationIntent, isStandaloneBookQuestion } =
      await import("./conversational-creation-ai");
    const question = "Como meu personagem Evocador define a Âncora?";
    expect(classifyCreationIntent(question)).toBe("mechanical_explanation");
    expect(isStandaloneBookQuestion(question)).toBe(true);
    responses = [
      response(200, {
        id: "chatcmpl-qa-anchor",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content:
                "A **Âncora** pode ser um objeto, lugar, nome, lembrança, elemento, artefato ou corpo construído que sustenta o vínculo evocado.",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
      }),
      response(200, {
        id: "chatcmpl-qa-anchor-support",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                claims: [
                  {
                    claim:
                      "A Âncora é definida por elementos como objeto, lugar, nome, lembrança, elemento, artefato ou corpo construído.",
                    answerQuote:
                      "A Âncora pode ser um objeto, lugar, nome, lembrança, elemento, artefato ou corpo construído que sustenta o vínculo evocado.",
                    kind: "factual",
                    status: "SUPPORTED",
                    evidence: [
                      {
                        quote:
                          "Âncora. objeto, lugar, nome, lembrança, elemento, artefato ou corpo construído.",
                        chunkId: "K12-0120",
                      },
                    ],
                  },
                ],
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
      }),
    ];
    const result = await runQuestion(
      question,
      "K12-0120",
      "Âncora. objeto, lugar, nome, lembrança, elemento, artefato ou corpo construído.",
    );
    expect(result.intent).toBe("question");
    expect(requestBodies[0]).not.toHaveProperty("response_format");
    expect(requestBodies[1]).not.toHaveProperty("response_format");
    expect(result.answerSupport).toMatchObject({ status: "SUPPORTED" });
    expect(result.reply).toContain("Fontes verificadas pelo servidor:");
  });

  it("keeps narrative questions about a character relationship in the conversational engine", async () => {
    const { classifyCreationIntent, isStandaloneBookQuestion } =
      await import("./conversational-creation-ai");
    const message =
      "Acho que o velho guerreiro era rígido, mas a protegia. Como essa relação poderia aparecer no vínculo dela com as Evocações, sem você decidir isso por mim?";

    expect(classifyCreationIntent(message)).toBe("narrative");
    expect(isStandaloneBookQuestion(message)).toBe(false);
    expect(classifyCreationIntent("Quais papéis um Evocador pode exercer?")).toBe(
      "mechanical_explanation",
    );
    expect(classifyCreationIntent("Como meu personagem Evocador define a Âncora?")).toBe(
      "mechanical_explanation",
    );
  });

  it("does not treat a verified quote as semantic support when it does not entail the answer", async () => {
    responses = [
      response(200, {
        id: "chatcmpl-qa-unsupported-answer",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "A Sintonia concede dano extra." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 9, total_tokens: 29 },
      }),
      response(200, {
        id: "chatcmpl-qa-unsupported-judge",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                claims: [
                  {
                    claim: "A Sintonia concede dano extra.",
                    answerQuote: "A Sintonia concede dano extra.",
                    kind: "mechanical",
                    status: "UNSUPPORTED",
                    evidence: [
                      { quote: "Sintonia limita formas conhecidas.", chunkId: "K12-0042" },
                    ],
                  },
                ],
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
      }),
    ];
    const result = await runQuestion();
    expect(result.answerSupport).toMatchObject({ status: "UNSUPPORTED" });
    expect(result.reply).toMatch(/não foi possível confirmar/i);
    expect(result.reply).not.toContain("Fontes verificadas pelo servidor:");
  });

  it("keeps useful primary text when independent verification fails and marks it unverified", async () => {
    responses = [
      response(200, {
        id: "chatcmpl-qa-unverified-text",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "A Sintonia limita as formas conhecidas." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 9, total_tokens: 29 },
      }),
      response(503, { error: { code: "upstream_error" } }),
    ];
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await runQuestion();
    expect(result.reply).toContain("A Sintonia limita as formas conhecidas.");
    expect(result.reply).toContain("verificação independente não foi concluída");
    expect(result.answerSupport).toMatchObject({ status: "UNVERIFIED", claims: [] });
    expect(requestBodies.map((body) => body.model)).toEqual([
      "deepseek/deepseek-v4-flash-0731",
      "openai/gpt-oss-20b",
    ]);
    expect(warning).toHaveBeenCalledWith(
      "[character-creation] book answer support evaluation failed",
      expect.objectContaining({ stage: "support_evaluation", providerHttpStatus: 503 }),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("A Sintonia limita");
  });

  it("stages a central question as an unconfirmed narrative proposal without calling the model", async () => {
    const { interpretNarrativeCreationTurn } = await import("./conversational-creation-ai");
    const start = startConversationalCreation("Jogador QA", "Quero criar uma personagem.");
    const result = await interpretNarrativeCreationTurn({
      requestId: "request-qa-central-question",
      snapshot: start.snapshot,
      history: [],
      authenticatedUserId: "qa-user-test",
      userMessage:
        "Minha pergunta central é se devo preservar a memória do meu pai ou construir uma vida sem ela.",
    });
    expect(requestBodies).toHaveLength(0);
    expect(result.intent).toBe("proposal");
    expect(result.pending).toEqual([expect.objectContaining({ path: "pergunta" })]);
    expect(
      (result.snapshot.serverCreationProgress as { confirmedPaths: string[] }).confirmedPaths,
    ).not.toContain("pergunta");
  });

  it("rejects a response that does not match the structured schema", async () => {
    const invalidResponse = () =>
      response(200, {
        id: "chatcmpl-qa-invalid",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify({ intent: "unknown" }) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 16, completion_tokens: 2, total_tokens: 18 },
      });
    responses = [invalidResponse(), invalidResponse()];

    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(runTurn()).rejects.toThrow();
    expect(requestBodies.map((body) => body.model)).toEqual([
      "deepseek/deepseek-v4-flash-0731",
      "deepseek/deepseek-v4-flash-0731",
    ]);
    expect(warning).toHaveBeenCalledWith(
      "[character-creation] structured output generation failed",
      expect.objectContaining({
        stage: "primary_generation",
        sdkErrorClass: "NoObjectGeneratedError",
        jsonParse: true,
        zodValidation: false,
        invalidPaths: expect.arrayContaining(["intent"]),
      }),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain('"intent":"unknown"');
  });

  it("retries one non-JSON 200 response with the primary model and accepts a valid retry", async () => {
    responses = [
      response(200, {
        id: "chatcmpl-qa-malformed",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "A resposta não é JSON válido." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 16, completion_tokens: 8, total_tokens: 24 },
      }),
      response(200, {
        id: "chatcmpl-qa-retry-valid",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(modelReply) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 16, completion_tokens: 18, total_tokens: 34 },
      }),
    ];

    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await runTurn();

    expect(requestBodies.map((body) => body.model)).toEqual([
      "deepseek/deepseek-v4-flash-0731",
      "deepseek/deepseek-v4-flash-0731",
    ]);
    expect(result.reply).toBe(modelReply.reply);
    expect(result.providerUnavailable).toBe(false);
    expect(warning).toHaveBeenCalledWith(
      "[character-creation] retrying invalid primary structured output",
      expect.objectContaining({
        stage: "primary_generation",
        sdkErrorClass: "NoObjectGeneratedError",
        finishReason: "stop",
        jsonParse: false,
      }),
    );
  });

  it("does not retry an output interrupted by the provider token limit", async () => {
    responses = [
      response(200, {
        id: "chatcmpl-qa-length",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "{" },
            finish_reason: "length",
          },
        ],
        usage: { prompt_tokens: 16, completion_tokens: 4800, total_tokens: 4816 },
      }),
      response(200, {
        id: "chatcmpl-qa-should-not-be-used",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(modelReply) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 16, completion_tokens: 18, total_tokens: 34 },
      }),
    ];

    await expect(runTurn()).rejects.toThrow();
    expect(requestBodies.map((body) => body.model)).toEqual(["deepseek/deepseek-v4-flash-0731"]);
  });

  it.each([
    [401, { error: { type: "authentication_error", code: "invalid_api_key" } }],
    [402, { error: { code: "insufficient_credits" } }],
    [403, { error: { code: "forbidden" } }],
    [429, { error: { code: "rate_limit" } }],
    [400, { error: { code: "invalid_parameter" } }],
  ])("does not fall back after non-retryable provider response %i", async (status, payload) => {
    responses = [response(status, payload)];

    await expect(runTurn()).rejects.toThrow();
    expect(requestBodies.map((body) => body.model)).toEqual(["deepseek/deepseek-v4-flash-0731"]);
  });

  it("keeps the unvalidated secondary disabled even after a primary upstream failure", async () => {
    responses = [response(503, { error: { code: "upstream_error" } })];

    await expect(runTurn()).rejects.toThrow();
    expect(requestBodies.map((body) => body.model)).toEqual(["deepseek/deepseek-v4-flash-0731"]);
  });
});
