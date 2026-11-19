import { describe, expect, it } from "vitest";
import { addDays, daysToWeek, israelDate, israelInstant, israelLocal, israelMidnight, israelMoment } from "./israelTime";

describe("days in Israel", () => {
  it("is the date in Israel, whatever the instant's zone", () => {
    expect(israelDate("2027-02-13T21:59:00Z")).toBe("2027-02-13"); // 23:59 in Israel (UTC+2)
    expect(israelDate("2027-02-13T22:00:00Z")).toBe("2027-02-14"); // midnight
    expect(israelDate("2027-06-12T21:00:00Z")).toBe("2027-06-13"); // summer: UTC+3
  });

  it("adds calendar days across months and years", () => {
    expect(addDays("2027-02-14", 5)).toBe("2027-02-19");
    expect(addDays("2027-02-14", -7)).toBe("2027-02-07");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("finds 00:00 in Israel in winter, in summer, and on the days the clock changes", () => {
    expect(israelMidnight("2027-02-19")).toBe("2027-02-18T22:00:00.000Z");
    expect(israelMidnight("2027-06-18")).toBe("2027-06-17T21:00:00.000Z");
    expect(israelMidnight("2026-10-25")).toBe("2026-10-24T21:00:00.000Z"); // summer time ends at 02:00 that night
    expect(israelMidnight("2027-03-26")).toBe("2027-03-25T22:00:00.000Z"); // summer time starts at 02:00 that night
  });

  it("reads and writes Israel's wall clock for the sign-up window's fields, whatever the device's zone", () => {
    expect(israelInstant("2027-01-10T20:00")).toBe("2027-01-10T18:00:00.000Z"); // winter: UTC+2
    expect(israelInstant("2027-06-10T20:00")).toBe("2027-06-10T17:00:00.000Z"); // summer: UTC+3
    expect(israelInstant("2027-03-26T02:30")).toBeNull(); // the hour the clock skips
    expect(israelInstant("2026-10-25T01:30")).toBe("2026-10-24T22:30:00.000Z"); // the repeated hour: the first of the two
    expect(israelInstant("10.1.2027 20:00")).toBeNull();
    expect(israelInstant("")).toBeNull();
    expect(israelLocal("2027-01-10T18:00:00.000Z")).toBe("2027-01-10T20:00");
    expect(israelLocal(israelInstant("2027-06-10T09:05")!)).toBe("2027-06-10T09:05");
    expect(israelMoment("2027-01-10T18:00:00.000Z")).toBe("10.1.2027 20:00");
    expect(israelMoment("2026-10-19T22:30:00Z")).toBe("20.10.2026 01:30");
  });
});

describe("daysToWeek (the logistics home's «קרוב לשבוע»)", () => {
  it("is null while the week's date is TBD", () => {
    expect(daysToWeek(null, "2027-02-01T10:00:00Z")).toBeNull();
    expect(daysToWeek(undefined, "2027-02-01T10:00:00Z")).toBeNull();
    expect(daysToWeek("", "2027-02-01T10:00:00Z")).toBeNull();
    expect(daysToWeek("TBD", "2027-02-01T10:00:00Z")).toBeNull();
  });

  it("counts Israel's calendar days: the day turns at 00:00 in Israel, not in UTC", () => {
    // the week starts on Sunday 14.2.2027; Israel is UTC+2 in winter
    expect(daysToWeek("2027-02-14", "2027-02-12T21:59:00Z")).toBe(2); // 23:59 on Friday in Israel
    expect(daysToWeek("2027-02-14", "2027-02-12T22:00:00Z")).toBe(1); // 00:00 on Saturday
    expect(daysToWeek("2027-02-14", "2027-02-13T21:59:59Z")).toBe(1);
    expect(daysToWeek("2027-02-14", "2027-02-13T22:00:00Z")).toBe(0); // the day itself, from its midnight
    expect(daysToWeek("2027-02-14", "2027-02-14T21:00:00Z")).toBe(0);
    expect(daysToWeek("2027-02-14", "2027-02-14T22:00:00Z")).toBe(-1); // it began yesterday
    expect(daysToWeek("2027-02-14", "2027-01-24T10:00:00Z")).toBe(21);
  });

  it("across months, years and a summer-time change (whole days, never 0.96 of one)", () => {
    expect(daysToWeek("2027-01-03", "2026-12-30T12:00:00Z")).toBe(4);
    expect(daysToWeek("2027-04-04", "2027-03-21T12:00:00Z")).toBe(14); // summer time starts on 26.3
    expect(daysToWeek("2027-06-13", "2027-06-12T21:00:00Z")).toBe(0); // summer: UTC+3 — 00:00 on the 13th in Israel
    expect(daysToWeek("2027-06-13", "2027-06-12T20:59:00Z")).toBe(1);
  });
});
