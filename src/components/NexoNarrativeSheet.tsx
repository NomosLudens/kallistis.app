import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";

type Character = Record<string, unknown> & {
  id: string;
  name?: string;
  status?: string;
  version?: number;
  snapshot: Record<string, unknown>;
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
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
function entries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function describe(value: unknown): string {
  const item = object(value);
  if (!Object.keys(item).length) return text(value);
  const name = text(
    item.nome ??
      item.name ??
      item.titulo ??
      item.forma ??
      item.chave ??
      item.equipamento ??
      item.formId,
  );
  const description = text(
    item.descricao ??
      item.description ??
      item.notas ??
      item.efeito ??
      item.effect ??
      item.condition,
  );
  return [name, description].filter(Boolean).join(" — ");
}
function List({ values }: { values: unknown }) {
  const items = entries(values).map(describe).filter(Boolean);
  return items.length ? (
    <ul className="nexo-sheet__list">
      {items.map((item, i) => (
        <li key={`${item}-${i}`}>{item}</li>
      ))}
    </ul>
  ) : (
    <p className="nexo-sheet__muted">Nenhum registrado.</p>
  );
}

export function NexoNarrativeSheet({ character }: { character: Character }) {
  const [printBlank, setPrintBlank] = useState(false);
  const snapshot = character.snapshot ?? {};
  const narrative = object(snapshot.historia);
  const capabilities = object(snapshot.capacidades);
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
  const identity = [text(snapshot.povo), text(snapshot.origem)].filter(Boolean).join(" · ");
  const craft = [text(snapshot.oficio), text(snapshot.especializacao)].filter(Boolean).join(" — ");
  const mesa = character.mesas?.[0];

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
        <span>Ficha narrativa · somente leitura dos dados do personagem</span>
        <div>
          <button type="button" onClick={() => print(false)}>
            Imprimir ficha
          </button>
          <button type="button" onClick={() => print(true)}>
            Imprimir ficha em branco
          </button>
        </div>
      </nav>
      <main className="nexo-sheet">
        <div className="nexo-sheet__screen">
          <header className="nexo-sheet__hero">
            <p>
              FICHA NARRATIVA · {text(character.status)} · VERSÃO {text(character.version)}
            </p>
            <h1>{text(snapshot.nome ?? character.name) || "Personagem"}</h1>
            <p>{text(snapshot.conceito)}</p>
            <div className="nexo-sheet__identity">
              <span>{identity || "Povo não informado"}</span>
              <span>{craft || "Ofício não informado"}</span>
              <span>Marco {text(snapshot.marco) || "—"}</span>
              <span>
                Luz {text(influence.luz) || "—"} · Escuridão {text(influence.escuridao) || "—"}
              </span>
            </div>
          </header>
          <section className="nexo-sheet__section">
            <h2>Minha história</h2>
            <p className="nexo-sheet__story">
              {historyText || "A história deste personagem ainda não foi registrada."}
            </p>
            <details>
              <summary>História completa</summary>
              <dl className="nexo-sheet__history-details">
                {Object.entries(narrative).map(([key, value]) => (
                  <div key={key}>
                    <dt>{historyLabel(key)}</dt>
                    <dd>{describe(value) || "—"}</dd>
                  </div>
                ))}
                {!Object.keys(narrative).length ? (
                  <dd>{historyText || "Sem detalhes adicionais."}</dd>
                ) : null}
              </dl>
            </details>
          </section>
          <div className="nexo-sheet__columns">
            <section className="nexo-sheet__section">
              <h2>O que sei fazer</h2>
              {(
                [
                  ["Técnicas", capabilities.tecnicas],
                  ["Especialização", snapshot.especializacao ? [snapshot.especializacao] : []],
                  ["Capacidades e conhecimentos", capabilities.dons],
                  ["Formas aprendidas", capabilities.formas],
                  ["Evocações", capabilities.evocoes],
                  ["Chaves", capabilities.chaves],
                  ["Equipamentos", capabilities.equipamentos],
                ] as Array<[string, unknown]>
              ).map(([label, values]) => (
                <div className="nexo-sheet__subsection" key={label}>
                  <h3>{label}</h3>
                  <List values={values} />
                </div>
              ))}
            </section>
            <section className="nexo-sheet__section">
              <h2>Minha situação atual</h2>
              <p className="nexo-sheet__shadow">
                <strong>Marcas de Sombra</strong> <span>{text(state.marcasSombra) || "0"} / 6</span>
              </p>
              <div className="nexo-sheet__subsection">
                <h3>Condições persistentes</h3>
                <List values={state.condicoes} />
              </div>
              <div className="nexo-sheet__subsection">
                <h3>Ferimentos</h3>
                <List values={state.ferimentos} />
              </div>
              <div className="nexo-sheet__subsection">
                <h3>Chaves e equipamentos disponíveis</h3>
                <List
                  values={[...entries(capabilities.chaves), ...entries(capabilities.equipamentos)]}
                />
              </div>
            </section>
          </div>
          <NexoActionBoard character={character} mesaId={mesa?.id ?? ""} />
        </div>
        <Printable
          character={character}
          blank={printBlank}
          history={historyText}
          identity={identity}
          craft={craft}
          capabilities={capabilities}
          state={state}
          influence={influence}
        />
      </main>
    </div>
  );
}

