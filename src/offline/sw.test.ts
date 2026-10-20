// The service worker on a fake worker scope — the very functions /sw.js inlines (src/offline/sw.ts), and the inlined
// script itself run in a fresh context: what it answers and what it never touches, install, activate, the update's
// message, the kill switch. The browser runs them for real in tests/e2e/offline.spec.ts.
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { FONT_CACHE, FONT_ORIGINS } from "./config";
import { killWorker, killWorkerScript, type RequestLike, routeFor, type ShellConfig, shellWorker, shellWorkerScript, type WorkerScope } from "./sw";

const ORIGIN = "https://volozhin.example";
const SUPABASE = "https://abcdefgh.supabase.co";
const cfg: ShellConfig = {
  cache: "volozhin-shell-v2",
  prefix: "volozhin-",
  fontCache: FONT_CACHE,
  fontOrigins: FONT_ORIGINS,
  precache: ["/", "/assets/index-AAAA.js", "/assets/index-BBBB.css", "/assets/worker-CCCC.js", "/favicon.svg", "/manifest.webmanifest"],
  supabaseOrigin: SUPABASE,
  skipWaiting: "skip-waiting",
  navigateTimeoutMs: 3500,
};

/** A request as the worker sees it. */
const req = (url: string, o: { method?: string; mode?: string; headers?: Record<string, string> } = {}): RequestLike & Request =>
  ({ url: new URL(url, ORIGIN).href, method: o.method ?? "GET", mode: o.mode ?? "cors", headers: new Headers(o.headers ?? {}) }) as never;

/** A response the worker can read: ok, type, its Content-Type, clone. */
interface FakeResponse {
  body: string;
  ok: boolean;
  type: string;
  headers: { get(name: string): string | null };
  clone(): FakeResponse;
}
const res = (body: string, type = "basic", ok = true, contentType = "text/javascript"): FakeResponse => ({
  body,
  ok,
  type,
  headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? contentType : null) },
  clone: () => res(body, type, ok, contentType),
});
/** What the static server sends for a path: a page is HTML, a script is JavaScript. */
const typeOf = (u: string) => (/\.js$/.test(new URL(u).pathname) ? "text/javascript" : /\.(css|svg|webmanifest)$/.test(new URL(u).pathname) ? "text/css" : "text/html; charset=utf-8");

class FakeCache {
  readonly map = new Map<string, FakeResponse>();
  private key(r: Request | string) {
    return new URL(typeof r === "string" ? r : r.url, ORIGIN).href;
  }
  async match(r: Request | string) {
    return this.map.get(this.key(r));
  }
  async put(r: Request | string, v: FakeResponse) {
    this.map.set(this.key(r), v);
  }
}

function scope() {
  const listeners = new Map<string, (e: never) => void>();
  const caches = new Map<string, FakeCache>();
  const online = { on: true };
  /** Paths the server no longer has: Cloudflare Pages' SPA fallback answers them with index.html, 200. */
  const gone = new Set<string>();
  const fetched: (Request | string)[] = [];
  const net = vi.fn(async (r: Request | string) => {
    fetched.push(r);
    if (!online.on) throw new TypeError("Failed to fetch");
    const u = typeof r === "string" ? r : r.url;
    if (gone.has(new URL(u).pathname)) return res(`network:${ORIGIN}/`, "basic", true, "text/html; charset=utf-8");
    return res(`network:${u}`, u.startsWith(ORIGIN) ? "basic" : "cors", true, typeOf(u));
  });
  const self = {
    location: { origin: ORIGIN },
    caches: {
      open: async (name: string) => caches.get(name) ?? caches.set(name, new FakeCache()).get(name)!,
      keys: async () => [...caches.keys()],
      delete: async (name: string) => caches.delete(name),
    },
    fetch: net,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clients: { claim: vi.fn(async () => undefined) },
    registration: { unregister: vi.fn(async () => true) },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (type: string, fn: (e: never) => void) => void listeners.set(type, fn),
  };
  /** An extendable event; resolves when every waitUntil has. */
  const extendable = async (type: string, extra: object = {}) => {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => waits.push(p), ...extra } as never);
    await Promise.all(waits);
  };
  /** A fetch event: what it answered (undefined: not touched), and what it left running. */
  const fetchEvent = async (r: RequestLike & Request) => {
    let answer: Promise<FakeResponse> | undefined;
    const waits: Promise<unknown>[] = [];
    listeners.get("fetch")!({ request: r, respondWith: (p: Promise<FakeResponse>) => (answer = Promise.resolve(p)), waitUntil: (p: Promise<unknown>) => waits.push(p) } as never);
    const out = answer === undefined ? undefined : await answer;
    await Promise.all(waits);
    return out;
  };
  return { self: self as unknown as WorkerScope & typeof self, listeners, caches, online, gone, fetched, net, extendable, fetchEvent };
}

