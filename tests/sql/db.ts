// Helpers for the SQL tests: a fresh database per suite, Supabase's starting
// state, and a way to act as the roles a browser gets.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const SCHEMA = readFileSync(`${ROOT}supabase/schema.sql`, "utf8");
const BOOTSTRAP = readFileSync(`${ROOT}tests/sql/bootstrap.sql`, "utf8");

// Projects created before mid-2026 hand the public roles everything in
// `public`, now and for every object created later. The schema must be safe
// under both that and the newer "nothing by default".
export const OLD_SUPABASE_DEFAULTS = `
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables    in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export type Regime = "old" | "new";

export function adminUrl(): string {
  const url = process.env.PG_ADMIN_URL;
  if (!url) {
    throw new Error("PG_ADMIN_URL is not set — run `npm run pg:up` and export the URL it prints");
  }
  return url;
}

function urlFor(db: string): string {
  const u = new URL(adminUrl());
  u.pathname = `/${db}`;
  return u.toString();
}

export async function freshDatabase(name: string, regime: Regime): Promise<pg.Client> {
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  // the tests' refusals are expected ERRORs: unlogged, so the server's log (CI prints it after the tests) stays short
  // enough to leave vitest's own output readable
  await admin.query(`alter database ${name} set log_min_messages = fatal`);
  await admin.end();
  const client = new pg.Client({ connectionString: urlFor(name) });
  await client.connect();
  await client.query(BOOTSTRAP);
  if (regime === "old") await client.query(OLD_SUPABASE_DEFAULTS);
  return client;
}

export async function dropDatabase(client: pg.Client, name: string): Promise<void> {
  await client.end();
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
}

export type Claims = Record<string, unknown>;

export function google(email: string): Claims {
  return {
    sub: "00000000-0000-4000-8000-000000000001",
    role: "authenticated",
    email,
    app_metadata: { provider: "google", providers: ["google"] },
  };
}

export function emailPassword(email: string): Claims {
  return {
    sub: "00000000-0000-4000-8000-000000000002",
    role: "authenticated",
    email,
    app_metadata: { provider: "email", providers: ["email"] },
  };
}

/** A password session on an account that ALSO has Google linked — must still be refused. */
export function linkedPassword(email: string): Claims {
  return {
    sub: "00000000-0000-4000-8000-000000000003",
    role: "authenticated",
    email,
    app_metadata: { provider: "email", providers: ["email", "google"] },
    amr: [{ method: "password", timestamp: 1 }],
  };
}

// Run `fn` as `role` with the given JWT claims, inside a transaction that is
// always rolled back — so a test can try writes without leaving traces. Each
// statement runs under its own savepoint, so a refused one does not abort the
// statements after it.
export async function as<T>(
  client: pg.Client,
  role: "anon" | "authenticated",
  claims: Claims | null,
  fn: (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [claims ? JSON.stringify(claims) : ""]);
    const q = async (sql: string, params?: unknown[]) => {
      await client.query("savepoint stmt");
      try {
        const r = await client.query(sql, params as unknown[]);
        await client.query("release savepoint stmt");
        return r;
      } catch (e) {
        await client.query("rollback to savepoint stmt");
        throw e;
      }
    };
    return await fn(q);
  } finally {
    await client.query("rollback");
  }
}

// The SQLSTATE of a failed query (or "ok").
export async function sqlstate(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}
