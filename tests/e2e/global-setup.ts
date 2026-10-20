// Builds the app twice and serves both builds on local ports:
//   demo — no Supabase configured → synthetic data only
//   mock — pointed at MOCK_URL, a host that does not exist; the tests answer
//          every request to it by route interception, so the signed-in code
//          path runs for real with no account and no network.
// /sw.js is served as Cloudflare serves it (no-cache, public/_headers). A context
// carrying the cookie `e2e-sw=next` gets a changed /sw.js — what the next build's
// worker looks like to a browser that has this one (tests/e2e/offline.spec.ts);
// `e2e-sw=kill` gets the kill switch's worker (src/offline/sw.ts). Cookies are per
// context, so tests running side by side never see each other's worker.
// No connection, for real: context.setOffline does not reach a service worker's
// own fetches in this Chromium (they still get an answer), so a context carrying
// `e2e-net=down` has every connection dropped here — the worker's network-first
// navigation fails as it would with no network, and its cached shell is what the
// tests see. `e2e-net=hang` takes every request and never answers it: a network
// that accepts requests and stays silent; `e2e-net=slow` answers every request,
// SLOW_NET_MS late — later than the worker waits for a navigation
// (tests/e2e/offline.spec.ts).
// A page of the build is served as Cloudflare Pages serves it («pretty URLs»):
// /privacy.html is a 308 to /privacy, and /privacy is privacy.html.
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { CACHE_PREFIX } from "../../src/offline/config";
import { killWorkerScript } from "../../src/offline/sw";

export const MOCK_URL = "https://mock-project.supabase.invalid";
export const MOCK_KEY = "sb_publishable_mock";
/** How late `e2e-net=slow` answers: more than NAVIGATE_TIMEOUT_MS (src/offline/config.ts). */
export const SLOW_NET_MS = 5000;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

/** /sw.js as a context asks for it: this build's, the next build's (its cache renamed, its bytes changed), or the kill switch. */
export function workerFor(file: string, cookie: string | undefined): string {
  const variant = /(?:^|;\s*)e2e-sw=(next|kill)(?:;|$)/.exec(cookie ?? "")?.[1];
  if (variant === "kill") return killWorkerScript(CACHE_PREFIX);
  const script = readFileSync(file, "utf8");
  if (variant !== "next") return script;
  return `${script.replace(/(volozhin-shell-[0-9a-f]+)/g, "$1-next")}\n// the next build\n`;
}

function build(outDir: string, env: Record<string, string>) {
  execFileSync("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir"], {
    env: { ...process.env, ...env },
    stdio: "pipe",
  });
}

/** What a context's network is: as usual, gone (`down`), taking requests and never answering (`hang`), or late (`slow`). */
export function netFor(cookie: string | undefined): "up" | "down" | "hang" | "slow" {
  const v = /(?:^|;\s*)e2e-net=(down|hang|slow)(?:;|$)/.exec(cookie ?? "")?.[1];
  return v === "down" || v === "hang" || v === "slow" ? v : "up";
}

/**
 * Cloudflare Pages' «pretty URLs» for an HTML page of the build: its .html address is a 308 to the address without the
 * extension (a folder's index.html: to the folder), the query kept; that address serves the page. Anything else: null.
 */
export function prettyUrl(root: string, path: string, search: string): { redirect: string } | { file: string } | null {
  if (path.endsWith(".html")) {
    if (!existsSync(join(root, path))) return null;
    return { redirect: (path.endsWith("/index.html") ? path.slice(0, -"index.html".length) : path.slice(0, -".html".length)) + search };
  }
  if (extname(path) === "" && path !== "/" && existsSync(join(root, `${path}.html`))) return { file: join(root, `${path}.html`) };
  return null;
}

// A static server with the SPA fallback and the pretty URLs Cloudflare Pages applies.
function serve(root: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const net = netFor(req.headers.cookie);
    if (net === "down") return void req.socket.destroy();
    if (net === "hang") return void setTimeout(() => req.socket.destroy(), 60_000).unref(); // silent; let go in the end
    if (net === "slow") return void setTimeout(() => answer(req, res), SLOW_NET_MS).unref();
    answer(req, res);
  });
  function answer(req: IncomingMessage, res: ServerResponse) {
    if (req.socket.destroyed) return;
    const [rawPath, ...q] = (req.url ?? "/").split("?");
    const path = normalize(decodeURIComponent(rawPath));
    const pretty = prettyUrl(root, path, q.length ? `?${q.join("?")}` : "");
    if (pretty && "redirect" in pretty) {
      res.writeHead(308, { Location: pretty.redirect }).end();
      return;
    }
    let file = pretty ? pretty.file : join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
    res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    if (path === "/sw.js") {
      res.setHeader("Cache-Control", "no-cache");
      res.end(workerFor(file, req.headers.cookie));
      return;
    }
    createReadStream(file).pipe(res);
  }
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    }),
  );
}

export default async function globalSetup() {
  const root = join(process.cwd(), "dist-e2e");
  build(join(root, "demo"), { VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" });
  build(join(root, "mock"), { VITE_SUPABASE_URL: MOCK_URL, VITE_SUPABASE_PUBLISHABLE_KEY: MOCK_KEY });
  const demo = await serve(join(root, "demo"));
  const mock = await serve(join(root, "mock"));
  process.env.E2E_DEMO_URL = demo.url;
  process.env.E2E_MOCK_URL = mock.url;
  return async () => {
    for (const s of [demo.server, mock.server]) {
      s.closeAllConnections(); // a request a test left hanging
      s.close();
    }
  };
}
