import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { kallistisCrystal, kallistisWordmark } from "../lib/brand-assets";
import forgeCatalog from "@/server/characters/character-forge-choice-catalog.generated.json";
import cormorantRegularUrl from "@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-normal.woff2?url";
import cormorantItalicUrl from "@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-italic.woff2?url";
import cormorantSemiBoldUrl from "@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2?url";
import cormorantBoldUrl from "@fontsource/cormorant-garamond/files/cormorant-garamond-latin-700-normal.woff2?url";
import interRegularUrl from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import interBoldUrl from "@fontsource/inter/files/inter-latin-700-normal.woff2?url";

type SheetCapability = {
  id: string;
  type: "ability" | "technique" | "magic";
  name: string;
  canonical_definition: { summary: string };
  character_manifestation_description: string;
};

type Character = Record<string, unknown> & {
  id: string;
  name?: string;
  status?: string;
  version?: number;
  snapshot: Record<string, unknown>;
  kallistis?: { capabilities: SheetCapability[] };
  mesas?: Array<{ id: string; name: string }>;
};
type ActionArgument = {
  slot: number;
  argument_text: string;
  status: "pending" | "accepted" | "rejected";
};
type ActionRecord = {
  id: string;
  character_id: string;
  character_name: string;
  actor_user_id: string;
  action_description: string;
  status: "pending" | "ready" | "resolved";
  resistance: number;
  arguments: ActionArgument[];
  light_die?: number;
  shadow_die?: number;
  total?: number;
  margin?: number;
  grade?: string;
  resonance?: boolean;
  bonus?: number;
  consequence_text?: string | null;
};
type ProgressionEvent = {
  id: string;
  type: "nexo_narrative_progression" | "nexo_marco_advanced" | "nexo_specialization_selected";
  actorName: string;
  createdAt: string;
  payload: Record<string, unknown>;
};
type ArgumentCandidate = { id: string; source: string; text: string };
type NarrativeInventory = {
  candidates: ArgumentCandidate[];
  resources: ArgumentCandidate[];
  conflicts: ArgumentCandidate[];
  descriptors: ArgumentCandidate[];
};

type StandaloneHtmlMode = "filled" | "blank";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
function entries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function fieldEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value.trim() ? [value] : [];
}
function canonicalText(value: unknown): string {
  return text(value)
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function capabilityDescription(capability: SheetCapability): string {
  const escapedName = capability.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return canonicalText(capability.canonical_definition.summary)
    .replace(
      new RegExp(
        `^(?:(?:Traço|Dom|Dissonância|Técnica inicial|Técnica|Herança|Heranças)\\s*[—:-]\\s*)?${escapedName}(?:\\s*[—:.-]+\\s*)?`,
        "iu",
      ),
      "",
    )
    .trimStart()
    .replace(new RegExp(`^${escapedName}\\s*[—:.-]+\\s*`, "iu"), "");
}
function itemName(value: unknown): string {
  const item = object(value);
  return text(item.nome ?? item.name ?? item.titulo ?? item.label ?? item.pessoa ?? item.person ?? item.forma ?? item.chave ?? item.equipamento ?? item.formId) || text(value);
}
function describedValues(values: unknown, canonical: SheetCapability[]): unknown[] {
  return entries(values).map((value) => {
    const name = itemName(value);
    const capability = canonical.find((item) => item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"));
    if (!capability) return value;
    return {
      nome: capability.name,
      descricao: capabilityDescription(capability),
    };
  });
}
function normalizedFact(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}
function factLabel(value: string) {
  return value.trim().replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase("pt-BR"));
}
function splitSemicolonFacts(value: string) {
  return value.split(/\s*;\s*/u).map((part) => part.trim()).filter(Boolean);
}
function originFacts(value: string) {
  return value
    .replace(/\s+e\s+(?=(?:foi|nasceu|cresceu|aprendeu|passou|viveu|conheceu)\b)/giu, "; ")
    .split(/[;.!?]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}
function resourceParts(value: string) {
  const commaParts = value.split(/\s*[,;]\s*/u).map((part) => part.trim()).filter(Boolean);
  return commaParts.flatMap((part, index) => {
    if (index !== commaParts.length - 1) return [part];
    const finalList = part.match(/^(.*?)\s+e\s+([^,;]+)$/iu);
    return finalList ? [finalList[1]!.trim(), finalList[2]!.trim()] : [part];
  });
}
function conceptFacts(value: string) {
  const clauses = splitSemicolonFacts(value).flatMap((part) =>
    part.split(/,\s*(?=(?:mas|porém|contudo)\b)/iu).map((clause) => clause.trim()),
  );
  return clauses
    .filter(Boolean)
    .map((clause) => clause.replace(/^(?:mas|porém|contudo)\s+/iu, ""))
    .filter((clause) => !/\b(?:nascid[oa]|criad[oa])\b/iu.test(clause));
}
function narrativeInventory(
  snapshot: Record<string, unknown>,
  events: ProgressionEvent[],
): NarrativeInventory {
  const candidates: ArgumentCandidate[] = [];
  const conflicts: ArgumentCandidate[] = [];
  const descriptors: ArgumentCandidate[] = [];
  const candidateSeen = new Set<string>();
  const add = (source: string, value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) add(source, item);
      return;
    }
    const description = factLabel(describe(value));
    if (!description) return;
    const key = normalizedFact(description);
    if (candidateSeen.has(key)) return;
    candidateSeen.add(key);
    candidates.push({ id: `${source}:${key}`, source, text: description });
  };
  const addFacts = (source: string, facts: string[]) => facts.forEach((fact) => add(source, fact));
  const narrative = object(snapshot.historia);
  const narrativeLabels: Record<string, string> = {
    promessa: "Promessa",
    vinculo: "Vínculo",
    experiencia: "Experiência",
    relacoes: "Relações",
    perguntaPessoal: "Pergunta pessoal",
    manifestacaoPessoal: "Manifestação pessoal",
    feridaMarcante: "Ferida marcante",
  };
  for (const [key, value] of Object.entries(narrative)) {
    const label = narrativeLabels[key] || historyLabel(key);
    if (key === "experiencia" || key === "relacoes") {
      addFacts(label, splitSemicolonFacts(text(value)));
    } else {
      add(label, value);
    }
  }
  add("História", snapshot.historiaCompleta);
  addFacts("Origem", originFacts(text(snapshot.origem)));
  add("Manifestação pessoal", snapshot.manifestacao_pessoal);
  for (const [source, value] of [
    ["Conhecimentos registrados", snapshot.conhecimentos],
    ["Acontecimentos importantes", snapshot.acontecimentos],
    ["Consequências persistentes", snapshot.consequencias],
    ["Aprendizagens registradas", snapshot.aprendizados],
  ] as Array<[string, unknown]>) add(source, value);

  const concept = text(snapshot.conceito);
  for (const clause of conceptFacts(concept)) {
    if (/\b(?:teme|receia|desconfia|conflita|mas)\b/iu.test(clause)) {
      const key = normalizedFact(clause);
      conflicts.push({ id: `Conflito:${key}`, source: "Conflito narrativo", text: factLabel(clause.replace(/^(?:mas|porém|contudo)\s+/iu, "")) });
    } else if (/\b(?:quer|deseja|promete|busca|pretende)\b/iu.test(clause)) {
      add("Intenção", clause);
    }
  }

  const rawCapabilities = object(snapshot.capacidades);
  const resourceRows = new Map<string, { sources: Set<string>; name: string; details: string[] }>();
  const addResource = (source: string, raw: unknown) => {
    const values = Array.isArray(raw) ? raw : fieldEntries(raw);
    for (const value of values) {
      const description = describe(value);
      if (!description) continue;
      for (const part of resourceParts(description)) {
        const detailStart = part.search(/\s+(?:usad[oa]s?|portad[oa]s?|feito[oa]s?|para)\b/iu);
        const name = factLabel((detailStart > 0 ? part.slice(0, detailStart) : part).replace(/[.]$/u, "").trim());
        const detail = detailStart > 0 ? part.slice(detailStart).replace(/[.]$/u, "").trim() : "";
        const key = normalizedFact(name);
        if (!key) continue;
        const row = resourceRows.get(key) ?? { sources: new Set<string>(), name, details: [] };
        row.sources.add(source);
        if (detail && !row.details.some((item) => normalizedFact(item) === normalizedFact(detail))) row.details.push(detail);
        resourceRows.set(key, row);
      }
    }
  };
  addResource("Chave", rawCapabilities.chaves);
  addResource("Equipamento", rawCapabilities.equipamentos);

  const resourceItems = [...resourceRows.entries()].map(([key, item]) => ({
    id: `Recurso:${key}`,
    source: [...item.sources].join(" · "),
    text: [item.name, ...item.details].join(" — "),
  }));

  const fields = object(snapshot.fields);
  const descriptorsList: Array<[string, unknown]> = [
    ["Povo", snapshot.povo],
    ["Origem estruturada", snapshot.origemEstruturada ?? snapshot.structuredOrigin ?? (fields.origemTrocada === true || fields.origemTrocado === true ? "Trocada" : undefined)],
    ["Ofício / Trilha", snapshot.oficio],
    ["Papel", snapshot.papel],
    ["Especialização", snapshot.especializacao],
    ["Marco", snapshot.marco],
  ];
  for (const [source, value] of descriptorsList) {
    const description = describe(value);
    if (description) descriptors.push({ id: `${source}:${normalizedFact(description)}`, source, text: description });
  }
  if (text(fields.modoTrocado)) {
    descriptors.push({ id: "Adaptação de origem", source: "Adaptação", text: text(fields.modoTrocado) });
  }

  for (const event of events) {
    if (event.type !== "nexo_narrative_progression") continue;
    const category = text(event.payload.category);
    const label = category === "conhecimento" ? "Conhecimento aprendido" : historyLabel(category);
    add(label, event.payload.description);
  }
  return { candidates, resources: resourceItems, conflicts, descriptors };
}

