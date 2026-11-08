import { MAGIC_FORMS } from "./magic-forms";
import type { CharacterSnapshot } from "./character-canon";
import { retrieveCanonicalBook } from "@/lib/canonical-rules.server";

export const PERSONAL_MANIFESTATION_MAX = 20_000;
export const ABILITY_MANIFESTATION_MAX = 10_000;

export type KallistisCapability = {
  id: string;
  type: "ability" | "technique" | "magic";
  name: string;
  canonical_definition: {
    id: string;
      source: "KALLISTIS_LIVRO_COMPLETO_NEXO_MOTOR_PROGRESSAO_2026-11-05";
    summary: string;
  };
  character_manifestation_description: string;
};

export type KallistisCharacterProjection = {
  manifestation: string;
  manifestacao_pessoal: string;
  fulgor: number;
  fulgor_current: number;
  fulgor_max: 5;
  capabilities: KallistisCapability[];
  capability_manifestation_descriptions: Record<string, string>;
  source: "kallistis";
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const slug = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "capacidade";

const PEOPLE_CAPABILITIES: Readonly<
  Record<string, { trait: string; domain: string; dissonance: string }>
> = {
  Aelvari: {
    trait: "Memória Estratificada",
    domain: "Eco Paralelo",
    dissonance: "Sobrecarga Temporal",
  },
  Kragor: {
    trait: "Força de Comunidade",
    domain: "Juramento Operante",
    dissonance: "Honra Fechada",
  },
  Draken: { trait: "Corpo Elemental", domain: "Manifestação Elemental", dissonance: "Hýbris" },
  Nomos: { trait: "Chassi Modular", domain: "Lei Interior", dissonance: "Otimização Absoluta" },
  Livres: {
    trait: "Aprendizagem Cruzada",
    domain: "Solução Improvisada",
    dissonance: "Identidade Oferecida",
  },
  Dóreos: {
    trait: "Memória da Matéria",
    domain: "Inscrição de Promessa",
    dissonance: "Permanência Rígida",
  },
  Teriantes: {
    trait: "Aspecto Faunístico",
    domain: "Instinto Inteiro",
    dissonance: "Redução ao Impulso",
  },
  Nimari: {
    trait: "Passo Liminal",
    domain: "Dado da Fortuna",
    dissonance: "Caminho Sem Compromisso",
  },
  Vitrálios: {
    trait: "Corpo Harmônico",
    domain: "Ressonância Prismática",
    dissonance: "Quebra Frequencial",
  },
};

const NEXO_CANONICAL_SUMMARIES: Readonly<Record<string, string>> = {
  "Aprendizagem Cruzada":
    "Escolha uma prática fora de seu Ofício que o Livre tenha aprendido ou exercido. Essa prática é reconhecida como permissão e fundamento quando a ação a exigir; não concede graduação numérica. Depois de cada Marco, pode substituí-la por outra prática que tenha efetivamente aprendido ou exercido.",
  "Solução Improvisada":
    "Uma vez por cena, o Livre pode propor um uso inesperado para objeto, contato, costume ou fragmento de conhecimento. Quando suas propriedades e a situação sustentam essa ideia, o Dom permite tentar mesmo sem uma ferramenta básica apropriada; não torna qualquer coisa ferramenta perfeita. Sob incerteza e risco, o Mestre anuncia a consequência e resolve por NEXO, sem bônus fixo.",
  "Identidade Oferecida":
    "A Sombra pode oferecer uma identidade sem dúvida como atalho para um objetivo imediato. Aceitar pode garantir esse êxito agora, mas cobra a negação de parte da história, dos vínculos ou da escolha da personagem. O Mestre nomeia a consequência concreta antes da aceitação; o jogador decide. Não há marca numérica obrigatória de Sombra.",
};

export function capabilityKey(type: KallistisCapability["type"], id: string): string {
  return `${type}:${id}`;
}

function customDescriptions(snapshot: CharacterSnapshot): Record<string, string> {
  const value = record(snapshot.capacidade_manifestacoes);
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, description]) => {
      const clean = text(description);
      return clean ? [[key, clean]] : [];
    }),
  );
}

