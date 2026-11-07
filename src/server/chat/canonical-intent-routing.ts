import type { CanonicalBookId } from "@/lib/canonical-rules.server";

export type CanonicalChatIntent =
  | "rules"
  | "history_cosmology"
  | "setting_atlas"
  | "table_guidance"
  | "character_creation_rules"
  | "game_action"
  | "narrative";

export type CanonicalChatRoute = {
  intent: CanonicalChatIntent;
  books: CanonicalBookId[];
  handling: "answer" | "conversation" | "action_handoff";
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function routeCanonicalChatQuestion(question: string): CanonicalChatRoute {
  const text = normalize(question);
  const actionDeclared =
    /\b(?:declaro|vou tentar|vou atacar|uso a tecnica|faco a acao|rolei|resultado dos dados|adjudique|conceda pulso)\b/.test(
      text,
    );
  if (actionDeclared)
    return {
      intent: "game_action",
      books: ["LIVRO III — SISTEMA"],
      handling: "action_handoff",
    };

  if (/\b(?:conversar|falar|encenar|interagir)\s+com\s+[\p{L}][\p{L}'’-]*/u.test(text))
    return { intent: "narrative", books: [], handling: "conversation" };

  if (/\bpovo(?:s)?\b/.test(text) && /\borigem\b/.test(text) && /\bcomunidade(?:s)?\b/.test(text))
    return {
      intent: "setting_atlas",
      books: ["LIVRO II — ATLAS", "LIVRO III — SISTEMA"],
      handling: "answer",
    };

  const asksCreationRules =
    /\b(?:como|qual|quais|explique|passo a passo|sequencia|regras|canone)\b/.test(text) &&
    /\b(?:criacao|criar|personagem|ficha)\b/.test(text);
  if (asksCreationRules)
    return {
      intent: "character_creation_rules",
      books: ["LIVRO III — SISTEMA"],
      handling: "answer",
    };

  if (/\b(?:conte|invente|narre|escreva)\s+(?:uma\s+)?historia\b/.test(text))
    return { intent: "narrative", books: [], handling: "conversation" };

  if (
    /\b(?:historia|cosmologia|grande cristal|cristal partido|fratura|origem dos mundos|luz|escuridao|sombra)\b/.test(
      text,
    ) &&
    /\b(?:historia|cosmologia|origem|grande cristal|cristal partido|fratura|diferenca|diferenca entre|o que e|o que aconteceu|como surgiu)\b/.test(
      text,
    )
  )
    return {
      intent: "history_cosmology",
      books: ["LIVRO I — HISTÓRIA"],
      handling: "answer",
    };

  if (
    /\b(?:livro iv|livro 4|como conduzir|conduzir a mesa|conduzir uma cena|preparar a cena|conducao do mestre|orientacao do mestre|regra do mestre|papel do mestre|narrar|narrando|antagonista|encontro|cena de conflito|estabelecer resistencia|resistencia e consequencias|consequencias de uma acao)\b/.test(
      text,
    )
  )
    return {
      intent: "table_guidance",
      books: ["LIVRO IV — NARRANDO O JOGO", "LIVRO III — SISTEMA"],
      handling: "answer",
    };

  const ruleTerms =
    /\b(?:regra|regras|canone|nexo|marco|argumentos?|formula|d10|dado|dados|rolagem|ressonancia|predominancia|margem|vanguarda|iniciativa|coro|pulsos?|barras?|vitalidade|guarda|trocados|excecao|resistencia|tecnica|magia|evocacao)\b/.test(
      text,
    );
  if (ruleTerms)
    return {
      intent: "rules",
      books: ["LIVRO III — SISTEMA"],
      handling: "answer",
    };

  if (/\b(?:no manuscrito|segundo o manuscrito|segundo o livro|no livro|regra canonica|regra oficial|fato canonico)\b/.test(text))
    return {
      intent: "rules",
      books: ["LIVRO III — SISTEMA"],
      handling: "answer",
    };

  if (
    /\b(?:povos?|oficios?|lugares?|cidades?|comunidades?|atlas|rotas?|velarim|regioes?)\b/.test(
      text,
    )
  )
    return {
      intent: "setting_atlas",
      books: ["LIVRO II — ATLAS"],
      handling: "answer",
    };

  return { intent: "narrative", books: [], handling: "conversation" };
}

export function renderCanonicalRouteInstructions(route: CanonicalChatRoute) {
  const destination = route.books.length ? route.books.join("; ") : "conversa narrativa";
  const handling =
    route.handling === "action_handoff"
      ? "A pessoa declarou uma ação de jogo. Não role, adjudique, aprove, conceda Pulso ou altere estado nesta sala; explique somente o procedimento documentado e indique o fluxo de jogo apropriado."
      : route.intent === "narrative"
        ? "Preserve a conversa narrativa. Trate nomes, lugares e situações que a pessoa acabou de fornecer como premissas para uma cena ficcional, não como fatos persistidos. Entre na cena sem exigir campanha ou Mesa ativa; não afirme que a cena existe no banco e não altere ficha, campanha ou estado mecânico. Não converta o pedido em criação de personagem ou resolução mecânica."
        : "Responda à intenção identificada usando somente os trechos documentais recuperados. Cada afirmação normativa ou factual precisa de suporte textual direto e deve terminar com um marcador [[EVIDENCE:E#]] que apareça nos trechos desta mensagem. O servidor converterá esses marcadores em Livro, seção e página verificados. Nunca escreva referências bibliográficas próprias. Para perguntas com vários conceitos, trate cada conceito com sua evidência específica; não extrapole uma passagem isolada para os demais. Distinga texto explícito de interpretação. Se um conceito solicitado não estiver definido nos trechos, declare a lacuna sem inferir uma regra. Seja conciso: responda cada conceito em até duas frases e mantenha a resposta inteira abaixo de 2800 caracteres, sem omitir evidências necessárias.";
  return [
    "=== ROTEAMENTO DA MENSAGEM DO CHAT GERAL ===",
    `CANON_INTENT=${route.intent}`,
    `CANON_DESTINATION=${destination}`,
    handling,
    "As regras de KALLISTIS devem vir do PDF revisado recuperado para esta mensagem. Não use regras legadas, lembranças do modelo ou implementações anteriores como autoridade. Para pergunta factual sem evidência recuperada, reconheça a lacuna em vez de improvisar.",
  ].join("\n");
}
