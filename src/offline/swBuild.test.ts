// The build's half: which files the worker keeps, the version their bytes make, and /sw.js with the kill switch on and
// off. The real build runs it in tests/e2e/global-setup.ts (and its output in the browser).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildVersion, filesUnder, listenersOf, precacheList, PUBLIC_PRECACHE, staticPages, supabaseOriginOf, workerScriptFor } from "./swBuild";

const files = [
  { name: "index.html", bytes: "<html>" },
  { name: "assets/index-AAAA.js", bytes: "a" },
  { name: "assets/index-BBBB.css", bytes: "b" },
  { name: "assets/ReaderScreen-CCCC.js", bytes: "c" }, // a lazy chunk
  { name: "assets/worker-DDDD.js", bytes: "d" }, // the reader's worker
  { name: "assets/index-AAAA.js.map", bytes: "m" },
  { name: "favicon.svg", bytes: "<svg>" },
  { name: "manifest.webmanifest", bytes: "{}" },
];

describe("precacheList", () => {
  it("index.html as «/», first; every emitted file but maps, other pages, the worker and Cloudflare's config", () => {
    expect(precacheList([...files.map((f) => f.name), "sw.js", "_headers", "_redirects", "privacy.html", ".vite/manifest.json"])).toEqual([
      "/",
      "/assets/ReaderScreen-CCCC.js",
      "/assets/index-AAAA.js",
      "/assets/index-BBBB.css",
      "/assets/worker-DDDD.js",
      "/favicon.svg",
      "/manifest.webmanifest",
    ]);
  });
});

describe("staticPages", () => {
  it("each HTML page in both spellings Cloudflare Pages answers — the .html (a 308) and the page's own address; a folder's index as the folder", () => {
    expect(staticPages(["privacy.html", "favicon.svg", "manifest.webmanifest", "_headers", "docs/terms.html", "help/index.html", "index.html"])).toEqual([
      "/docs/terms",
      "/docs/terms.html",
      "/help",
      "/help/",
      "/help/index.html",
      "/privacy",
      "/privacy.html",
    ]);
    expect(staticPages([])).toEqual([]);
  });
});

describe("buildVersion", () => {
  const v = buildVersion(files, "worker");
  it("is the same for the same files in any order", () => {
    expect(v).toMatch(/^[0-9a-f]{12}$/);
    expect(buildVersion([...files].reverse(), "worker")).toBe(v);
  });
  it("changes with any file's bytes, any name, or the worker's own source", () => {
    expect(buildVersion(files.map((f) => (f.name === "index.html" ? { ...f, bytes: "<html> " } : f)), "worker")).not.toBe(v);
    expect(buildVersion(files.map((f) => (f.name === "favicon.svg" ? { ...f, name: "icon.svg" } : f)), "worker")).not.toBe(v);
    expect(buildVersion(files, "worker2")).not.toBe(v);
    expect(buildVersion(files, "worker")).toBe(v);
  });
});

describe("workerScriptFor", () => {
  it("the shell: its cache named by the version, the Supabase origin from the build variable, four listeners", () => {
    const { script, config } = workerScriptFor(files, { enabled: true, supabaseUrl: "https://abcdefgh.supabase.co/", pages: ["/privacy", "/privacy.html"] });
    expect(config!.cache).toMatch(/^volozhin-shell-[0-9a-f]{12}$/);
    expect(config!.supabaseOrigin).toBe("https://abcdefgh.supabase.co");
    expect(config!.precache).toContain("/assets/worker-DDDD.js");
    expect(config!.pages).toEqual(["/privacy", "/privacy.html"]);
    expect(script).toContain(config!.cache);
    expect(listenersOf(script)).toEqual(["activate", "fetch", "install", "message"]);
    // a change to any file is a new cache: the old one goes on activate
    const next = workerScriptFor(files.map((f) => (f.name === "assets/index-AAAA.js" ? { ...f, bytes: "a2" } : f)), { enabled: true, pages: [] });
    expect(next.config!.cache).not.toBe(config!.cache);
    expect(next.config!.supabaseOrigin).toBeNull(); // a demo build
  });

  it("the kill switch: the self-unregistering worker, which answers nothing", () => {
    const { script, config } = workerScriptFor(files, { enabled: false, pages: ["/privacy", "/privacy.html"] });
    expect(config).toBeNull();
    expect(listenersOf(script)).toEqual(["activate", "install"]);
    expect(script).toContain("unregister");
  });

  it("a script that throws as it starts is caught by the check the build runs", () => {
    expect(() => listenersOf("self.addEventListener('install', () => {}); undefinedThing();")).toThrow();
  });
});

describe("supabaseOriginOf", () => {
  it("the origin, or null for no URL or a bad one", () => {
    expect(supabaseOriginOf("https://x.supabase.co/rest/v1")).toBe("https://x.supabase.co");
    expect(supabaseOriginOf(undefined)).toBeNull();
    expect(supabaseOriginOf("")).toBeNull();
    expect(supabaseOriginOf("not a url")).toBeNull();
  });
});

describe("the files Cloudflare serves beside the build", () => {
  const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

  /** public/_headers as Cloudflare reads it: a path at the start of a line, its headers indented under it. */
  function headers(): Map<string, Map<string, string>> {
    const out = new Map<string, Map<string, string>>();
    let cur: Map<string, string> | null = null;
    for (const line of read("public/_headers").split("\n")) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      if (!/^\s/.test(line)) out.set(line.trim(), (cur = new Map()));
      else {
        const [k, ...v] = line.trim().split(":");
        cur!.set(k.trim().toLowerCase(), v.join(":").trim());
      }
    }
    return out;
  }

  it("_headers: /sw.js never served from a cache (an update is seen), the manifest's type — and every header that was there", () => {
    const h = headers();
    expect(h.get("/sw.js")?.get("cache-control")).toBe("no-cache");
    expect(h.get("/manifest.webmanifest")?.get("content-type")).toBe("application/manifest+json");
    expect(Object.fromEntries(h.get("/*")!)).toEqual({
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    });
  });

  it("public/'s pages, as the build reads them: privacy.html in both spellings — every .html there, and nothing else", () => {
    const dir = fileURLToPath(new URL("../../public/", import.meta.url));
    const pages = staticPages(filesUnder(dir));
    expect(pages).toEqual(["/privacy", "/privacy.html"]);
    const html = readdirSync(dir).filter((n) => n.endsWith(".html"));
    expect(pages).toEqual(html.flatMap((n) => [`/${n.slice(0, -".html".length)}`, `/${n}`]).sort());
    expect(filesUnder(dir)).toEqual(expect.arrayContaining(["privacy.html", "favicon.svg", "_headers"]));
    expect(filesUnder("")).toEqual([]);
  });

  it("the manifest: Hebrew, right to left, the site's name and its icon; index.html links it", () => {
    const m = JSON.parse(read("public/manifest.webmanifest")) as Record<string, unknown> & { icons: { src: string }[] };
    expect(m).toMatchObject({ name: "שבוע וולוז'ין", lang: "he", dir: "rtl", start_url: "/", scope: "/", display: "standalone" });
    expect(m.icons.map((i) => i.src)).toEqual(["/favicon.svg"]);
    expect(existsSync(new URL("../../public/favicon.svg", import.meta.url))).toBe(true);
    expect(read("index.html")).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    for (const f of PUBLIC_PRECACHE) expect(existsSync(new URL(`../../public/${f}`, import.meta.url)), f).toBe(true);
  });
});
