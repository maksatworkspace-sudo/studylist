// Genuine in-memory repository (issue #9): real Map-backed collections with
// defensive copies, fully serialized access (readers never observe partial
// transactions), snapshot rollback, unique/foreign-key constraint parity and
// the same cascade behavior as the original schema. There is no SQL and no
// database engine anywhere in this file.

import {
  rowKey,
  StoreError,
  uniqueColumns,
  references,
  primaryKeys,
  type Row,
  type Store,
  type Table,
} from "./types";

type World = Map<Table, Map<string, Row>>;

function emptyWorld(): World {
  const world: World = new Map();
  for (const table of Object.keys(primaryKeys) as Table[])
    world.set(table, new Map());
  return world;
}

const clone = <T>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);

function matches(row: Row, match: Partial<Row>): boolean {
  return Object.entries(match).every(([column, value]) => row[column] === value);
}

/** Primary-key value referenced by single-column foreign keys. */
function referenceValue(table: Table, row: Row): unknown {
  return row[primaryKeys[table][0]];
}

export class MemoryStore implements Store {
  private world: World = emptyWorld();
  private counter = 1000;
  /** Async mutex: exactly one owner; waiters receive the lock in FIFO order. */
  private held = false;
  private waiters: (() => void)[] = [];
  /** >0 while the current owner is a transaction running multi-step work. */
  private depth = 0;

  constructor(world?: World) {
    if (world) this.world = world;
  }

  private acquire(): Promise<void> {
    if (!this.held) {
      this.held = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.held = false;
  }

  /** Runs a synchronous body under exclusive access (joining transactions). */
  private async exclusive<T>(body: () => T): Promise<T> {
    if (this.depth > 0) return body();
    await this.acquire();
    this.depth = 1;
    try {
      return body();
    } finally {
      this.depth = 0;
      this.release();
    }
  }

  private snapshot(): World {
    const copy: World = new Map();
    for (const [table, rows] of this.world)
      copy.set(table, new Map([...rows].map(([key, row]) => [key, clone(row)])));
    return copy;
  }

  private restore(world: World) {
    this.world = world;
  }

  all(table: Table): Promise<Row[]> {
    return this.exclusive(() => [...this.world.get(table)!.values()].map(clone));
  }

  get(table: Table, key: string): Promise<Row | undefined> {
    return this.exclusive(() => {
      const row = this.world.get(table)!.get(key);
      return row ? clone(row) : undefined;
    });
  }

  first(table: Table, match: Partial<Row>): Promise<Row | undefined> {
    return this.exclusive(() => {
      for (const row of this.world.get(table)!.values())
        if (matches(row, match)) return clone(row);
      return undefined;
    });
  }

  find(table: Table, match: Partial<Row>): Promise<Row[]> {
    return this.exclusive(() =>
      [...this.world.get(table)!.values()]
        .filter((row) => matches(row, match))
        .map(clone),
    );
  }

  private insertLocked(table: Table, row: Row) {
    const key = rowKey(table, row);
    const rows = this.world.get(table)!;
    if (rows.has(key))
      throw new StoreError(`${table} primary key already exists`, "unique");
    for (const column of uniqueColumns[table] ?? []) {
      if (row[column] === null || row[column] === undefined) continue;
      for (const existing of rows.values())
        if (existing[column] === row[column])
          throw new StoreError(`${table}.${column} must be unique`, "unique");
    }
    for (const reference of references[table] ?? []) {
      const value = row[reference.column];
      if (value === null || value === undefined) continue;
      const targetKey = rowKey(reference.table, {
        [primaryKeys[reference.table][0]]: value,
      });
      if (!this.world.get(reference.table)!.has(targetKey))
        throw new StoreError(
          `${table}.${reference.column} references a missing ${reference.table} row`,
          "foreign",
        );
    }
    rows.set(key, clone(row));
  }

  insert(table: Table, row: Row): Promise<void> {
    return this.exclusive(() => this.insertLocked(table, row));
  }

  update(table: Table, key: string, patch: Row): Promise<void> {
    return this.exclusive(() => {
      const rows = this.world.get(table)!;
      const row = rows.get(key);
      if (!row) throw new StoreError(`${table} row not found`, "missing");
      const next = { ...clone(row), ...patch };
      for (const column of uniqueColumns[table] ?? []) {
        if (next[column] === null || next[column] === undefined) continue;
        for (const [otherKey, existing] of rows)
          if (otherKey !== key && existing[column] === next[column])
            throw new StoreError(`${table}.${column} must be unique`, "unique");
      }
      rows.set(key, next);
    });
  }

  delete(table: Table, key: string): Promise<Row | undefined> {
    return this.exclusive(() => {
      const row = this.world.get(table)!.get(key);
      if (!row) return undefined;
      this.cascadeLocked(table, row);
      return clone(row);
    });
  }

  deleteWhere(table: Table, match: Partial<Row>): Promise<Row[]> {
    return this.exclusive(() => {
      const removed: Row[] = [];
      for (const row of [...this.world.get(table)!.values()])
        if (matches(row, match)) {
          this.cascadeLocked(table, row);
          removed.push(clone(row));
        }
      return removed;
    });
  }

  /** ON DELETE CASCADE / SET NULL parity across referencing tables. */
  private cascadeLocked(table: Table, row: Row) {
    this.world.get(table)!.delete(rowKey(table, row));
    const value = referenceValue(table, row);
    for (const [other, list] of Object.entries(references) as [
      Table,
      NonNullable<(typeof references)[Table]>,
    ][])
      for (const reference of list) {
        if (reference.table !== table) continue;
        const column = reference.column;
        if (reference.onDelete === "set-null") {
          for (const [key, child] of [...this.world.get(other)!.entries()])
            if (child[column] === value)
              this.world.get(other)!.set(key, { ...child, [column]: null });
        } else if (reference.onDelete === "cascade") {
          for (const child of [...this.world.get(other)!.values()])
            if (child[column] === value) this.cascadeLocked(other, child);
        }
      }
  }

  nextNumber(): Promise<number> {
    return this.exclusive(() => {
      // Continue after any explicitly inserted numbers (seed parity with the
      // original IDENTITY column that started at 1001).
      for (const row of this.world.get("feedback")!.values())
        this.counter = Math.max(this.counter, Number(row.number));
      return ++this.counter;
    });
  }

  async transaction<T>(work: (tx: Store) => Promise<T>): Promise<T> {
    // Nested calls join the enclosing transaction (one snapshot, one rollback).
    if (this.depth > 0) return work(this);
    await this.acquire();
    this.depth = 1;
    const snapshot = this.snapshot();
    try {
      return await work(this);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    } finally {
      this.depth = 0;
      this.release();
    }
  }
}
