import { describe, expect, it } from "vitest";
import type { KkData } from "../data/kk";
import { emptyWeek } from "../testing/week";
import { andList, groupName, kkSessions, kkStatus, leaderInput, leaderName, notYet, offered, traineeLeaders } from "./kk";
import type { RosterMember } from "./types";

const w = emptyWeek(); // opens Sunday 08:30 (510), closes Thursday at 19:00 (1140)
const roster: RosterMember[] = [
  { id: 1, full_name: "חניך/ה לדוגמה א׳", gender: null },
  { id: 2, full_name: "חניך/ה לדוגמה ב׳", gender: null },
  { id: 3, full_name: "חניך/ה לדוגמה ג׳", gender: null },
  { id: 4, full_name: "חניך/ה לדוגמה ד׳", gender: null },
];
const kk: KkData = {
  groups: [
    { id: 10, title: "ספר לדוגמה", author: null, place: "הדשא", capacity: 6, open: true },
    { id: 11, title: null, author: null, place: null, capacity: null, open: true },
    { id: 12, title: "ספר סגור", author: null, place: null, capacity: 4, open: false },
  ],
  leaders: [
    { id: 1, group_id: 10, kind: "trainee", roster_id: 1, label: null },
    { id: 2, group_id: 10, kind: "staff", roster_id: null, label: "מוביל/ה לדוגמה" },
    { id: 3, group_id: 11, kind: "ein_prat", roster_id: null, label: "מעין פרת לדוגמה" },
  ],
  signups: [{ id: 1, group_id: 10, roster_id: 2, via: "link", created_at: "2026-10-27T08:00:00.000Z" }],
  orders: [
    { group_id: 10, copies: 7, ordered_at: "2026-10-27T09:00:00.000Z" },
    { group_id: 11, copies: 3, ordered_at: "2026-10-27T09:00:00.000Z" },
  ],
};

describe("מכריכה לכריכה for the screens (v15)", () => {
  it("a default week has 8 sessions: Sunday–Wednesday, the evening and the night row (≡ app.kk_rows)", () => {
    const s = kkSessions(w.rows, w.edition);
    expect(s).toHaveLength(8);
    expect(s.map((x) => `${x.day}:${x.start_min}`)).toEqual(["0:1290", "0:1740", "1:1290", "1:1740", "2:1290", "2:1740", "3:1290", "3:1740"]);
    // Sunday opening at 22:30 drops Sunday's evening; Thursday until 22:30 adds Thursday's evening
    expect(kkSessions(w.rows, { ...w.edition, first_day_from: 1350 })[0]).toEqual({ day: 0, start_min: 1740, end_min: 1830 });
    expect(kkSessions(w.rows, { ...w.edition, last_day_until: 1350 }).filter((x) => x.day === 4)).toEqual([{ day: 4, start_min: 1290, end_min: 1350 }]);
  });

  it("a group is called by its book, or before the book by its leaders, or its place", () => {
    expect(groupName(kk.groups[0]!, kk, roster)).toBe("ספר לדוגמה");
    expect(groupName(kk.groups[1]!, kk, roster)).toBe("עוד לא נבחר ספר · מעין פרת לדוגמה");
    expect(groupName({ id: 99, title: null, place: "הספרייה" }, kk, roster)).toBe("עוד לא נבחר ספר · הספרייה");
    expect(groupName({ id: 99, title: null, place: null }, kk, roster)).toBe("עוד לא נבחר ספר");
    expect(andList(["א", "ב", "ג"])).toBe("א, ב ו-ג");
    expect(andList(["א", "ב"])).toBe("א ו-ב");
    expect(leaderName({ roster_id: 77, label: null }, roster)).toBe("חניך/ה שנמחק/ה");
  });

  it("leaders are in their group: not «עוד לא נרשמו», not counted among who may sign up", () => {
    expect([...traineeLeaders(kk)]).toEqual([1]);
    expect(notYet(roster, kk).map((r) => r.id)).toEqual([3, 4]);
    expect(kkStatus(kk, roster)).toEqual({ groups: 3, paired: 1, withBook: 2, offered: 1, signedUp: 1, eligible: 3, ordered: 1 });
  });

  it("offered = a book, a capacity, open", () => {
    expect(kk.groups.map(offered)).toEqual([true, false, false]);
    expect(offered({ title: null, capacity: 5, open: true })).toBe(false); // no book: a capacity and open are not enough
  });

  it("a name from the team list or typed by hand that is one trainee's is stored as that trainee", () => {
    expect(leaderInput("  חניך/ה  לדוגמה ג׳ ", roster)).toEqual({ kind: "trainee", roster_id: 3 });
    expect(leaderInput("חניך/ה לדוגמה ג'", roster)).toEqual({ kind: "trainee", roster_id: 3 }); // geresh or quote alike
    expect(leaderInput("מוביל/ה מהצוות", roster)).toBeNull();
    expect(leaderInput("   ", roster)).toBeNull();
    const twins = [...roster, { id: 5, full_name: "חניך/ה לדוגמה ג׳", gender: null }];
    expect(leaderInput("חניך/ה לדוגמה ג׳", twins)).toBeNull(); // two trainees by that name: the admin picks from the list
  });
});
