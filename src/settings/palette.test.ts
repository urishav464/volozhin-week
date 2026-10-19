import { describe, expect, it } from "vitest";
import { DEMO_CATEGORIES } from "../data/demoWeek";
import { PALETTE, contrast } from "./palette";

describe("the category palette", () => {
  it("keeps every seeded colour", () => {
    const colors = PALETTE.map((p) => p.color);
    for (const c of DEMO_CATEGORIES) expect(colors).toContain(c.color);
  });
  it("reads on white and on paper (≥ 3:1), and is distinct", () => {
    for (const p of PALETTE) {
      expect(contrast(p.color, "#ffffff"), p.name).toBeGreaterThanOrEqual(3);
      expect(contrast(p.color, "#f7f3ea"), p.name).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(PALETTE.map((p) => p.color)).size).toBe(PALETTE.length);
    expect(new Set(PALETTE.map((p) => p.name)).size).toBe(PALETTE.length);
  });
});