const CANONICAL_MILESTONES: Record<number, string> = {
  2: "Aprender uma Técnica ou magia e registrar a aquisição efetivamente realizada.",
  3: "Escolher uma Especialização do Ofício ativo; sua Permissão e Assinatura passam a integrar a ficha.",
  4: "Aprender e registrar uma nova Técnica ou prática; perícias numéricas legadas não operam.",
  5: "Aumento de Atributo legado não opera. O Marco fortalece argumentos apenas pela fórmula NEXO.",
  6: "Aprender uma Técnica avançada ou acessar Evocação Maior quando seus requisitos próprios forem atendidos.",
  7: "Aumento de Atributo legado não opera. O Marco fortalece argumentos apenas pela fórmula NEXO.",
  8: "Aprender uma prática/Técnica; um Vínculo adicional só pode ser registrado se foi efetivamente desenvolvido.",
  9: "Escolher uma segunda Especialização do Ofício ativo ou aprender uma Técnica de outro Ofício conforme as regras de Trilhas.",
  10: "Legado. O manuscrito não define aquisição numérica automática neste Marco.",
  11: "Horizonte Cena. Magia Épica I/G4 pode ser considerada apenas se progressão, aprendizagem, permissão do Ofício e contrato da campanha permitirem; não-Tecelões seguem limitados a G3.",
  12: "Horizonte Bairro; não concede Grau épico novo nem aquisição automática.",
  13: "Horizonte Cidade. Magia Épica II/G5 pode ser considerada apenas com aprendizagem, permissão do Ofício e contrato da campanha; não-Tecelões seguem limitados a G3.",
  14: "Horizonte Povo; não concede Grau épico novo nem aquisição automática.",
  15: "Horizonte Mundo. Magia Épica III/G6 pode ser considerada apenas com aprendizagem, permissão do Ofício e contrato da campanha; M15 é o limite jogável.",
};
function describe(value: unknown): string {
  const item = object(value);
  if (!Object.keys(item).length) return text(value);
  const name = text(
    item.nome ??
      item.name ??
      item.titulo ??
      item.label ??
      item.pessoa ??
      item.person ??
      item.forma ??
      item.chave ??
      item.equipamento ??
      item.formId,
  );
  const description = text(
    item.descricao ??
      item.description ??
      item.texto ??
      item.text ??
      item.conteudo ??
      item.contexto ??
      item.relacao ??
      item.relationship ??
      item.valor ??
      item.fato ??
      item.notas ??
      item.efeito ??
      item.effect ??
      item.condition,
  );
  return [name, description].filter(Boolean).join(" — ");
}
function List({ values, empty = "Nenhum registrado." }: { values: unknown; empty?: string }) {
  const items = entries(values).map(describe).filter(Boolean);
  return items.length ? (
    <ul className="nexo-sheet__list">
      {items.map((item, i) => (
        <li key={`${item}-${i}`}>{item}</li>
      ))}
    </ul>
  ) : (
    <p className="nexo-sheet__muted">{empty}</p>
  );
}

