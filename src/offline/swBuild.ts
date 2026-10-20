// The build's half of the offline shell (node only — imported by vite.config.ts, never by the app): after the bundle
// is complete it lists every file the build emitted — index.html (as "/"), the hashed JS and CSS, the lazy chunks and
// the reader's worker — computes the build's version from their bytes, and writes /sw.js (unhashed, so the browser
// finds it at one address) from src/offline/sw.ts with that list and a cache name carrying the version. With the kill
// switch on (src/offline/config.ts) it writes the self-unregistering worker instead. Before emitting either it runs
// the script once on a stub scope, so a worker that would throw is a failed build, not a broken site. The static pages
// of public/ (privacy.html) it reads from the folder itself, in the spellings Cloudflare Pages answers for them, so the
// worker never answers one of them with the app shell (`staticPages`).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { runInNewContext } from "node:vm";
import type { Plugin } from "vite";
import { CACHE_PREFIX, FONT_CACHE, FONT_ORIGINS, NAVIGATE_TIMEOUT_MS, OFFLINE_SHELL_ENABLED, SHELL_CACHE_PREFIX, SKIP_WAITING } from "./config";
import { killWorkerScript, type ShellConfig, shellWorkerScript, workerSourceText } from "./sw";

/** The public files kept beside the build's own: the icon and the manifest (privacy.html stays a plain page). */
export const PUBLIC_PRECACHE = ["favicon.svg", "manifest.webmanifest"];

export interface BuiltFile {
  name: string;
  bytes: string | Uint8Array;
}

/**
 * What the worker caches at install, from the files' names: index.html as "/", every other emitted file but source
 * maps, other HTML pages, the worker itself and Cloudflare's own config files.
 */
export function precacheList(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (n === "index.html") out.add("/");
    else if (n.endsWith(".map") || n.endsWith(".html") || n === "sw.js" || n === "_headers" || n === "_redirects" || n.startsWith(".")) continue;
    else out.add(`/${n}`);
  }
  return [...out].sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The static pages Cloudflare Pages serves beside the app, from the names of public/'s files (relative to it, "/"
 * between folders): every HTML page in each spelling a navigation to it can take — its .html address, which Cloudflare
 * answers with a 308 to the address without the extension («pretty URLs»), and that address, which serves the page,
 * with a trailing slash too (typed by hand; privacy.html: /privacy.html, /privacy and /privacy/); a folder's
 * index.html as /d/index.html, /d/ and /d. public/index.html,
 * were there one, is the app's own page (the build's index.html), not a static page. The worker passes a navigation to
 * any of them to the network, never the app shell (src/offline/sw.ts routeFor).
 */
export function staticPages(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (!n.endsWith(".html") || n === "index.html") continue;
    out.add(`/${n}`);
    const bare = n.slice(0, -".html".length);
    if (bare === "index" || bare.endsWith("/index")) {
      const folder = bare.slice(0, -"index".length); // "d/"
      out.add(`/${folder}`);
      out.add(`/${folder.slice(0, -1)}`);
    } else {
      out.add(`/${bare}`);
      out.add(`/${bare}/`);
    }
  }
  return [...out].sort();
}

/** Every file under a folder (public/), as paths relative to it with "/" between folders; none when there is no folder. */
export function filesUnder(dir: string): string[] {
  if (!dir || !existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[]).filter((n) => statSync(join(dir, n)).isFile()).map((n) => n.split(sep).join("/"));
}

/** The build's version: a digest of every precached file's name and bytes, and of the worker's own source. */
export function buildVersion(files: readonly BuiltFile[], workerSource: string): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    h.update(f.name);
    h.update("\0");
    h.update(createHash("sha256").update(f.bytes).digest("hex"));
    h.update("\n");
  }
  h.update(workerSource);
  return h.digest("hex").slice(0, 12);
}

/** The Supabase project's origin from the build variable, or null (a demo build). */
export function supabaseOriginOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** /sw.js for these files: the shell's worker, or — with the switch off — the kill switch's. */
export function workerScriptFor(
  files: readonly BuiltFile[],
  opts: { enabled: boolean; supabaseUrl?: string; pages: readonly string[] },
): { script: string; config: ShellConfig | null } {
  if (!opts.enabled) return { script: killWorkerScript(CACHE_PREFIX), config: null };
  const precache = precacheList(files.map((f) => f.name));
  const kept = new Set(precache);
  const version = buildVersion(
    files.filter((f) => kept.has(f.name === "index.html" ? "/" : `/${f.name}`)),
    workerSourceText(),
  );
  const config: ShellConfig = {
    cache: `${SHELL_CACHE_PREFIX}${version}`,
    prefix: CACHE_PREFIX,
    fontCache: FONT_CACHE,
    fontOrigins: FONT_ORIGINS,
    precache,
    supabaseOrigin: supabaseOriginOf(opts.supabaseUrl),
    skipWaiting: SKIP_WAITING,
    navigateTimeoutMs: NAVIGATE_TIMEOUT_MS,
    pages: [...opts.pages],
  };
  return { script: shellWorkerScript(config), config };
}

/** Runs a worker script once on a stub scope and returns the events it listens to; throws if the script does. */
export function listenersOf(script: string): string[] {
  const events: string[] = [];
  const self = {
    location: { origin: "https://example.invalid" },
    addEventListener: (type: string) => events.push(type),
  };
  runInNewContext(script, { self, Request, Response, URL }, { timeout: 1000 });
  return events.sort();
}

/** The Vite plugin: writes /sw.js after everything else in the bundle exists. Production builds only. */
export function offlineShell(): Plugin {
  let publicDir = "";
  let supabaseUrl: string | undefined;
  return {
    name: "volozhin-offline-shell",
    apply: "build",
    enforce: "post",
    configResolved(c) {
      publicDir = c.publicDir;
      supabaseUrl = c.env.VITE_SUPABASE_URL as string | undefined;
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const files: BuiltFile[] = Object.values(bundle).map((f) => ({ name: f.fileName, bytes: f.type === "chunk" ? f.code : f.source }));
        for (const name of PUBLIC_PRECACHE) {
          const path = join(publicDir, name);
          if (publicDir && existsSync(path)) files.push({ name, bytes: readFileSync(path) });
        }
        if (!files.some((f) => f.name === "index.html")) this.error("offline shell: the bundle has no index.html");
        const { script } = workerScriptFor(files, { enabled: OFFLINE_SHELL_ENABLED, supabaseUrl, pages: staticPages(filesUnder(publicDir)) });
        const want = OFFLINE_SHELL_ENABLED ? ["activate", "fetch", "install", "message"] : ["activate", "install"];
        const got = listenersOf(script);
        if (got.join() !== want.join()) this.error(`offline shell: /sw.js listens to ${got.join()} — expected ${want.join()}`);
        this.emitFile({ type: "asset", fileName: "sw.js", source: script });
      },
    },
  };
}
