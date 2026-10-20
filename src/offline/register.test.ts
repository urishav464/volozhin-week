// When the app registers the worker: production builds only — never `vite dev` — and with the kill switch on it
// unregisters instead (src/offline/config.ts).
import { describe, expect, it, vi } from "vitest";
import { retireShellWorker, shellWorkerMode } from "./register";

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
