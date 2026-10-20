// The service worker, as two plain functions the build writes into /sw.js (src/offline/swBuild.ts): `shellWorker`
// keeps the app shell — index.html and the hashed JS/CSS the build emitted — so the site opens without internet, and
// `killWorker` is the kill switch (src/offline/config.ts). They are written as functions of `self` so a unit test runs
// the very same code on a fake worker scope (src/offline/sw.test.ts); the build inlines their source text, so neither
// may use anything from outside its own body — everything comes in through `cfg`, `route` and `self`.
//
// What the worker answers for, and how (`routeFor`):
//   - anything sent to the Supabase project (REST, RPC, Auth, Storage, Realtime), anything carrying Authorization or
//     apikey, anything but GET, and every other origin: NOT touched — no respondWith, the browser sends it as if there
//     were no worker, and nothing of it is ever cached;
//   - a navigation to a page of its own — a path with a file extension: /privacy.html, a picture opened in a tab —
//     NOT touched: the network answers it as if there were no worker (offline: the browser's own «no connection»),
//     never the app shell in its place, which would send the privacy link to the week;
//   - any other navigation: the network first, for a few seconds (cfg.navigateTimeoutMs); without one — or with one
//     that takes the request and never answers — the cached index.html (the app then shows the day from its own snapshot,
//     src/offline/snapshot.ts). The network's answer is never cached: the cached index.html is always the one whose
//     chunks this worker precached;
//   - the build's own files (/assets/…, the precache list): the cache first; only this build's files are ever kept —
//     an old build's chunk name is answered by Cloudflare Pages' SPA fallback with index.html (200, text/html), and
//     kept, that HTML would answer the chunk even after a rollback brought the file back;
//   - Google Fonts (public, no personal data): stale-while-revalidate, in a cache of their own.

/** What the build hands the worker. */
export interface ShellConfig {
  /** This build's cache: `volozhin-shell-<version>`. */
  cache: string;
  /** Every cache of this site starts with it; `activate` deletes the others that do. */
  prefix: string;
  fontCache: string;
  fontOrigins: string[];
  /** Same-origin paths cached at install: "/" (index.html) and every file the build emitted. */
  precache: string[];
  /** The Supabase project's origin, when the build has one (never answered, never cached). */
  supabaseOrigin: string | null;
  /** The message that lets a waiting worker take over (the update banner's «רענון»). */
  skipWaiting: string;
  /** A navigation waits this long for the network before the cached shell answers. */
  navigateTimeoutMs: number;
}

export type Route = "pass" | "navigate" | "asset" | "font";

/** The parts of a Request the decision reads. */
export interface RequestLike {
  url: string;
  method: string;
  mode: string;
  headers: { has(name: string): boolean };
}

/** How the worker treats one request. Pure; inlined into /sw.js. */
export function routeFor(req: RequestLike, origin: string, cfg: ShellConfig): Route {
  if (req.method !== "GET") return "pass";
  if (req.headers.has("authorization") || req.headers.has("apikey")) return "pass";
  let u: URL;
  try {
    u = new URL(req.url);
  } catch {
    return "pass";
  }
  if (cfg.supabaseOrigin && u.origin === cfg.supabaseOrigin) return "pass";
  if (/\.supabase\.(co|in)$/i.test(u.hostname)) return "pass";
  // Supabase's paths on any host (a custom domain, a proxy): never ours to answer
  if (/^\/(rest|auth|storage|realtime|functions|graphql)\/v1(\/|$)/.test(u.pathname)) return "pass";
  if (cfg.fontOrigins.indexOf(u.origin) >= 0) return "font";
  if (u.origin !== origin) return "pass";
  // a page of its own (/privacy.html, a file opened in a tab): never answered with the app shell — the network's
  if (req.mode === "navigate") return /\.[a-z0-9]+$/i.test(u.pathname.slice(u.pathname.lastIndexOf("/") + 1)) ? "pass" : "navigate";
  if (u.search === "" && (cfg.precache.indexOf(u.pathname) >= 0 || u.pathname.indexOf("/assets/") === 0)) return "asset";
  return "pass";
}

/** The parts of a worker's scope the two workers use — `self` in /sw.js, a fake in the unit test. */
export interface WorkerScope {
  location: { origin: string };
  caches: {
    open(name: string): Promise<CacheLike>;
    keys(): Promise<string[]>;
    delete(name: string): Promise<boolean>;
  };
  fetch(req: Request | string): Promise<Response>;
  setTimeout(fn: () => void, ms: number): unknown;
  clients: { claim(): Promise<void> };
  registration: { unregister(): Promise<boolean> };
  skipWaiting(): Promise<void>;
  addEventListener(type: string, listener: (event: never) => void): void;
}

export interface CacheLike {
  match(req: Request | string, options?: { ignoreVary?: boolean }): Promise<Response | undefined>;
  put(req: Request | string, res: Response): Promise<void>;
}

export interface ExtendableEventLike {
  waitUntil(p: Promise<unknown>): void;
}
export interface FetchEventLike extends ExtendableEventLike {
  request: Request & RequestLike;
  respondWith(r: Promise<Response> | Response): void;
}
export interface MessageEventLike {
  data: unknown;
}