describe("routeFor: what the worker answers, and what it never touches", () => {
  const route = (url: string, o?: Parameters<typeof req>[1]) => routeFor(req(url, o), ORIGIN, cfg);

  it("anything sent to Supabase — REST, RPC, Auth, Storage, Realtime — passes untouched", () => {
    for (const path of ["/rest/v1/rpc/load_week", "/rest/v1/editions?select=*", "/auth/v1/token?grant_type=refresh_token", "/storage/v1/object/sign/sources/1/2/x.pdf", "/realtime/v1/websocket"]) {
      expect(route(`${SUPABASE}${path}`), path).toBe("pass");
      expect(route(`https://other-project.supabase.co${path}`), path).toBe("pass");
      expect(route(`https://api.example.org${path}`), path).toBe("pass"); // a custom domain
      expect(route(`${ORIGIN}${path}`), path).toBe("pass"); // even on our own origin
    }
  });

  it("anything carrying Authorization or apikey passes untouched, whatever its address", () => {
    expect(route(`${ORIGIN}/assets/index-AAAA.js`, { headers: { authorization: "Bearer x" } })).toBe("pass");
    expect(route(`${ORIGIN}/assets/index-AAAA.js`, { headers: { apikey: "x" } })).toBe("pass");
    expect(route("https://fonts.gstatic.com/s/a.woff2", { headers: { Authorization: "Bearer x" } })).toBe("pass");
    expect(route(`${ORIGIN}/`, { mode: "navigate", headers: { apikey: "x" } })).toBe("pass");
  });

  it("anything but GET, and every other origin, passes untouched", () => {
    expect(route(`${ORIGIN}/assets/index-AAAA.js`, { method: "POST" })).toBe("pass");
    expect(route(`${ORIGIN}/`, { method: "HEAD", mode: "navigate" })).toBe("pass");
    expect(route("https://cdn.example.org/x.js")).toBe("pass");
    expect(route("not a url")).toBe("pass");
  });

  it("navigations, the build's files and Google Fonts are the worker's", () => {
    expect(route(`${ORIGIN}/`, { mode: "navigate" })).toBe("navigate");
    expect(route(`${ORIGIN}/kk?x=1`, { mode: "navigate" })).toBe("navigate");
    expect(route(`${ORIGIN}/assets/index-AAAA.js`)).toBe("asset");
    expect(route(`${ORIGIN}/assets/lazy-DDDD.js`)).toBe("asset"); // hashed, even if not listed
    expect(route(`${ORIGIN}/favicon.svg`)).toBe("asset");
    expect(route(`${ORIGIN}/assets/index-AAAA.js?v=1`)).toBe("pass");
    expect(route(`${ORIGIN}/privacy.html`)).toBe("pass");
    expect(route(`${ORIGIN}/sw.js`)).toBe("pass");
    expect(route("https://fonts.googleapis.com/css2?family=Assistant")).toBe("font");
    expect(route("https://fonts.gstatic.com/s/assistant/v1/a.woff2")).toBe("font");
  });
});

