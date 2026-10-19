// File-backed SQLite repository (issue #10): TypeORM EntitySchema over
// better-sqlite3, implementing exactly the same Store contract as the
// genuine in-memory repository (issue #9) so the entire shared domain runs
// unchanged on both adapters. The schema is created by a versioned,
// transactional migration (no boot-time synchronization, no destructive
// changes); constraint and cascade semantics mirror the memory store.

import { DataSource, EntityManager, EntitySchema, type EntitySchemaColumnOptions } from "typeorm";
import {
  primaryKeys,
  references,
  rowKey,
  StoreError,
  uniqueColumns,
  type Row,
  type Store,
  type Table,
} from "./types";

type ColumnKind = "text" | "integer" | "boolean" | "real";

/** Single source of truth for entities and DDL. */
const tables: Record<Table, Record<string, ColumnKind>> = {
  profiles: { id: "text", name: "text", email: "text", phone: "text", role: "text", verified: "boolean", active: "boolean", created_at: "text" },
  courses: { id: "text", name: "text", active: "boolean" },
  teachers: { id: "text", profile_id: "text", name: "text", subject: "text", color: "text", active: "boolean" },
  feedback: { id: "text", number: "integer", type: "text", title: "text", body: "text", course_id: "text", teacher_id: "text", custom_target: "text", anonymous: "boolean", author_name: "text", status: "text", outcome: "text", confirmed: "boolean", hidden: "boolean", hidden_reason: "text", deleted: "boolean", resolved_at: "text", created_at: "text", updated_at: "text" },
  feedback_access: { feedback_id: "text", profile_id: "text", recovery_email: "text", code_hash: "text" },
  sessions: { token_hash: "text", profile_id: "text", expires_at: "text", provider_session: "text" },
  guest_grants: { token_hash: "text", feedback_id: "text", expires_at: "text" },
  local_credentials: { profile_id: "text", password_hash: "text" },
  tokens: { token_hash: "text", purpose: "text", subject_id: "text", expires_at: "text" },
  official_replies: { id: "text", feedback_id: "text", profile_id: "text", body: "text", created_at: "text" },
  comments: { id: "text", feedback_id: "text", profile_id: "text", parent_id: "text", body: "text", deleted: "boolean", created_at: "text", updated_at: "text" },
  supports: { profile_id: "text", feedback_id: "text" },
  bookmarks: { profile_id: "text", feedback_id: "text" },
  ratings: { profile_id: "text", teacher_id: "text", stars: "integer", comment: "text", updated_at: "text" },
  status_history: { id: "text", feedback_id: "text", status: "text", outcome: "text", created_at: "text" },
  notifications: { id: "text", profile_id: "text", feedback_id: "text", title: "text", read_at: "text", created_at: "text" },
  attachments: { id: "text", feedback_id: "text", token_hash: "text", name: "text", size: "integer", mime: "text", object_path: "text", ready: "boolean", created_at: "text" },
  jobs: { id: "text", kind: "text", subject_id: "text", payload: "text", status: "text", attempts: "integer", available_at: "text", last_error: "text", created_at: "text" },
  moderation_flags: { id: "text", feedback_id: "text", reason: "text", source: "text", created_at: "text" },
  rate_limits: { key: "text", count: "integer", resets_at: "text" },
  submissions: { key: "text", feedback_id: "text" },
};

const SQLITE_TYPE: Record<ColumnKind, string> = {
  text: "TEXT",
  integer: "INTEGER",
  boolean: "INTEGER",
  real: "REAL",
};

function entities(): EntitySchema[] {
  return Object.entries(tables).map(([name, columns]) => {
    const definition: Record<string, EntitySchemaColumnOptions> = {};
    for (const [column, kind] of Object.entries(columns))
      definition[column] = {
        type: kind === "boolean" ? "boolean" : kind,
        primary: primaryKeys[name as Table].includes(column),
        nullable: !primaryKeys[name as Table].includes(column),
      };
    return new EntitySchema<Row>({
      name: `maxball_${name}`,
      tableName: name,
      columns: definition,
    });
  });
}

