import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRuntimeEnv } from "./context";

const COOKIE_NAME = "__Host-kallistis_supabase_session";

// Supabase Auth /user can transiently return 5xx. Retry once before treating
// a potentially valid player session as invalid. Never retry 4xx credentials.
async function getUserWithTransientRetry(supabase: SupabaseClient, accessToken: string) {
  const first = await supabase.auth.getUser(accessToken);
  const status = first.error?.status;
  if (typeof status === "number" && [500, 502, 503, 504].includes(status)) {
    return supabase.auth.getUser(accessToken);
  }
  return first;
}

function cookieValue(cookieHeader: string | null, name: string): string | null {
  for (const part of cookieHeader?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

export function readSupabaseAccessToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) return token;
  }
  return cookieValue(request.headers.get("cookie"), COOKIE_NAME);
}

export function buildSupabaseSessionCookie(accessToken: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(accessToken)}; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSupabaseSessionCookie(): string {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export async function resolveSupabaseIdentity(accessToken: string): Promise<{ id: string } | null> {
  const runtime = getRuntimeEnv();
  if (!runtime.supabaseUrl || !runtime.supabasePublishableKey) return null;
  const supabase = createClient(runtime.supabaseUrl, runtime.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  try {
    const { data, error } = await getUserWithTransientRetry(supabase, accessToken);
    return error || !data.user ? null : { id: data.user.id };
  } catch {
    return null;
  }
}

export async function resolveSupabaseGoogleIdentity(
  accessToken: string,
): Promise<{ id: string; provider: "google" } | null> {
  const runtime = getRuntimeEnv();
  if (!runtime.supabaseUrl || !runtime.supabasePublishableKey) return null;
  const supabase = createClient(runtime.supabaseUrl, runtime.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  try {
    const { data, error } = await getUserWithTransientRetry(supabase, accessToken);
    if (error || !data.user) return null;
    const linkedProviders = new Set([
      ...(Array.isArray(data.user.app_metadata?.providers)
        ? data.user.app_metadata.providers.filter(
            (provider): provider is string => typeof provider === "string",
          )
        : []),
      ...(data.user.identities ?? [])
        .map((identity) => identity.provider)
        .filter((provider): provider is string => typeof provider === "string"),
      ...(typeof data.user.app_metadata?.provider === "string"
        ? [data.user.app_metadata.provider]
        : []),
    ]);
    return linkedProviders.has("google") ? { id: data.user.id, provider: "google" } : null;
  } catch {
    return null;
  }
}

export function hasSupabaseAuthRuntime(): boolean {
  const runtime = getRuntimeEnv();
  return Boolean(runtime.supabaseUrl && runtime.supabasePublishableKey);
}