describe("shellWorker", () => {
  it("install caches every file of the build, past the HTTP cache — and does not take over (an update waits)", async () => {
    const s = scope();
    shellWorker(s.self, cfg, routeFor);
    await s.extendable("install");
    expect([...s.caches.get(cfg.cache)!.map.keys()].sort()).toEqual(cfg.precache.map((p) => new URL(p, ORIGIN).href).sort());
    expect(s.fetched.every((r) => typeof r !== "string" && r.cache === "reload")).toBe(true);
    expect(s.self.skipWaiting).not.toHaveBeenCalled();
  });

  it("activate deletes this site's older caches only — the fonts, this build's and anyone else's stay — and takes the open pages", async () => {
    const s = scope();
    for (const n of ["volozhin-shell-v1", "volozhin-shell-v2", FONT_CACHE, "someone-else"]) await s.self.caches.open(n);
    shellWorker(s.self, cfg, routeFor);
    await s.extendable("activate");
    expect([...s.caches.keys()].sort()).toEqual([FONT_CACHE, "someone-else", "volozhin-shell-v2"].sort());
    expect(s.self.clients.claim).toHaveBeenCalled();
  });

  it("only «רענון»'s message lets a waiting worker take over", () => {
    const s = scope();
    shellWorker(s.self, cfg, routeFor);
    const message = s.listeners.get("message")!;
    message({ data: null } as never);
    message({ data: "skip-waiting" } as never);
    message({ data: { type: "something-else" } } as never);
    expect(s.self.skipWaiting).not.toHaveBeenCalled();
    message({ data: { type: "skip-waiting" } } as never);
    expect(s.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("a request to Supabase, or with a key, is never answered and never cached — online or not", async () => {
    const s = scope();
    shellWorker(s.self, cfg, routeFor);
    await s.extendable("install");
    const before = s.net.mock.calls.length;
    for (const online of [true, false]) {
      s.online.on = online;
      expect(await s.fetchEvent(req(`${SUPABASE}/rest/v1/rpc/whoami`, { method: "POST", headers: { apikey: "k", authorization: "Bearer t" } }))).toBeUndefined();
      expect(await s.fetchEvent(req(`${SUPABASE}/rest/v1/editions`, { headers: { apikey: "k" } }))).toBeUndefined();
      expect(await s.fetchEvent(req(`${SUPABASE}/storage/v1/object/sign/sources/x`))).toBeUndefined();
    }
    expect(s.net.mock.calls.length).toBe(before); // the worker fetched nothing: the browser sends them itself
    for (const c of s.caches.values()) for (const k of c.map.keys()) expect(k).not.toContain("supabase");
  });

  it("a navigation: the network first, and its answer is not kept; without a network, the cached index.html", async () => {
    const s = scope();
    shellWorker(s.self, cfg, routeFor);
    await s.extendable("install");
    const page = req(`${ORIGIN}/kk`, { mode: "navigate" });
    expect((await s.fetchEvent(page))?.body).toBe(`network:${ORIGIN}/kk`);
    expect(s.caches.get(cfg.cache)!.map.has(`${ORIGIN}/kk`)).toBe(false);
    s.online.on = false;
    expect((await s.fetchEvent(page))?.body).toBe(`network:${ORIGIN}/`); // the copy install made of "/"
  });

  it("a navigation on a network that takes it and never answers: the cached shell after cfg.navigateTimeoutMs, never before", async () => {
    vi.useFakeTimers();
    try {
      const s = scope();
      shellWorker(s.self, cfg, routeFor);
      await s.extendable("install");
      s.net.mockImplementationOnce(() => new Promise(() => undefined)); // held for ever
      const out: { r?: FakeResponse } = {};
      const got = (): FakeResponse | undefined => out.r;
      void s.fetchEvent(req(`${ORIGIN}/kk`, { mode: "navigate" })).then((r) => (out.r = r));
      await vi.advanceTimersByTimeAsync(cfg.navigateTimeoutMs - 1);
      expect(out.r).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(out.r?.body).toBe(`network:${ORIGIN}/`); // the copy install made of "/"
      // a slow network that answers in time still wins, and is not kept
      s.net.mockImplementationOnce((r) => new Promise((ok) => setTimeout(() => ok(res(`network:${(r as Request).url}`, "basic", true, "text/html")), 1000)));
      delete out.r;
      void s.fetchEvent(req(`${ORIGIN}/kk`, { mode: "navigate" })).then((r) => (out.r = r));
      await vi.advanceTimersByTimeAsync(1000);
      expect(got()?.body).toBe(`network:${ORIGIN}/kk`);
      expect(s.caches.get(cfg.cache)!.map.has(`${ORIGIN}/kk`)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("with no cached shell, a navigation waits for the network's answer however late", async () => {
    vi.useFakeTimers();
    try {
      const s = scope();
      shellWorker(s.self, cfg, routeFor);
      s.net.mockImplementationOnce((r) => new Promise((ok) => setTimeout(() => ok(res(`network:${(r as Request).url}`, "basic", true, "text/html")), 10_000)));
      const out: { r?: FakeResponse } = {};
      void s.fetchEvent(req(`${ORIGIN}/`, { mode: "navigate" })).then((r) => (out.r = r));
      await vi.advanceTimersByTimeAsync(cfg.navigateTimeoutMs);
      expect(out.r).toBeUndefined();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(out.r?.body).toBe(`network:${ORIGIN}/`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a navigation without a network and without a cached shell fails as the network did", async () => {
    const s = scope();
    shellWorker(s.self, cfg, routeFor);
    s.online.on = false;
    await expect(s.fetchEvent(req(`${ORIGIN}/`, { mode: "navigate" }))).rejects.toThrow("Failed to fetch");
  });

  it("the build's files: the cache first; one of this build not cached (yet, or any more) is fetched and kept", async () => {
    const s = scope();
    shellWorker(s.self, cfg, routeFor);
    await s.extendable("install");
    const calls = s.net.mock.calls.length;
    s.online.on = false;
    expect((await s.fetchEvent(req(`${ORIGIN}/assets/index-AAAA.js`)))?.body).toBe(`network:${ORIGIN}/assets/index-AAAA.js`);
    expect(s.net.mock.calls.length).toBe(calls);
    s.online.on = true;
    s.caches.get(cfg.cache)!.map.delete(`${ORIGIN}/assets/index-BBBB.css`);
    await s.fetchEvent(req(`${ORIGIN}/assets/index-BBBB.css`));
    expect(s.caches.get(cfg.cache)!.map.has(`${ORIGIN}/assets/index-BBBB.css`)).toBe(true);
  });

  it("another build's file (a tab left on the old version, a rollback) is passed on — never kept, not even its SPA fallback's HTML", async () => {
    const s = scope();
    shellWorker(s.self, cfg, routeFor);
    await s.extendable("install");
    // the old chunk is gone from the server: the SPA fallback answers index.html — handed over, never cached
    s.gone.add("/assets/OldScreen-EEEE.js");
    const html = await s.fetchEvent(req(`${ORIGIN}/assets/OldScreen-EEEE.js`));
    expect(html?.headers.get("content-type")).toContain("text/html");
    expect(s.caches.get(cfg.cache)!.map.has(`${ORIGIN}/assets/OldScreen-EEEE.js`)).toBe(false);
    // the rollback brings the file back: the network's real file answers, nothing stored stands in its way
    s.gone.clear();
    expect((await s.fetchEvent(req(`${ORIGIN}/assets/OldScreen-EEEE.js`)))?.body).toBe(`network:${ORIGIN}/assets/OldScreen-EEEE.js`);
    expect(s.caches.get(cfg.cache)!.map.has(`${ORIGIN}/assets/OldScreen-EEEE.js`)).toBe(false);
  });

  it("install fails rather than keep a page under a file's name (a deploy landing mid-install)", async () => {
    const s = scope();
    shellWorker(s.self, cfg, routeFor);
    s.gone.add("/assets/index-AAAA.js");
    await expect(s.extendable("install")).rejects.toThrow("precache: /assets/index-AAAA.js");
    for (const c of s.caches.values()) expect(c.map.get(`${ORIGIN}/assets/index-AAAA.js`)).toBeUndefined();
  });

  it("Google Fonts: stale-while-revalidate in their own cache; a failed refresh keeps the copy", async () => {
    const s = scope();
    shellWorker(s.self, cfg, routeFor);
    const font = req("https://fonts.gstatic.com/s/a.woff2");
    expect((await s.fetchEvent(font))?.body).toBe("network:https://fonts.gstatic.com/s/a.woff2");
    const fonts = s.caches.get(FONT_CACHE)!;
    fonts.map.set(font.url, res("old copy", "cors"));
    expect((await s.fetchEvent(font))?.body).toBe("old copy"); // the copy at once…
    expect(fonts.map.get(font.url)?.body).toBe("network:https://fonts.gstatic.com/s/a.woff2"); // …refreshed behind it
    s.online.on = false;
    expect((await s.fetchEvent(font))?.body).toBe("network:https://fonts.gstatic.com/s/a.woff2");
    // a stylesheet loaded without CORS is opaque: kept all the same
    s.online.on = true;
    s.net.mockResolvedValueOnce(res("", "opaque", false));
    await s.fetchEvent(req("https://fonts.googleapis.com/css2?family=Rubik"));
    expect(fonts.map.get("https://fonts.googleapis.com/css2?family=Rubik")?.type).toBe("opaque");
  });
});

describe("killWorker", () => {
  it("takes over at once, deletes this site's caches only, unregisters, and answers nothing", async () => {
    const s = scope();
    for (const n of ["volozhin-shell-v2", FONT_CACHE, "someone-else"]) await s.self.caches.open(n);
    killWorker(s.self, "volozhin-");
    expect([...s.listeners.keys()].sort()).toEqual(["activate", "install"]);
    s.listeners.get("install")!({} as never);
    expect(s.self.skipWaiting).toHaveBeenCalled();
    await s.extendable("activate");
    expect([...s.caches.keys()]).toEqual(["someone-else"]);
    expect(s.self.registration.unregister).toHaveBeenCalled();
    expect(s.self.clients.claim).not.toHaveBeenCalled();
  });
});

describe("the script /sw.js is", () => {
  /** Runs a script the way the browser does — no module scope, only `self` and the platform's globals. */
  const run = (script: string) => {
    const s = scope();
    runInNewContext(script, { self: s.self, Request, URL, Promise });
    return s;
  };

  it("ASCII only, and the functions above working on their own — nothing they need lives outside them", async () => {
    const script = shellWorkerScript({ ...cfg, precache: [...cfg.precache, "/assets/שם-EEEE.js"] });
    expect(script).toMatch(/^[\x00-\x7f]*$/);
    const s = run(script);
    expect([...s.listeners.keys()].sort()).toEqual(["activate", "fetch", "install", "message"]);
    await s.extendable("install");
    expect(s.caches.get(cfg.cache)!.map.has(new URL("/assets/שם-EEEE.js", ORIGIN).href)).toBe(true); // the escape kept its meaning
    expect(await s.fetchEvent(req(`${SUPABASE}/rest/v1/rpc/load_week`, { method: "POST" }))).toBeUndefined();
    s.online.on = false;
    expect((await s.fetchEvent(req(`${ORIGIN}/`, { mode: "navigate" })))?.body).toBe(`network:${ORIGIN}/`);
  });

  it("the kill switch's, likewise", async () => {
    const script = killWorkerScript("volozhin-");
    expect(script).toMatch(/^[\x00-\x7f]*$/);
    const s = run(script);
    await s.self.caches.open("volozhin-shell-v2");
    await s.extendable("activate");
    expect(s.caches.size).toBe(0);
    expect(s.self.registration.unregister).toHaveBeenCalled();
  });
});