export function NexoNarrativeSheet({ character }: { character: Character }) {
  const [printBlank, setPrintBlank] = useState(false);
  const [pendingHtmlExport, setPendingHtmlExport] = useState<StandaloneHtmlMode | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const [progressionEvents, setProgressionEvents] = useState<ProgressionEvent[]>([]);
  const [argumentCoverage, setArgumentCoverage] = useState<{
    eligible: number;
    rendered: number;
    missing: string[];
    duplicates: number;
  } | null>(null);
  const source = character.snapshot ?? {};
  const fields = object(source.fields);
  const snapshot = Object.keys(fields).length
    ? {
        ...source,
        nome: fields.name ?? source.nome,
        conceito: fields.concept ?? source.conceito,
        povo: fields.povo ?? source.povo,
        origem: fields.origem ?? source.origem,
        oficio: fields.oficio ?? source.oficio,
        papel: fields.papel ?? source.papel,
        especializacao: fields.especializacao ?? source.especializacao,
        marco: fields.marco ?? source.marco,
        historia: {
          promessa: fields.promessa,
          vinculo: fields.vinculo,
          experiencia: fields.experiencia,
          feridaMarcante: fields.feridaMarcante,
          relacoes: fields.relacoes,
          perguntaPessoal: fields.perguntaPessoal,
          manifestacaoPessoal: fields.manifestacaoPessoal,
        },
        influencia: { luz: fields.luz, escuridao: fields.escuridao },
        capacidades: {
          tecnicas: entries(source.learnedCapabilities).length
            ? entries(source.learnedCapabilities)
            : fieldEntries(fields.tecnicas),
          dons: fieldEntries(fields.capacidades ?? fields.conhecimentos),
          heranca: fieldEntries(fields.herancaPovo),
          formas: entries(fields.formas),
          evocoes: entries(fields.evocoes),
          chaves: fieldEntries(fields.chave),
          equipamentos: fieldEntries(fields.equipamento),
        },
      }
    : source;
  const narrative = object(snapshot.historia);
  const rawCapabilities = object(snapshot.capacidades);
  const canonicalCapabilities = Array.isArray(character.kallistis?.capabilities)
    ? character.kallistis.capabilities
    : [];
  const heritageName = text(snapshot.heranca) || text(fields.herancaPovo);
  const peopleCapabilities = canonicalCapabilities
    .filter((item) => item.type === "ability" && item.name !== heritageName)
    .map((item) => ({ nome: item.name, descricao: capabilityDescription(item) }));
  const capabilities: Record<string, unknown> = {
    ...rawCapabilities,
    tecnicas: describedValues(rawCapabilities.tecnicas, canonicalCapabilities),
    heranca: describedValues(rawCapabilities.heranca, canonicalCapabilities),
    dons: describedValues(
      [...fieldEntries(rawCapabilities.dons), ...peopleCapabilities],
      canonicalCapabilities,
    ),
  };
  const sourceTrails = entries(source.trilhas);
  const activeTrailIndex = Number.isInteger(source.trilhaAtiva) ? Number(source.trilhaAtiva) : 0;
  const activeTrail = object(sourceTrails[activeTrailIndex]);
  const activeOffice = sourceTrails.length
    ? text(activeTrail.oficio)
    : text(fields.oficio) || text(snapshot.oficio);
  const proposedRole = sourceTrails.length
    ? text(activeTrail.papel)
    : text(fields.papel) || text(snapshot.papel);
  const validRoles = forgeCatalog.offices.find((office) => office.name === activeOffice)?.roles ?? [];
  const activeRole = validRoles.includes(proposedRole) ? proposedRole : "";
  const structuredOrigin = fields.origemTrocada === true || fields.origemTrocado === true
    ? "Trocada"
    : text(fields.structuredOrigin ?? fields.origemEstruturada);
  const state = object(snapshot.estado);
  const influence = object(snapshot.influencia);
  const wound = text(narrative.feridaMarcante ?? snapshot.feridaMarcante);
  const shortHistory = [
    ["Promessa", narrative.promessa ?? snapshot.promessa],
    ["Vínculo", narrative.vinculo ?? snapshot.vinculo],
    ["Experiência", narrative.experiencia ?? snapshot.experiencia],
    ["Ferida Marcante", wound],
  ]
    .map(([label, value]) => [label, text(value)] as const)
    .filter(([, value]) => value);
  const historyText = [
    text(snapshot.conceito),
    ...shortHistory.map(([label, value]) => `${label}: ${value}`),
  ]
    .filter(Boolean)
    .join(". ");
  const narrativeParts = (
    [
      ["Promessa", narrative.promessa ?? snapshot.promessa],
      ["Vínculo", narrative.vinculo ?? snapshot.vinculo],
      ["Experiência", narrative.experiencia ?? snapshot.experiencia],
      ["História", snapshot.historiaCompleta],
      ["Relações", narrative.relacoes ?? snapshot.relacoes],
      ["Pergunta pessoal", narrative.perguntaPessoal ?? snapshot.perguntaPessoal],
      ["Manifestação pessoal", narrative.manifestacaoPessoal ?? snapshot.manifestacaoPessoal],
    ] satisfies Array<[string, unknown]>
  ).filter(([, value]) => text(value) || (Array.isArray(value) && value.length > 0));
  const inventory = narrativeInventory(snapshot, progressionEvents);
  const { candidates } = inventory;
  const candidateIds = candidates.map((candidate) => candidate.id).join("\u001f");
  useEffect(() => {
    const expectedIds = candidates.map((candidate) => candidate.id);
    const renderedIds = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".nexo-editorial__arguments li[data-argument-id]",
      ),
    ).map((item) => item.dataset.argumentId || "");
    const renderedSet = new Set(renderedIds);
    setArgumentCoverage({
      eligible: expectedIds.length,
      rendered: renderedSet.size,
      missing: expectedIds.filter((id) => !renderedSet.has(id)),
      duplicates: renderedIds.length - renderedSet.size,
    });
  }, [character.id, character.version, candidateIds]);
  useEffect(() => {
    if (!pendingHtmlExport) return;
    let cancelled = false;
    void buildNexoStandaloneHtml(pendingHtmlExport).then((html) => {
      if (cancelled) return;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const characterName = document.querySelector(".nexo-editorial__title h1")?.textContent?.trim() || "Personagem";
      const safeCharacterName = characterName.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").replace(/[^A-Za-z0-9]+/gu, "_").replace(/^_|_$/gu, "");
      anchor.download = pendingHtmlExport === "blank"
        ? "KALLISTIS_NEXO_Ficha_Em_Branco.html"
        : `${safeCharacterName || "Personagem"}.html`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }).catch((error) => {
      console.error("Falha ao exportar ficha HTML autônoma", error);
      window.alert("Não foi possível preparar o HTML autônomo. Recarregue a ficha e tente novamente.");
    }).finally(() => {
      if (!cancelled) setPendingHtmlExport(null);
    });
    return () => { cancelled = true; };
  }, [pendingHtmlExport]);
  const specialCapabilities = canonicalCapabilities;
  const additionalKnowledges = entries(capabilities.dons).filter((value) =>
    !specialCapabilities.some((item) => item.name.toLocaleLowerCase("pt-BR") === itemName(value).toLocaleLowerCase("pt-BR")),
  );
  const mesa = character.mesas?.[0];

  const exportHtml = (mode: StandaloneHtmlMode) => {
    setPrintBlank(mode === "blank");
    setPendingHtmlExport(mode);
  };

  function print(blank: boolean) {
    setPrintBlank(blank);
    document.body.classList.add("nexo-print-context");
    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => document.body.classList.remove("nexo-print-context"), 500);
    }, 0);
  }

  return (
    <div className="nexo-sheet-route">
      <nav className="nexo-sheet__toolbar no-print">
        <Link to="/nexo">← NEXO</Link>
        <span>Ficha narrativa · dados persistidos</span>
        <div>
          <button
            type="button"
            onClick={() => setActionOpen((open) => !open)}
            aria-expanded={actionOpen}
          >
            {actionOpen ? "Fechar ação" : "Agir"}
          </button>
          <button type="button" onClick={() => print(false)}>
            Imprimir ficha
          </button>
          <button type="button" onClick={() => print(true)}>
            Imprimir ficha em branco
          </button>
          <button type="button" onClick={() => exportHtml("filled")} disabled={pendingHtmlExport !== null}>
            {pendingHtmlExport === "filled" ? "Preparando HTML…" : "Baixar ficha HTML"}
          </button>
          <button type="button" onClick={() => exportHtml("blank")} disabled={pendingHtmlExport !== null}>
            {pendingHtmlExport === "blank" ? "Preparando HTML…" : "Baixar ficha em branco HTML"}
          </button>
        </div>
      </nav>
      <main className="nexo-sheet">
        <div className="nexo-sheet__screen">
          <article
            className="nexo-editorial"
            aria-label={`Ficha narrativa de ${text(snapshot.nome ?? character.name)}`}
          >
            <header className="nexo-editorial__hero">
              <div className="nexo-editorial__brand">
                <img
                  className="nexo-editorial__crystal"
                  src={kallistisCrystal.url}
                  alt="Cristal partido de KALLÍSTIS"
                />
                <img
                  className="nexo-editorial__wordmark"
                  src={kallistisWordmark.url}
                  alt="KALLÍSTIS"
                />
                <span>· NEXO</span>
                <small>
                  RPG DE
                  <br />
                  MUNDOS FRATURADOS
                </small>
              </div>
              <div className="nexo-editorial__title">
                <h1>{text(snapshot.nome ?? character.name) || "Personagem"}</h1>
                <p className="nexo-editorial__craft">
                  <strong>{text(snapshot.povo) || "—"}</strong>
                  {structuredOrigin ? ` · Origem: ${structuredOrigin}` : ""}
                  {` · Trilha ativa: ${activeOffice || "não definida"}`}
                  {text(snapshot.especializacao) ? ` · ${text(snapshot.especializacao)}` : ""}
                  {` · Papel ativo: ${activeRole || "não definido"}`}
                </p>
                <p className="nexo-editorial__concept">
                  {text(snapshot.conceito) || "Conceito ainda não registrado."}
                </p>
              </div>
            </header>
            <div className="nexo-editorial__body">
              <aside className="nexo-editorial__rail" aria-label="Indicadores do personagem">
                <EditorialMetric label="Marco" value={text(snapshot.marco) || "—"} />
                <EditorialMetric label="Luz" value={text(influence.luz) || "—"} />
                <EditorialMetric label="Escuridão" value={text(influence.escuridao) || "—"} />
                <div className="nexo-editorial__rail-stat">
                  <h2>Sombras</h2>
                  <strong>{text(state.marcasSombra) || "0"}/6</strong>
                  <span className="nexo-editorial__marks" aria-hidden="true">
                    {Array.from({ length: 6 }, (_, i) => (
                      <i
                        key={i}
                        className={i < (Number(state.marcasSombra) || 0) ? "is-filled" : ""}
                      />
                    ))}
                  </span>
                </div>
                <div className="nexo-editorial__rail-stat">
                  <h2>Ferimentos</h2>
                  <List values={state.ferimentos} empty="Nenhum registrado." />
                </div>
              </aside>
              <div className="nexo-editorial__main">
                <section className="nexo-editorial__story">
                  {narrativeParts.map(([label, value]) => (
                    <EditorialText key={label} label={label} value={value} />
                  ))}
                  {narrativeParts.length === 0 ? (
                    <p className="nexo-editorial__empty">
                      A história deste personagem ainda não foi registrada.
                    </p>
                  ) : null}
                </section>
                <section
                  className="nexo-editorial__arguments"
                  aria-label="Meus argumentos persistentes"
                  data-eligible-argument-count={candidates.length}
                  data-rendered-argument-count={argumentCoverage?.rendered ?? 0}
                  data-argument-coverage-ok={
                    argumentCoverage &&
                    argumentCoverage.missing.length === 0 &&
                    argumentCoverage.duplicates === 0 &&
                    argumentCoverage.rendered === argumentCoverage.eligible
                      ? "true"
                      : "false"
                  }
                >
                  <header>
                    <h2>Meus argumentos</h2>
                    <p>
                      {candidates.length} fatos narrativos individualizados. São candidatos, não
                      bônus: apresente apenas fatos verdadeiros e causalmente pertinentes; o Mestre
                      avalia distinção e aceita até dois por resolução. Capacidades, recursos,
                      conflitos e dados descritivos aparecem em grupos próprios.
                    </p>
                    {argumentCoverage ? (
                      <p
                        role={
                          argumentCoverage.missing.length || argumentCoverage.duplicates
                            ? "alert"
                            : "status"
                        }
                        data-testid="argument-coverage"
                      >
                        {argumentCoverage.missing.length || argumentCoverage.duplicates
                          ? `Cobertura incompleta: ${argumentCoverage.rendered}/${argumentCoverage.eligible}; ${argumentCoverage.missing.length} ausente(s), ${argumentCoverage.duplicates} duplicata(s).`
                          : `Cobertura verificada: ${argumentCoverage.rendered}/${argumentCoverage.eligible} fundamentos exibidos.`}
                      </p>
                    ) : null}
                  </header>
                  {candidates.length ? (
                    <ul>
                      {candidates.map((candidate) => (
                        <li key={candidate.id} data-argument-id={candidate.id}>
                          <span>{candidate.source}</span>
                          <p>{candidate.text}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="nexo-editorial__empty">
                      Nenhum fundamento persistente foi encontrado nos dados projetados.
                    </p>
                  )}
                  {inventory.conflicts.length ? (
                    <div className="nexo-editorial__inventory-group nexo-editorial__inventory-group--conflict">
                      <h3>Limitações e conflitos narrativos</h3>
                      <ul>{inventory.conflicts.map((item) => <li key={item.id}><span>{item.source}</span><p>{item.text}</p></li>)}</ul>
                    </div>
                  ) : null}
                  {inventory.descriptors.length ? (
                    <div className="nexo-editorial__inventory-group nexo-editorial__inventory-group--descriptive">
                      <h3>Dados descritivos — não são argumentos por si</h3>
                      <ul>{inventory.descriptors.map((item) => <li key={item.id}><span>{item.source}</span><p>{item.text}</p></li>)}</ul>
                    </div>
                  ) : null}
                  <div className="nexo-editorial__circumstantial">
                    <strong>Argumentos circunstanciais</strong>
                    <p>Registre à mão a posição, o ambiente, a ajuda ou a oportunidade específica da cena.</p>
                    <i /><i />
                  </div>
                </section>
                <div className="nexo-editorial__resources">
                  <EditorialResource label="Técnica" values={capabilities.tecnicas} />
                  <EditorialResource label="Herança" values={capabilities.heranca} />
                  <InventoryResourceList items={inventory.resources} />
                  <EditorialResource label="Condições" values={state.condicoes} />
                  <section className="nexo-editorial__resource nexo-editorial__notes">
                    <h2>Notas de viagem</h2>
                    <div className="nexo-editorial__note-lines" aria-hidden="true" />
                  </section>
                </div>
                <section className="nexo-editorial__capabilities" aria-label="Capacidades e permissões especiais">
                  <h2>Capacidades e permissões especiais</h2>
                  <p>Os efeitos abaixo têm regras próprias. Só podem fundamentar um argumento quando sua condição causal ocorrer; nunca concedem bônus automáticos.</p>
                  <div className="nexo-editorial__more-grid">
                    <EditorialResource
                      label="Especialização"
                      values={snapshot.especializacao ? [snapshot.especializacao] : []}
                    />
                    {additionalKnowledges.length ? <EditorialResource
                      label="Capacidades e conhecimentos"
                      values={additionalKnowledges}
                    /> : null}
                    <EditorialResource label="Formas aprendidas" values={capabilities.formas} />
                    <EditorialResource label="Evocações" values={capabilities.evocoes} />
                    {specialCapabilities.map((item) => (
                      <section className="nexo-editorial__resource" key={`${item.type}:${item.id}`}>
                        <h2>{item.name}</h2>
                        <span className="nexo-editorial__classification">{capabilityClassification(item)}</span>
                        <p>{capabilityDescription(item) || "Descrição canônica indisponível nesta projeção."}</p>
                      </section>
                    ))}
                  </div>
                </section>
                <NexoProgressionSummary snapshot={snapshot} events={progressionEvents} />
                <NexoResolutionReference />
                <p className="nexo-editorial__version">
                  {text(character.status)} · versão {text(character.version)}
                </p>
              </div>
            </div>
          </article>
          <div hidden={!actionOpen} aria-hidden={!actionOpen}>
            <NexoActionBoard
              character={character}
              mesaId={mesa?.id ?? ""}
              onProgressionEvents={setProgressionEvents}
            />
          </div>
        </div>
        <Printable
          character={character}
          snapshot={snapshot}
          blank={printBlank}
          capabilities={capabilities}
          state={state}
          influence={influence}
          activeOffice={activeOffice}
          activeRole={activeRole}
          candidates={candidates}
          inventory={inventory}
          narrativeParts={narrativeParts}
          specialCapabilities={specialCapabilities}
          progressionEvents={progressionEvents}
          structuredOrigin={structuredOrigin}
        />
      </main>
    </div>
  );
}

function EditorialMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="nexo-editorial__rail-stat">
      <h2>{label}</h2>
      <strong>{value}</strong>
    </div>
  );
}

