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
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { CACHE_PREFIX } from "../../src/offline/config";
import { killWorkerScript } from "../../src/offline/sw";

export const MOCK_URL = "https://mock-project.supabase.invalid";
export const MOCK_KEY = "sb_publishable_mock";

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

// A static server with the SPA fallback Cloudflare Pages applies.
function serve(root: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
    let file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
    res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    if (path === "/sw.js") {
      res.setHeader("Cache-Control", "no-cache");
      res.end(workerFor(file, req.headers.cookie));
      return;
    }
    createReadStream(file).pipe(res);
  });
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
    demo.server.close();
    mock.server.close();
  };
}