/** Version 1 DDL; future schema changes append version 2+, never rewrite. */
const MIGRATION_V1 = [
  ...Object.entries(tables).map(([name, columns]) => {
    const pk = primaryKeys[name as Table];
    const parts = Object.entries(columns).map(([column, kind]) => {
      const pkMark = pk.length === 1 && pk.includes(column) ? " PRIMARY KEY" : "";
      return `"${column}" ${SQLITE_TYPE[kind]}${pkMark}`;
    });
    if (pk.length > 1)
      parts.push(`PRIMARY KEY (${pk.map((c) => `"${c}"`).join(", ")})`);
    for (const column of uniqueColumns[name as Table] ?? [])
      parts.push(`UNIQUE("${column}")`);
    return `CREATE TABLE IF NOT EXISTS "${name}" (${parts.join(", ")})`;
  }),
  `CREATE TABLE IF NOT EXISTS store_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
];

export async function openSqliteStore(path?: string): Promise<SqliteStore> {
  const target = path ?? process.env.MAXBALL_SQLITE_PATH;
  if (!target)
    throw new StoreError("MAXBALL_SQLITE_PATH is required for the sqlite adapter.", "missing");
  const source = new DataSource({
    type: "better-sqlite3",
    database: target,
    entities: entities(),
    synchronize: false,
    // Transactions serialize through better-sqlite3's sync driver; busy
    // timeout absorbs brief writer contention from the local worker tick.
    prepareDatabase: (database) => {
      database.pragma("journal_mode = WAL");
      database.pragma("busy_timeout = 5000");
    },
  });
  await source.initialize();
  await source.transaction(async (manager) => {
    const applied = await manager.query(
      "SELECT version FROM store_migrations WHERE version = 1",
    ).catch(() => []);
    if (applied.length === 0) {
      for (const statement of MIGRATION_V1)
        await manager.query(statement);
      await manager.query(
        "INSERT INTO store_migrations(version, applied_at) VALUES (1, ?)",
        [new Date().toISOString()],
      );
    }
  });
  return new SqliteStore(source);
}

function keyObject(table: Table, key: string): Row {
  const columns = primaryKeys[table];
  const values = key.split("|");
  const object: Row = {};
  columns.forEach((column, index) => {
    object[column] = values[index];
  });
  return object;
}

function pkOf(table: Table, row: Row): Row {
  const object: Row = {};
  for (const column of primaryKeys[table]) object[column] = row[column];
  return object;
}

export class SqliteStore implements Store {
  constructor(
    private root: DataSource,
    private scope: DataSource | EntityManager = root,
  ) {}

  private repo(table: Table) {
    return (this.scope as EntityManager).getRepository<Row>(`maxball_${table}`);
  }

  async all(table: Table): Promise<Row[]> {
    return this.repo(table).find();
  }
  async get(table: Table, key: string): Promise<Row | undefined> {
    return (
      (await this.repo(table).findOneBy(
        keyObject(table, key) as never,
      )) ?? undefined
    );
  }
  async first(table: Table, match: Partial<Row>): Promise<Row | undefined> {
    return (await this.repo(table).find({ where: match as never }))[0];
  }
  async find(table: Table, match: Partial<Row>): Promise<Row[]> {
    return this.repo(table).find({ where: match as never });
  }

  private async assertInsert(table: Table, row: Row) {
    const repo = this.repo(table);
    const pk = pkOf(table, row);
    if (await repo.findOneBy(pk as never))
      throw new StoreError(`${table} primary key already exists`, "unique");
    for (const column of uniqueColumns[table] ?? []) {
      if (row[column] === null || row[column] === undefined) continue;
      if (
        await repo.findOneBy({ [column]: row[column] } as never)
      )
        throw new StoreError(`${table}.${column} must be unique`, "unique");
    }
    for (const reference of references[table] ?? []) {
      const value = row[reference.column];
      if (value === null || value === undefined) continue;
      const targetKey = rowKey(reference.table, {
        [primaryKeys[reference.table][0]]: value,
      });
      if (!(await this.get(reference.table, targetKey)))
        throw new StoreError(
          `${table}.${reference.column} references a missing ${reference.table} row`,
          "foreign",
        );
    }
    await repo.insert(row as never);
  }

  async insert(table: Table, row: Row): Promise<void> {
    await this.assertInsert(table, row);
  }

  async update(table: Table, key: string, patch: Row): Promise<void> {
    const repo = this.repo(table);
    const existing = await this.get(table, key);
    if (!existing) throw new StoreError(`${table} row not found`, "missing");
    const next = { ...existing, ...patch };
    for (const column of uniqueColumns[table] ?? []) {
      if (next[column] === null || next[column] === undefined) continue;
      const clash = await repo.findOneBy({ [column]: next[column] } as never);
      if (clash && rowKey(table, clash) !== key)
        throw new StoreError(`${table}.${column} must be unique`, "unique");
    }
    await repo.update(keyObject(table, key) as never, patch as never);
  }

  async delete(table: Table, key: string): Promise<Row | undefined> {
    const row = await this.get(table, key);
    if (!row) return undefined;
    await this.cascadeLocked(table, row);
    return row;
  }

  async deleteWhere(table: Table, match: Partial<Row>): Promise<Row[]> {
    const removed: Row[] = [];
    for (const row of await this.repo(table).find({ where: match as never })) {
      await this.cascadeLocked(table, row);
      removed.push(row);
    }
    return removed;
  }

  /** Same CASCADE / SET NULL parity as the memory repository. */
  private async cascadeLocked(table: Table, row: Row) {
    await this.repo(table).delete(pkOf(table, row) as never);
    const value = row[primaryKeys[table][0]];
    for (const [other, list] of Object.entries(references) as [
      Table,
      NonNullable<(typeof references)[Table]>,
    ][])
      for (const reference of list) {
        if (reference.table !== table) continue;
        const column = reference.column;
        if (reference.onDelete === "set-null") {
          for (const child of await this.repo(other).find({
            where: { [column]: value } as never,
          }))
            await this.repo(other).update(pkOf(other, child) as never, {
              [column]: null,
            } as never);
        } else if (reference.onDelete === "cascade") {
          for (const child of await this.repo(other).find({
            where: { [column]: value } as never,
          }))
            await this.cascadeLocked(other, child);
        }
      }
  }

  /**
   * Feedback numbers must never repeat. The database maximum is the source
   * of truth across processes; the in-process claim keeps consecutive calls
   * monotonic within one process, matching the memory adapter's counter.
   */
  private claimed = 1000;
  async nextNumber(): Promise<number> {
    const rows: { value: number }[] = await (
      this.scope as EntityManager
    ).query("SELECT COALESCE(MAX(number), 1000) AS value FROM feedback");
    this.claimed = Math.max(this.claimed, Number(rows[0].value)) + 1;
    return this.claimed;
  }

  transaction<T>(work: (tx: Store) => Promise<T>): Promise<T> {
    return this.root.transaction(async (manager) =>
      work(new SqliteStore(this.root, manager)),
    );
  }
}
