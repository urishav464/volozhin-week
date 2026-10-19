// Builds the app twice and serves both builds on local ports:
//   demo — no Supabase configured → synthetic data only
//   mock — pointed at MOCK_URL, a host that does not exist; the tests answer
//          every request to it by route interception, so the signed-in code
//          path runs for real with no account and no network.
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";

export const MOCK_URL = "https://mock-project.supabase.invalid";
export const MOCK_KEY = "sb_publishable_mock";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

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
