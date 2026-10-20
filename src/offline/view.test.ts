// The offline banner's day and time, and the day the view opens on — in Israel, whatever the device's clock zone.
import { describe, expect, it } from "vitest";
import { savedAtText, todayColumn } from "./view";

describe("savedAtText", () => {
  it("the day and the time in Israel (summer time, winter time, across midnight UTC)", () => {
    expect(savedAtText("2026-10-20T11:05:00.000Z")).toBe("יום שלישי 20.10 בשעה 14:05"); // UTC+3
    expect(savedAtText("2027-02-15T07:30:00.000Z")).toBe("יום שני 15.2 בשעה 09:30"); // UTC+2
    expect(savedAtText("2027-02-14T22:10:00.000Z")).toBe("יום שני 15.2 בשעה 00:10"); // already Monday in Israel
  });
});

describe("todayColumn", () => {
  const start = "2027-02-14"; // a Sunday
  it("the column of today, during the week", () => {
    expect(todayColumn(start, "2027-02-14T08:00:00Z")).toBe(0);
    expect(todayColumn(start, "2027-02-18T15:00:00Z")).toBe(4);
  });
  it("the small hours (before 06:30 in Israel) are still the day before's column, as the grid draws them", () => {
    expect(todayColumn(start, "2027-02-16T03:00:00Z")).toBe(1); // 05:00 Tuesday → Monday's night
    expect(todayColumn(start, "2027-02-16T04:45:00Z")).toBe(2); // 06:45 Tuesday
    expect(todayColumn(start, "2027-02-19T02:00:00Z")).toBe(4); // Thursday's night
  });
  it("before the week, after it, or while its date is TBD: none", () => {
    expect(todayColumn(start, "2027-02-13T12:00:00Z")).toBeNull();
    expect(todayColumn(start, "2027-02-14T03:00:00Z")).toBeNull(); // 05:00 Sunday: Saturday night
    expect(todayColumn(start, "2027-02-19T12:00:00Z")).toBeNull();
    expect(todayColumn(null, "2027-02-15T12:00:00Z")).toBeNull();
  });
});
