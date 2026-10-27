import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, LockKeyhole, MapPin, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  criarEventoAgenda,
  listarContextoAgenda,
  listarEventosAgenda,
  type AgendaEvento,
  type TipoEvento,
} from "@/lib/agenda.functions";

const weekdayLabels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const eventTypes: { value: TipoEvento; label: string }[] = [
  { value: "evento", label: "Evento" },
  { value: "reuniao", label: "Encontro" },
  { value: "compromisso", label: "Compromisso" },
  { value: "aula", label: "Aula" },
  { value: "prazo", label: "Prazo" },
  { value: "outro", label: "Outro" },
];

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDateTimeValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function monthRange(date: Date) {
  return {
    inicio: monthStart(date).toISOString(),
    fim: new Date(date.getFullYear(), date.getMonth() + 1, 1).toISOString(),
  };
}

function dayLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function eventTime(date: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(date));
}

type EventForm = {
  titulo: string;
  tipo: TipoEvento;
  inicio: string;
  fim: string;
  local: string;
  descricao: string;
  scope: "PRIVATE" | "MESA";
  mesaId: string;
};

function emptyForm(mesaId: string): EventForm {
  const start = new Date();
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  return {
    titulo: "",
    tipo: "evento",
    inicio: localDateTimeValue(start),
    fim: "",
    local: "",
    descricao: "",
    scope: mesaId ? "MESA" : "PRIVATE",
    mesaId,
  };
}

