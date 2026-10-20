import { describe, expect, it } from "vitest";
import { byDue, fmtDate, isLate, israelToday, milestoneDate, milestoneLabel } from "./milestones";

describe("milestones", () => {
  it("are labelled by their distance from the week: W−n, W, W+n", () => {
    expect(milestoneLabel(42)).toBe("W−42");
    expect(milestoneLabel(0)).toBe("W");
    expect(milestoneLabel(-7)).toBe("W+7");
  });

  it("have a real date once the week has one — the opening Sunday minus the days — and none while it is TBD", () => {
    expect(fmtDate(milestoneDate("2027-02-14", 42)!)).toBe("3.1.2027");
    expect(fmtDate(milestoneDate("2027-02-14", 0)!)).toBe("14.2.2027");
    expect(fmtDate(milestoneDate("2027-02-14", -7)!)).toBe("21.2.2027");
    expect(fmtDate(milestoneDate("2027-03-07", 7)!)).toBe("28.2.2027"); // across a month end
    expect(milestoneDate(null, 42)).toBeNull();
  });

  it("are late when not done and their date has passed — never while the date is TBD", () => {
    const today = new Date(Date.UTC(2027, 0, 10));
    expect(isLate("2027-02-14", 42, false, today)).toBe(true); // 3.1
    expect(isLate("2027-02-14", 42, true, today)).toBe(false);
    expect(isLate("2027-02-14", 14, false, today)).toBe(false); // 31.1
    expect(isLate(null, 42, false, today)).toBe(false);
  });

  it("know today's date in Israel, whatever the device's zone", () => {
    expect(fmtDate(israelToday(new Date("2027-01-02T22:30:00Z")))).toBe("3.1.2027");
  });

  it("sort the furthest from the week first", () => {
    const m = [
      { id: 1, title: "ב", days_before: 7 },
      { id: 2, title: "א", days_before: 42 },
      { id: 3, title: "ג", days_before: -7 },
    ];
    expect([...m].sort(byDue).map((x) => x.id)).toEqual([2, 1, 3]);
  });
});
