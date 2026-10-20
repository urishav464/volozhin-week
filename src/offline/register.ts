// The app's side of the service worker (src/offline/sw.ts): register /sw.js in production builds — never in `vite
// dev` — and say when a new version is waiting. The page never reloads by itself in the middle of someone's work: a
// new worker installs and waits, the header shows «גרסה חדשה של האתר זמינה» with «רענון», and only that button lets
// it take over (skipWaiting) and reloads — in every tab: a tab whose worker another tab already let in reloads at
// once (applyUpdate). With the kill switch on (src/offline/config.ts) the app unregisters every
// worker it finds and deletes this site's caches instead (`retireShellWorker`). Only the team's app registers: a link's public page (/e, /k, /s) never installs the shell,
// and never offers a reload that would drop its token.
import { useCallback, useEffect, useRef, useState } from "react";
import { CACHE_PREFIX, OFFLINE_SHELL_ENABLED, SKIP_WAITING } from "./config";

/**
 * What the app does about the worker: register it (a production build, the switch on), unregister every one it finds
 * (a production build with the kill switch on), or nothing (`vite dev`, or a browser without service workers).
 */
export function shellWorkerMode(o: { production: boolean; enabled: boolean; supported: boolean }): "register" | "unregister" | "none" {
  if (!o.production || !o.supported) return "none";
  return o.enabled ? "register" : "unregister";
}

/**
 * The kill switch, from the app's side — on every load of a build with the switch off: unregister every worker, and
 * delete every cache of this site. The app does it itself because it unregisters before the browser's update check
 * would fetch the new /sw.js (killWorker), and an unregistered registration's update never runs — so killWorker's own
 * cleanup does not happen here. On every load, not once: until this page closes, the old worker still controls it and
 * puts its cache back on the next file it fetches. Never throws (storage blocked: the site works as before).
 */
export async function retireShellWorker(
  sw: { getRegistrations(): Promise<readonly { unregister(): Promise<boolean> }[]> } | null,
  store: { keys(): Promise<string[]>; delete(name: string): Promise<boolean> } | null,
  prefix: string = CACHE_PREFIX,
): Promise<void> {
  if (sw) {
    try {
      await Promise.all((await sw.getRegistrations()).map((r) => r.unregister().catch(() => false)));
    } catch {
      // blocked: nothing registered here to remove
    }
  }
  if (store) {
    try {
      const keys = await store.keys();
      await Promise.all(keys.filter((k) => k.indexOf(prefix) === 0).map((k) => store.delete(k).catch(() => false)));
    } catch {
      // storage blocked: nothing kept here to delete
    }
  }
}

/** The worker the banner holds: a new one installed and waiting, or "reload" (another tab let the new version in). */
export type HeldUpdate = Pick<ServiceWorker, "state" | "postMessage"> | "reload";

/**
 * «רענון», decided: let the held worker take over (it then reloads this page, on controllerchange) — or, when it is not
 * waiting any more, reload at once. With two tabs open, the other tab's «רענון» activates the worker this one holds:
 * a skip-waiting message to an active worker does nothing, no controllerchange follows, and the button would be dead.
 * So: "reload" when another tab already let it in, or when the held worker is no longer 'installed' (activating,
 * activated — or redundant, a newer one replacing it); "skip" only for a worker still waiting.
 */
export function applyUpdate(held: HeldUpdate | null): "none" | "reload" | "skip" {
  if (held === null) return "none";
  if (held === "reload" || held.state !== "installed") return "reload";
  return "skip";
}

/**
 * A controllerchange, decided: this page asked for it («רענון» here) → reload; otherwise, when the page already had a
 * controller before — a worker replaced by another, not the first install's clients.claim — another tab let the new
 * version in: the banner, and its «רענון» reloads ("reload", whatever worker was held: that one is active now).
 */
export function onControllerChanged(asked: boolean, hadController: boolean): "reload" | "banner" | "none" {
  if (asked) return "reload";
  return hadController ? "banner" : "none";
}

export interface ShellUpdate {
  /** A new version waits (or another tab already let it in): show the banner. */
  ready: boolean;
  /** «רענון»: let the waiting worker take over, then reload. */
  apply(): void;
}

export function useShellWorker(production: boolean = import.meta.env.PROD): ShellUpdate {
  const [waiting, setWaiting] = useState<ServiceWorker | "reload" | null>(null);
  const wanted = useRef(false);

  useEffect(() => {
    const mode = shellWorkerMode({ production, enabled: OFFLINE_SHELL_ENABLED, supported: typeof navigator !== "undefined" && "serviceWorker" in navigator });
    if (mode === "none") return;
    const sw = navigator.serviceWorker;
    if (mode === "unregister") {
      void retireShellWorker(sw, typeof caches !== "undefined" ? caches : null);
      return;
    }
    let live = true;
    let reg: ServiceWorkerRegistration | null = null;
    // A first install takes control of this page too (clients.claim): that is not an update. Every change after it is
    // one — this page's first worker replaced by the next too, when this was the tab that installed the first.
    let controlled = !!sw.controller;
    const onControllerChange = () => {
      const was = controlled;
      controlled = !!sw.controller;
      const d = onControllerChanged(wanted.current, was);
      if (d === "reload") window.location.reload();
      else if (d === "banner" && live) setWaiting("reload"); // another tab let the new version in
    };
    const watch = (w: ServiceWorker | null) => {
      if (!w) return;
      const check = () => {
        if (!live) return;
        if (w.state === "installed" && sw.controller) setWaiting(w);
        else if (w.state === "redundant") setWaiting((cur) => (cur === w ? null : cur));
      };
      w.addEventListener("statechange", check);
      check();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reg?.update().catch(() => undefined);
    };
    sw.addEventListener("controllerchange", onControllerChange);
    sw.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(
      (r) => {
        if (!live) return;
        reg = r;
        if (r.waiting && sw.controller) setWaiting(r.waiting);
        watch(r.installing);
        r.addEventListener("updatefound", () => watch(r.installing));
        document.addEventListener("visibilitychange", onVisible);
      },
      // blocked (a private window, a browser setting, a test): the site works as before, online only
      () => undefined,
    );
    return () => {
      live = false;
      sw.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [production]);

  const apply = useCallback(() => {
    const d = applyUpdate(waiting);
    if (d === "reload") return window.location.reload();
    if (d !== "skip" || waiting === null || waiting === "reload") return;
    wanted.current = true;
    waiting.postMessage({ type: SKIP_WAITING });
  }, [waiting]);

  return { ready: waiting !== null, apply };
}
