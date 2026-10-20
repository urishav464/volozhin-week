// «איך עבר»'s window and the end of the week, in Israel time whatever the device's clock zone; which year is
// «earlier»; and what a review keeps (cleanReview — the same refusals as save_lesson_review).
import { describe, expect, it } from "vitest";
import { CommandError } from "../data/commands";
import { cleanReview, EMPTY_REVIEW } from "../data/reviews";
import { earlierEdition, purgeAllowed, reviewOpensOn, reviewWindow, weekOver } from "./reviews";

const code = (f: () => unknown) => {
  try {
    f();
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : String(e);
  }
};

describe("reviewOpensOn", () => {
  it("is the day after the calendar day the lesson ends on", () => {
    expect(reviewOpensOn("2027-02-14", 0, 600)).toBe("2027-02-15"); // Sunday 08:30–10:00 → Monday
    expect(reviewOpensOn("2027-02-14", 1, 600)).toBe("2027-02-16"); // Monday → Tuesday
    expect(reviewOpensOn("2027-02-14", 4, 1140)).toBe("2027-02-19"); // Thursday's last → Friday
  });

  it("a night lesson in a day's column ends on the next date — and one ending at midnight ends on its own", () => {
    expect(reviewOpensOn("2027-02-14", 1, 1560)).toBe("2027-02-17"); // Monday's column 00:30–02:00 is Tuesday's night → Wednesday
    expect(reviewOpensOn("2027-02-14", 1, 1440)).toBe("2027-02-16"); // 22:30–24:00 ends with Monday → Tuesday
    expect(reviewOpensOn("2027-02-14", 1, 1441)).toBe("2027-02-17");
    expect(reviewOpensOn("2027-02-28", 3, 1830)).toBe("2027-03-05"); // across a month's end
  });
});

describe("reviewWindow, in Israel time", () => {
  const lesson = { day: 1, end_min: 600 }; // Monday 10:00 of a week opening 2027-02-14
  const edition = { start_date: "2027-02-14" };

  it("is closed while the week's date is TBD", () => {
    expect(reviewWindow({ start_date: null }, lesson, "2027-03-01T10:00:00.000Z")).toEqual({ state: "tbd" });
  });

  it("opens at 00:00 in Israel on the day after — 22:00 UTC in winter, whatever the device's zone says", () => {
    expect(reviewWindow(edition, lesson, "2027-02-15T21:59:59.000Z")).toEqual({ state: "before", opensOn: "2027-02-16" }); // 23:59:59 Monday in Israel
    expect(reviewWindow(edition, lesson, "2027-02-15T22:00:00.000Z")).toEqual({ state: "open", opensOn: "2027-02-16" }); // 00:00 Tuesday in Israel, still Monday in UTC
    expect(reviewWindow(edition, lesson, "2027-02-14T08:00:00.000Z").state).toBe("before");
  });

  it("in summer time Israel is UTC+3: the day turns at 21:00 UTC", () => {
    const summer = { start_date: "2027-06-06" };
    expect(reviewWindow(summer, lesson, "2027-06-07T20:59:00.000Z").state).toBe("before");
    expect(reviewWindow(summer, lesson, "2027-06-07T21:00:00.000Z").state).toBe("open");
  });
});

describe("the end of the week", () => {
  it("is Friday 00:00 in Israel (start_date + 5), never while the date is TBD", () => {
    expect(weekOver({ start_date: null }, "2030-01-01T00:00:00.000Z")).toBe(false);
    expect(weekOver({ start_date: "2027-02-14" }, "2027-02-18T21:59:00.000Z")).toBe(false); // Thursday 23:59 in Israel
    expect(weekOver({ start_date: "2027-02-14" }, "2027-02-18T22:00:00.000Z")).toBe(true); // Friday 00:00 in Israel
  });

  it("a purge is allowed once the week is over, or in an archive whatever its date", () => {
    const live = { start_date: "2027-02-14", kind: "real" as const, status: "active" as const };
    expect(purgeAllowed(live, "2027-02-17T10:00:00.000Z")).toBe(false);
    expect(purgeAllowed(live, "2027-02-20T10:00:00.000Z")).toBe(true);
    expect(purgeAllowed({ ...live, start_date: null, status: "archived" }, "2027-02-17T10:00:00.000Z")).toBe(true);
    expect(purgeAllowed({ start_date: null, kind: "archive", status: "planning" }, "2027-02-17T10:00:00.000Z")).toBe(true);
    expect(purgeAllowed({ ...live, start_date: null }, "2030-02-17T10:00:00.000Z")).toBe(false);
  });
});

describe("earlierEdition", () => {
  const year = (start_date: string | null, kind: "real" | "archive" | "practice" = "real", status: "planning" | "active" | "archived" = "planning") => ({ start_date, kind, status });
  it("compares the weeks' dates when both are known", () => {
    expect(earlierEdition(year("2026-02-15", "real", "archived"), year("2027-02-14"))).toBe(true);
    expect(earlierEdition(year("2028-02-13", "archive"), year("2027-02-14"))).toBe(false);
  });
  it("without a date, a past year (an archive, an archived real edition) is earlier than one that is not", () => {
    expect(earlierEdition(year(null, "archive"), year(null))).toBe(true);
    expect(earlierEdition(year(null, "real", "archived"), year("2027-02-14"))).toBe(true);
    expect(earlierEdition(year(null), year(null, "archive"))).toBe(false);
    expect(earlierEdition(year(null, "archive"), year(null, "real", "archived"))).toBe(false);
  });
});

describe("cleanReview", () => {
  it("keeps what was said: blocks trimmed, an answer, a rating", () => {
    expect(cleanReview({ went_well: "  טוב\r\nמאוד  ", issues: "", invite_again: "yes", overran: false, rating: 4 })).toEqual({
      went_well: "טוב\nמאוד", issues: null, invite_again: "yes", overran: false, rating: 4,
    });
    expect(cleanReview({ ...EMPTY_REVIEW, overran: true })).toEqual({ ...EMPTY_REVIEW, overran: true });
  });
  it("refuses nothing at all, a text over 2000, an answer outside yes/no/maybe, a rating outside 1–5", () => {
    expect(code(() => cleanReview(EMPTY_REVIEW))).toBe("review_empty");
    expect(code(() => cleanReview({ ...EMPTY_REVIEW, went_well: "  \n " }))).toBe("review_empty");
    expect(code(() => cleanReview({ ...EMPTY_REVIEW, issues: "א".repeat(2001) }))).toBe("bad_value");
    expect(code(() => cleanReview({ ...EMPTY_REVIEW, went_well: "א".repeat(2000) }))).toBe("ok");
    expect(code(() => cleanReview({ ...EMPTY_REVIEW, invite_again: "always" as never }))).toBe("bad_value");
    for (const r of [0, 6, 2.5]) expect(code(() => cleanReview({ ...EMPTY_REVIEW, rating: r })), String(r)).toBe("bad_value");
  });
});
