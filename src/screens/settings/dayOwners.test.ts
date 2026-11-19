import { describe, expect, it } from "vitest";
import { dayOwnerCandidates, initialPicks } from "./DayOwnersPanel";

describe("«ימים»: who may own a day", () => {
  it("the team who handle speakers (content and admins), by name — never logistics", () => {
    const team = [
      { id: 5, display_name: "לוגיסטיקה לדוגמה", gender: null, role: "logistics" as const },
      { id: 3, display_name: "ב חניך/ה", gender: null, role: "content" as const },
      { id: 1, display_name: "מדריך/ה", gender: null, role: "admin" as const },
      { id: 2, display_name: "א חניך/ה", gender: null, role: "content" as const },
    ];
    expect(dayOwnerCandidates(team).map((t) => t.id)).toEqual([2, 3, 1]);
    expect(dayOwnerCandidates([])).toEqual([]);
  });

  it("a saved owner who may no longer own the day (deactivated: not in the team) is not offered, and the save leaves them out", () => {
    const candidates = [{ id: 3 }, { id: 4 }];
    expect(initialPicks([3, 4], candidates)).toEqual({ picks: [3, 4], gone: 0 });
    // owner 2 deactivated: set_day_owners would refuse [2, …] (app.can_handle) — the select starts without them
    expect(initialPicks([2, 3], candidates)).toEqual({ picks: [3, null], gone: 1 });
    expect(initialPicks([1, 2], candidates)).toEqual({ picks: [null, null], gone: 2 });
    expect(initialPicks([], candidates)).toEqual({ picks: [null, null], gone: 0 });
  });
});
