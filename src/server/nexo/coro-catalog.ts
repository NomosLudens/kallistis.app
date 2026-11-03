export const CORO_PAPERS = ["Vanguarda", "Artilharia", "Amparo", "Bastião"] as const;
export type CoroPaper = typeof CORO_PAPERS[number];
export type CoroLevel = 1 | 2 | 3;
export type CoroActionType = "action" | "reaction";

export type CoroEffect = {
  id: string;
  paper: CoroPaper;
  level: CoroLevel;
  name: string;
  actionType: CoroActionType;
  scope: string;
};

// NEXO wording follows the reviewed Livro III conversion of Freeze v1.3 §§72–79.
// The player's narrative remains open; this text bounds the canonical effect.
export const CORO_EFFECTS: readonly CoroEffect[] = [
  { id: "vanguarda-1", paper: "Vanguarda", level: 1, name: "Corte da Fresta", actionType: "action", scope: "Um alvo alcançável ou estrutura crítica: abre uma brecha concreta e uma oportunidade imediata. Não derrota o alvo nem rompe material por decreto." },
  { id: "vanguarda-2", paper: "Vanguarda", level: 2, name: "Horizonte Partido", actionType: "action", scope: "Um alvo singular: escolha interromper preparação/concentração visível, romper barreira identificada, remover defesa com causa alcançável ou provocar mudança de fase cuja condição já foi atingida." },
  { id: "vanguarda-3", paper: "Vanguarda", level: 3, name: "Veredito dos Dois Mundos", actionType: "action", scope: "Uma mudança decisiva contra ameaça singular: interromper capacidade catastrófica, quebrar núcleo alcançável, expor verdade física ou impedir fuga possível. Regras próprias de campanha prevalecem." },
  { id: "artilharia-1", paper: "Artilharia", level: 1, name: "Chuva de Estilhaços", actionType: "action", scope: "Uma zona declarada; aliados fora do alvo. Cada ameaça alcançada responde à pressão, podendo ter preparação visível interrompida ou rota exposta conforme a intenção e a posição. Sem eliminação automática." },
  { id: "artilharia-2", paper: "Artilharia", level: 2, name: "Onda dos Horizontes", actionType: "action", scope: "Até duas zonas conectadas: pode conter passagem, separar ameaças ou abrir rota protegida; cada ameaça efetivamente alcançada recebe uma consequência compatível." },
  { id: "artilharia-3", paper: "Artilharia", level: 3, name: "Céu Fraturado", actionType: "action", scope: "Todo o campo hostil visível; consequências proporcionais a comuns, elites e chefes já definidos na cena. Pode interromper preparação coletiva alcançável e destruir perigos ambientais menores; não elimina inimigos nem destrói elemento maior por classificação." },
  { id: "amparo-1", paper: "Amparo", level: 1, name: "Pulso de Retorno", actionType: "action", scope: "Aliados alcançados retomam participação após abalo imediato; remove Abalado ligado à cena e permite cuidado imediato possível, sem apagar lesão séria, Ferida Marcante ou Sombra." },
  { id: "amparo-2", paper: "Amparo", level: 2, name: "Coro Restaurador", actionType: "action", scope: "Aliados alcançados se recompõem, podem remover uma condição comum compatível com cuidado e voltar à participação; quem caiu fica estável se a morte ainda não foi estabelecida." },
  { id: "amparo-3", paper: "Amparo", level: 3, name: "Todos os Nomes Retornam", actionType: "action", scope: "Aliados caídos durante a cena podem voltar antes do fim dela, sem reverter morte estabelecida. Aliados conscientes escolhem recuperar participação apesar do abalo corporal ou recompor coerência e identidade; autonomia contra assimilação depende do vínculo e da ameaça. Ferida séria, decisão e Sombra permanente mantêm seus próprios procedimentos." },
  { id: "bastiao-1", paper: "Bastião", level: 1, name: "Guarda Compartilhada", actionType: "reaction", scope: "Após gatilho anunciado e antes da resolução, intercepta uma ameaça contra pessoa/objetivo coberto; se possível, a consequência não alcança o protegido, mas pode recair no Bastião ou na posição conforme risco anunciado." },
  { id: "bastiao-2", paper: "Bastião", level: 2, name: "Muralha das Duas Realidades", actionType: "reaction", scope: "Sustenta rota ou posição durante a resolução de uma ameaça coletiva, impedindo deslocamento forçado ou medo coletivo quando essa for a abordagem declarada; não cria imunidade geral." },
  { id: "bastiao-3", paper: "Bastião", level: 3, name: "Ninguém Cai Sozinho", actionType: "reaction", scope: "Protege durante um evento catastrófico previamente definido ou uma rodada da cena. A consequência não retira do grupo a possibilidade de continuar na cena, embora possa deixar outra consequência. Pode impedir Merge forçado/assimilação coletiva enquanto durar; não remove Sombra nem protege ameaça fora do escopo." },
] as const;

export function isCoroPaper(value: unknown): value is CoroPaper {
  return typeof value === "string" && (CORO_PAPERS as readonly string[]).includes(value);
}

export function getCoroEffect(paper: unknown, level: unknown): CoroEffect | null {
  if (!isCoroPaper(paper) || !Number.isInteger(level) || Number(level) < 1 || Number(level) > 3) return null;
  return CORO_EFFECTS.find((effect) => effect.paper === paper && effect.level === level) ?? null;
}

export function coroConsentParticipants(activeMembers: readonly { userId: string; memberRole: string }[], requestedIds: readonly string[], proposerId: string): string[] {
  const activeIds = new Set(activeMembers.map((member) => member.userId));
  const ids = [...new Set(requestedIds.filter((id) => typeof id === "string" && id.trim()))].sort();
  if (!ids.length || !ids.includes(proposerId) || ids.some((id) => !activeIds.has(id))) return [];
  return ids;
}

export function sameIdentitySet(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((userId, index) => userId === b[index]);
}
