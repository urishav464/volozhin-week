import { describe, expect, it } from "vitest";
import { hebrewNumeral, hebrewYear, hebrewYearLabel } from "./hebrewYear";

describe("the Hebrew year as an edition label", () => {
  it("writes the year in letters, gershayim before the last one", () => {
    expect(hebrewNumeral(5787)).toBe('תשפ"ז');
    expect(hebrewNumeral(5786)).toBe('תשפ"ו');
    expect(hebrewNumeral(5790)).toBe('תש"צ');
    expect(hebrewNumeral(5800)).toBe('ת"ת');
    expect(hebrewNumeral(5700)).toBe('ת"ש');
    expect(hebrewNumeral(5400)).toBe("ת'");
    expect(hebrewNumeral(5005)).toBe("ה'");
    expect(hebrewNumeral(5801)).toBe('תת"א');
  });
  it("never spells 15 and 16 as part of the Name", () => {
    expect(hebrewNumeral(5715)).toBe('תשט"ו');
    expect(hebrewNumeral(5716)).toBe('תשט"ז');
  });
  it("reads the year from Intl's Hebrew calendar, which turns at Rosh Hashana", () => {
    expect(hebrewYear(new Date("2026-10-19T12:00:00Z"))).toBe(5787);
    expect(hebrewYear(new Date("2026-09-01T12:00:00Z"))).toBe(5786);
    expect(hebrewYearLabel(new Date("2026-10-19T12:00:00Z"))).toBe('תשפ"ז');
  });
});
