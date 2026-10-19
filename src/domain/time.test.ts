import { describe, expect, it } from "vitest";
import { dateOf, fmt, fmtRange, hebrewDate, overlaps, parseClock, shortDate, weekMinute } from "./time";

describe("the week's clock", () => {
  it("formats minutes past midnight, wrapping the night", () => {
    expect(fmt(390)).toBe("06:30");
    expect(fmt(510)).toBe("08:30");
    expect(fmt(1440)).toBe("00:00");
    expect(fmt(1470)).toBe("00:30");
    expect(fmt(1830)).toBe("06:30");
    expect(fmtRange(1470, 1740)).toBe("00:30–05:00");
  });

  it("reads anything before 06:30 as the night after", () => {
    expect(parseClock("08:30")).toBe(510);
    expect(parseClock("00:30")).toBe(1470);
    expect(parseClock("05:00")).toBe(1740);
    expect(parseClock("6:30")).toBe(390);
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("noon")).toBeNull();
  });

  it("treats ranges as half-open", () => {
    expect(overlaps(870, 930, 930, 960)).toBe(false); // 14:30–15:30 then 15:30–16:00
    expect(overlaps(870, 960, 900, 930)).toBe(true);
  });

  it("puts the night after Sunday on Sunday's column", () => {
    expect(weekMinute(0, 1470)).toBe(1470);
    expect(weekMinute(1, 510)).toBe(1440 + 510);
    expect(weekMinute(0, 1470)).toBeLessThan(weekMinute(1, 510));
  });

  it("dates a column, Gregorian and Hebrew", () => {
    expect(dateOf(null, 2)).toBeNull();
    const d = dateOf("2026-02-15", 0)!;
    expect(shortDate(d)).toBe("15.2");
    expect(shortDate(dateOf("2026-02-15", 4)!)).toBe("19.2");
    expect(hebrewDate(d)).toMatch(/שבט/);
  });
});
