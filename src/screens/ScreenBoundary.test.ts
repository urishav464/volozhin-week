// The lazy screens' boundary knows a failed dynamic import — a tab left on the previous version after a deploy — by
// the words each browser and Vite's preload helper use, and nothing else (any other error goes on as before).
import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "./ScreenBoundary";

describe("isChunkLoadError", () => {
  it("knows a screen's file that is gone, in every browser's words", () => {
    for (const m of [
      "Failed to fetch dynamically imported module: https://volozhin.example/assets/MemorialScreen-C_c5mUJ3.js", // Chromium
      "error loading dynamically imported module: https://volozhin.example/assets/x.js", // Firefox
      "Importing a module script failed.", // Safari
      "Unable to preload CSS for /assets/index-AAAA.css", // Vite
    ]) {
      expect(isChunkLoadError(new TypeError(m)), m).toBe(true);
    }
  });

  it("leaves every other error alone", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false); // not an Error
    expect(isChunkLoadError(null)).toBe(false);
  });
});
