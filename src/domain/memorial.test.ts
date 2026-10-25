// Memorial times as the screens read them: the yellow card's words (the fallen, the family's status, the minutes —
// never a contact), the slot picker's free slots (a plan's own included, another plan's never), the day's rows.
import { describe, expect, it } from "vitest";
import { demoWeek } from "../data/demoWeek";
import { trackingRows } from "../exports/tracking";
import { freeSlots, memorialCard, memorialRowsOf, memorialSlots, slotLabel } from "./memorial";
import { LRM } from "./time";

describe("memorial times on screen", () => {
  it("draw the yellow card: the fallen's name, the family's status and the planned minutes — an empty slot says so", () => {
    const w = demoWeek();
    const [sun, mon] = memorialSlots(w);
    expect(memorialCard(w, sun)).toMatchObject({ title: "זמן זיכרון – חלל/ה לדוגמה 1", line: "המשפחה אישרה · 10 דק׳ · בלי חריגה" });
    expect(memorialCard(w, mon)).toMatchObject({ title: "זמן זיכרון", line: "עוד לא שובץ/ה חלל/ה", plan: null });
    w.memorialPlans[1].lesson_id = mon.id;
    expect(memorialCard(w, mon).line).toBe("המשפחה הוזמנה · 20 דק׳");
    w.memorialPlans[2].lesson_id = mon.id;
    w.memorialPlans[1].lesson_id = null;
    expect(memorialCard(w, mon).line).toBe("עוד לא נוצר קשר · משך לא נקבע");
    expect(JSON.stringify(memorialSlots(w).map((l) => memorialCard(w, l)))).not.toMatch(/טלפון|@/);
  });

  it("offer a plan the free slots and its own — never one another plan holds", () => {
    const w = demoWeek();
    const slots = memorialSlots(w);
    const held = w.memorialPlans[0]; // on Sunday's slot
    expect(freeSlots(w, w.memorialPlans[1]).map((l) => l.id)).toEqual(slots.slice(1).map((l) => l.id));
    expect(freeSlots(w, held).map((l) => l.id)).toEqual(slots.map((l) => l.id));
    // plain text (an <option>): an LRM right before the range keeps it 13:00–13:15 among the Hebrew, not 13:15–13:00
    expect(slotLabel(w, slots[0])).toMatch(new RegExp(`^ראשון ${LRM}13:00–13:15 · `));
  });

  it("list a day's memorial rows inside the edition's window", () => {
    const w = demoWeek();
    expect(memorialRowsOf(w, 0).map((r) => [r.label, r.start_min])).toEqual([["זמן זיכרון", 780], ["זמן זיכרון", 855]]);
    w.edition.last_day_until = 800; // Thursday ends at 13:20: the 14:15 row is gone
    expect(memorialRowsOf(w, 4).map((r) => r.start_min)).toEqual([780]);
  });

  it("name the fallen and the liaison in the tracking table's memorial row — never a contact", () => {
    const w = demoWeek();
    const rows = trackingRows(w).filter((r) => r.stage === "memorial");
    expect(rows[0]).toMatchObject({ title: "זמן זיכרון – חלל/ה לדוגמה 1", escort: "מלווה לדוגמה ד׳", speaker: "" });
    expect(rows[1]).toMatchObject({ title: "זמן זיכרון", escort: "" });
  });
});
