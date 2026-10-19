import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import { postgresOptions } from "../src/server/pg-config.ts";

try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
function env(name: string) {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required in the protected environment.`);
  return value;
}
const command = process.argv[2];
if (!["migrate", "storage", "owner"].includes(command))
  throw new Error("Use: npm run setup -- migrate|storage|owner");
const pool = new Pool({ ...postgresOptions(env("DATABASE_URL")), max: 1 });
try {
  if (command === "migrate") {
    const source = await readFile(
      new URL(
        "../supabase/migrations/202610190001_initial.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const checksum = createHash("sha256").update(source).digest("hex");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('maxball-migrations'))",
      );
      await client.query(
        "CREATE SCHEMA IF NOT EXISTS private; REVOKE ALL ON SCHEMA private FROM PUBLIC; CREATE TABLE IF NOT EXISTS private.migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now()); REVOKE ALL ON private.migrations FROM PUBLIC",
      );
      const existing = (
        await client.query(
          "SELECT checksum FROM private.migrations WHERE name=$1",
          ["202610190001_initial"],
        )
      ).rows[0];
      if (existing && existing.checksum !== checksum)
        throw new Error(
          "Applied migration changed. Create a new migration instead.",
        );
      if (!existing) {
        await client.query(source);
        await client.query(
          "INSERT INTO private.migrations(name,checksum) VALUES($1,$2)",
          ["202610190001_initial", checksum],
        );
      }
      await client.query("COMMIT");
      console.log(
        existing
          ? "Database already up to date."
          : "Database migration applied. No demo data inserted.",
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } else {
    const auth = createClient(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    if (command === "storage") {
      const bucket =
        process.env.SUPABASE_STORAGE_BUCKET || "feedback-attachments";
      const current = await auth.storage.getBucket(bucket);
      const result = current.data
        ? await auth.storage.updateBucket(bucket, {
            public: false,
            fileSizeLimit: 20971520,
          })
        : await auth.storage.createBucket(bucket, {
            public: false,
            fileSizeLimit: 20971520,
          });
      if (result.error)
        throw new Error("Private storage setup failed. Check service access.");
      console.log(
        "Private attachment bucket ready, 20 MB per file, no MIME restrictions.",
      );
    } else {
      const email = env("OWNER_EMAIL").trim().toLowerCase(),
        name = env("OWNER_NAME").trim(),
        phone = env("OWNER_PHONE").trim();
      if (name.length < 2 || phone.length < 8)
        throw new Error("Valid owner name and phone are required.");
      const leaders = await pool.query(
        "SELECT email FROM profiles WHERE role='leadership' AND active",
      );
      if (leaders.rows.some((p) => p.email !== email))
        throw new Error(
          "An owner already exists. Add further staff through the application.",
        );
      let id: string | undefined;
      for (let page = 1; page <= 20; page++) {
        const result = await auth.auth.admin.listUsers({ page, perPage: 1000 });
        if (result.error) throw new Error("Cannot list Auth users.");
        id = result.data.users.find(
          (u) => u.email?.toLowerCase() === email,
        )?.id;
        if (id || result.data.users.length < 1000) break;
      }
      if (!id) {
        const result = await auth.auth.admin.inviteUserByEmail(email, {
          data: { name, phone },
          redirectTo: env("APP_URL"),
        });
        if (result.error || !result.data.user)
          throw new Error(
            "Owner invitation failed. Check Auth SMTP and redirect settings.",
          );
        id = result.data.user.id;
      }
      await pool.query(
        "INSERT INTO profiles(id,name,email,phone,role) VALUES($1,$2,$3,$4,'leadership') ON CONFLICT(id) DO UPDATE SET role='leadership',active=true,name=excluded.name,phone=excluded.phone",
        [id, name, email, phone],
      );
      console.log(
        "First leadership profile prepared. Complete the email invitation personally; no password was generated or displayed.",
      );
    }
  }
} finally {
  await pool.end();
}
