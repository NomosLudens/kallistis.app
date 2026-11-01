export type AuthEventName = "PASSWORD_RECOVERY" | "INITIAL_SESSION" | "SIGNED_IN" | string;

export function shouldNavigateAfterAuthEvent(
  event: AuthEventName,
  hasSession: boolean,
  recoveryMode: boolean,
) {
  if (event === "PASSWORD_RECOVERY") return false;
  return hasSession && !recoveryMode;
}

export function validatePasswordRecoveryInput(
  password: string,
  confirmation: string,
): string | null {
  if (password.trim().length < 7) return "A nova frase de acesso precisa ter pelo menos 7 caracteres.";
  if (password !== confirmation) return "As senhas não conferem.";
  return null;
}
