import { PGlite } from "@electric-sql/pglite";
import { Pool, type PoolClient } from "pg";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { seed } from "./seed";
import { postgresOptions } from "./pg-config";

export interface Database {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  transaction<T>(action: (db: Database) => Promise<T>): Promise<T>;
}
export const localMode = () =>
  !process.env.DATABASE_URL &&
  process.env.NODE_ENV !== "production" &&
  !process.env.VERCEL;
const globals = globalThis as unknown as { maxballDb?: Promise<Database> };

export function database(): Promise<Database> {
  return (globals.maxballDb ??= initialize());
}

async function initialize(): Promise<Database> {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      ...postgresOptions(process.env.DATABASE_URL),
      max: 3,
    });
    const wrap = (client: Pool | PoolClient): Database => ({
      query: async <T>(sql: string, params: unknown[] = []) =>
        (await client.query(sql, params)).rows as T[],
      transaction: async <T>(action: (db: Database) => Promise<T>) => {
        const connection = await pool.connect();
        try {
          await connection.query("BEGIN");
          const result = await action(wrap(connection));
          await connection.query("COMMIT");
          return result;
        } catch (error) {
          await connection.query("ROLLBACK");
          throw error;
        } finally {
          connection.release();
        }
      },
    });
    return wrap(pool);
  }
  if (!localMode())
    throw new Error("Жария ортада DATABASE_URL бапталуы қажет.");
  await mkdir(path.join(process.cwd(), ".local"), { recursive: true });
  const engine = new PGlite(path.join(process.cwd(), ".local", "postgres"));
  await engine.waitReady;
  const wrap = (client: Pick<PGlite, "query">): Database => ({
    query: async <T>(sql: string, params: unknown[] = []) =>
      (await client.query(sql, params)).rows as T[],
    transaction: async <T>(action: (db: Database) => Promise<T>) =>
      engine.transaction((tx) => action(wrap(tx))),
  });
  const schema = await readFile(
    path.join(process.cwd(), "supabase/migrations/202610190001_initial.sql"),
    "utf8",
  );
  await engine.exec(schema);
  const db = wrap(engine);
  await seed(db);
  return db;
}
