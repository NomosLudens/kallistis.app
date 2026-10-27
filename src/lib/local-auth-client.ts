export type LocalSessionUser = { id: string };
export type LocalSessionResponse = { user: LocalSessionUser };

export function isSupabaseClientConfigured(): boolean {
  const runtime = (globalThis as typeof globalThis & {
    __KALLISTIS_CONFIG__?: Record<string, string | undefined>;
  }).__KALLISTIS_CONFIG__;
  const url = import.meta.env.VITE_SUPABASE_URL || runtime?.SUPABASE_URL;
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    runtime?.SUPABASE_PUBLISHABLE_KEY ||
    runtime?.SUPABASE_ANON_KEY;
  return Boolean(url && key);
}

async function readResponse(response: Response): Promise<LocalSessionResponse | null> {
  if (response.status === 401) return null;
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof body?.error === "string" ? body.error : "Falha na sessão local");
  }
  return (await response.json()) as LocalSessionResponse;
}

export async function getLocalSession(): Promise<LocalSessionResponse | null> {
  return readResponse(
    await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" }),
  );
}

export async function restoreLocalSessionFromSupabase(): Promise<LocalSessionResponse | null> {
  const localSession = await getLocalSession();
  if (localSession || !isSupabaseClientConfigured()) return localSession;
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    if (localSession) return localSession;
    throw error;
  }
  const accessToken = data.session?.access_token;
  if (accessToken) return establishServerSession(accessToken);
  return localSession;
}

export async function establishServerSession(accessToken: string): Promise<LocalSessionResponse> {
  const response = await fetch("/api/auth/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessToken }),
  });
  const result = await readResponse(response);
  if (!result) throw new Error("E-mail ou palavra inválidos");
  return result;
}

export async function signInLocal(email: string, password: string): Promise<LocalSessionResponse> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) throw new Error("E-mail ou palavra inválidos");
  return establishServerSession(data.session.access_token);
}

export async function signInWithCredential(credential: string): Promise<LocalSessionResponse> {
  const response = await fetch("/api/auth/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  const result = await readResponse(response);
  if (!result) throw new Error("E-mail ou palavra inválidos");
  return result;
}

export async function signOutLocal(): Promise<void> {
  if (isSupabaseClientConfigured()) {
    const { supabase } = await import("@/integrations/supabase/client");
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw new Error("Falha ao encerrar sessão");
  }

  const response = await fetch("/api/auth/session", {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok && response.status !== 401) throw new Error("Falha ao encerrar sessão");
}