function Printable({
  character,
  blank,
  history,
  identity,
  craft,
  capabilities,
  state,
  influence,
}: {
  character: Character;
  blank: boolean;
  history: string;
  identity: string;
  craft: string;
  capabilities: Record<string, unknown>;
  state: Record<string, unknown>;
  influence: Record<string, unknown>;
}) {
  const groups: Array<[string, unknown]> = [
    ["Técnicas", capabilities.tecnicas],
    ["Capacidades e conhecimentos", capabilities.dons],
    ["Formas aprendidas", capabilities.formas],
    ["Evocações", capabilities.evocoes],
    ["Chaves", capabilities.chaves],
    ["Equipamentos", capabilities.equipamentos],
  ];
  const lines = (label: string, value: unknown, count = 2) => (
    <div className="nexo-print__field">
      <strong>{label}</strong>
      {blank ? (
        <div className="nexo-print__writing" style={{ minHeight: `${count * 1.25}rem` }} />
      ) : (
        <p>{describe(value) || "—"}</p>
      )}
    </div>
  );
  return (
    <article className={`nexo-print ${blank ? "nexo-print--blank" : ""}`}>
      <header>
        <span>KALLÍSTIS · NEXO</span>
        <small>Ficha narrativa</small>
      </header>
      <h1>{blank ? "Minha ficha" : text(character.snapshot.nome ?? character.name)}</h1>
      {!blank && text(character.snapshot.conceito) ? (
        <p className="nexo-print__concept">{text(character.snapshot.conceito)}</p>
      ) : null}
      <section className="nexo-print__identity">
        {lines("Povo / Origem", identity, 1)}
        {lines("Ofício / Especialização", craft, 1)}
        {lines("Marco", text(character.snapshot.marco), 1)}
        {lines(
          "Influência · Luz / Escuridão",
          `${text(influence.luz)} / ${text(influence.escuridao)}`,
          1,
        )}
      </section>
      {lines("Minha história", history, 2)}
      <section className="nexo-print__columns">
        {groups.map(([label, value]) => (
          <div key={label}>
            {lines(label, entries(value).map(describe).filter(Boolean).join(" · "), 2)}
          </div>
        ))}
      </section>
      <section className="nexo-print__columns nexo-print__state">
        {lines("Marcas de Sombra", `${text(state.marcasSombra) || "0"} / 6`, 1)}
        {lines(
          "Condições persistentes",
          entries(state.condicoes).map(describe).filter(Boolean).join(" · "),
          2,
        )}
        {lines(
          "Ferimentos",
          entries(state.ferimentos).map(describe).filter(Boolean).join(" · "),
          2,
        )}
      </section>
      <section className="nexo-print__action">
        <h2>O QUE QUERO FAZER?</h2>
        {lines("Intenção", "", 2)}
        {lines("Resistência (definida pelo Mestre)", "", 1)}
        {lines("Argumento 1", "", 2)}
        {lines("Argumento 2", "", 2)}
        {lines("NEXO · calculado a partir do Marco e dos argumentos aceitos", "", 1)}
        {lines("Luz (d10) / Escuridão (d10)", "", 1)}
        {lines("Total · Margem · Ressonância · Consequência", "", 2)}
      </section>
      <footer>Argumentos propostos são avaliados pelo Mestre antes da rolagem.</footer>
    </article>
  );
}

export function NexoActionBoard({ character, mesaId }: { character: Character; mesaId: string }) {
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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const activeSession = useMemo(
    () => sessions.find((session) => session.status === "live"),
    [sessions],
  );

  const reload = useCallback(async () => {
    if (!mesaId) return;
    const [actionResponse, coroResponse, sessionResponse] = await Promise.all([
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
    ]);
    const [actionData, coroData, sessionData] = await Promise.all([
      actionResponse.json(),
      coroResponse.json(),
      sessionResponse.json(),
    ]);
    if (actionResponse.ok) {
      setActions(actionData.actions ?? []);
      setCanAdjudicate(actionData.canAdjudicate === true);
    }
    if (coroResponse.ok) setResistances(coroData.resistanceAssignments ?? []);
    if (sessionResponse.ok) setSessions(sessionData.sessions ?? []);
  }, [mesaId]);
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
