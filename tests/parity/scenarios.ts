// Scenarios that walk docs/CONTRACT.md clause by clause. Each runs on the
// engine and on the SQL; every step's result and the whole state after it
// must be identical.
import { FOREIGN_ROOM, type Step } from "./fixture";

export const SCENARIOS: Record<string, Step[]> = {
  "propose, claim, offer, give back": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", propose: "אלפא", cell: [1, 510, 600] }, // idempotent
    { as: "B", propose: "אלפא", cell: [2, 510, 600] }, // someone else's speaker
    { as: "B", propose: "אלפא", cell: [2, 510, 600], mode: "offer" },
    { as: "A", unpropose: "אלפא", at: [1, 510] }, // the plain cell comes back
    { as: "A", propose: "אלפא", cell: [1, 1140, 1200] }, // dinner is no lesson row
    { as: "A", propose: "אלפא", cell: [4, 1200, 1290] }, // Thursday after 19:00
    { as: "A", propose: "אלפא", cell: [0, 390, 435] }, // Sunday before the opening
    { as: "A", propose: "אלפא", cell: [1, 512, 600] }, // not on the 5-minute grid
    { as: "A", propose: "אלפא", cell: [1, 600, 690, FOREIGN_ROOM] }, // another edition's room
    { as: "A", propose: "וו", cell: [1, 600, 690] }, // retired
    { as: "L", propose: "גמא", cell: [1, 600, 690] }, // logistics may not
    { as: "A", propose: "הא", cell: [1, 600, 690] }, // unvetted → candidate only
    { as: "A", setPitch: "הא", at: [1, 600], state: "approached" },
  ],

  "close, supersede, withdraw, reopen": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", propose: "בטא", cell: [1, 510, 600] },
    { as: "A", propose: "אלפא", cell: [2, 600, 690] },
    { as: "B", close: "אלפא", at: [1, 510] }, // not B's
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "A", propose: "גמא", at: [1, 510] }, // a closed lesson takes no pitches
    { as: "B", reopen: [1, 510] },
    { as: "admin", reopen: [1, 510] },
    { as: "A", setPitch: "אלפא", at: [1, 510], state: "declined" },
    { as: "A", setPitch: "אלפא", at: [1, 510], state: "approached" },
  ],

  "closing refusals": [
    { as: "A", propose: "הא", cell: [1, 510, 600] },
    { as: "A", close: "הא", at: [1, 510] }, // not vetted
    { as: "A", propose: "דלתא", cell: [1, 600, 690] },
    { as: "A", close: "דלתא", at: [1, 600] }, // gender unknown
    { as: "A", propose: "בטא", cell: [2, 510, 600] },
    { as: "A", close: "בטא", at: [2, 510] },
    { as: "A", reshape: [2, 510], op: { op: "split_parallel", count: 2, reason: "שני מסלולים" } },
    { as: "A", propose: "בטא", at: [2, 510, "כיתה"] },
    { as: "A", close: "בטא", at: [2, 510, "כיתה"] }, // the same speaker, the same time
  ],

  "moving lessons": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "A", propose: "בטא", cell: [1, 600, 690] },
    { as: "A", close: "בטא", at: [1, 600] },
    { as: "A", move: [1, 510], to: [1, 600, 690] }, // the room is taken
    { as: "A", move: [1, 510], to: [1, 1140, 1200] }, // dinner
    { as: "B", move: [1, 510], to: [3, 870, 960] }, // not B's lesson
    { as: "A", move: [1, 510], to: [3, 870, 960] },
    { as: "A", move: [1, 600], to: [3, 870, 960, "כיתה"] }, // parallel in another room is fine
    { as: "B", propose: "גמא", cell: [4, 510, 600] },
    { as: "A", move: [4, 510], to: [4, 600, 690] }, // anyone may move a draft
    { as: "A", move: [4, 600], to: [4, 600, 690, FOREIGN_ROOM] }, // another edition's room
  ],

  "reshaping": [
    { as: "A", propose: "אלפא", cell: [1, 870, 960] },
    { as: "A", reshape: [1, 870], op: { op: "split_time", parts: [60, 30] } },
    { as: "A", reshape: [1, 510], op: { op: "split_time", parts: [60, 20] } },
    { as: "A", reshape: [1, 510], op: { op: "split_time", parts: [80, 10] } },
    { as: "A", reshape: [1, 870], op: { op: "reset" } },
    { as: "B", propose: "בטא", cell: [1, 1560, 1650] },
    { as: "A", reshape: [1, 1470], op: { op: "merge_next" } },
    { as: "A", reshape: [1, 1470], op: { op: "merge_next" } },
    { as: "A", reshape: [2, 1470], op: { op: "merge_next" } },
    { as: "A", propose: "גמא", cell: [3, 1560, 1650] },
    { as: "A", close: "גמא", at: [3, 1560] },
    { as: "A", reshape: [3, 1470], op: { op: "merge_next" } }, // would swallow a closed lesson
    { as: "A", reshape: [3, 960], op: { op: "split_parallel", count: 3, reason: "שלושה" } },
    { as: "A", reshape: [3, 960], op: { op: "split_parallel", count: 3, reason: "שוב" } }, // already 3
    { as: "A", reshape: [3, 1050], op: { op: "split_parallel", count: 2, reason: " " } },
    { as: "A", reshape: [3, 1140], op: { op: "reset" } }, // not a lesson row
    { as: "L", reshape: [3, 1050], op: { op: "reset" } },
  ],

  "editing and versions": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "A", update: [1, 510], patch: { title: "  כותרת  ", category: "פילוסופיה", teach_min: 75 } },
    { as: "A", update: [1, 510], patch: { title: "שוב" }, staleBy: 1 },
    { as: "A", update: [1, 510], patch: { teach_min: 120 } },
    { as: "A", update: [1, 510], patch: { audience: "שיעור להורים", category: null } },
  ],

  "an archived edition": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { archive: true },
    { as: "A", propose: "בטא", cell: [1, 600, 690] },
    { as: "admin", propose: "בטא", cell: [1, 600, 690] },
  ],
};