export function SharedAgenda() {
  const contextFn = useServerFn(listarContextoAgenda);
  const listFn = useServerFn(listarEventosAgenda);
  const createFn = useServerFn(criarEventoAgenda);
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => dateKey(new Date()));
  const [events, setEvents] = useState<AgendaEvento[]>([]);
  const [context, setContext] = useState<Awaited<ReturnType<typeof listarContextoAgenda>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EventForm>(() => emptyForm(""));
  const range = useMemo(() => monthRange(month), [month]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextContext, nextEvents] = await Promise.all([
        contextFn(),
        listFn({ data: range }),
      ]);
      setContext(nextContext);
      setEvents(nextEvents);
      setForm((current) => {
        if (current.mesaId || !nextContext.mesas[0]) return current;
        return { ...current, mesaId: nextContext.mesas[0].id, scope: "MESA" };
      });
    } catch {
      toast.error("Não foi possível carregar a agenda.");
    } finally {
      setLoading(false);
    }
  }, [contextFn, listFn, range]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const calendarDays = useMemo(() => {
    const first = monthStart(month);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [month]);

  const eventsByDay = useMemo(() => {
    const grouped = new Map<string, AgendaEvento[]>();
    for (const event of events) {
      const key = dateKey(new Date(event.inicio));
      grouped.set(key, [...(grouped.get(key) ?? []), event]);
    }
    return grouped;
  }, [events]);

  const selectedDate = useMemo(() => {
    const [year, monthNumber, day] = selectedDay.split("-").map(Number);
    return new Date(year, monthNumber - 1, day);
  }, [selectedDay]);
  const selectedEvents = eventsByDay.get(selectedDay) ?? [];

  function shiftMonth(amount: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + amount, 1);
    setMonth(next);
    setSelectedDay(dateKey(next));
  }

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.scope === "MESA" && !form.mesaId) {
      toast.error("Escolha uma Mesa para compartilhar este evento.");
      return;
    }
    setSaving(true);
    try {
      await createFn({
        data: {
          titulo: form.titulo,
          tipo: form.tipo,
          inicio: new Date(form.inicio).toISOString(),
          fim: form.fim ? new Date(form.fim).toISOString() : null,
          local: form.local || null,
          descricao: form.descricao || null,
          scope_type: form.scope,
          mesa_id: form.scope === "MESA" ? form.mesaId : null,
          target_user_id: null,
        },
      });
      toast.success(form.scope === "MESA" ? "Evento compartilhado com a Mesa." : "Evento privado criado.");
      setShowForm(false);
      setForm(emptyForm(context?.mesas[0]?.id ?? ""));
      await refresh();
    } catch {
      toast.error("Não foi possível criar o evento. Verifique sua permissão e os dados.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            <CalendarDays className="size-4" /> Crônicas da Mesa
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Agenda compartilhada</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Os eventos da Mesa ficam visíveis ao Mestre e a todos os jogadores ativos. Compromissos privados continuam só seus.
          </p>
        </div>
        <Button onClick={() => setShowForm((open) => !open)} className="shrink-0">
          <Plus /> {showForm ? "Fechar" : "Novo evento"}
        </Button>
      </header>

      {showForm ? (
        <form onSubmit={createEvent} className="grid gap-4 rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm sm:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold"><Plus className="size-4 text-primary" /> Novo evento</div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">Título<Input required maxLength={160} value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} /></label>
            <label className="space-y-1.5 text-sm">Tipo<select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoEvento })}>{eventTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1.5 text-sm">Início<Input required type="datetime-local" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} /></label>
            <label className="space-y-1.5 text-sm">Fim (opcional)<Input type="datetime-local" value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} /></label>
            <label className="space-y-1.5 text-sm">Local (opcional)<Input maxLength={200} value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })} /></label>
          </div>
          <label className="space-y-1.5 text-sm">Descrição (opcional)<Textarea maxLength={4000} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => setForm({ ...form, scope: "PRIVATE" })} className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${form.scope === "PRIVATE" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"}`}>
              <LockKeyhole className="mt-0.5 size-4 text-muted-foreground" /><span><span className="block text-sm font-medium">Só para mim</span><span className="text-xs text-muted-foreground">Evento privado</span></span>
            </button>
            <button type="button" disabled={!context?.canCreateMesa} onClick={() => setForm({ ...form, scope: "MESA" })} className={`flex items-start gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${form.scope === "MESA" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"}`}>
              <Users className="mt-0.5 size-4 text-primary" /><span><span className="block text-sm font-medium">Compartilhar com a Mesa</span><span className="text-xs text-muted-foreground">Mestre e jogadores ativos</span></span>
            </button>
          </div>
          {form.scope === "MESA" ? (
            <label className="space-y-1.5 text-sm">Mesa<select required className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.mesaId} onChange={(e) => setForm({ ...form, mesaId: e.target.value })}><option value="">Selecione uma Mesa</option>{context?.mesas.map((mesa) => <option key={mesa.id} value={mesa.id}>{mesa.name}</option>)}</select></label>
          ) : null}
          <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving ? "Salvando…" : form.scope === "MESA" ? "Publicar para a Mesa" : "Salvar privado"}</Button></div>
        </form>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-border/70 bg-card/50 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-4 sm:px-6">
          <h2 className="font-display text-xl font-semibold capitalize">{new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(month)}</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { const today = monthStart(new Date()); setMonth(today); setSelectedDay(dateKey(new Date())); }}>Hoje</Button>
            <Button variant="outline" size="icon" aria-label="Mês anterior" onClick={() => shiftMonth(-1)}><ChevronLeft /></Button>
            <Button variant="outline" size="icon" aria-label="Próximo mês" onClick={() => shiftMonth(1)}><ChevronRight /></Button>
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-border/70 bg-muted/20">
          {weekdayLabels.map((label) => <div key={label} className="py-2 text-center text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs">{label}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {calendarDays.map((day) => {
            const key = dateKey(day);
            const dayEvents = eventsByDay.get(key) ?? [];
            const inMonth = day.getMonth() === month.getMonth();
            return <button key={key} type="button" onClick={() => setSelectedDay(key)} className={`min-h-16 border-b border-r border-border/50 p-1.5 text-left transition sm:min-h-24 sm:p-2 ${inMonth ? "" : "bg-muted/15 text-muted-foreground/50"} ${selectedDay === key ? "bg-primary/10 ring-1 ring-inset ring-primary/50" : "hover:bg-muted/30"}`}>
              <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs ${key === dateKey(new Date()) ? "bg-primary text-primary-foreground" : ""}`}>{day.getDate()}</span>
              <span className="mt-1 hidden space-y-1 sm:block">{dayEvents.slice(0, 2).map((event) => <span key={event.id} className={`block truncate rounded px-1.5 py-0.5 text-[0.65rem] ${event.scope_type === "MESA" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{event.titulo}</span>)}{dayEvents.length > 2 ? <span className="block px-1 text-[0.65rem] text-muted-foreground">+{dayEvents.length - 2} eventos</span> : null}</span>
              {dayEvents.length ? <span className="mx-auto mt-1 block size-1.5 rounded-full bg-primary sm:hidden" /> : null}
            </button>;
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl font-semibold capitalize">{dayLabel(selectedDate)}</h2>
          <span className="text-xs text-muted-foreground">{selectedEvents.length} {selectedEvents.length === 1 ? "evento" : "eventos"}</span>
        </div>
        {loading ? <p className="rounded-xl border border-border/70 p-5 text-sm text-muted-foreground">Carregando eventos…</p> : selectedEvents.length ? selectedEvents.map((event) => <article key={event.id} className="rounded-xl border border-border/70 bg-card/60 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="font-semibold">{event.titulo}</h3><p className="mt-1 text-xs text-muted-foreground">{eventTypes.find((type) => type.value === event.tipo)?.label ?? "Evento"}</p></div>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${event.scope_type === "MESA" ? "bg-primary/10 text-primary" : event.scope_type === "PRIVATE" ? "bg-muted text-muted-foreground" : "bg-secondary text-secondary-foreground"}`}>{event.scope_type === "MESA" ? <><Users className="size-3.5" /> Compartilhado com a Mesa</> : event.scope_type === "PRIVATE" ? <><LockKeyhole className="size-3.5" /> Privado</> : "KALLÍSTIS"}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Clock3 className="size-4" />{eventTime(event.inicio)}{event.fim ? ` – ${eventTime(event.fim)}` : ""}</span>{event.local ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" />{event.local}</span> : null}</div>
          {event.descricao ? <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{event.descricao}</p> : null}
        </article>) : <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">Nenhum evento neste dia. Eventos publicados para a Mesa aparecem aqui para o Mestre e todos os jogadores ativos.</p>}
      </section>
    </main>
  );
}
