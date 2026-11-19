import { describe, expect, it } from "vitest";
import { cleanTransportRequest } from "../data/stageRules";
import { PICKUP_MIN_MAX, pickupInput, pickupMin } from "./pickup";

describe("pickupMin", () => {
  it("a morning or an evening lesson: the clock's minute", () => {
    expect(pickupMin("08:00", 600)).toBe(480);
    expect(pickupMin("16:15", 1050)).toBe(975);
    expect(pickupMin("7:05", 510)).toBe(425);
    expect(pickupMin("07.05", 510)).toBe(425);
  });

  it("a night lesson: a pickup after midnight is the night after the day (the grid's clock)", () => {
    expect(pickupMin("00:10", 1470)).toBe(1450);
    expect(pickupMin("01:30", 1560)).toBe(1530);
    expect(pickupMin("23:40", 1470)).toBe(1420);
  });

  it("the nearer of the two to the start; a tie keeps the clock's minute", () => {
    // 05:00 before a 10:00 lesson is the morning (300), not the night after (1740)
    expect(pickupMin("05:00", 600)).toBe(300);
    // 04:00 before a 02:00 lesson (1560): 240 is 1320 away, 1680 only 120 — the night
    expect(pickupMin("04:00", 1560)).toBe(1680);
    // equally far: 12 hours either way
    expect(pickupMin("00:00", 720)).toBe(0);
  });

  it("never past 06:30 of the next morning", () => {
    expect(pickupMin("06:30", 1650)).toBe(1830);
    expect(pickupMin("06:31", 1650)).toBe(391);
    expect(pickupMin("23:59", 1830)).toBe(1439);
  });

  it("not a time: null", () => {
    for (const bad of ["", "24:00", "12:60", "אחרי השיעור", "1200", "12:5", " : "]) expect(pickupMin(bad, 600)).toBeNull();
  });

  it("whatever it answers, set_transport_request takes it", () => {
    for (let h = 0; h < 24; h++) {
      for (const start of [390, 600, 1050, 1470, 1650, 1830]) {
        const v = pickupMin(`${String(h).padStart(2, "0")}:30`, start)!;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(PICKUP_MIN_MAX);
        expect(cleanTransportRequest({ pickup_min: v })).toEqual({ pickup_min: v });
      }
    }
  });
});

describe("pickupInput", () => {
  it("a stored clock time, zero-padded for a time input", () => {
    expect(pickupInput("07:15")).toBe("07:15");
    expect(pickupInput("7:15")).toBe("07:15");
    expect(pickupInput(" 19.05 ")).toBe("19:05");
  });

  it("words, an impossible time or nothing: empty (the form shows the old text beside it)", () => {
    expect(pickupInput("אחרי השיעור")).toBe("");
    expect(pickupInput("25:00")).toBe("");
    expect(pickupInput("")).toBe("");
    expect(pickupInput(null)).toBe("");
    expect(pickupInput(undefined)).toBe("");
  });
});
