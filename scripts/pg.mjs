#!/usr/bin/env node
// A throwaway local PostgreSQL 16 for the SQL tests (no Supabase reachable from
// a sandbox). `up` initialises it on first use and starts it; `down` stops it.
// Prints the admin URL to export as PG_ADMIN_URL. CI uses a postgres:16
// service container instead and sets PG_ADMIN_URL itself.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, chownSync } from "node:fs";

const BIN = process.env.PG_BIN ?? "/usr/lib/postgresql/16/bin";
const DATA = process.env.PG_DATA ?? "/tmp/volozhin-pg";
const PORT = process.env.PG_PORT ?? "55433";
const SOCK = "/tmp";
const URL = `postgresql://postgres@localhost:${PORT}/postgres?host=${SOCK}`;

// initdb refuses to run as root; run the binaries as the `postgres` user then.
function asPostgres(args) {
  const isRoot = process.getuid?.() === 0;
  const q = (a) => `'${a.replaceAll("'", "'\\''")}'`;
  return isRoot
    ? spawnSync("su", ["postgres", "-c", args.map(q).join(" ")], { encoding: "utf8" })
    : spawnSync(args[0], args.slice(1), { encoding: "utf8" });
}

function running() {
  return asPostgres([`${BIN}/pg_ctl`, "-D", DATA, "status"]).status === 0;
}

const cmd = process.argv[2];
if (cmd === "up") {
  if (!existsSync(`${BIN}/pg_ctl`)) {
    console.error(`blocked: PostgreSQL 16 not found at ${BIN} (apt-get install postgresql-16 postgresql-contrib-16)`);
    process.exit(1);
  }
  if (!existsSync(`${DATA}/PG_VERSION`)) {
    mkdirSync(DATA, { recursive: true });
    if (process.getuid?.() === 0) {
      const uid = Number(execFileSync("id", ["-u", "postgres"]).toString());
      const gid = Number(execFileSync("id", ["-g", "postgres"]).toString());
      chownSync(DATA, uid, gid);
    }
    const r = asPostgres([`${BIN}/initdb`, "-D", DATA, "-A", "trust", "-E", "UTF8", "--locale=C.UTF-8", "-U", "postgres"]);
    if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  }
  if (!running()) {
    const r = asPostgres([`${BIN}/pg_ctl`, "-D", DATA, "-l", `${DATA}/server.log`, "-w",
      "-o", `-p ${PORT} -k ${SOCK} -c listen_addresses=''`, "start"]);
    if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
  }
  console.log(URL);
} else if (cmd === "down") {
  if (running()) asPostgres([`${BIN}/pg_ctl`, "-D", DATA, "-m", "fast", "stop"]);
  console.log("stopped");
} else {
  console.error("usage: node scripts/pg.mjs up|down");
  process.exit(2);
}
