#!/usr/bin/env node
// Fails (exit 1) if a tracked file — or, with --dir, a built bundle — contains
// something that looks like personal data or a secret: an Israeli phone number,
// an e-mail address outside the allow-list, or a Supabase secret / JWT.
//
//   node scripts/pii-scan.mjs              # every file git tracks
//   node scripts/pii-scan.mjs --dir dist   # every file under dist/
//
// Personal data belongs in the database only. If this trips on something that
// is genuinely not personal, add it to ALLOWED_EMAIL_DOMAINS or SKIP below —
// never weaken the patterns.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PATTERNS = [
  {
    name: "Israeli phone",
    // 05x / 0x landlines / 07x, with or without +972, separated by spaces or dashes.
    re: /(?<![\d.])(?:\+972[\s-]?|0)(?:5\d|7[2-9]|[2-489])[\s-]?\d{3}[\s-]?\d{4}(?![\d])/g,
  },
  { name: "e-mail", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { name: "Supabase secret key", re: /sb_secret_[A-Za-z0-9_-]{8,}/g },
  { name: "JWT", re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
];

// Placeholder and machine addresses only.
const ALLOWED_EMAIL_DOMAINS = [
  /@example\.(org|com|net)$/i,
  /\.invalid$/i,
  /^noreply@anthropic\.com$/i,
  /@users\.noreply\.github\.com$/i,
];

// Lock files carry integrity hashes; binaries are not text.
const SKIP = [/(^|\/)package-lock\.json$/, /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|tgz|gz|zip)$/i];

function files() {
  const i = process.argv.indexOf("--dir");
  if (i === -1) return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(process.argv[i + 1]);
  return out;
}

const mask = (s) => (s.length <= 4 ? "****" : `${s.slice(0, 2)}…${s.slice(-2)}`);

let hits = 0;
for (const file of files()) {
  if (SKIP.some((r) => r.test(file))) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  lines.forEach((line, n) => {
    for (const { name, re } of PATTERNS) {
      for (const m of line.matchAll(re)) {
        if (name === "e-mail" && ALLOWED_EMAIL_DOMAINS.some((r) => r.test(m[0]))) continue;
        hits++;
        console.error(`${file}:${n + 1}: ${name} (${mask(m[0])})`);
      }
    }
  });
}

if (hits) {
  console.error(`\n${hits} possible personal-data or secret hit(s). Personal data lives in the database only.`);
  process.exit(1);
}
console.log("pii-scan: clean");
