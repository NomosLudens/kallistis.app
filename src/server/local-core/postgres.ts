import { Client } from "pg";
import { getRuntimeDatabaseUrl, getRuntimeEnv } from "@/server/runtime/context";

export type SqlExecutor = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
  close(): void;
  transaction?<T>(fn: (transaction: SqlExecutor) => Promise<T>): Promise<T>;
};

type BunSqlClient = {
  unsafe<T extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
  begin?<T>(fn: (transaction: BunSqlClient) => Promise<T>): Promise<T>;
};

type BunRuntime = { SQL?: new (url: string) => BunSqlClient };

const bunSqlClients = new Map<string, BunSqlClient>();

export function createWorkerPostgresExecutor(connectionString: string): SqlExecutor {
  const client = new Client({ connectionString });
  let connected: Promise<void> | undefined;

  const connect = async () => {
    if (!connected) connected = client.connect().then(() => undefined);
    await connected;
  };

  const query = async <T extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]> => {
    await connect();
    const result = await client.query<T>(statement, parameters ? [...parameters] : undefined);
    return result.rows;
  };

  return {
    query,
    close: () => {
      void client.end().catch(() => undefined);
    },
    transaction: async <T>(fn: (transaction: SqlExecutor) => Promise<T>): Promise<T> => {
      await connect();
      await client.query("BEGIN");
      const transaction: SqlExecutor = { query, close: () => undefined };
      try {
        const value = await fn(transaction);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    },
  };
}

/** Adapter for local Bun.SQL or the Worker connection exposed through runtime bindings. */
export function createBunPostgresExecutor(databaseUrl: string): SqlExecutor {
  if (!databaseUrl.startsWith("postgres://") && !databaseUrl.startsWith("postgresql://")) {
    throw new TypeError("KALLISTIS_DATABASE_URL must be a PostgreSQL URL");
  }
  const hyperdriveConnectionString = getRuntimeEnv().hyperdrive?.connectionString;
  if (hyperdriveConnectionString) return createWorkerPostgresExecutor(hyperdriveConnectionString);

  const runtime = (globalThis as unknown as { Bun?: BunRuntime }).Bun;
  if (!runtime?.SQL) return createWorkerPostgresExecutor(databaseUrl);
  let client = bunSqlClients.get(databaseUrl);
  if (!client) {
    client = new runtime.SQL(databaseUrl);
    bunSqlClients.set(databaseUrl, client);
  }
  return {
    query: (statement, parameters) => client.unsafe(statement, parameters),
    // Bun.SQL owns a process-wide pool; request-scoped executors must not close it.
    close: () => undefined,
    transaction: client.begin
      ? (fn) =>
          client.begin!(async (transaction) =>
            fn({
              query: (statement, parameters) => transaction.unsafe(statement, parameters),
              close: () => undefined,
            }),
          )
      : undefined,
  };
}

export { getRuntimeDatabaseUrl };
