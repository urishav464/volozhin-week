// The demo's `?as=` persona (config.ts reads it once, when the module loads): loaded here with a window of our own, so a
// module that cannot even be evaluated (a helper used before it exists) fails a unit test, not every page of the demo.
import { afterEach, describe, expect, it, vi } from "vitest";

function windowWith(search: string, stored: Record<string, string> = {}, storage = true) {
  const kept = new Map(Object.entries(stored));
  const sessionStorage = {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  };
  vi.stubGlobal("window", {
    location: { search },
    get sessionStorage() {
      if (!storage) throw new Error("blocked");
      return sessionStorage;
    },
  });
  return kept;
}

async function load() {
  vi.resetModules();
  return import("./config");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the demo's persona (?as=)", () => {
  it("reads trainee and logistics from the address, and the tab keeps it", async () => {
    const kept = windowWith("?as=logistics");
    expect((await load()).demoAs).toBe("logistics");
    expect(kept.get("volozhin-demo-as")).toBe("logistics");
    windowWith("", { "volozhin-demo-as": "trainee" });
    expect((await load()).demoAs).toBe("trainee");
  });

  it("anything else goes back to the instructor and forgets the kept one", async () => {
    const kept = windowWith("?as=staff", { "volozhin-demo-as": "trainee" });
    expect((await load()).demoAs).toBeNull();
    expect(kept.has("volozhin-demo-as")).toBe(false);
  });

  it("with no storage, the address alone decides", async () => {
    windowWith("?as=trainee", {}, false);
    expect((await load()).demoAs).toBe("trainee");
    windowWith("", {}, false);
    expect((await load()).demoAs).toBeNull();
  });
});