function canonicalPassage(textValue: string, name: string): string {
  const lines = textValue.split(/\r?\n/);
  const normalizedName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const startsCapability = (line: string) => {
    const plain = line
      .replace(/^#{1,6}\s*/, "")
      .replace(/\*\*/g, "")
      .replace(/[_`]/g, "")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return (
      plain === normalizedName ||
      /^(traco|dom|dissonancia|tecnica inicial|tecnica|especializacao|herancas)\s*[—:-]\s*/.test(
        plain,
      ) && plain.endsWith(normalizedName) ||
      plain.startsWith(`${normalizedName}.`) ||
      plain.startsWith(`${normalizedName} —`) ||
      plain.startsWith(`${normalizedName} –`)
    );
  };
  const start = lines.findIndex(startsCapability);
  if (start < 0) return "";
  const heading = /^\s*#{1,6}\s/.test(lines[start]) ||
    /^(?:Traço|Dom|Dissonância|Técnica|Heranças)\s*[—:-]/i.test(
      lines[start].replace(/^\s*#{1,6}\s*/, ""),
    );
  const selected: string[] = [];
  for (let index = heading ? start + 1 : start; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      if (selected.length) break;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) break;
    if (
      selected.length &&
      (/^(?:Traço|Dom|Dissonância|Heranças|Técnica inicial|Técnicas da Trilha|Especializações)(?:\s*[—:-]|$)/i.test(
        line,
      ) || /^\*\*[^*]+\.\*\*/.test(line))
    )
      break;
    selected.push(line);
  }
  let passage = selected.join(" ").replace(/\s+/g, " ").trim();
  if (!heading) {
    const nextNamedEntry = passage.search(
      /\.\s+[A-ZÀ-Ý][\p{L}]+(?:\s+(?:[A-ZÀ-Ý][\p{L}]+|de|do|da|dos|das|e)){1,3}\.\s/u,
    );
    if (nextNamedEntry > 0) passage = passage.slice(0, nextNamedEntry + 1);
  }
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return passage.replace(new RegExp(`^${escapedName}(?:\\.|\\s*[—–:-])\\s*`, "iu"), "");
}

function canonicalSummary(value: unknown, name: string): string {
  const item = record(value);
  const direct = text(item?.texto) || text(item?.efeito) || text(item?.summary) || text(item?.g0);
  const extracted = retrieveCanonicalBook(name, "LIVRO III — SISTEMA")
    .map((context) => canonicalPassage(context.text, name))
    .find(Boolean);
  if (extracted) return extracted;
  if (direct) return direct;
  const nexoCanonical = NEXO_CANONICAL_SUMMARIES[name];
  if (nexoCanonical) return nexoCanonical;
  return "Definição canônica registrada por ID no KALLISTIS.";
}

function capability(
  type: KallistisCapability["type"],
  id: string,
  name: string,
  canonical: unknown,
  descriptions: Record<string, string>,
): KallistisCapability {
  const key = capabilityKey(type, id);
  return {
    id,
    type,
    name,
    canonical_definition: {
      id,
      source: "KALLISTIS_LIVRO_COMPLETO_NEXO_MOTOR_PROGRESSAO_2026-11-05",
      summary: canonicalSummary(canonical, name),
    },
    character_manifestation_description: descriptions[key] || "",
  };
}

export function kallistisCapabilities(snapshot: CharacterSnapshot): KallistisCapability[] {
  const fields = record(snapshot.fields) ?? {};
  const descriptions = customDescriptions(snapshot);
  const capabilities: KallistisCapability[] = [];
  const seen = new Set<string>();
  const add = (item: KallistisCapability) => {
    const key = capabilityKey(item.type, item.id);
    const nameKey = `${item.type}:${slug(item.name)}`;
    if (!seen.has(key) && !seen.has(nameKey)) {
      seen.add(key);
      seen.add(nameKey);
      capabilities.push(item);
    }
  };

  const peopleCapabilities = PEOPLE_CAPABILITIES[text(snapshot.povo) || text(fields.povo)];
  for (const [type, name] of peopleCapabilities
    ? ([
        ["ability", peopleCapabilities.trait],
        ["ability", peopleCapabilities.domain],
        ["ability", peopleCapabilities.dissonance],
      ] as const)
    : []) {
    add(capability(type, slug(name), name, name, descriptions));
  }
  for (const key of ["traco", "dom", "dissonancia"]) {
    const item = record(snapshot[key]);
    const name = text(item?.nome || item?.name);
    if (name) add(capability("ability", slug(name), name, item, descriptions));
  }
  const heritage = text(snapshot.heranca) || text(fields.herancaPovo);
  const people = text(snapshot.povo) || text(fields.povo);
  const heritageItem = record(snapshot.herancaDefinicao);
  if (heritage)
    add(capability("ability", slug(heritage), heritage, heritageItem || heritage, descriptions));
  if (people && text(snapshot.aspectoOutro)) {
    const name = text(snapshot.aspectoOutro);
    add(capability("ability", slug(name), name, name, descriptions));
  }

  const inheritedTechnique = record(snapshot.tecnicaHeranca);
  const inheritedTechniqueName = text(inheritedTechnique?.nome || inheritedTechnique?.name);
  const inheritedTechniqueOffice = slug(text(inheritedTechnique?.oficio));
  if (inheritedTechniqueName) {
    add(
      capability(
        "technique",
        `heritage.${inheritedTechniqueOffice || "universal"}.${slug(inheritedTechniqueName)}`,
        inheritedTechniqueName,
        inheritedTechnique,
        descriptions,
      ),
    );
  }

  const trails = list(snapshot.trilhas);
  for (const rawTrail of trails) {
    const trail = record(rawTrail);
    const office = slug(text(trail?.oficio));
    for (const rawTechnique of list(trail?.tecnicas)) {
      const item = record(rawTechnique);
      const name = text(item?.nome || item?.name || rawTechnique);
      if (name)
        add(
          capability(
            "technique",
            `${office || "trilha"}.${slug(name)}`,
            name,
            item || name,
            descriptions,
          ),
        );
    }
    for (const rawForm of list(trail?.knownForms)) {
      const form = record(rawForm);
      const formId = text(form?.formId);
      const canonical = MAGIC_FORMS.find((candidate) => candidate.id === formId);
      if (formId && canonical)
        add(capability("magic", formId, canonical.canonicalName, canonical, descriptions));
    }
  }
  const office = text(snapshot.oficio) || text(fields.oficio);
  const nexoCapabilities = record(snapshot.capacidades) ?? {};
  for (const rawTechnique of list(nexoCapabilities.tecnicas)) {
    const item = record(rawTechnique);
    const name = text(item?.nome || item?.name || rawTechnique);
    if (name)
      add(capability("technique", `${slug(office) || "trilha"}.${slug(name)}`, name, item || name, descriptions));
  }
  for (const rawForm of list(nexoCapabilities.formas)) {
    const form = record(rawForm);
    const formId = text(form?.formId || form?.id || rawForm);
    const canonical = MAGIC_FORMS.find((candidate) => candidate.id === formId);
    if (canonical) add(capability("magic", formId, canonical.canonicalName, canonical, descriptions));
  }
  for (const rawEvocation of list(nexoCapabilities.evocoes)) {
    const item = record(rawEvocation);
    const name = text(item?.nome || item?.name || rawEvocation);
    if (name) add(capability("ability", `evocacao.${slug(name)}`, name, item || name, descriptions));
  }
  for (const rawTechnique of list(snapshot.learnedCapabilities)) {
    const item = record(rawTechnique);
    const name = text(item?.nome || item?.name || rawTechnique);
    if (name)
      add(
        capability(
          "technique",
          `${slug(office) || "trilha"}.${slug(name)}`,
          name,
          item,
          descriptions,
        ),
      );
  }
  const specialization = text(snapshot.especializacao) || text(fields.especializacao);
  if (specialization)
    add(capability("ability", slug(specialization), specialization, specialization, descriptions));
  return capabilities;
}

export function projectKallistisCharacter(
  snapshot: CharacterSnapshot,
): KallistisCharacterProjection {
  const fulgor = Number.isInteger(snapshot.fulgor)
    ? Math.max(0, Math.min(5, Number(snapshot.fulgor)))
    : 0;
  const capabilities = kallistisCapabilities(snapshot);
  return {
    manifestation: text(snapshot.manifestacao_pessoal),
    manifestacao_pessoal: text(snapshot.manifestacao_pessoal),
    fulgor,
    fulgor_current: fulgor,
    fulgor_max: 5,
    capabilities,
    capability_manifestation_descriptions: Object.fromEntries(
      capabilities.map((item) => [
        capabilityKey(item.type, item.id),
        item.character_manifestation_description,
      ]),
    ),
    source: "kallistis",
  };
}

export function validateCharacterPresentation(snapshot: CharacterSnapshot): string[] {
  const errors: string[] = [];
  if (
    snapshot.manifestacao_pessoal !== undefined &&
    (typeof snapshot.manifestacao_pessoal !== "string" ||
      snapshot.manifestacao_pessoal.length > PERSONAL_MANIFESTATION_MAX)
  ) {
    errors.push("personal_manifestation_invalid");
  }
  if (
    snapshot.fulgor !== undefined &&
    (!Number.isInteger(snapshot.fulgor) ||
      Number(snapshot.fulgor) < 0 ||
      Number(snapshot.fulgor) > 5)
  ) {
    errors.push("fulgor_invalid");
  }
  const descriptions = snapshot.capacidade_manifestacoes;
  if (descriptions !== undefined) {
    const value = record(descriptions);
    if (!value || Object.keys(value).length > 128) errors.push("ability_manifestations_invalid");
    else {
      for (const [key, description] of Object.entries(value)) {
        if (!/^(ability|technique|magic):[A-Za-z0-9._-]+$/.test(key))
          errors.push(`ability_manifestation_key_invalid_${key}`);
        if (typeof description !== "string" || description.length > ABILITY_MANIFESTATION_MAX)
          errors.push(`ability_manifestation_invalid_${key}`);
      }
    }
  }
  return errors;
}