function NexoProgressionSummary({
  snapshot,
  events,
}: {
  snapshot: Record<string, unknown>;
  events: ProgressionEvent[];
}) {
  const marco = Number(snapshot.marco);
  const next = Number.isInteger(marco) ? marco + 1 : 0;
  const option = CANONICAL_MILESTONES[next];
  return (
    <section className="nexo-editorial__progression" aria-label="Progressão da personagem">
      <h2>Trajetória e progressão</h2>
      <div>
        <p><strong>Narrativa:</strong> registre o acontecimento, a mudança e a consequência persistente. Esse registro não altera valores.</p>
        <p><strong>Mecânica:</strong> o Mestre confirma o Marco após escolha ou consequência que mude a trajetória. Capacidades exigem aprendizagem e registro próprios; o Marco não as concede automaticamente.</p>
      </div>
      <p className="nexo-editorial__milestone">
        <strong>Estado:</strong> Marco {Number.isInteger(marco) ? marco : "não registrado"}.{" "}
        {option ? <><strong>Referência canônica para M{next}:</strong> {option}</> : marco >= 10 && marco < 15 ? "O manuscrito consultado não especifica opções de aquisição para M11–M15; não inferir uma escolha automática." : marco >= 15 ? "M15 é o limite jogável; M16 permanece narrativo e não recebe testes." : "Sem referência de aquisição posterior registrada no manuscrito consultado."}
      </p>
      <div className="nexo-editorial__progression-events">
        <strong>Acontecimentos persistentes</strong>
        {events.length ? (
          <ol>
            {events.map((event) => {
              const narrativeEvent = event.type === "nexo_narrative_progression";
              return (
                <li key={event.id}>
                  <span>{narrativeEvent ? historyLabel(text(event.payload.category)) : `Marco ${text(event.payload.fromMarco)} → ${text(event.payload.toMarco)}`}</span>
                  <p>{text(event.payload.description ?? event.payload.rationale)}</p>
                  <small>{event.actorName} · {new Date(event.createdAt).toLocaleDateString("pt-BR")}</small>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="nexo-editorial__empty">Nenhum evento de progressão foi disponibilizado para esta Mesa.</p>
        )}
      </div>
    </section>
  );
}

function EditorialText({ label, value }: { label: string; value: unknown }) {
  return (
    <section className="nexo-editorial__text">
      <h2>{label}</h2>
      <p>{describe(value) || "—"}</p>
    </section>
  );
}

function EditorialResource({ label, values }: { label: string; values: unknown }) {
  return (
    <section className="nexo-editorial__resource">
      <h2>{label}</h2>
      <List values={values} empty="—" />
    </section>
  );
}

function InventoryResourceList({ items }: { items: ArgumentCandidate[] }) {
  return (
    <section className="nexo-editorial__resource nexo-editorial__resource--inventory">
      <h2>Recursos materiais</h2>
      {items.length ? (
        <ul className="nexo-sheet__list">
          {items.map((item) => <li key={item.id}><strong>{item.text.split(" — ")[0]}</strong><span>{item.source}</span>{item.text.includes(" — ") ? ` — ${item.text.slice(item.text.indexOf(" — ") + 3)}` : ""}</li>)}
        </ul>
      ) : <p className="nexo-sheet__muted">Nenhum registrado.</p>}
    </section>
  );
}

function capabilityClassification(capability: SheetCapability) {
  const summary = canonicalText(capability.canonical_definition.summary);
  if (capability.name === "Caminho Sem Compromisso" || /\bdissonância\b/iu.test(summary))
    return "Limitação / Dissonância";
  if (capability.name === "Dado da Fortuna")
    return "Permissão especial — não é argumento nem bônus fixo";
  const allowsArgument = /\bargument\w*\b/iu.test(summary) &&
    !/\b(?:não|nao|nunca|sem)\b[^.]{0,90}\bargument\w*\b/iu.test(summary);
  if (allowsArgument)
    return "Capacidade com regra própria — pode fundamentar argumento quando causalmente pertinente";
  return capability.type === "technique" ? "Técnica aprendida" : capability.type === "magic" ? "Magia aprendida" : "Capacidade com regra própria";
}

async function assetAsDataUrl(rawUrl: string, baseUrl = document.baseURI): Promise<string> {
  if (/^(?:data:|blob:|#)/iu.test(rawUrl)) return rawUrl;
  const url = new URL(rawUrl, baseUrl);
  if (url.origin !== window.location.origin) return "";
  const response = await fetch(url.href, { credentials: "omit", cache: "force-cache" });
  if (!response.ok) return "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${response.headers.get("content-type") || "application/octet-stream"};base64,${btoa(binary)}`;
}

function collectNexoStyles(usedClasses: Set<string>) {
  const normal: string[] = [];
  const printOnly: string[] = [];
  const printScreen: string[] = [];
  const visited = new Set<CSSStyleSheet>();
  const relevantSelector = (selector: string) =>
    selector.split(",").some((part) => {
      const trimmed = part.trim();
      const classNames = [...trimmed.matchAll(/\.([\w-]+)/gu)].map((match) => match[1]!);
      return trimmed === "*" || trimmed === ":root" ||
        (!trimmed.includes("#") && classNames.length > 0 && classNames.every((name) => usedClasses.has(name)));
    });

  const visit = (rules: CSSRuleList, target: string[], baseTarget: string[]) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet && !visited.has(rule.styleSheet)) {
          visited.add(rule.styleSheet);
          visit(rule.styleSheet.cssRules, target, baseTarget);
        }
        continue;
      }
      if (rule instanceof CSSMediaRule) {
        const nested: string[] = [];
        const nestedPrint: string[] = [];
        visit(rule.cssRules, nested, nestedPrint);
        if (!nested.length) continue;
        if (/\bprint\b/iu.test(rule.conditionText)) {
          target.push(`@media ${rule.conditionText}{${nested.join("\n")}}`);
          baseTarget.push(...nested);
          printOnly.push(...nested);
        } else {
          target.push(`@media ${rule.conditionText}{${nested.join("\n")}}`);
        }
        continue;
      }
      if (rule instanceof CSSStyleRule) {
        if (relevantSelector(rule.selectorText)) target.push(rule.cssText);
        continue;
      }
      if (rule instanceof CSSFontFaceRule) {
        const family = rule.style.getPropertyValue("font-family");
        const range = rule.style.getPropertyValue("unicode-range");
        if (/Cormorant Garamond|Inter/iu.test(family) && (!range || /U\+0000-00FF/iu.test(range))) {
          const firstSource = rule.style.getPropertyValue("src").split(/,\s*(?=url\()/iu)[0]?.trim();
          target.push(firstSource
            ? rule.cssText.replace(/src:\s*[^;]+;/iu, `src: ${firstSource};`)
            : rule.cssText);
        }
        continue;
      }
      if (rule instanceof CSSPageRule) {
        target.push(rule.cssText);
        continue;
      }
      if ("cssRules" in rule) {
        const grouping = rule as CSSGroupingRule;
        const nested: string[] = [];
        const nestedPrint: string[] = [];
        visit(grouping.cssRules, nested, nestedPrint);
        if (nested.length) {
          const header = rule.cssText.slice(0, rule.cssText.indexOf("{"));
          target.push(`${header}{${nested.join("\n")}}`);
        }
      }
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    if (visited.has(sheet)) continue;
    visited.add(sheet);
    try {
      visit(sheet.cssRules, normal, printScreen);
    } catch {
      // A stylesheet inaccessible to this page is omitted; exported CSS stays self-contained.
    }
  }
  return {
    normal: normal.join("\n"),
    printScreen: printScreen.join("\n").replaceAll("body.nexo-print-context", "body.nexo-standalone-blank"),
    printOnly: printOnly.join("\n"),
  };
}

async function inlineCssAssets(css: string): Promise<string> {
  const urls = [...css.matchAll(/url\((?:['"])?([^)'"\s]+)(?:['"])?\)/giu)]
    .map((match) => match[1]!)
    .filter((url) => !/^(?:data:|blob:|#)/iu.test(url));
  const assets = new Map<string, string>();
  await Promise.all([...new Set(urls)].map(async (url) => {
    try { assets.set(url, await assetAsDataUrl(url)); }
    catch { assets.set(url, ""); }
  }));
  return css.replace(/url\((?:['"])?([^)'"\s]+)(?:['"])?\)/giu, (_all, raw: string) => {
    if (/^(?:data:|blob:|#)/iu.test(raw)) return `url("${raw}")`;
    const embedded = assets.get(raw);
    return embedded ? `url("${embedded}")` : "none";
  });
}

async function standaloneFontStyles() {
  const fonts: Array<{ family: string; weight: number; style?: string; url: string }> = [
    { family: "Cormorant Garamond", weight: 400, url: cormorantRegularUrl },
    { family: "Cormorant Garamond", weight: 400, style: "italic", url: cormorantItalicUrl },
    { family: "Cormorant Garamond", weight: 600, url: cormorantSemiBoldUrl },
    { family: "Cormorant Garamond", weight: 700, url: cormorantBoldUrl },
    { family: "Inter", weight: 400, url: interRegularUrl },
    { family: "Inter", weight: 700, url: interBoldUrl },
  ];
  const faces = await Promise.all(fonts.map(async (font) => {
    const embedded = await assetAsDataUrl(font.url);
    if (!embedded) throw new Error(`Fonte local indisponível: ${font.family} ${font.weight}`);
    return `@font-face{font-family:"${font.family}";src:url("${embedded}") format("woff2");font-weight:${font.weight};font-style:${font.style || "normal"};font-display:swap}`;
  }));
  return faces.join("\n");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

async function standaloneMarkup(source: Element, embeddedBrandAssets: Map<string, string>): Promise<string> {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, iframe, object, embed, form, button, input, textarea, select").forEach((node) => node.remove());
  clone.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/iu.test(attribute.name) || attribute.name === "data-testid" || attribute.name === "data-argument-id") {
        element.removeAttribute(attribute.name);
      }
      if ((attribute.name === "href" || attribute.name === "src") && /^https?:/iu.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  const originalImages = Array.from(source.querySelectorAll<HTMLImageElement>("img[src]"));
  const clonedImages = Array.from(clone.querySelectorAll<HTMLImageElement>("img[src]"));
  await Promise.all(clonedImages.map(async (image, index) => {
    const original = originalImages[index];
    const src = image.getAttribute("src") || "";
    const brandKey = /kallistis-canon-crystal\.png/iu.test(src)
      ? "crystal"
      : /kallistis-canon-wordmark\.png/iu.test(src)
        ? "wordmark"
        : "";
    if (brandKey) {
      const embedded = embeddedBrandAssets.get(brandKey) || await assetAsDataUrl(src);
      if (!embedded) { image.removeAttribute("src"); return; }
      embeddedBrandAssets.set(brandKey, embedded);
      const replacement = document.createElement("span");
      replacement.className = `${image.className} nexo-standalone-brand-image nexo-standalone-brand-image--${brandKey}`.trim();
      replacement.setAttribute("role", "img");
      replacement.setAttribute("aria-label", image.alt || (brandKey === "crystal" ? "Cristal KALLÍSTIS" : "KALLÍSTIS"));
      const isPrint = Boolean(original?.closest(".nexo-print"));
      const parentClass = original?.parentElement?.className || "";
      if (isPrint && brandKey === "crystal") replacement.style.cssText = "display:block;width:25mm;height:34mm;background-size:contain;background-position:center;background-repeat:no-repeat;background-image:var(--nexo-crystal)";
      else if (isPrint) replacement.style.cssText = "display:inline-block;width:38mm;height:9mm;max-height:9mm;background-size:contain;background-position:left center;background-repeat:no-repeat;background-image:var(--nexo-wordmark)";
      else {
        const computed = original ? window.getComputedStyle(original) : null;
        replacement.style.cssText = `display:inline-block;width:${computed?.width || "auto"};height:${computed?.height || "auto"};max-width:${computed?.maxWidth || "100%"};max-height:${computed?.maxHeight || "none"};background-size:contain;background-position:${computed?.objectPosition || "center"};background-repeat:no-repeat;background-image:var(--nexo-${brandKey})`;
      }
      if (parentClass.includes("nexo-print__back-heading")) replacement.style.backgroundPosition = "left center";
      image.replaceWith(replacement);
      return;
    }
    const embedded = await assetAsDataUrl(src);
    if (embedded) image.src = embedded;
    else image.removeAttribute("src");
  }));
  return clone.outerHTML;
}

async function buildNexoStandaloneHtml(mode: StandaloneHtmlMode): Promise<string> {
  const printable = document.querySelector<HTMLElement>(".nexo-print");
  if (!printable) throw new Error("A versão imprimível da ficha não está disponível.");
  const editorial = mode === "filled" ? document.querySelector<HTMLElement>(".nexo-editorial") : null;
  if (mode === "filled" && !editorial) throw new Error("A apresentação digital da personagem não está disponível.");
  const usedClasses = new Set<string>(["nexo-print-context", mode === "blank" ? "nexo-standalone-blank" : "nexo-standalone-filled"]);
  for (const root of [printable, editorial].filter((item): item is HTMLElement => Boolean(item))) {
    [root, ...Array.from(root.querySelectorAll<HTMLElement>("[class]"))].forEach((element) => {
      element.classList.forEach((className) => usedClasses.add(className));
    });
  }
  const styles = collectNexoStyles(usedClasses);
  const embeddedBrandAssets = new Map<string, string>();
  const printMarkup = await standaloneMarkup(printable, embeddedBrandAssets);
  let content = printMarkup;
  let bodyClass = "nexo-print-context nexo-standalone-blank";
  let title = "KALLISTIS NEXO — Ficha em branco";
  let screenStyles = styles.printScreen;
  if (mode === "filled") {
    if (!editorial) throw new Error("A apresentação digital da personagem não está disponível.");
    const editorialMarkup = await standaloneMarkup(editorial, embeddedBrandAssets);
    content = `<div class="nexo-sheet__screen">${editorialMarkup}</div>${printMarkup}`;
    bodyClass = "nexo-print-context nexo-standalone-filled";
    title = `${editorial.querySelector("h1")?.textContent?.trim() || "Personagem"} — KALLISTIS NEXO`;
    screenStyles = "";
  }
  const css = await inlineCssAssets(`${styles.normal}\n${screenStyles}`);
  const fontStyles = await standaloneFontStyles();
  const brandVariables = [...embeddedBrandAssets.entries()].map(([key, value]) => `--nexo-${key === "crystal" ? "crystal" : "wordmark"}:url("${value}")`).join(";");
  const standaloneScreen = `
    *{box-sizing:border-box}html{color-scheme:light;background:#e9e3d8}body{margin:0;color:#282521;background:#e9e3d8}
    :root{${brandVariables}}
    .nexo-standalone-brand-image{flex:none}
    .nexo-print__brand .nexo-standalone-brand-image--wordmark,.nexo-print__back-heading .nexo-standalone-brand-image--wordmark{width:38mm;height:9mm;max-height:9mm}
    .nexo-editorial__crystal{background-size:contain;background-position:center;background-repeat:no-repeat}
    .nexo-editorial__wordmark{background-size:contain;background-position:left center;background-repeat:no-repeat}
    @media print{body.nexo-standalone-filled .nexo-sheet__screen{display:none!important}}
    @media print{
      html,body{width:100%!important;max-width:100%!important}
      body.nexo-print-context main,body.nexo-print-context .nexo-sheet,body.nexo-print-context .nexo-print,body.nexo-print-context .nexo-print__page{width:100%!important;max-width:100%!important}
    }
    @media screen{
    body.nexo-standalone-filled .nexo-sheet__screen{display:block}
    body.nexo-standalone-filled .nexo-editorial{max-width:1100px;margin:2rem auto;padding:clamp(1rem,4vw,3rem);background:#f3ecdf;box-shadow:0 8px 32px #28252126}
    body.nexo-standalone-filled .nexo-editorial__hero{display:grid;grid-template-columns:minmax(160px,25%) minmax(0,1fr);gap:2rem;align-items:center}
    body.nexo-standalone-filled .nexo-editorial__body{display:grid;grid-template-columns:minmax(150px,22%) minmax(0,1fr);gap:2rem}
    body.nexo-standalone-filled .nexo-editorial__title h1{font:600 clamp(2.7rem,7vw,6rem)/.9 "Cormorant Garamond",Georgia,serif}
    body.nexo-standalone-filled .nexo-editorial__crystal{width:100%;max-height:230px;object-fit:contain}
    body.nexo-standalone-filled .nexo-editorial__wordmark{max-width:240px;max-height:56px;object-fit:contain}
    body.nexo-standalone-filled .nexo-editorial__story,body.nexo-standalone-filled .nexo-editorial__arguments,body.nexo-standalone-filled .nexo-editorial__capabilities,body.nexo-standalone-filled .nexo-editorial__progression,body.nexo-standalone-filled .nexo-editorial__reference{margin:1.5rem 0}
    body.nexo-standalone-filled .nexo-editorial__arguments>ul,body.nexo-standalone-filled .nexo-editorial__inventory-group ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem;list-style:none;padding:0}
    body.nexo-standalone-filled .nexo-editorial__text,body.nexo-standalone-filled .nexo-editorial__resource,body.nexo-standalone-filled .nexo-editorial__arguments li{break-inside:avoid}
    body.nexo-standalone-filled .nexo-print{display:none}
    body.nexo-standalone-blank .nexo-print{display:block!important;width:min(210mm,calc(100vw - 2rem));max-width:210mm;margin:1.5rem auto;background:#f3ecdf;box-shadow:0 8px 32px #28252126}
    body.nexo-standalone-blank .nexo-print__page{width:100%;min-height:297mm;margin:0 0 1rem;box-shadow:none}
    }
    @media screen and (max-width:760px){body.nexo-standalone-blank .nexo-print{width:100%;margin:0;box-shadow:none}body.nexo-standalone-blank .nexo-print__page{min-height:0;padding:1rem}body.nexo-standalone-filled .nexo-editorial__hero,body.nexo-standalone-filled .nexo-editorial__body{grid-template-columns:1fr;gap:1rem}body.nexo-standalone-filled .nexo-editorial__rail{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem}body.nexo-standalone-filled .nexo-editorial__arguments>ul,body.nexo-standalone-filled .nexo-editorial__inventory-group ul{grid-template-columns:1fr}}
    @page{size:A4 portrait;margin:0}
  `;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>${fontStyles}\n${css}\n${standaloneScreen}</style></head><body class="${bodyClass}"><main class="nexo-sheet">${content}</main></body></html>`;
}

function NexoResolutionReference({ print = false }: { print?: boolean }) {
  return (
    <section className={print ? "nexo-print__reference" : "nexo-editorial__reference"}>
      <h2>Referência de resolução NEXO</h2>
      <ol className="nexo-resolution-steps">
        <li>Declare intenção e abordagem.</li>
        <li>O Mestre anuncia Resistência e risco antes dos dados.</li>
        <li>Apresente fatos distintos e pertinentes; o Mestre reconhece até dois.</li>
        <li>Role 1d10 de Luz e 1d10 de Escuridão.</li>
        <li>Some os dados naturais e o NEXO; subtraia a Resistência.</li>
        <li>Leia Margem, Predominância e eventual Ressonância; descreva a consequência.</li>
      </ol>
      <p><strong>Fórmula:</strong> B(M)=2+⌊(M−1)/3⌋; NEXO=A×B(M); Total=d10L+d10E+NEXO; Margem=Total−Resistência. A=0–2 argumentos aceitos pelo Mestre.</p>
      <p><strong>Peso:</strong> M1–3 +2 por argumento; M4–6 +3; M7–9 +4; M10–12 +5; M13–15 +6. M16: somente narrativa, sem testes. Resistências de referência: 10, 12, 15, 18, 21, 24, 27, 30; anuncie antes dos dados.</p>
      <p><strong>Margem:</strong> ≤−5 falha severa; −4 a −1 falha; 0 a 4 sucesso; 5 a 9 sucesso forte; ≥10 sucesso extraordinário. A Margem qualifica o resultado, mas não substitui a consequência ficcional.</p>
      <p><strong>Predominância:</strong> Luz maior tende a consequência externa, material ou pública; Escuridão maior toca memória, relações, caminhos ocultos ou possibilidades futuras. Igualdade natural gera Ressonância, não sucesso automático nem alteração da Margem.</p>
      <ul className="nexo-resonance-reference">
        <li>1–1 Frágil — algo pequeno resiste.</li><li>2–2 Eco — retorna algo pertinente.</li>
        <li>3–3 Forma — ideia ou condição ganha contorno.</li><li>4–4 Passagem — surge brecha, rota ou comunicação.</li>
        <li>5–5 Espelho — revela correspondência sem impor vínculo.</li><li>6–6 Acorde — coordenação dentro das permissões normais.</li>
        <li>7–7 Fratura — vulnerabilidade pode aparecer; nada se rompe automaticamente.</li><li>8–8 Vínculo — relação reconhecida ou posta à prova, sem remoção automática de condição.</li>
        <li>9–9 Convergência — elementos alinham aberturas, sem duplicar ações.</li><li>10–10 Plena — mudança duradoura só dentro da ficção e permissões estabelecidas.</li>
      </ul>
    </section>
  );
}

function Printable({
  character,
  snapshot,
  blank,
  capabilities,
  state,
  influence,
  activeOffice,
  activeRole,
  structuredOrigin,
  candidates,
  inventory,
  narrativeParts,
  specialCapabilities,
  progressionEvents,
}: {
  character: Character;
  snapshot: Record<string, unknown>;
  blank: boolean;
  capabilities: Record<string, unknown>;
  state: Record<string, unknown>;
  influence: Record<string, unknown>;
  activeOffice: string;
  activeRole: string;
  structuredOrigin: string;
  candidates: ArgumentCandidate[];
  inventory: NarrativeInventory;
  narrativeParts: Array<[string, unknown]>;
  specialCapabilities: SheetCapability[];
  progressionEvents: ProgressionEvent[];
}) {
  const marco = Number(snapshot.marco);
  const nextMarco = Number.isInteger(marco) ? marco + 1 : 0;
  const nextOption = CANONICAL_MILESTONES[nextMarco];
  const woundCount = entries(state.ferimentos).length;
  const capabilityRows = new Map<string, { name: string; kind: string; description: string }>();
  for (const item of specialCapabilities) {
    capabilityRows.set(item.name.toLocaleLowerCase("pt-BR"), {
      name: item.name,
      kind: capabilityClassification(item),
      description: capabilityDescription(item),
    });
  }
  for (const [kind, values] of [
    ["Técnica", capabilities.tecnicas],
    ["Herança", capabilities.heranca],
    ["Capacidade", entries(capabilities.dons).filter((value) =>
      !specialCapabilities.some((item) => item.name.toLocaleLowerCase("pt-BR") === itemName(value).toLocaleLowerCase("pt-BR")),
    )],
    ["Forma", capabilities.formas],
    ["Evocação", capabilities.evocoes],
  ] as Array<[string, unknown]>) {
    for (const value of entries(values)) {
      const name = itemName(value);
      if (!name) continue;
      const key = name.toLocaleLowerCase("pt-BR");
      const item = object(value);
      if (!capabilityRows.has(key)) capabilityRows.set(key, {
        name,
        kind,
        description: text(item.descricao ?? item.description ?? item.efeito ?? item.effect ?? item.condition),
      });
    }
  }
  const materialResources = inventory.resources;
  const situation: Array<[string, unknown]> = [["Condições", state.condicoes]];
  const textLine = (label: string, value: string) => (
    <div className="nexo-print__write-row"><strong>{label}</strong><span>{blank ? "" : value}</span></div>
  );
  return (
    <article className={`nexo-print ${blank ? "nexo-print--blank" : ""}`}>
      <section className="nexo-print__page nexo-print__front">
        <header className="nexo-print__hero">
          <img className="nexo-print__crystal" src={kallistisCrystal.url} alt="" />
          <div className="nexo-print__hero-main">
            <div className="nexo-print__brand"><img src={kallistisWordmark.url} alt="KALLÍSTIS" /><span>· NEXO</span><small>RPG DE MUNDOS FRATURADOS</small></div>
            <h1>{blank ? "Minha ficha" : text(snapshot.nome ?? character.name)}</h1>
            <p className="nexo-print__concept">{blank ? "Conceito / identidade" : text(snapshot.conceito) || "—"}</p>
          </div>
        </header>
        <div className="nexo-print__identity">
          {textLine("Povo", text(snapshot.povo))}
          {textLine("Origem", blank ? "" : [structuredOrigin, text(snapshot.origem)].filter(Boolean).join(" · "))}
          {textLine("Ofício / Trilha / Papel", [activeOffice, activeRole, text(snapshot.especializacao)].filter(Boolean).join(" · "))}
          {textLine("Marco", text(snapshot.marco))}
        </div>
        <section className="nexo-print__story" aria-label="Identidade e narrativa">
          <h2>História e identidade</h2>
          {blank ? (
            <div className="nexo-print__blank-story">
              {["História", "Promessa", "Vínculo", "Experiência", "Relações", "Pergunta pessoal", "Manifestação pessoal"].map((label) => (
                <div key={label}><strong>{label}</strong><i /></div>
              ))}
            </div>
          ) : narrativeParts.length ? (
            <div className="nexo-print__story-grid">
              {narrativeParts.map(([label, value]) => (
                <section key={label}><strong>{label}</strong><p>{describe(value)}</p></section>
              ))}
            </div>
          ) : <p>História ainda não registrada.</p>}
        </section>
        <div className="nexo-print__front-layout">
          <aside className="nexo-print__rail">
            <section className="nexo-print__metric"><h2>Luz</h2><strong>{blank ? "—" : text(influence.luz) || "—"}</strong></section>
            <section className="nexo-print__metric"><h2>Escuridão</h2><strong>{blank ? "—" : text(influence.escuridao) || "—"}</strong></section>
            <section className="nexo-print__metric"><h2>Sombras</h2><strong>{blank ? "0" : text(state.marcasSombra) || "0"}/6</strong><span className="nexo-print__marks">{Array.from({ length: 6 }, (_, i) => <i key={i} className={!blank && i < (Number(state.marcasSombra) || 0) ? "is-filled" : ""} />)}</span></section>
            <section className="nexo-print__metric"><h2>Ferimentos</h2><span className="nexo-print__wound-marks">{Array.from({ length: Math.max(3, Math.min(6, woundCount)) }, (_, i) => <i key={i} className={!blank && i < woundCount ? "is-filled" : ""} />)}</span>{!blank && woundCount ? <p>{entries(state.ferimentos).map(describe).filter(Boolean).join(" · ")}</p> : null}</section>
          </aside>
          <main className="nexo-print__arguments">
            <header><h2>Meus argumentos</h2><p>Fundamentos são candidatos, não bônus automáticos. O Mestre avalia verdade, pertinência causal e distinção; até dois podem ser aceitos por resolução.</p></header>
            {blank ? (
              <div className="nexo-print__blank-candidates">{Array.from({ length: 16 }, (_, i) => <div key={i}><strong>Fato / fundamento {i + 1}</strong><i /><i /></div>)}</div>
            ) : candidates.length ? (
              <ul>{candidates.map((candidate) => <li key={candidate.id} data-argument-id={candidate.id}><span>{candidate.source}</span><p>{candidate.text}</p></li>)}</ul>
            ) : <p>Nenhum fundamento persistente registrado.</p>}
            {!blank && inventory.conflicts.length ? <section className="nexo-print__inventory-notes"><strong>Limitações e conflitos</strong>{inventory.conflicts.map((item) => <p key={item.id}>{item.text}</p>)}</section> : null}
            <section className="nexo-print__circumstantial"><strong>Argumentos circunstanciais</strong><span>Posição · ambiente · ajuda · oportunidade</span><i /><i /></section>
            <section className="nexo-print__notes"><strong>Notas de campanha</strong><i /><i /><i /></section>
          </main>
        </div>
        <small className="nexo-print__edition">{blank ? "KALLÍSTIS · NEXO" : `${text(character.status)} · versão ${text(character.version)}`}</small>
      </section>
      <section className="nexo-print__page nexo-print__back">
        <header className="nexo-print__back-heading"><img src={kallistisWordmark.url} alt="KALLÍSTIS" /><span>· NEXO</span><strong>O QUE POSSO FAZER E COMO EVOLUO</strong></header>
        <NexoResolutionReference print />
        <section className="nexo-print__ability-list">
          <h2>Capacidades e permissões</h2>
          <p>Permissões especiais não são argumentos adicionais nem bônus fixos. Use condições e limites descritos em cada regra.</p>
          {blank ? (
            <div className="nexo-print__blank-capabilities">{["Traço / Dom / Dissonância", "Técnicas aprendidas", "Heranças", "Formas aprendidas", "Evocações"].map((label) => <div key={label}><strong>{label}</strong><i /><i /></div>)}</div>
          ) : (
            <ul>{[...capabilityRows.values()].map((item) => <li key={`${item.kind}:${item.name}`}><strong>{item.name}</strong><span>{item.kind}</span><p>{item.description || "Descrição canônica não projetada; consultar a definição registrada."}</p></li>)}</ul>
          )}
        </section>
        <section className="nexo-print__resources">
          <h2>Recursos e situação</h2>
          <div className="nexo-print__inventory nexo-print__inventory--materials"><strong>Recursos materiais</strong>{blank ? <div className="nexo-print__blank-resources">{["Chave", "Equipamento", "Equipamento", "Equipamento", "Outro recurso"].map((label, index) => <div key={`${label}-${index}`}><span>{label}</span><i /></div>)}</div> : materialResources.length ? <ul>{materialResources.map((item) => <li key={item.id}><strong>{item.text.split(" — ")[0]}</strong><span>{item.source}</span>{item.text.includes(" — ") ? ` — ${item.text.slice(item.text.indexOf(" — ") + 3)}` : ""}</li>)}</ul> : <p>—</p>}</div>
          {situation.map(([label, values]) => <div className="nexo-print__inventory" key={label}><strong>{label}</strong>{blank ? <i /> : <p>{entries(values).map(describe).filter(Boolean).join(" · ") || "—"}</p>}</div>)}
        </section>
        <section className="nexo-print__progression">
          <h2>Progressão narrativa e mecânica</h2>
          <p>Narrativa: registre o acontecimento, o que mudou e a consequência que permaneceu. Não aumenta valores automaticamente.</p>
          <p>Mecânica: o Mestre confirma o Marco após mudança significativa; aprendizagem e registro de capacidade são separados.</p>
          <p><strong>Marco atual:</strong> {blank ? "_____" : Number.isInteger(marco) ? marco : "não registrado"}. {nextOption ? `Referência para M${nextMarco}: ${nextOption}` : marco >= 10 && marco < 15 ? "Opções de aquisição para M11–M15 não estão especificadas no manuscrito consultado." : marco >= 15 ? "M15 é o limite jogável; M16 permanece narrativo." : "Sem opção canônica registrada para o próximo Marco."}</p>
          {progressionEvents.length ? <ol>{progressionEvents.map((event) => <li key={event.id}><strong>{event.type === "nexo_narrative_progression" ? historyLabel(text(event.payload.category)) : `Marco ${text(event.payload.fromMarco)} → ${text(event.payload.toMarco)}`}</strong><span>{text(event.payload.description ?? event.payload.rationale)}</span></li>)}</ol> : <p>Sem acontecimentos de progressão disponibilizados para esta Mesa.</p>}
        </section>
        <small className="nexo-print__edition">{blank ? "KALLÍSTIS · NEXO" : `${text(character.status)} · versão ${text(character.version)}`}</small>
      </section>
    </article>
  );
}

export function NexoActionBoard({
  character,
  mesaId,
  onProgressionEvents,
}: {
  character: Character;
  mesaId: string;
  onProgressionEvents?: (events: ProgressionEvent[]) => void;
}) {
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [canAdjudicate, setCanAdjudicate] = useState(false);
  const [resistances, setResistances] = useState<
    Array<{ character_id: string; action_description: string; resistance: number }>
  >([]);
  const [sessions, setSessions] = useState<Array<{ id: string; status: string; title: string }>>(
    [],
  );
  const [description, setDescription] = useState("");
  const [argument1, setArgument1] = useState("");
  const [argument2, setArgument2] = useState("");
  const [linkToLiveSession, setLinkToLiveSession] = useState(false);
  const [resistance, setResistance] = useState(10);
  const [masterDescription, setMasterDescription] = useState("");
  const [masterResistance, setMasterResistance] = useState(10);
  const [acceptance, setAcceptance] = useState<
    Record<string, Record<number, "accepted" | "rejected">>
  >({});
  const [results, setResults] = useState<Record<string, Record<string, unknown>>>({});
  const [consequenceDrafts, setConsequenceDrafts] = useState<Record<string, string>>({});
  const [progressionEvents, setProgressionEvents] = useState<ProgressionEvent[]>([]);
  const [narrativeCategory, setNarrativeCategory] = useState("historia");
  const [narrativeDescription, setNarrativeDescription] = useState("");
  const [marcoRationale, setMarcoRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const activeSession = useMemo(
    () => sessions.find((session) => session.status === "live"),
    [sessions],
  );

  const reload = useCallback(async () => {
    if (!mesaId) return;
    const [actionResponse, coroResponse, sessionResponse, progressionResponse] = await Promise.all([
      fetch(`/api/nexo/actions?mesaId=${encodeURIComponent(mesaId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      }),
      fetch(`/api/nexo/coro?mesaId=${encodeURIComponent(mesaId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      }),
      fetch(`/api/nexo/sessions?mesaId=${encodeURIComponent(mesaId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      }),
      fetch(
        `/api/nexo/progression?mesaId=${encodeURIComponent(mesaId)}&characterId=${encodeURIComponent(character.id)}`,
        { credentials: "same-origin", cache: "no-store" },
      ),
    ]);
    const [actionData, coroData, sessionData, progressionData] = await Promise.all([
      actionResponse.json(),
      coroResponse.json(),
      sessionResponse.json(),
      progressionResponse.json(),
    ]);
    if (actionResponse.ok) {
      setActions(actionData.actions ?? []);
      setCanAdjudicate(actionData.canAdjudicate === true);
    }
    if (coroResponse.ok) setResistances(coroData.resistanceAssignments ?? []);
    if (sessionResponse.ok) setSessions(sessionData.sessions ?? []);
    if (progressionResponse.ok) {
      const events = progressionData.events ?? [];
      setProgressionEvents(events);
      onProgressionEvents?.(events);
    }
  }, [character.id, mesaId, onProgressionEvents]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const currentResistance = resistances.find(
    (item) => item.character_id === character.id && item.action_description === description.trim(),
  );
  async function setActionResistance(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/nexo/coro", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "set_resistance",
          mesaId,
          characterId: character.id,
          actionDescription: masterDescription,
          resistance: masterResistance,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao definir Resistência");
      setMasterDescription("");
      setNotice("Resistência registrada para esta ação.");
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao definir Resistência");
    } finally {
      setBusy(false);
    }
  }
  async function submitAction(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/nexo/actions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          mesaId,
          characterId: character.id,
          actionDescription: description,
          arguments: [argument1, argument2].filter((value) => value.trim()),
          sessionId: linkToLiveSession ? (activeSession?.id ?? null) : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao enviar argumentos");
      setDescription("");
      setArgument1("");
      setArgument2("");
      setLinkToLiveSession(false);
      setNotice("Ação registrada; cada argumento aguarda a avaliação do Mestre.");
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao enviar ação");
    } finally {
      setBusy(false);
    }
  }
  async function adjudicate(action: ActionRecord) {
    const acceptedSlots = Object.entries(acceptance[action.id] ?? {})
      .filter(([, decision]) => decision === "accepted")
      .map(([slot]) => Number(slot));
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/nexo/actions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "adjudicate",
          mesaId,
          submissionId: action.id,
          acceptedSlots,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha na avaliação dos argumentos");
      setNotice("Avaliação registrada. O jogador já pode realizar a rolagem.");
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha na avaliação");
    } finally {
      setBusy(false);
    }
  }
  async function roll(action: ActionRecord) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/nexo", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "roll",
          characterId: character.id,
          submissionId: action.id,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha na rolagem NEXO");
      setResults((current) => ({ ...current, [action.id]: data.roll }));
      setNotice("Rolagem NEXO persistida no servidor.");
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha na rolagem");
    } finally {
      setBusy(false);
    }
  }
  async function recordConsequence(action: ActionRecord) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/nexo/actions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "record_consequence",
          mesaId,
          submissionId: action.id,
          consequence: consequenceDrafts[action.id],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao registrar a consequência");
      setNotice("Consequência narrativa registrada.");
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao registrar a consequência");
    } finally {
      setBusy(false);
    }
  }
  async function recordNarrativeProgression(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/nexo/progression", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "record_narrative",
          mesaId,
          characterId: character.id,
          category: narrativeCategory,
          description: narrativeDescription,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao registrar a mudança narrativa");
      setNarrativeDescription("");
      setNotice("Mudança narrativa registrada sem alterar Marco ou capacidades.");
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao registrar a mudança narrativa");
    } finally {
      setBusy(false);
    }
  }
  async function advanceMarco(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/nexo/progression", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "advance_marco",
          mesaId,
          characterId: character.id,
          expectedVersion: character.version,
          rationale: marcoRationale,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao registrar o novo Marco");
      window.location.reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao registrar o novo Marco");
      setBusy(false);
    }
  }
  if (!mesaId)
    return (
      <section className="nexo-sheet__section">
        <h2>O que quero fazer?</h2>
        <p>Vincule este personagem a uma Mesa NEXO para registrar ações.</p>
        <Link to="/nexo">Abrir Central NEXO</Link>
      </section>
    );
  return (
    <section className="nexo-sheet__section nexo-action no-print">
      <div className="nexo-action__heading">
        <div>
          <p className="nexo-sheet__eyebrow">ARGUMENTAÇÃO MANUAL · SEM IA OBRIGATÓRIA</p>
          <h2>O que quero fazer?</h2>
        </div>
        <button type="button" onClick={() => void reload()}>
          Atualizar
        </button>
      </div>
      <p className="nexo-action__hint">
        Consulte sua história, técnicas, Chaves e equipamentos. Seus argumentos são propostas: o
        Mestre avaliará cada um antes da rolagem.
        {activeSession ? ` Sessão Viva: ${activeSession.title}.` : ""}
      </p>
      <p className="nexo-action__criteria">
        Argumento é uma circunstância verdadeira da ficção que explica causalmente por que esta ação
        pode ter maior possibilidade de êxito. O Mestre verifica se ela está estabelecida, é relevante
        para esta intenção e não repete o fundamento de outra. A fala é manual; nenhum argumento é
        aceito por IA ou por palavras-chave.
      </p>
      {canAdjudicate ? (
        <form
          className="nexo-action__master-form"
          onSubmit={(event) => void setActionResistance(event)}
        >
          <h3>Definir Resistência para esta ação</h3>
          <label>
            Ação exata
            <input
              required
              maxLength={1000}
              value={masterDescription}
              onChange={(event) => setMasterDescription(event.target.value)}
            />
          </label>
          <label>
            Resistência
            <input
              required
              type="number"
              min={0}
              max={100}
              value={masterResistance}
              onChange={(event) => setMasterResistance(Number(event.target.value))}
            />
          </label>
          <button disabled={busy}>Registrar Resistência</button>
        </form>
      ) : null}
      {!canAdjudicate ? (
        <form className="nexo-action__form" onSubmit={(event) => void submitAction(event)}>
          <label>
            Intenção
            <textarea
              required
              minLength={3}
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="O resultado que pretende alcançar"
            />
          </label>
          <p className="nexo-action__resistance">
            Resistência:{" "}
            {currentResistance
              ? currentResistance.resistance
              : "Aguardando o Mestre para esta ação"}
          </p>
          {activeSession ? (
            <label>
              <input
                type="checkbox"
                checked={linkToLiveSession}
                onChange={(event) => setLinkToLiveSession(event.target.checked)}
              />
              Vincular esta ação à Sessão Viva
            </label>
          ) : null}
          <div className="nexo-action__args">
            <label>
              Argumento 1
              <input
                maxLength={500}
                value={argument1}
                onChange={(event) => setArgument1(event.target.value)}
                placeholder="Uma razão ligada à sua história"
              />
            </label>
            <label>
              Argumento 2 · independente
              <input
                maxLength={500}
                value={argument2}
                onChange={(event) => setArgument2(event.target.value)}
                placeholder="Outra razão, se houver"
              />
            </label>
          </div>
          <p className="nexo-action__calc">
            NEXO = Marco {text(character.snapshot.marco)} + bônus pelos argumentos aceitos pelo
            Mestre.
          </p>
          <button disabled={busy || !currentResistance || !description.trim()}>
            Submeter intenção e argumentos
          </button>
        </form>
      ) : (
        <p className="nexo-action__hint">
          O jogador declara e rola a própria ação. Como Mestre, você define a Resistência e avalia
          os argumentos enviados.
        </p>
      )}
      <section className="nexo-action__progression">
        <h3>Progressão da personagem</h3>
        <div className="nexo-action__progression-copy">
          <p>
            <strong>Narrativa:</strong> registre uma mudança em história, vínculo, conhecimento ou
            consequência. Esse registro não altera valores.
          </p>
          <p>
            <strong>Mecânica:</strong> o Mestre confirma o avanço de Marco após uma escolha ou
            consequência que mude a trajetória. O avanço altera apenas o Marco e seu peso NEXO;
            capacidades exigem aprendizagem real e registro separado.
          </p>
        </div>
        {canAdjudicate ? (
          Number(character.snapshot.marco) < 15 ? (
            <form className="nexo-action__progression-form" onSubmit={(event) => void advanceMarco(event)}>
              <label>
                Justificativa da mudança significativa de trajetória
                <textarea
                  required
                  minLength={10}
                  maxLength={1500}
                  value={marcoRationale}
                  onChange={(event) => setMarcoRationale(event.target.value)}
                />
              </label>
              <button disabled={busy || marcoRationale.trim().length < 10}>
                Mestre: confirmar Marco {Number(character.snapshot.marco) + 1}
              </button>
            </form>
          ) : (
            <p className="nexo-action__hint">Marco 15 é o limite jogável; Marco 16 permanece narrativo.</p>
          )
        ) : (
          <form
            className="nexo-action__progression-form"
            onSubmit={(event) => void recordNarrativeProgression(event)}
          >
            <label>
              Tipo de mudança narrativa
              <select
                value={narrativeCategory}
                onChange={(event) => setNarrativeCategory(event.target.value)}
              >
                <option value="historia">História</option>
                <option value="vinculo">Vínculo</option>
                <option value="conhecimento">Conhecimento</option>
                <option value="consequencia">Consequência</option>
              </select>
            </label>
            <label>
              O que mudou na trajetória?
              <textarea
                required
                minLength={5}
                maxLength={1500}
                value={narrativeDescription}
                onChange={(event) => setNarrativeDescription(event.target.value)}
              />
            </label>
            <button disabled={busy || narrativeDescription.trim().length < 5}>
              Registrar mudança narrativa
            </button>
          </form>
        )}
        {progressionEvents.length ? (
          <ol className="nexo-action__progression-list">
            {progressionEvents.map((entry) => {
              const payload = object(entry.payload);
              const narrative = entry.type === "nexo_narrative_progression";
              const specialization = entry.type === "nexo_specialization_selected";
              return (
                <li key={entry.id}>
                  <strong>{narrative ? historyLabel(text(payload.category)) : specialization ? `Especialização registrada em M${text(payload.marco)}` : `Marco ${text(payload.fromMarco)} → ${text(payload.toMarco)}`}</strong>
                  <span>{text(payload.description ?? payload.rationale ?? payload.specialization)}</span>
                  <small>{entry.actorName} · {new Date(entry.createdAt).toLocaleDateString("pt-BR")}</small>
                </li>
              );
            })}
          </ol>
        ) : null}
      </section>
      {notice ? (
        <p role="status" className="nexo-action__notice">
          {notice}
        </p>
      ) : null}
      <div className="nexo-action__list">
        {actions
          .filter((action) => action.character_id === character.id)
          .map((action) => (
            <article key={action.id} className="nexo-action__card">
              <h3>{action.action_description}</h3>
              <p>
                Resistência {action.resistance} ·{" "}
                {action.status === "pending"
                  ? "aguarda avaliação"
                  : action.status === "ready"
                    ? "pronta para rolagem"
                    : "rolagem concluída"}
              </p>
              {action.arguments.map((argument) => (
                <div key={argument.slot} className="nexo-action__argument">
                  <p>
                    <strong>Argumento {argument.slot}:</strong> {argument.argument_text}
                  </p>
                  {argument.status !== "pending" ? (
                    <small>{argument.status === "accepted" ? "Aceito" : "Não aceito"}</small>
                  ) : null}
                  {canAdjudicate && action.status === "pending" ? (
                    <div>
                      <button
                        type="button"
                        aria-pressed={acceptance[action.id]?.[argument.slot] === "accepted"}
                        onClick={() =>
                          setAcceptance((current) => ({
                            ...current,
                            [action.id]: { ...current[action.id], [argument.slot]: "accepted" },
                          }))
                        }
                      >
                        Aceitar
                      </button>
                      <button
                        type="button"
                        aria-pressed={acceptance[action.id]?.[argument.slot] === "rejected"}
                        onClick={() =>
                          setAcceptance((current) => ({
                            ...current,
                            [action.id]: { ...current[action.id], [argument.slot]: "rejected" },
                          }))
                        }
                      >
                        Recusar
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
              {canAdjudicate && action.status === "pending" && action.arguments.length ? (
                <button
                  disabled={
                    busy ||
                    action.arguments.some((argument) => !acceptance[action.id]?.[argument.slot])
                  }
                  onClick={() => void adjudicate(action)}
                >
                  Registrar avaliação individual
                </button>
              ) : null}
              {!canAdjudicate && action.status === "ready" ? (
                <button disabled={busy} onClick={() => void roll(action)}>
                  Rolar NEXO
                </button>
              ) : null}
              {results[action.id] || action.status === "resolved" ? (
                <p className="nexo-action__result">
                  Luz {String(results[action.id]?.light ?? action.light_die)} · Escuridão{" "}
                  {String(results[action.id]?.shadow ?? action.shadow_die)} · Bônus NEXO{" "}
                  {String(results[action.id]?.bonus ?? action.bonus)} · Total{" "}
                  {String(results[action.id]?.total ?? action.total)} · Margem{" "}
                  {String(results[action.id]?.margin ?? action.margin)} ·{" "}
                  {grade(String(results[action.id]?.grade ?? action.grade))}
                  {(results[action.id]?.resonance ?? action.resonance) ? " · Ressonância" : ""}
                </p>
              ) : null}
              {action.consequence_text ? (
                <p className="nexo-action__consequence">
                  <strong>Consequência narrativa:</strong> {action.consequence_text}
                </p>
              ) : null}
              {canAdjudicate && action.status === "resolved" && !action.consequence_text ? (
                <div className="nexo-action__consequence-form">
                  <label>
                    Consequência narrativa da rolagem
                    <textarea
                      minLength={3}
                      maxLength={1500}
                      value={consequenceDrafts[action.id] ?? ""}
                      onChange={(event) =>
                        setConsequenceDrafts((current) => ({
                          ...current,
                          [action.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    disabled={busy || (consequenceDrafts[action.id] ?? "").trim().length < 3}
                    onClick={() => void recordConsequence(action)}
                  >
                    Registrar consequência
                  </button>
                </div>
              ) : null}
            </article>
          ))}
      </div>
    </section>
  );
}
function grade(value: string) {
  return (
    (
      {
        severe_failure: "Falha grave",
        failure: "Falha",
        success: "Sucesso",
        strong_success: "Sucesso forte",
        extraordinary: "Sucesso extraordinário",
      } as Record<string, string>
    )[value] ?? value
  );
}

function historyLabel(key: string) {
  return (
    (
      {
        promessa: "Promessa",
        vinculo: "Vínculo",
        experiencia: "Experiência",
        feridaMarcante: "Ferida Marcante",
        origem: "Origem",
      } as Record<string, string>
    )[key] ??
    key
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (value) => value.toLocaleUpperCase("pt-BR"))
  );
}
