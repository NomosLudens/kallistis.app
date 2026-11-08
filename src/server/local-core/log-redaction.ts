const POSTGRES_URL = /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi;
const SENSITIVE_KEY =
  /(?:password|passwd|secret|token|credential|authorization|cookie|connectionstring|databaseurl|dsn)/i;

function redactString(value: string): string {
  return value.replace(POSTGRES_URL, "postgresql://[REDACTED]");
}

export function redactSensitiveLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(value.stack ? { stack: redactString(value.stack) } : {}),
      ...(value.cause !== undefined ? { cause: redactSensitiveLogValue(value.cause, seen) } : {}),
    };
  }
  if (value instanceof URL) return redactString(value.href);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveLogValue(item, seen));

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitiveLogValue(item, seen),
    ]),
  );
}

export function installSensitiveLogRedaction(): void {
  for (const method of ["debug", "info", "log", "warn", "error"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) =>
      original(...args.map((value) => redactSensitiveLogValue(value)));
  }
}
