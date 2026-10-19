// Storage contract for issue #9/#10: every backend (genuine in-memory
// collections now, TypeORM + better-sqlite3 next) implements the same
// table-oriented Store. Domain code never writes SQL — authorization,
// validation, privacy and small-data aggregation live in the shared domain
// modules and operate on whole-table reads and keyed writes.
//
// Keys: single-PK tables use the row id; composite-PK tables
// (supports, bookmarks, ratings, guest_grants, submissions) use the joined
// "a|b" form of their primary-key columns.

export type Table =
  | "profiles"
  | "courses"
  | "teachers"
  | "feedback"
  | "feedback_access"
  | "sessions"
  | "guest_grants"
  | "local_credentials"
  | "tokens"
  | "official_replies"
  | "comments"
  | "supports"
  | "bookmarks"
  | "ratings"
  | "status_history"
  | "notifications"
  | "attachments"
  | "jobs"
  | "moderation_flags"
  | "rate_limits"
  | "submissions";

export type Row = Record<string, unknown>;

export interface Store {
  /** Every row of a table, as a fresh deep copy (small-data application). */
  all(table: Table): Promise<Row[]>;
  /** Primary-key lookup. */
  get(table: Table, key: string): Promise<Row | undefined>;
  /** First row matching all given column equalities. */
  first(table: Table, match: Partial<Row>): Promise<Row | undefined>;
  /** All rows matching all given column equalities, fresh copies. */
  find(table: Table, match: Partial<Row>): Promise<Row[]>;
  /**
   * Inserts a complete row. Throws StoreError on unique/PK conflicts and
   * (for the memory backend) foreign-key violations with cascade parity.
   */
  insert(table: Table, row: Row): Promise<void>;
  /** Merges a patch into the row with the given primary key (404 if absent). */
  update(table: Table, key: string, patch: Row): Promise<void>;
  /** Deletes by primary key; returns the removed row (cascades applied). */
  delete(table: Table, key: string): Promise<Row | undefined>;
  /** Deletes every row matching the equalities; returns the removed rows. */
  deleteWhere(table: Table, match: Partial<Row>): Promise<Row[]>;
  /** Feedback numbers start at 1001 and never repeat within a store. */
  nextNumber(): Promise<number>;
  /**
   * Serialized transaction: reads inside never observe partial writes of
   * other transactions; a rejection rolls every change back.
   */
  transaction<T>(work: (tx: Store) => Promise<T>): Promise<T>;
}

export class StoreError extends Error {
  constructor(
    message: string,
    public code: "unique" | "missing" | "foreign",
  ) {
    super(message);
  }
}

/** Primary-key column(s) per table ("a|b" for composite keys). */
export const primaryKeys: Record<Table, readonly string[]> = {
  profiles: ["id"],
  courses: ["id"],
  teachers: ["id"],
  feedback: ["id"],
  feedback_access: ["feedback_id"],
  sessions: ["token_hash"],
  guest_grants: ["token_hash", "feedback_id"],
  local_credentials: ["profile_id"],
  tokens: ["token_hash"],
  official_replies: ["id"],
  comments: ["id"],
  supports: ["profile_id", "feedback_id"],
  bookmarks: ["profile_id", "feedback_id"],
  ratings: ["profile_id", "teacher_id"],
  status_history: ["id"],
  notifications: ["id"],
  attachments: ["id"],
  jobs: ["id"],
  moderation_flags: ["id"],
  rate_limits: ["key"],
  submissions: ["key"],
};

export function rowKey(table: Table, row: Partial<Row>): string {
  return primaryKeys[table]
    .map((column) => String(row[column]))
    .join("|");
}

/** Unique constraints beyond the primary key. */
export const uniqueColumns: Partial<Record<Table, readonly string[]>> = {
  profiles: ["email"],
  courses: ["name"],
  teachers: ["profile_id"],
  attachments: ["object_path"],
};

/**
 * Foreign-key graph with the same cascade behavior as the original schema:
 * most references cascade on delete; attachments.token_hash detaches (SET
 * NULL); teachers.profile_id and feedback catalog references must simply
 * exist on insert.
 */
export const references: Partial<
  Record<Table, { table: Table; column: string; onDelete?: "cascade" | "set-null" }[]>
> = {
  teachers: [{ table: "profiles", column: "profile_id" }],
  feedback: [
    { table: "courses", column: "course_id" },
    { table: "teachers", column: "teacher_id" },
  ],
  feedback_access: [
    { table: "feedback", column: "feedback_id", onDelete: "cascade" },
    { table: "profiles", column: "profile_id" },
  ],
  sessions: [{ table: "profiles", column: "profile_id", onDelete: "cascade" }],
  guest_grants: [
    { table: "sessions", column: "token_hash", onDelete: "cascade" },
    { table: "feedback", column: "feedback_id", onDelete: "cascade" },
  ],
  local_credentials: [
    { table: "profiles", column: "profile_id", onDelete: "cascade" },
  ],
  tokens: [],
  official_replies: [
    { table: "feedback", column: "feedback_id", onDelete: "cascade" },
    { table: "profiles", column: "profile_id" },
  ],
  comments: [
    { table: "feedback", column: "feedback_id", onDelete: "cascade" },
    { table: "profiles", column: "profile_id" },
    { table: "comments", column: "parent_id" },
  ],
  supports: [
    { table: "profiles", column: "profile_id", onDelete: "cascade" },
    { table: "feedback", column: "feedback_id", onDelete: "cascade" },
  ],
  bookmarks: [
    { table: "profiles", column: "profile_id", onDelete: "cascade" },
    { table: "feedback", column: "feedback_id", onDelete: "cascade" },
  ],
  ratings: [
    { table: "profiles", column: "profile_id", onDelete: "cascade" },
    { table: "teachers", column: "teacher_id", onDelete: "cascade" },
  ],
  status_history: [
    { table: "feedback", column: "feedback_id", onDelete: "cascade" },
  ],
  notifications: [
    { table: "profiles", column: "profile_id", onDelete: "cascade" },
    { table: "feedback", column: "feedback_id", onDelete: "cascade" },
  ],
  attachments: [
    { table: "feedback", column: "feedback_id", onDelete: "cascade" },
    { table: "sessions", column: "token_hash", onDelete: "set-null" },
  ],
  moderation_flags: [
    { table: "feedback", column: "feedback_id", onDelete: "cascade" },
  ],
  submissions: [{ table: "feedback", column: "feedback_id", onDelete: "cascade" }],
};
