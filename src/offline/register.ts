// The app's side of the service worker (src/offline/sw.ts): register /sw.js in production builds — never in `vite
// dev` — and say when a new version is waiting. The page never reloads by itself in the middle of someone's work: a
// new worker installs and waits, the header shows «גרסה חדשה של האתר זמינה» with «רענון», and only that button lets
// it take over (skipWaiting) and reloads. With the kill switch on (src/offline/config.ts) the app unregisters every
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
    // A first install takes control of this page too (clients.claim): that is not an update.
    const hadController = !!sw.controller;
    const onControllerChange = () => {
      if (wanted.current) window.location.reload();
      else if (hadController && live) setWaiting((cur) => cur ?? "reload"); // another tab let the new version in
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
    if (waiting === null) return;
    if (waiting === "reload") return window.location.reload();
    wanted.current = true;
    waiting.postMessage({ type: SKIP_WAITING });
  }, [waiting]);

  return { ready: waiting !== null, apply };
}
