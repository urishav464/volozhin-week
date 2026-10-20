// When the app registers the worker: production builds only — never `vite dev` — and with the kill switch on it
// unregisters instead (src/offline/config.ts).
import { describe, expect, it } from "vitest";
import { shellWorkerMode } from "./register";

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
