// When the app registers the worker: production builds only — never `vite dev` — and with the kill switch on it
// unregisters instead (src/offline/config.ts).
import { describe, expect, it, vi } from "vitest";
import { applyUpdate, onControllerChanged, retireShellWorker, shellWorkerMode } from "./register";

describe("shellWorkerMode", () => {
  it("a production build registers; the dev server and a browser without workers do nothing", () => {
    expect(shellWorkerMode({ production: true, enabled: true, supported: true })).toBe("register");
    expect(shellWorkerMode({ production: false, enabled: true, supported: true })).toBe("none");
    expect(shellWorkerMode({ production: true, enabled: true, supported: false })).toBe("none");
  });
  it("the kill switch: a production build unregisters every worker it finds", () => {
    expect(shellWorkerMode({ production: true, enabled: false, supported: true })).toBe("unregister");
    expect(shellWorkerMode({ production: false, enabled: false, supported: true })).toBe("none");
  });
});

describe("retireShellWorker: the kill switch from the app's side", () => {
  const fakes = (names: string[]) => {
    const regs = [{ unregister: vi.fn(async () => true) }, { unregister: vi.fn(async () => true) }];
    const kept = new Set(names);
    const sw = { getRegistrations: vi.fn(async () => regs) };
    const store = { keys: vi.fn(async () => [...kept]), delete: vi.fn(async (n: string) => kept.delete(n)) };
    return { regs, kept, sw, store };
  };

  it("unregisters every worker and deletes this site's caches — the shell's and the fonts' — and nobody else's", async () => {
    const f = fakes(["volozhin-shell-a446f0dd70e4", "volozhin-fonts", "someone-else"]);
    await retireShellWorker(f.sw, f.store, "volozhin-");
    for (const r of f.regs) expect(r.unregister).toHaveBeenCalled();
    expect([...f.kept]).toEqual(["someone-else"]);
  });

  it("deletes the caches even when no worker is registered any more (the old one still controls the page and refills them)", async () => {
    const f = fakes(["volozhin-shell-a446f0dd70e4"]);
    f.sw.getRegistrations.mockResolvedValue([]);
    await retireShellWorker(f.sw, f.store, "volozhin-");
    expect([...f.kept]).toEqual([]);
  });

  it("never throws: no workers, no caches, or storage that refuses", async () => {
    await expect(retireShellWorker(null, null)).resolves.toBeUndefined();
    const f = fakes(["volozhin-shell-x"]);
    f.sw.getRegistrations.mockRejectedValue(new Error("SecurityError"));
    f.store.keys.mockRejectedValue(new Error("SecurityError"));
    await expect(retireShellWorker(f.sw, f.store)).resolves.toBeUndefined();
  });
});

describe("«רענון» with two tabs open (applyUpdate, onControllerChanged)", () => {
  const worker = (state: ServiceWorkerState) => ({ state, postMessage: vi.fn() });

  it("lets a waiting worker take over — and reloads at once when another tab already did (the held worker is not waiting any more)", () => {
    expect(applyUpdate(worker("installed"))).toBe("skip");
    // tab B pressed «רענון» first: the worker tab A holds is active now — a skip-waiting message would do nothing
    for (const state of ["activating", "activated", "redundant"] as const) expect(applyUpdate(worker(state)), state).toBe("reload");
    expect(applyUpdate("reload")).toBe("reload");
    expect(applyUpdate(null)).toBe("none");
  });

  it("a controller replaced while this tab did not ask: the banner, whose «רענון» reloads — not the first install's claim", () => {
    expect(onControllerChanged(true, true)).toBe("reload"); // this tab's «רענון»
    expect(onControllerChanged(true, false)).toBe("reload");
    expect(onControllerChanged(false, true)).toBe("banner"); // another tab's
    expect(onControllerChanged(false, false)).toBe("none"); // the first install taking this page (clients.claim)
  });
});
