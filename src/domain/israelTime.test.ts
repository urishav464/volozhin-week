import { describe, expect, it } from "vitest";
import { addDays, israelDate, israelInstant, israelLocal, israelMidnight, israelMoment } from "./israelTime";

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