/** The app shell's worker. A new one installs beside the old and waits: it takes over only on «רענון». */
export function shellWorker(self: WorkerScope, cfg: ShellConfig, route: typeof routeFor): void {
  const open = () => self.caches.open(cfg.cache);
  const abs = (path: string) => new URL(path, self.location.origin).href;

  self.addEventListener("install", (event: ExtendableEventLike) => {
    // `reload`: past the HTTP cache, so the copies are this build's. No skipWaiting here: an update waits. A file
    // answered with HTML (the SPA fallback: a deploy landed mid-install and the file is gone) fails the install — it is
    // tried again at the next update — rather than keeping a page under a script's name.
    event.waitUntil(
      open().then((cache) =>
        Promise.all(
          cfg.precache.map(async (p) => {
            const req = new Request(abs(p), { cache: "reload" });
            const res = await self.fetch(req);
            if (!res.ok || (p !== "/" && (res.headers.get("content-type") || "").indexOf("text/html") === 0)) throw new TypeError(`precache: ${p}`);
            await cache.put(req, res);
          }),
        ),
      ),
    );
  });

  self.addEventListener("activate", (event: ExtendableEventLike) => {
    event.waitUntil(
      (async () => {
        const keys = await self.caches.keys();
        await Promise.all(keys.filter((k) => k.indexOf(cfg.prefix) === 0 && k !== cfg.cache && k !== cfg.fontCache).map((k) => self.caches.delete(k)));
        await self.clients.claim();
      })(),
    );
  });

  self.addEventListener("message", (event: MessageEventLike) => {
    const data = event.data as { type?: unknown } | null;
    if (data && data.type === cfg.skipWaiting) void self.skipWaiting();
  });

  self.addEventListener("fetch", (event: FetchEventLike) => {
    const kind = route(event.request, self.location.origin, cfg);
    if (kind === "pass") return; // untouched: no respondWith, nothing cached
    if (kind === "navigate") event.respondWith(navigate(event.request));
    else if (kind === "asset") event.respondWith(asset(event.request));
    else event.respondWith(font(event));
  });

  async function navigate(req: Request): Promise<Response> {
    const shell = async () => (await open()).match(abs("/"));
    const network = self.fetch(req);
    // a network that takes the request and never answers must not hold the page: after a few seconds, the cached shell
    // (the late answer is dropped — never cached); with no cached shell, the network's answer whenever it comes
    const late = new Promise<null>((resolve) => self.setTimeout(() => resolve(null), cfg.navigateTimeoutMs));
    try {
      const first = await Promise.race([network, late]);
      if (first) return first;
      const cached = await shell();
      if (cached) {
        network.catch(() => undefined);
        return cached;
      }
      return await network;
    } catch (e) {
      const cached = await shell();
      if (cached) return cached;
      throw e;
    }
  }

  async function asset(req: Request): Promise<Response> {
    const cache = await open();
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    const res = await self.fetch(req);
    // only this build's own files are kept (the precache list names every file the build emitted): another build's
    // chunk is answered by the SPA fallback with index.html, and is passed on — never kept under the chunk's name
    if (res.ok && res.type === "basic" && cfg.precache.indexOf(new URL(req.url).pathname) >= 0) await cache.put(req, res.clone()).catch(() => undefined);
    return res;
  }

  async function font(event: FetchEventLike): Promise<Response> {
    const req = event.request;
    const cache = await self.caches.open(cfg.fontCache);
    const hit = await cache.match(req, { ignoreVary: true });
    const fresh = self.fetch(req).then(async (res) => {
      if (res.ok || res.type === "opaque") await cache.put(req, res.clone()).catch(() => undefined);
      return res;
    });
    if (hit) {
      event.waitUntil(fresh.catch(() => undefined));
      return hit;
    }
    return fresh;
  }
}

/**
 * The kill switch's worker: takes over at once, deletes every cache of this site, unregisters itself, and answers no
 * request — from then on every request goes to the network as if there had never been a worker. It does not reload
 * anyone's page: the next visit simply has no worker.
 */
export function killWorker(self: WorkerScope, prefix: string): void {
  self.addEventListener("install", () => {
    void self.skipWaiting();
  });
  self.addEventListener("activate", (event: ExtendableEventLike) => {
    event.waitUntil(
      (async () => {
        const keys = await self.caches.keys();
        await Promise.all(keys.filter((k) => k.indexOf(prefix) === 0).map((k) => self.caches.delete(k)));
        await self.registration.unregister();
      })(),
    );
  });
}

const HEADER = "/* Volozhin week - the service worker, written by the build (src/offline/swBuild.ts) from src/offline/sw.ts. */\n";

/** /sw.js for the app shell: the functions above, inlined, with this build's config. */
export function shellWorkerScript(cfg: ShellConfig): string {
  return ascii(`${HEADER}"use strict";\n(${shellWorker.toString()})(self, ${JSON.stringify(cfg)}, ${routeFor.toString()});\n`);
}

/** /sw.js when the kill switch is on. */
export function killWorkerScript(prefix: string): string {
  return ascii(`${HEADER}"use strict";\n(${killWorker.toString()})(self, ${JSON.stringify(prefix)});\n`);
}

/** The source the build's version is computed over, beside the files: a change to the worker is a new version. */
export function workerSourceText(): string {
  return shellWorker.toString() + routeFor.toString();
}

/**
 * Every non-ASCII character as a \u escape, so /sw.js reads the same whatever charset it is served with. The meaning
 * is the same wherever one can occur: in a string, a regular expression or an identifier it is that character, in a
 * comment only text.
 */
function ascii(script: string): string {
  return script.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
