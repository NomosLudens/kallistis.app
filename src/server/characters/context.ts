import type { CharacterRecord } from "./contracts";
import {
  ATTRIBUTE_NAMES,
  SKILL_NAMES,
  activeMarco,
  activeTrail,
  characterAttribute,
  tecelaoMagicDeficit,
  tecelaoMagicTotals,
  universalMagicCap,
  universalMagicGradeMax,
} from "./character-canon";
import { projectKallistisCharacter } from "./presentation";
import { isNexoRuleset } from "@/server/nexo/engine";
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strings = (v: unknown) => arr(v).map(text).filter(Boolean).join(" · ") || "—";
const jsonText = (v: unknown) => (v && typeof v === "object" ? JSON.stringify(v) : text(v) || "—");
export function buildCharacterContext(record: CharacterRecord): string {
  const c = record.snapshot;
  if (isNexoRuleset(record.ruleset)) {
    const history = obj(c.historia) ?? {};
    const capacities = obj(c.capacidades) ?? {};
    const state = obj(c.estado) ?? {};
    const influence = obj(c.influencia) ?? {};
    return [
      "## PERSONAGEM KALLISTIS NEXO — ESTADO PERSISTIDO",
      "> Fonte autoritativa: personagem salvo no PostgreSQL. Regras NEXO v1. Não importe atributos, perícias, reservas ou efeitos mecânicos da edição legada.",
      "> Você pode conversar sobre a narrativa; nunca adjudique rolagens, progressão ou efeitos. As operações mecânicas são calculadas e validadas pelo servidor.",
      `**Nome:** ${record.name || "—"}`,
      `**Status / versão:** ${record.status} / ${record.version}`,
      `**Conceito:** ${text(c.conceito) || "—"}`,
      `**Identidade:** ${text(c.povo)} · ${text(c.origem)} · ${text(c.oficio)} — ${text(c.especializacao)} · Marco ${String(c.marco ?? "—")}`,
      `**Influência:** Luz ${String(influence.luz ?? "—")} · Escuridão ${String(influence.escuridao ?? "—")}`,
      `**História:** promessa ${text(history.promessa) || text(c.promessa) || "—"}; vínculo ${text(history.vinculo) || text(c.vinculo) || "—"}; experiência ${text(history.experiencia) || text(c.experiencia) || "—"}; ferida ${text(history.feridaMarcante) || text(c.feridaMarcante) || "—"}`,
      `**Capacidades aprendidas:** dons ${strings(capacities.dons)}; técnicas ${strings(capacities.tecnicas)}; formas ${strings(capacities.formas)}; evocações ${strings(capacities.evocoes)}; chaves ${strings(capacities.chaves)}; equipamentos ${strings(capacities.equipamentos)}`,
      `**Estado:** Marcas de Sombra ${String(state.marcasSombra ?? 0)} de 6; ferimentos ${strings(state.ferimentos)}; condições ${strings(state.condicoes)}`,
    ].join("\n");
  }
  const trail = activeTrail(c),
    concept = obj(c.conceito),
    marco = activeMarco(c),
    knownForms = arr(trail?.knownForms).filter((value) => obj(value)?.formId),
    provenance = obj(c.periciasProveniencia) ?? {},
    magicRule =
      trail?.oficio === "Tecelão"
        ? `Tecelão M${marco}: ${tecelaoMagicTotals(marco)} Formas conhecidas; pendências = ${tecelaoMagicDeficit(c)}`
        : `Magia universal: máximo de ${universalMagicCap(c)} conhecida(s) pela Sintonia; até Grau ${universalMagicGradeMax(marco)} no Marco ${marco}; aquisição explícita, sem concessão automática.`;
  const presentation = projectKallistisCharacter(c);
  const companion = (value: unknown) => {
    const item = obj(value);
    return item
      ? [text(item.nome), text(item.descricao), text(item.notas)].filter(Boolean).join(" — ") || "—"
      : "—";
  };
  const currentAttributes = ATTRIBUTE_NAMES.map(
    (attribute) => `${attribute} ${characterAttribute(c, attribute)}`,
  ).join(" · ");
  const currentSkills = SKILL_NAMES.map((skill) => {
    const base = Number(obj(c.periciasBase)?.[skill] ?? 0);
    const bonus = Number(obj(provenance[skill])?.bonus ?? 0);
    const sources = arr(obj(provenance[skill])?.fontes).map(text).filter(Boolean);
    return `${skill} ${base + bonus} (base ${base}${bonus ? ` +${bonus} · ${sources.join(", ") || "bônus persistido"}` : ""})`;
  }).join(" · ");
  const equipment = obj(c.equipamento);
  const evocations = arr(trail?.vinculosEvocados)
    .map((value) => {
      const item = obj(value);
      return item
        ? [
            text(item.nome),
            text(item.modelo),
            text(item.forma),
            text(item.porte),
            text(item.aparencia),
            text(item.ancora),
            text(item.impulso),
            text(item.pacto),
            text(item.consciencia),
          ]
            .filter(Boolean)
            .join(" · ")
        : "";
    })
    .filter(Boolean);
  const magicChoices = knownForms.map((value) => {
    const form = obj(value)!;
    return `${text(form.formId)} até Grau ${String(form.maxGrade ?? "—")}`;
  });
  return [
    "## PERSONAGEM KALLISTIS — ESTADO PERSISTIDO",
    "> Fonte: PostgreSQL do runtime KALLISTIS. Este estado prevalece sobre inferências conversacionais e sobre estados UNKNOWN do roteador quando houver registro persistido.",
    "> Use este personagem para responder perguntas do jogador sobre sua ficha; não diga que ele não está disponível.",
    "",
    `**Nome:** ${record.name || "—"}`,
    `**Jogador:** ${record.playerName || "—"}`,
    `**Status:** ${record.status}`,
    `**Versão:** ${record.version}`,
    `**Povo / Herança:** ${text(c.povo) || "—"} · ${text(c.heranca) || "—"}`,
    `**Origem:** ${text(c.origem) || "—"}`,
    `**Conceito:** ${concept ? [text(concept.identidade), text(concept.objetivo), text(concept.perda)].filter(Boolean).join(" · ") : "—"}`,
    `**Descrição / Aparência:** ${[text(c.descricao), text(c.aparencia)].filter(Boolean).join(" · ") || "—"}`,
    `**Trilha ativa:** ${trail ? `${text(trail.oficio) || "—"} · Marco ${marco} · ${text(trail.papel) || "—"} · Chave ${text(trail.chave) || "—"}` : "—"}`,
    `**Atributos efetivos:** ${currentAttributes}`,
    `**Perícias efetivas e bônus:** ${currentSkills}`,
    `**Técnicas:** ${strings(trail?.tecnicas)}`,
    `**Especializações:** ${strings(trail?.especializacoes)}`,
    `**Chave / nome da chave:** ${text(trail?.chave) || "—"} · ${text(trail?.chaveNome) || "—"}`,
    `**Equipamento:** arma ${text(equipment?.arma) || "—"} · armadura ${text(equipment?.armadura) || "—"} · ferramenta ${text(equipment?.ferramenta) || "—"} · consumíveis ${strings(equipment?.consumiveis)} · extras ${strings(equipment?.extras)}`,
    `**Formas conhecidas:** ${magicChoices.join(" · ") || "nenhuma registrada"}`,
    `**Regra de progressão mágica:** ${magicRule}`,
    `**Vínculos evocados:** ${evocations.join(" | ") || "nenhum registrado"}`,
    "**Movimento:** 6 pontos na grade ou 2 zonas; sem conversão obrigatória entre escalas.",
    `**Montaria narrativa:** ${companion(c.montaria)} · sem estatísticas, ações, bônus ou movimento extra.`,
    `**Pet narrativo:** ${companion(c.pet)} · sem ficha, combate, progressão ou automação; pode buscar objeto acessível sem risco ou consequência tática relevante.`,
    `**Vínculos:** ${strings(c.vinculos)}`,
    `**Promessa:** ${text(c.promessa) || "—"}`,
    `**Ferida:** ${text(c.ferida) || "—"}`,
    `**Pergunta:** ${text(c.pergunta) || "—"}`,
    `**Biografia:** ${text(c.biografia).slice(0, 2500) || "—"}`,
    `**Recursos e condições persistidos:** reservas ${jsonText(c.reservas)} · condições ${jsonText(c.condicoes)}`,
    "",
    "## MANIFESTAÇÃO E CAPACIDADES DA PERSONAGEM",
    "> As descrições abaixo são manifestações pessoais narrativas da personagem. Não substituem nem alteram a regra canônica; antes do Marco 10 não produzem efeito mecânico.",
    `**Manifestação Pessoal:** ${presentation.manifestacao_pessoal || "—"}`,
    `**Fulgor:** ${presentation.fulgor_current}/${presentation.fulgor_max} · marcador narrativo explícito, sem ganho automático.`,
    ...presentation.capabilities.flatMap((item) => [
      `**Capacidade ${item.type} · ${item.name} · ID ${item.id}**`,
      `Regra canônica: ${item.canonical_definition.summary}`,
      `Manifestação pessoal: ${item.character_manifestation_description || "—"}`,
    ]),
  ].join("\n");
}
