import { describe, expect, it } from "vitest";
import { kkWindowState, kkWindowText } from "./kkWindow";

describe("the sign-up window", () => {
  const w = { opens_at: "2027-01-10T18:00:00.000Z", closes_at: "2027-01-17T18:00:00.000Z" };
  it("is closed without one, and open from its opening up to (not including) its closing", () => {
    expect(kkWindowState(null)).toBe("none");
    expect(kkWindowState({ opens_at: null, closes_at: null })).toBe("none");
    expect(kkWindowState(w, Date.parse(w.opens_at) - 1)).toBe("before");
    expect(kkWindowState(w, Date.parse(w.opens_at))).toBe("open");
    expect(kkWindowState(w, Date.parse(w.closes_at) - 1)).toBe("open");
    expect(kkWindowState(w, Date.parse(w.closes_at))).toBe("after");
  });
  it("says it in Israel's time", () => {
    expect(kkWindowText(undefined)).toBe("ההרשמה עוד לא נפתחה.");
    expect(kkWindowText(w, Date.parse("2027-01-01T00:00:00Z"))).toBe("ההרשמה תיפתח ב-10.1.2027 20:00.");
    expect(kkWindowText(w, Date.parse("2027-01-12T00:00:00Z"))).toBe("ההרשמה פתוחה עד 17.1.2027 20:00.");
    expect(kkWindowText(w, Date.parse("2027-02-01T00:00:00Z"))).toBe("ההרשמה נסגרה ב-17.1.2027 20:00.");
  });
});
