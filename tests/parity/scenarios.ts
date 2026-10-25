// Scenarios that walk docs/CONTRACT.md clause by clause. Each runs on the
// engine and on the SQL; every step's result and the whole state after it
// must be identical.
import { addDays, israelDate } from "../../src/domain/israelTime";
import { EDITION, FOREIGN_EDITION, FOREIGN_ROOM, FOREIGN_TRAINEE, type ImportLessonStep, type ImportSpeakerStep, type Step } from "./fixture";

// Dates and instants relative to now, fixed once for both drivers: the links' rules count from today.
const NOW = Date.now();
const dateIn = (days: number) => addDays(israelDate(new Date(NOW).toISOString()), days);
const isoIn = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

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

  // v13 review: a time split never deletes a lesson only partly in the cell — a parallel draft moved to straddle it
  "a time split refuses a lesson that sticks out of the cell": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", reshape: [1, 510], op: { op: "merge_next" } }, // 08:30–11:30, בית מדרש
    { as: "A", reshape: [1, 960], op: { op: "split_parallel", count: 2, reason: "שני מסלולים" } }, // a 16:00 draft in כיתה
    { as: "A", propose: "גמא", at: [1, 960, "כיתה"] },
    { as: "A", move: [1, 960, "כיתה"], to: [1, 600, 690, "כיתה"] }, // 10:00–11:30: inside the merged cell's range
    { as: "A", move: [1, 600, "כיתה"], to: [1, 690, 780, "כיתה"] }, // 11:30–13:00: outside it
    { as: "A", move: [1, 690, "כיתה"], to: [1, 600, 690, "כיתה"] },
    { as: "A", reshape: [1, 510], op: { op: "split_time", parts: [90, 90] } }, // inside the cell: both drafts go, the pitches to the first part
    { as: "A", propose: "בטא", cell: [3, 510, 600] },
    { as: "A", reshape: [3, 510], op: { op: "merge_next" } }, // 08:30–11:30
    { as: "A", reshape: [3, 960], op: { op: "split_parallel", count: 2, reason: "שני מסלולים" } },
    { as: "A", reshape: [3, 960], op: { op: "merge_next" } }, // would swallow — refused or merged, alike on both
    { as: "A", propose: "גמא", at: [3, 960, "כיתה"] },
    { as: "A", move: [3, 960, "כיתה"], to: [3, 600, 780, "כיתה"] }, // 10:00–13:00 in כיתה: sticks out of 08:30–11:30
    { as: "A", reshape: [3, 510], op: { op: "split_time", parts: [90, 90] } }, // refused — the draft is not deleted whole
  ],

  // v13: the grid's soft rules, the instructor's — never seeded; null brings back the «הצעה» default
  "the grid's rules": [
    { as: "A", gridRules: { gender_tolerance: 2, max_category_per_day: null } }, // content: not theirs
    { as: "E", gridRules: { gender_tolerance: 6, max_category_per_day: null } },
    { as: "E", gridRules: { gender_tolerance: null, max_category_per_day: 0 } },
    { as: "E", gridRules: { gender_tolerance: 0, max_category_per_day: 2 } },
    { as: "E", gridRules: { gender_tolerance: 2, max_category_per_day: null } }, // the maximum back to its default
    { as: "admin", gridRules: { gender_tolerance: null, max_category_per_day: null } },
  ],

  // v13: a merged cell splits whole — never one-row drafts beside it (the instructor's report)
  "splitting a merged cell": [
    { as: "A", propose: "אלפא", cell: [2, 510, 600] },
    { as: "A", reshape: [2, 510], op: { op: "merge_next" } }, // 08:30–11:30
    { as: "A", reshape: [2, 510], op: { op: "split_parallel", count: 2, reason: "שני מסלולים" } }, // one more 08:30–11:30
    { as: "A", reshape: [2, 600], op: { op: "split_parallel", count: 3, reason: "שלושה" } }, // from its second row: the same cell
    { as: "A", reshape: [2, 510], op: { op: "split_parallel", count: 3, reason: "שוב" } }, // already 3
    { as: "A", reshape: [2, 510], op: { op: "split_time", parts: [90, 90] } }, // all three go; אלפא's pitch to the first part
    { as: "A", reshape: [2, 510], op: { op: "merge_next" } },
    { as: "A", reshape: [2, 510], op: { op: "split_time", parts: [90, 60] } }, // not the cell's length
    { as: "A", reshape: [2, 510], op: { op: "split_time", parts: [60, 120] } }, // the second part spans two rows, as a merged lesson does
    { as: "A", reshape: [3, 1200], op: { op: "merge_next" } }, // 20:00–00:00, over מכריכה לכריכה
    { as: "A", reshape: [3, 1350], op: { op: "split_time", parts: [90, 150] } }, // the second part would start in מכריכה לכריכה
    { as: "A", reshape: [3, 1350], op: { op: "split_time", parts: [60, 180] } },
    { as: "A", propose: "בטא", cell: [3, 510, 600] },
    { as: "A", close: "בטא", at: [3, 510] },
    { as: "A", reshape: [3, 510], op: { op: "merge_next" } }, // a closed lesson merged
    { as: "A", reshape: [3, 600], op: { op: "split_time", parts: [90, 90] } }, // its cell is closed
    { as: "A", reshape: [3, 600], op: { op: "split_parallel", count: 2, reason: "מקביל לסגור" } }, // a draft beside it, its whole length
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
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "E", updateSpeaker: "אלפא", patch: { affiliation: "מוסד" } }, // this year's admin edits the pool's record
    { as: "admin", vet: ["אלפא"], state: "rejected" }, // a closed lesson this year stands
    { archive: true },
    { as: "A", propose: "בטא", cell: [1, 600, 690] },
    { as: "admin", propose: "בטא", cell: [1, 600, 690] },
    { as: "A", claim: "גמא" },
    { as: "A", create: { name: "מרצה חדשה לגמרי" } },
    { as: "A", setStatus: "אלפא", status: "no_answer" },
    { as: "admin", create: { name: "מרצה חדשה לגמרי", gender: "f" } },
    { as: "E", updateSpeaker: "אלפא", patch: { affiliation: "מוסד אחר" } }, // last year's admin: no longer
    { as: "E", claim: "דלתא" }, // an admin may still write in an archive…
    { as: "E", updateSpeaker: "דלתא", patch: { gender: "f" } }, // …but not the pool's record, even as the handler
    { as: "admin", vet: ["אלפא"], state: "rejected", note: "לא השנה" }, // last year's lesson pins nothing
    { as: "admin", updateSpeaker: "אלפא", patch: { retired: true } },
  ],

  "a practice week: the real pool, no right over it": [
    { sandbox: true },
    { as: "A", claim: "אלפא" },
    { as: "A", readContacts: "אלפא" },
    { as: "A", updateSpeaker: "אלפא", patch: { name: "שם אחר", gender: "m", bio_short: "ביו שהוחלף" } },
    { as: "E", updateSpeaker: "גמא", patch: { affiliation: "מוסד" } }, // the practice week's admin
    { as: "admin", updateSpeaker: "גמא", patch: { affiliation: "מוסד" } }, // a global admin, from anywhere
    { as: "A", create: { name: "מרצה חדשה מתרגול", gender: "f" }, opts: { claim: true } }, // into the real pool, pending
    { as: "A", updateSpeaker: "מרצה חדשה מתרגול", patch: { bio_short: "ביו" } }, // not even its creator, from here
    { as: "A", propose: "בטא", cell: [1, 510, 600] },
    { as: "A", close: "בטא", at: [1, 510] },
    { as: "A", setStatus: "בטא", status: "declined" }, // its own edition's closed lesson still stands
    { as: "admin", vet: ["בטא"], state: "rejected", note: "x" }, // a practice lesson pins nothing in the pool
    { as: "admin", updateSpeaker: "בטא", patch: { gender: null, retired: true } },
  ],

  // ------------------------------------------------------------ the speaker pool (milestone 2)

  "create: search first, the same name, a namesake, a similar name": [
    { as: "A", matches: "אלפא" },
    { as: "A", matches: "  " }, // nothing to search
    { as: "A", create: { name: "אלפא" } }, // the same person
    { as: "A", create: { name: "הרב  אלפא", disambiguator: " " } }, // a title and spacing do not make a new name
    { as: "A", create: { name: "אלפא", disambiguator: "ירושלים" } }, // a namesake: still «ייתכן שזה…» first
    { as: "A", create: { name: "אלפא", disambiguator: "ירושלים" }, opts: { confirmed: true } },
    { as: "B", create: { name: "אלפא", disambiguator: "ירושלים" }, opts: { confirmed: true } }, // that namesake exists now
    { as: "A", matches: "אלפא" },
    { as: "A", matches: "פלונית אלמוני" }, // trigram ≥ 0.6
    { as: "A", matches: "פלונית כהן" }, // 0.44: no
    { as: "A", matches: "יוסף בן-שמעון" }, // the same key
    { as: "A", create: { name: "פלונית אלמוני", gender: "f" } },
    { as: "A", create: { name: "פלונית אלמוני", gender: "f", topics: ["תנ\"ך"] }, opts: { confirmed: true, claim: true } },
    { as: "A", setContacts: "פלונית אלמוני", phone: "555 0100 99" }, // the creator claimed: theirs to write
    { as: "A", readContacts: "פלונית אלמוני" },
    { as: "B", create: { name: "פלונית אלמוני", disambiguator: "חיפה" } }, // a namesake of the new one
    { as: "B", create: { name: "פלונית אלמוני", disambiguator: "חיפה" }, opts: { confirmed: true } },
  ],

  "create: the fields, who may, approving at once": [
    { as: "A", create: { name: "   " } },
    { as: "A", create: { name: "הרב" } }, // a title alone is a name — and nothing like anyone
    { as: "A", create: { name: "א".repeat(121) } },
    { as: "A", create: { name: "מרצה חדשה", title: "מר" } }, // not one of the titles
    { as: "A", create: { name: "מרצה חדשה", gender: "x" } },
    { as: "A", create: { name: "מרצה חדשה", contact_pref: "fax" } },
    { as: "A", create: { name: "מרצה חדשה", topics: "תנ\"ך" } },
    { as: "A", create: { name: "מרצה חדשה", topics: ["א".repeat(41)] } },
    { as: "A", create: { name: "מרצה חדשה", topics: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"] } },
    { as: "A", create: { name: "מרצה חדשה", bio_short: "ב".repeat(401) } },
    { as: "A", create: { name: "מרצה חדשה" }, opts: { approve: true } }, // only a global admin approves
    { as: "L", create: { name: "מרצה חדשה" } },
    {
      as: "A",
      create: {
        name: "  מרצה \t חדשה ", title: "ד״ר", gender: "f", affiliation: " מוסד   לדוגמה ", bio_short: "  שורה\r\nשנייה  ",
        topics: ["תנ\"ך", " תנ\"ך ", "", "פילוסופיה", "1", "2", "3", "4", "5", "6", "7", "8"], contact_pref: "whatsapp",
      },
    },
    { as: "admin", create: { name: "מרצה נוספת", gender: "f" }, opts: { approve: true, confirmed: true } },
  ],

  "editing a speaker: the handler or an admin": [
    { as: "B", updateSpeaker: "אלפא", patch: { bio_short: "ביו" } }, // nobody's yet: not B's
    { as: "A", claim: "אלפא" },
    { as: "B", claim: "אלפא" },
    { as: "A", claim: "אלפא" }, // already mine
    { as: "A", updateSpeaker: "אלפא", patch: { bio_short: " ביו לדוגמה ", topics: ["תנ\"ך"], contact_pref: "whatsapp", title: "הרבנית", ignored: 1 } },
    { as: "A", updateSpeaker: "אלפא", patch: { bio_short: "שוב" }, staleBy: 1 },
    { as: "A", updateSpeaker: "אלפא", patch: { bio_short: " ביו לדוגמה " } }, // nothing changes: no new version
    { as: "A", updateSpeaker: "אלפא", patch: { contact_pref: "fax" } },
    { as: "A", updateSpeaker: "אלפא", patch: { name: " " } },
    { as: "A", updateSpeaker: "אלפא", patch: { name: "בטא" } }, // someone else's name
    { as: "A", updateSpeaker: "אלפא", patch: { retired: true } }, // a global admin's
    { as: "B", updateSpeaker: "אלפא", patch: { gender: "m" } },
    { as: "admin", updateSpeaker: "גמא", patch: { gender: null, affiliation: "מוסד" } },
    { as: "admin", updateSpeaker: "גמא", patch: { retired: "yes" } },
    { as: "admin", updateSpeaker: "גמא", patch: { retired: true } },
    { as: "A", claim: "גמא" }, // retired
    { as: "L", updateSpeaker: "גמא", patch: { affiliation: "x" } },
    { as: "A", updateSpeaker: "אלפא", patch: { name: "בטא", disambiguator: "חיפה" } }, // a namesake, told apart
  ],

  "vetting: the global admin, one or a batch, never under a closed lesson": [
    { as: "A", vet: ["הא"], state: "approved" },
    { as: "admin", vet: ["הא", "יוסף בן שמעון"], state: "approved", note: "  נבדק  " },
    { as: "admin", vet: ["הא"], state: "approved", note: "נבדק" }, // already so: no new version
    { as: "admin", vet: ["הא"], state: "maybe" },
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "admin", vet: ["בטא", "אלפא"], state: "rejected", note: "x" }, // the whole batch waits
    { as: "admin", vet: ["בטא"], state: "rejected", note: "לא מתאים השנה" },
    { as: "A", propose: "בטא", cell: [1, 600, 690] }, // a rejected speaker: a candidate only
    { as: "A", setPitch: "בטא", at: [1, 600], state: "approached" },
    { as: "A", updateSpeaker: "אלפא", patch: { gender: null } },
    { as: "admin", updateSpeaker: "אלפא", patch: { retired: true } },
    { as: "admin", reopen: [1, 510] },
    { as: "admin", vet: ["אלפא"], state: "pending" },
  ],

  "approach statuses, notes, «סירב/ה»": [
    { as: "A", claim: "בטא" },
    { as: "A", setStatus: "בטא", status: "approached", note: "  שלחתי הודעה " },
    { as: "B", setStatus: "בטא", status: "positive" },
    { as: "A", setStatus: "בטא", status: "positive", staleBy: 1 },
    { as: "A", setStatus: "בטא", status: "maybe" },
    { as: "A", setStatus: "בטא", status: "no_answer", note: "ש".repeat(201) },
    { as: "A", setStatus: "בטא", status: "no_answer" },
    { as: "A", setStatus: "בטא", status: "no_answer" }, // the same, no note: nothing
    { as: "A", setStatus: "בטא", status: "no_answer", note: "עוד ניסיון" }, // the same, with a note: logged
    { as: "A", claim: "הא" }, // not yet approved: may be claimed…
    { as: "A", setStatus: "הא", status: "approached" }, // …not approached
    { as: "A", setStatus: "הא", status: "declined" },
    { as: "A", propose: "בטא", cell: [2, 510, 600] },
    { as: "A", propose: "בטא", cell: [2, 600, 690] },
    { as: "A", setStatus: "בטא", status: "declined", note: "לא פנוי השנה" }, // every live pitch too
    { as: "A", setStatus: "בטא", status: "positive" },
    { as: "A", propose: "גמא", cell: [3, 510, 600] },
    { as: "A", close: "גמא", at: [3, 510] },
    { as: "A", setStatus: "גמא", status: "declined" }, // a closed lesson stands
    { as: "admin", setStatus: "גמא", status: "positive", note: "אושר בטלפון" },
    { as: "L", setStatus: "בטא", status: "approached" },
    { as: "A", setStatus: "דלתא", status: "approached" }, // no approach
  ],

  "hand-over: offer, answer, admin reassigns; the grid's offer still works": [
    { as: "A", claim: "בטא" },
    { as: "B", handOver: "בטא", to: "B" }, // not B's to give
    { as: "A", handOver: "בטא", to: "A" },
    { as: "A", handOver: "בטא", to: "L" }, // logistics handles no speaker
    { as: "A", handOver: "בטא", to: "B", note: "מכיר אותו" },
    { as: "A", answerHandOver: "בטא", accept: true }, // not offered to A
    { as: "B", propose: "בטא", cell: [1, 510, 600] }, // still A's
    { as: "B", propose: "בטא", cell: [1, 510, 600], mode: "offer" }, // «מטופל ע"י X»: offer the cell to A
    { as: "B", answerHandOver: "בטא", accept: false },
    { as: "B", answerHandOver: "בטא", accept: true }, // nothing waits any more
    { as: "A", handOver: "בטא", to: "B" },
    { as: "A", handOver: "בטא", to: null }, // withdrawn
    { as: "A", handOver: "בטא", to: null }, // nothing to withdraw
    { as: "A", handOver: "בטא", to: "B" },
    { as: "B", answerHandOver: "בטא", accept: true, note: "לקחתי" },
    { as: "A", setStatus: "בטא", status: "approached" }, // B's now
    { as: "admin", handOver: "בטא", to: "A" }, // an admin reassigns at once
    { as: "admin", handOver: "בטא", to: "L" },
    { as: "admin", handOver: "בטא", to: null }, // back to the pool
    { as: "A", setPitch: "בטא", at: [1, 510], state: "declined" }, // nobody's approach is nobody's to change
    { as: "A", close: "בטא", at: [1, 510] },
    { as: "B", unpropose: "בטא", at: [1, 510] }, // the proposer may still take it back
    { as: "L", handOver: "בטא", to: "B" },
    { as: "A", claim: "בטא" }, // nobody's: anyone may take it
  ],

  "availability chips: a part of a day, cut from older ranges": [
    { as: "A", avail: "בטא", day: 1, part: "morning", kind: "can" }, // no approach
    { as: "A", claim: "בטא" },
    { as: "A", avail: "בטא", day: 1, part: "morning", kind: "can", note: " רק אחרי 9 " },
    { as: "A", avail: "בטא", day: 1, part: "night", kind: "cannot" },
    { as: "A", avail: "בטא", day: 1, part: "morning", kind: "cannot" },
    { as: "A", avail: "בטא", day: 1, part: "morning", kind: null, note: "נשכח" },
    { as: "A", avail: "בטא", day: 5, part: "morning", kind: "can" },
    { as: "A", avail: "בטא", day: 1, part: "noon", kind: "can" },
    { as: "A", avail: "בטא", day: 1, part: "evening", kind: "maybe" },
    { as: "B", avail: "בטא", day: 2, part: "evening", kind: "can" },
    { as: "admin", avail: "בטא", day: 2, part: "evening", kind: "can" },
    { as: "L", avail: "בטא", day: 2, part: "evening", kind: "can" },
    { as: "B", avail: "זין", day: 2, part: "evening", kind: "cannot" }, // 20:00–06:30 → the night is left
    { as: "B", avail: "זין", day: 3, part: "afternoon", kind: "can" }, // 11:40–20:00 → a piece on each side
    { as: "B", avail: "זין", day: 2, part: "night", kind: null },
  ],

  "contacts: the handler in the current real edition, and the admin": [
    { as: "B", readContacts: "אלפא" },
    { as: "admin", readContacts: "אלפא" },
    { as: "A", readContacts: "אלפא" },
    { as: "A", setContacts: "אלפא", phone: "555 0100 99" },
    { as: "A", claim: "אלפא" },
    { as: "A", readContacts: "אלפא" },
    { as: "L", readContacts: "אלפא" },
    { as: "A", setContacts: "אלפא", phone: "12-34" },
    { as: "A", setContacts: "אלפא", phone: "555 0100 99", email: "not-an-address" },
    { as: "A", setContacts: "אלפא", phone: "5".repeat(41) },
    { as: "A", setContacts: "אלפא", phone: " 555  0100 99 ", email: "speaker@example.org", secretary_note: "  דרך המזכירות\r\nבבוקר ", notes: null },
    { as: "A", setContacts: "אלפא", phone: "555 0100 99", email: "speaker@example.org", secretary_note: "דרך המזכירות\nבבוקר" }, // nothing changes
    { as: "A", readContacts: "אלפא" },
    { as: "B", readContacts: "אלפא" },
    { as: "admin", setContacts: "בטא", phone: null, email: "b@example.org" }, // an admin, no approach needed
    { as: "A", readContacts: "בטא" },
    { as: "A", setContacts: "בטא", phone: null }, // nothing to write: still not A's
    { as: "A", handOver: "אלפא", to: "B" },
    { as: "B", readContacts: "אלפא" }, // an offer is not a hand-over yet
    { as: "B", answerHandOver: "אלפא", accept: true },
    { as: "B", readContacts: "אלפא" },
    { as: "A", readContacts: "אלפא" },
    { archive: true },
    { as: "B", readContacts: "אלפא" }, // last year's handler
    { as: "B", setContacts: "אלפא", phone: null },
    { as: "admin", readContacts: "אלפא" },
  ],

  // ------------------------------------------------------------ from placement to arrival (milestone 3)

  "payment and transport: ask, decide, change, ask again": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", pay: [1, 510], amount: 500, transport: "none" }, // a draft: not yet
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "B", pay: [1, 510], amount: 500, transport: "none" }, // not B's speaker
    { as: "L", pay: [1, 510], amount: 500, transport: "none" }, // logistics asks for nothing
    { as: "A", pay: [1, 510], amount: 1.5, transport: "none" },
    { as: "A", pay: [1, 510], amount: 0, transport: "none" },
    { as: "A", pay: [1, 510], amount: 100001, transport: "none" },
    { as: "A", pay: [1, 510], amount: 500, transport: "bus" },
    { as: "A", pay: [1, 510], amount: 500, transport: "none", staleBy: 1 },
    { as: "A", pay: [1, 510], amount: null, transport: "none" }, // nothing asked, as before: nothing
    { as: "A", pay: [1, 510], amount: 500, transport: "round_trip" }, // → pending
    { as: "A", pay: [1, 510], amount: 500, transport: "round_trip" }, // the same again: nothing
    { as: "A", decide: [[1, 510]], decision: "approved" }, // only a global admin decides
    { as: "E", decide: [[1, 510]], decision: "approved" }, // not this edition's admin either
    { as: "admin", decide: [[1, 510]], decision: "maybe" },
    { as: "admin", decide: [[1, 510]], decision: "approved", staleBy: 1 }, // changed since the queue was read
    { as: "admin", decide: [[1, 510]], decision: "approved", note: "  אושר (נתון לדוגמה)  " },
    { as: "admin", decide: [[1, 510]], decision: "approved" }, // no longer waiting
    { as: "A", reopen: [1, 510] }, // approved: the instructor's to reopen
    { as: "A", pay: [1, 510], amount: 400, transport: "round_trip" }, // a change → pending again, the note gone
    { as: "admin", decide: [[1, 510]], decision: "rejected", note: "לא מאושר (נתון לדוגמה)" },
    { as: "A", pay: [1, 510], amount: 400, transport: "round_trip" }, // rejected, asked again: pending
    { as: "A", propose: "בטא", cell: [2, 510, 600] },
    { as: "A", close: "בטא", at: [2, 510] },
    { as: "A", pay: [2, 510], amount: null, transport: "one_way" }, // transport alone
    { as: "admin", decide: [[2, 510], [1, 510]], decision: "approved", note: "באצווה" }, // a batch
    { as: "A", pay: [2, 510], amount: 150, transport: "one_way" },
    { as: "admin", decide: [[1, 510], [2, 510]], decision: "rejected" }, // one is not waiting: the whole batch waits
    { as: "E", pay: [1, 510], amount: null, transport: "none" }, // the edition's admin may; nothing asked → none
    { archive: true },
    { as: "A", pay: [2, 510], amount: 200, transport: "one_way" },
    { as: "admin", decide: [[2, 510]], decision: "approved" },
  ],

  "the summary message: sent, changed, «לעדכן את המרצה», sent again": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", sent: [1, 510] }, // a draft
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "B", sent: [1, 510] }, // not B's speaker
    { as: "L", sent: [1, 510] },
    { as: "A", sent: [1, 510], staleBy: 1 },
    { as: "A", sent: [1, 510] },
    { as: "A", update: [1, 510], patch: { category: "פילוסופיה", audience: "שיעור להורים" } }, // not in the message: no flag
    { as: "A", update: [1, 510], patch: { title: "כותרת לדוגמה" } }, // retitled → flag
    { as: "A", sent: [1, 510] }, // sent again: cleared
    { as: "A", update: [1, 510], patch: { teach_min: 60 } }, // a new teaching time → flag
    { as: "A", sent: [1, 510] },
    { as: "A", move: [1, 510], to: [1, 510, 600, "כיתה"] }, // another room → flag
    { as: "A", sent: [1, 510, "כיתה"] },
    { as: "A", pay: [1, 510, "כיתה"], amount: 200, transport: "none" }, // a new amount → flag, and pending
    { as: "A", sent: [1, 510, "כיתה"] }, // waits for the instructor
    { as: "admin", decide: [[1, 510, "כיתה"]], decision: "rejected" },
    { as: "A", sent: [1, 510, "כיתה"] }, // rejected
    { as: "A", pay: [1, 510, "כיתה"], amount: 200, transport: "none" },
    { as: "admin", decide: [[1, 510, "כיתה"]], decision: "approved" },
    { as: "A", sent: [1, 510, "כיתה"] },
    { as: "admin", reopen: [1, 510, "כיתה"] }, // a draft again: its stages start over, the message mark too
    { as: "A", move: [1, 510, "כיתה"], to: [3, 870, 960] }, // a draft moves: no flag
    { as: "A", close: "אלפא", at: [3, 870] }, // closed again: a first message to send, not a reconfirm
    { as: "A", sent: [3, 870] },
    { as: "A", reshape: [3, 870], op: { op: "merge_next" } }, // a closed lesson grows → flag
    { as: "E", sent: [3, 870] }, // an admin may send for the handler
  ],

  "escorts and sources: any editor, on a closed lesson": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", escort: [1, 510], trainee: "חניכה לדוגמה", selfIntro: false }, // a draft
    { as: "A", sources: [1, 510], kind: "sheet", print: "none", inReader: false },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "A", escort: [1, 510], trainee: "חניכה לדוגמה", selfIntro: false, note: "  להגיע מוקדם\r\nבבקשה  " },
    { as: "B", escort: [1, 510], trainee: "חניך לדוגמה", selfIntro: false }, // any editor
    { as: "L", escort: [1, 510], trainee: "חניך לדוגמה", selfIntro: true },
    { as: "A", escort: [1, 510], trainee: FOREIGN_TRAINEE, selfIntro: false }, // another edition's trainee
    { as: "A", escort: [1, 510], trainee: null, selfIntro: null },
    { as: "A", escort: [1, 510], trainee: "חניך לדוגמה", selfIntro: false, staleBy: 1 },
    { as: "A", escort: [1, 510], trainee: "חניך לדוגמה", selfIntro: false }, // as it is: nothing
    { as: "A", escort: [1, 510], trainee: null, selfIntro: true, note: "א".repeat(301) },
    { as: "A", escort: [1, 510], trainee: null, selfIntro: true }, // self-introduction, no escort
    { as: "A", sources: [1, 510], kind: "sheet", print: "before", note: " דף אחד ", inReader: true },
    { as: "A", sources: [1, 510], kind: "pdf", print: "before", inReader: false },
    { as: "A", sources: [1, 510], kind: "sheet", print: "later", inReader: false },
    { as: "A", sources: [1, 510], kind: "presentation", print: "none", url: "ftp://example.org/deck", inReader: false },
    { as: "A", sources: [1, 510], kind: "presentation", print: "none", url: "javascript:alert(1)", inReader: false },
    { as: "A", sources: [1, 510], kind: "presentation", print: "none", url: "https://example.org/a b", inReader: false },
    { as: "A", sources: [1, 510], kind: "presentation", print: "none", url: "https://", inReader: false },
    { as: "A", sources: [1, 510], kind: "sheet", print: "same_day", inReader: null },
    { as: "A", sources: [1, 510], kind: "sheet", print: "before", note: "דף אחד", inReader: true, staleBy: 1 },
    { as: "A", sources: [1, 510], kind: "sheet", print: "before", note: "דף אחד", inReader: true }, // as it is: nothing
    { as: "B", sources: [1, 510], kind: "presentation", print: "none", url: "  HTTPS://example.org/deck ", inReader: true }, // no reader for a deck
    { as: "L", sources: [1, 510], kind: "none", print: "none", inReader: false },
    { as: "A", sources: [1, 510], kind: "sheet_video", print: "same_day", url: "http://example.org/v", inReader: true },
    { as: "A", sources: [1, 510], kind: "sheet_video", print: "same_day", note: "ש".repeat(501), inReader: true },
    { archive: true },
    { as: "A", escort: [1, 510], trainee: null, selfIntro: false },
    { as: "admin", sources: [1, 510], kind: "other", print: "none", inReader: true },
  ],

  "a reopen starts the stages over: the next speaker's handler inherits nothing; money paid stays": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "A", pay: [1, 510], amount: 700, transport: "round_trip" },
    { as: "A", setTransport: [1, 510], address: "כתובת לדוגמה", time: "07:15" },
    { as: "A", escort: [1, 510], trainee: "חניכה לדוגמה", selfIntro: true, note: "הערה לדוגמה" },
    { as: "A", sources: [1, 510], kind: "presentation", print: "none", url: "https://example.org/deck", inReader: false },
    { as: "B", readTransport: [1, 510] },
    { as: "A", reopen: [1, 510] }, // pending, not approved: the handler may — and every stage starts over
    { as: "admin", decide: [[1, 510]], decision: "approved" }, // nothing waits any more
    { as: "B", propose: "גמא", at: [1, 510] },
    { as: "B", close: "גמא", at: [1, 510] },
    { as: "B", readTransport: [1, 510] }, // the new handler: not the last speaker's pickup
    { as: "L", readTransport: [1, 510] },
    { as: "B", sent: [1, 510] }, // nothing asked for this speaker: a first message
    { as: "L", paid: [1, 510], value: true }, // nothing approved for this speaker
    { as: "B", pay: [1, 510], amount: 900, transport: "one_way" },
    { as: "admin", decide: [[1, 510]], decision: "approved" },
    { as: "L", paid: [1, 510], value: true },
    { as: "B", pay: [1, 510], amount: 1000, transport: "one_way" }, // paid: the amount stays what was paid
    { as: "B", pay: [1, 510], amount: null, transport: "one_way" },
    { as: "B", pay: [1, 510], amount: 900, transport: "round_trip" }, // the transport may change: pending again, still paid
    { as: "B", reopen: [1, 510] }, // paid
    { as: "admin", reopen: [1, 510] }, // not even the instructor, while it is paid
    { as: "admin", decide: [[1, 510]], decision: "approved" },
    { as: "E", paid: [1, 510], value: false }, // «שולם» undone first …
    { as: "B", pay: [1, 510], amount: 1000, transport: "round_trip" }, // … then a new amount, back to the instructor
    { as: "admin", decide: [[1, 510]], decision: "approved" },
    { as: "B", reopen: [1, 510] }, // approved: the instructor's to reopen
    { as: "E", reopen: [1, 510] },
    { as: "admin", decide: [[1, 510]], decision: "rejected" }, // a draft's request is no one's
  ],

  "transport details: the handler, logistics once approved, the instructor; paid": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "A", readTransport: [1, 510] }, // the handler: nothing yet
    { as: "A", setTransport: [1, 510], address: "כתובת לדוגמה" }, // no transport asked
    { as: "A", pay: [1, 510], amount: null, transport: "round_trip" },
    { as: "A", setTransport: [1, 510], address: " כתובת   לדוגמה ", time: "07:15" },
    { as: "A", setTransport: [1, 510], address: "כתובת לדוגמה", time: "07:15" }, // nothing changed
    { as: "A", setTransport: [1, 510], address: "כתובת לדוגמה", phone: "12-34" },
    { as: "A", setTransport: [1, 510], address: "א".repeat(201) },
    { as: "L", readTransport: [1, 510] }, // logistics: not before the approval
    { as: "L", setTransport: [1, 510], driver: "נהג/ת לדוגמה" },
    { as: "B", readTransport: [1, 510] },
    { as: "E", readTransport: [1, 510] }, // the edition's admin is not the handler
    { as: "admin", readTransport: [1, 510] },
    { as: "admin", decide: [[1, 510]], decision: "approved" },
    { as: "L", readTransport: [1, 510] },
    { as: "L", setTransport: [1, 510], address: "כתובת לדוגמה", time: "07:15", driver: "נהג/ת לדוגמה", phone: "555 0100 99", arranged: true },
    { as: "B", readTransport: [1, 510] },
    { as: "A", handOver: "אלפא", to: "B" },
    { as: "B", readTransport: [1, 510] }, // an offer is not a hand-over yet
    { as: "B", answerHandOver: "אלפא", accept: true },
    { as: "B", readTransport: [1, 510] }, // the new handler
    { as: "A", readTransport: [1, 510] }, // the old one, no longer
    { as: "L", paid: [1, 510], value: true }, // transport only: nothing to pay
    { as: "B", pay: [1, 510], amount: 250, transport: "round_trip" }, // pending again
    { as: "L", readTransport: [1, 510] }, // logistics loses sight until it is approved again
    { as: "admin", decide: [[1, 510]], decision: "approved" },
    { as: "B", paid: [1, 510], value: true }, // content does not pay
    { as: "L", paid: [1, 510], value: null },
    { as: "L", paid: [1, 510], value: true },
    { as: "L", paid: [1, 510], value: true }, // already
    { as: "E", paid: [1, 510], value: false }, // an admin may undo
    { as: "B", pay: [1, 510], amount: 250, transport: "none" }, // no transport: its details go
    { as: "admin", readTransport: [1, 510] },
    { as: "B", setTransport: [1, 510], address: "כתובת לדוגמה" },
    { as: "B", pay: [1, 510], amount: 250, transport: "one_way" },
    { as: "B", setTransport: [1, 510], address: "כתובת לדוגמה" },
    { archive: true },
    { as: "B", readTransport: [1, 510] }, // last year's handler
    { as: "B", setTransport: [1, 510], address: null },
    { as: "L", paid: [1, 510], value: true }, // an archive
    { as: "admin", readTransport: [1, 510] },
  ],

  "transport details in a practice week: the instructor only": [
    { sandbox: true },
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "A", pay: [1, 510], amount: null, transport: "one_way" },
    { as: "A", readTransport: [1, 510] },
    { as: "A", setTransport: [1, 510], address: "כתובת לדוגמה" },
    { as: "admin", decide: [[1, 510]], decision: "approved" },
    { as: "L", readTransport: [1, 510] },
    { as: "admin", setTransport: [1, 510], address: "כתובת לדוגמה", arranged: true },
    { as: "admin", readTransport: [1, 510] },
  ],

  "the template and the duty phrases: the edition's admin, the instructor's wording": [
    { as: "A", template: "נוסח לדוגמה {{פנייה}}" },
    { as: "L", template: "נוסח לדוגמה {{פנייה}}" },
    { as: "E", template: "  נוסח לדוגמה {{פנייה}}\r\nשורה שנייה  " },
    { as: "admin", template: "א".repeat(4001) },
    { as: "admin", template: "   " }, // empty: no template
    { as: "admin", template: "נוסח לדוגמה {{פנייה}}" },
    { as: "A", duty: [{ when: "always", text: "ניסוח לדוגמה" }] },
    { as: "E", duty: [{ when: "always", text: " ניסוח  לדוגמה " }, { when: "self_intro", text: "" }, { when: "always", text: "ניסוח לדוגמה" }, { when: "transport", text: "ניסוח לדוגמה" }] },
    { as: "E", duty: [{ when: "sometimes", text: "ניסוח לדוגמה" }] },
    { as: "E", duty: "ניסוח לדוגמה" },
    { as: "E", duty: [{ when: "always" }] },
    { as: "E", duty: [["always", "ניסוח לדוגמה"]] },
    { as: "E", duty: [{ when: "always", text: "א".repeat(201) }] },
    { as: "E", duty: Array.from({ length: 31 }, (_, i) => ({ when: "always", text: `ניסוח לדוגמה ${i}` })) },
    { as: "E", duty: [] }, // empty: none
    { as: "E", duty: [{ when: "memorial", text: "ניסוח לדוגמה לזיכרון" }, { when: "escort_intro", text: "ניסוח לדוגמה להצגה" }] },
    { archive: true },
    { as: "E", template: "נוסח לדוגמה אחר" }, // an admin may still write in an archive
    { as: "A", template: "נוסח לדוגמה אחר" },
  ],

  // ------------------------------------------------------------ links and מכריכה לכריכה (milestone 5a)

  "links: an edition admin issues, replaces and revokes; a token opens its own page only": [
    { as: "A", reshape: [1, 510], op: { op: "split_parallel", count: 2, reason: "דוגמה" } },
    { as: "A", propose: "אלפא", at: [1, 510] },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "A", propose: "בטא", at: [1, 510, "כיתה"] },
    { as: "A", close: "בטא", at: [1, 510, "כיתה"] },
    { as: "A", update: [1, 510], patch: { title: "כותרת לדוגמה", category: "פילוסופיה", teach_min: 60 } },
    { as: "A", propose: "גמא", cell: [2, 600, 690] }, // a draft: not public
    { as: "A", issue: "schedule", name: "x" },
    { as: "L", issue: "schedule", name: "x" },
    { as: "E", issue: "escort", trainee: FOREIGN_TRAINEE, name: "x" },
    { as: "E", issue: "escort", trainee: null, name: "x" },
    { as: "E", issue: "kk_signup", trainee: "חניכה לדוגמה", name: "x" },
    { as: "E", issue: "poster", name: "x" },
    { as: "E", issue: "schedule", name: "s1" },
    { anon: "scheduleView", token: "s1" },
    { anon: "escortView", token: "s1" }, // another scope's token
    { anon: "kkForm", token: "s1" },
    { anon: "scheduleView", token: "nothing" }, // a token that opens nothing
    { as: "admin", issue: "schedule", name: "s2" }, // replaces s1
    { anon: "scheduleView", token: "s1" },
    { anon: "scheduleView", token: "s2" },
    { as: "A", revoke: "s2" },
    { as: "E", revoke: "s2" },
    { as: "E", revoke: "s2" }, // already revoked: nothing
    { anon: "scheduleView", token: "s2" },
    { startDate: dateIn(-10) }, // the week is over
    { as: "E", issue: "schedule", name: "s3" },
    { startDate: dateIn(20) },
    { as: "E", issue: "schedule", name: "s3" },
    { anon: "scheduleView", token: "s3" }, // with dates now
    { startDate: null }, // TBD again: 30 days after issue
    { expire: "s3" },
    { anon: "scheduleView", token: "s3" },
    { as: "E", issue: "schedule", name: "s4" },
    { archive: true },
    { anon: "scheduleView", token: "s4" }, // an archived edition's link
    { as: "admin", issue: "schedule", name: "s5" },
  ],

  "links: the rate limit — an escort's link counted as one, a class link per caller's address, never one count for the class": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "A", escort: [1, 510], trainee: "חניכה לדוגמה", selfIntro: false },
    { as: "E", issue: "escort", trainee: "חניכה לדוגמה", name: "e1" },
    { as: "E", issue: "escort", trainee: "חניך לדוגמה", name: "e2" },
    { as: "E", issue: "schedule", name: "s" },
    { as: "E", issue: "kk_signup", name: "k" },
    { anon: "escortView", token: "e1", times: 60 },
    { anon: "escortView", token: "e1" }, // the 61st in ten minutes
    { anon: "escortView", token: "e1", from: "198.51.100.7" }, // one person's link: one count, from anywhere
    { anon: "escortView", token: "e2" }, // another link is counted apart
    { rateWindowPassed: "e1" },
    { anon: "escortView", token: "e1" }, // ten minutes later
    { rateHits: "s", from: "198.51.100.7", hits: 1199 },
    { anon: "scheduleView", token: "s", from: "198.51.100.7", times: 2 }, // the 1200th, then refused
    { anon: "scheduleView", token: "s", from: "203.0.113.9" }, // someone else holding the same link still gets in
    { anon: "scheduleView", token: "s" }, // no address reported: a count of its own
    { rateHits: "k", from: "198.51.100.7", hits: 1200 },
    { anon: "kkForm", token: "k", from: "198.51.100.7" },
    { anon: "kkForm", token: "k", from: "203.0.113.9" },
    { rateWindowPassed: "s" },
    { anon: "scheduleView", token: "s", from: "198.51.100.7" },
  ],

  "the escort's link: own lessons only, the phone from W−7, ticks, a write-only pickup address": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "A", propose: "בטא", cell: [1, 600, 690] },
    { as: "A", close: "בטא", at: [1, 600] },
    { as: "A", propose: "גמא", cell: [2, 510, 600] },
    { as: "A", close: "גמא", at: [2, 510] },
    { as: "A", escort: [1, 510], trainee: "חניכה לדוגמה", selfIntro: false, note: "הערה לדוגמה" },
    { as: "A", escort: [1, 600], trainee: "חניכה לדוגמה", selfIntro: true },
    { as: "A", escort: [2, 510], trainee: "חניך לדוגמה", selfIntro: false },
    { as: "A", pay: [1, 600], amount: 300, transport: "round_trip" },
    { as: "admin", decide: [[1, 600]], decision: "approved", note: "הערה לדוגמה" },
    { as: "A", setTransport: [1, 600], address: "כתובת לדוגמה", driver: "נהג/ת לדוגמה", phone: "555 0100 33", arranged: true },
    { as: "A", sources: [1, 510], kind: "sheet", print: "before", note: "הערת מקורות", inReader: true },
    { as: "E", duty: [{ when: "always", text: "ניסוח לדוגמה" }, { when: "self_intro", text: "ניסוח להצגה עצמית" }, { when: "escort_intro", text: "ניסוח למלווה" }, { when: "transport", text: "ניסוח להסעה" }] },
    { as: "A", issue: "escort", trainee: "חניכה לדוגמה", name: "e1" },
    { as: "E", issue: "escort", trainee: "חניכה לדוגמה", name: "e1" },
    { as: "E", issue: "escort", trainee: "חניך לדוגמה", name: "e2" },
    { anon: "escortView", token: "e1" }, // the date TBD: no phone
    { startDate: dateIn(10) },
    { anon: "escortView", token: "e1" }, // W−10: not yet
    { startDate: dateIn(7) },
    { anon: "escortView", token: "e1" }, // W−7: אלפא's phone (בטא has none on file)
    { startDate: dateIn(3) },
    { anon: "escortView", token: "e2" },
    { anon: "escortTick", token: "e1", at: [1, 510], item: "met", on: true },
    { anon: "escortTick", token: "e1", at: [1, 510], item: "met", on: true }, // the first time kept
    { anon: "escortTick", token: "e1", at: [1, 510], item: "gift", on: true },
    { anon: "escortTick", token: "e1", at: [1, 510], item: "gift", on: false },
    { anon: "escortTick", token: "e1", at: [1, 510], item: "hug", on: true },
    { anon: "escortTick", token: "e1", at: [1, 510], item: "met", on: null },
    { anon: "escortTick", token: "e1", at: [2, 510], item: "met", on: true }, // another escort's lesson
    { anon: "escortTick", token: "e1", at: [3, 510], item: "met", on: true }, // no lesson there
    { anon: "escortTick", token: "e2", at: [2, 510], item: "reminded", on: true },
    { anon: "escortPickup", token: "e1", at: [1, 510], address: "כתובת" }, // no transport asked
    { anon: "escortPickup", token: "e1", at: [1, 600], address: "   " },
    { anon: "escortPickup", token: "e1", at: [1, 600], address: "א".repeat(201) },
    { anon: "escortPickup", token: "e2", at: [1, 600], address: "כתובת" }, // not e2's lesson
    { anon: "escortPickup", token: "e1", at: [1, 600], address: " רחוב  לדוגמה 1 " }, // written, never read back
    { anon: "escortView", token: "e1" },
    { as: "B", readTransport: [1, 600] },
    { as: "A", readTransport: [1, 600] },
    { as: "A", escort: [2, 510], trainee: "חניכה לדוגמה", selfIntro: false }, // a new escort: e2's ticks go
    { anon: "escortView", token: "e2" },
    { anon: "escortView", token: "e1" },
    { as: "admin", reopen: [1, 510] }, // a draft again: its escort and ticks go
    { anon: "escortView", token: "e1" },
    { expire: "e1" },
    { anon: "escortView", token: "e1" },
  ],

  "מכריכה לכריכה: groups on the grid's kk rows, the window, a link that never overwrites, the staff place": [
    { as: "A", kkAdd: [1, 1290], fields: { title: "ספר א" } },
    { as: "L", kkAdd: [1, 1290], fields: { title: "ספר א" } },
    { as: "E", kkAdd: [4, 1290], fields: { title: "ספר א" } }, // Thursday ends at 19:00
    { as: "E", kkAdd: [1, 510], fields: { title: "ספר א" } }, // a lesson row
    { as: "E", kkAdd: [1, 1290], fields: {} },
    { as: "E", kkAdd: [1, 1290], fields: { title: "ספר א", room: FOREIGN_ROOM } },
    { as: "E", kkAdd: [1, 1290], fields: { title: "ספר א", capacity: 0 } },
    { as: "E", kkAdd: [1, 1290], fields: { title: "ספר א", capacity: 1.5 } },
    { as: "E", kkAdd: [1, 1290], fields: { title: "ספר א", open: "yes" } },
    { as: "E", kkAdd: [1, 1290], fields: { title: "ספר א", leaders: [{ kind: "trainee", trainee: FOREIGN_TRAINEE }] } },
    { as: "E", kkAdd: [1, 1290], fields: { title: "ספר א", leaders: [{ kind: "staff", label: " " }] } },
    {
      as: "E",
      kkAdd: [1, 1290],
      fields: {
        title: " ספר  א ", author: "מחבר/ת לדוגמה", room: "כיתה", capacity: 1,
        leaders: [{ kind: "trainee", trainee: "חניך לדוגמה" }, { kind: "staff", label: "צוות לדוגמה" }, { kind: "staff", label: " צוות  לדוגמה " }],
      },
    },
    { as: "E", kkAdd: [1, 1290], fields: { title: "ספר ב", capacity: 5, ignored: true } },
    { as: "E", kkAdd: [2, 1740], fields: { title: "ספר ג" } }, // no capacity yet: not offered
    { as: "E", issue: "kk_signup", name: "k" }, // no window yet: 30 days
    { anon: "kkForm", token: "k" },
    { anon: "kkSignup", token: "k", trainee: "חניכה לדוגמה", group: "ספר א" }, // closed: nothing recorded
    { as: "E", kkWindow: [isoIn(-1), isoIn(3)] },
    { anon: "kkForm", token: "k" },
    { anon: "kkSignup", token: "k", trainee: "חניכה לדוגמה", group: "ספר א" },
    { anon: "kkSignup", token: "k", trainee: "חניכה לדוגמה", group: "ספר ב" }, // never changed through the link
    { anon: "kkSignup", token: "k", trainee: "חניך לדוגמה", group: "ספר א" }, // full
    { anon: "kkSignup", token: "k", trainee: "חניך לדוגמה", group: "ספר ג" }, // not offered
    { anon: "kkSignup", token: "k", trainee: FOREIGN_TRAINEE, group: "ספר ב" },
    { anon: "kkSignup", token: "k", trainee: "חניך לדוגמה", group: "אין כזה" },
    { anon: "kkForm", token: "k" }, // ספר א is full
    { as: "E", kkPlace: "ספר א", trainee: "חניך לדוגמה" }, // the staff decide: over capacity
    { as: "E", kkPlace: "ספר ב", trainee: "חניכה לדוגמה" }, // moved within the track
    { as: "E", kkPlace: "ספר ב", trainee: "חניכה לדוגמה" }, // already there
    { as: "A", kkPlace: "ספר ב", trainee: "חניך לדוגמה" },
    { as: "E", kkPlace: "ספר ב", trainee: FOREIGN_TRAINEE },
    { as: "E", kkPlace: "ספר ד", trainee: "חניך לדוגמה" },
    { as: "E", kkDelete: "ספר ב" },
    { as: "E", kkUnplace: [1, 1290], trainee: "חניכה לדוגמה" },
    { as: "E", kkUnplace: [3, 1290], trainee: "חניכה לדוגמה" },
    { as: "E", kkDelete: "ספר ב" },
    { as: "E", kkUpdate: "ספר א", patch: { title: "  " } },
    { as: "E", kkUpdate: "ספר א", patch: { title: "ספר א מתוקן", author: null, capacity: 3, open: false, leaders: [] } },
    { as: "A", kkUpdate: "ספר ג", patch: { capacity: 2 } },
    { as: "E", kkUpdate: "ספר ג", patch: { capacity: 2, room: "ספרייה" } },
    { anon: "kkForm", token: "k" }, // ספר א closed, ספר ג offered now
    { as: "E", kkAdd: [0, 1290], fields: { title: "ספר ה", capacity: 3 } },
    { anon: "kkForm", token: "k" }, // Sunday's track on offer
    { firstDayFrom: 1350 }, // Sunday opens at 22:30: its kk row is off the grid
    { anon: "kkForm", token: "k" }, // the track is not offered any more…
    { anon: "kkSignup", token: "k", trainee: "חניך לדוגמה", group: "ספר ה" }, // …nor signed up for
    { as: "E", kkAdd: [0, 1290], fields: { title: "ספר ו", capacity: 3 } }, // outside_grid
    { firstDayFrom: 510 },
    { anon: "kkSignup", token: "k", trainee: "חניך לדוגמה", group: "ספר ה" }, // on the grid again
    { as: "L", bookOrder: "ספר א מתוקן", copies: 4, ordered: false },
    { as: "A", bookOrder: "ספר א מתוקן", copies: 4, ordered: false },
    { as: "L", bookOrder: "ספר א מתוקן", copies: 4, ordered: true },
    { as: "E", bookOrder: "ספר א מתוקן", copies: 5, ordered: true }, // the first time kept
    { as: "E", bookOrder: "ספר א מתוקן", copies: null, ordered: true },
    { as: "E", bookOrder: "ספר א מתוקן", copies: 1001, ordered: false },
    { as: "E", bookOrder: "ספר ג", copies: 2, ordered: false },
    { as: "E", bookOrder: "ספר ג", copies: null, ordered: false },
    { as: "E", kkWindow: [isoIn(1), null] },
    { as: "E", kkWindow: [isoIn(3), isoIn(1)] },
    { as: "A", kkWindow: [isoIn(-1), isoIn(3)] },
    { as: "E", kkWindow: [isoIn(-3), isoIn(-1)] }, // closed: the link has expired with it
    { anon: "kkForm", token: "k" },
    { anon: "kkSignup", token: "k", trainee: "חניך לדוגמה", group: "ספר ג" },
    { as: "E", kkWindow: [null, null] }, // no window: 30 days after issue again
    { anon: "kkForm", token: "k" },
    { as: "E", issue: "kk_signup", name: "k2" },
    { anon: "kkForm", token: "k" }, // replaced
  ],

  // the sources' files (milestone 5ב-1): the bucket's limits and policies, register and remove, the reader's settings
  "sources' files and the reader": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "A", propose: "בטא", cell: [2, 510, 600] }, // a draft
    { as: "L", store: [1, 510], file: "l1" }, // logistics read and print; they do not upload
    { as: "A", store: [2, 510], file: "d1" }, // a draft
    { as: "A", store: [3, 510], file: "n1" }, // no lesson there
    { as: "A", store: [1, 510], file: "x1", mime: "text/plain" }, // not a type the bucket takes
    { as: "A", store: [1, 510], file: "big", size: 26_214_401 }, // over 25 MB
    { as: "A", store: [1, 510], file: "a1", size: 4096 },
    { as: "B", register: "a1" }, // A's upload, not B's
    { as: "A", register: "a1", for: [2, 510] }, // the path is another lesson's
    { as: "A", register: "a1", for: "cover" },
    { as: "A", register: "a1", display: "   " },
    { as: "A", register: "a1", pages: 0 },
    { as: "A", register: "a1", display: "  דף   מקורות.pdf ", pages: 3 }, // «טרם התקבלו» → a sheet, in the reader
    { as: "A", register: "a1", display: "שוב", pages: 9 }, // a retry: the same row, nothing changes
    { as: "A", register: "zz", for: [1, 510] }, // nothing stored there
    { as: "B", store: [1, 510], file: "b1", mime: "image/png", size: 777 }, // any content member
    { as: "B", register: "b1", pages: 5 }, // an image is one page; not the first file: no change
    { as: "A", sources: [1, 510], kind: "sheet", print: "none", inReader: false }, // out of the reader on purpose
    { as: "B", store: [1, 510], file: "b2", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { as: "B", register: "b2", pages: 4 }, // Word: no pages; the «off» stays
    { as: "A", unregister: "b1" }, // not A's
    { as: "B", unregister: "b1" }, // still stored
    { as: "A", unstore: "b1" }, // kept: not A's
    { as: "L", unstore: "b1" }, // kept
    { as: "B", unstore: "b1" }, // deleted
    { as: "B", unregister: "b1" },
    { as: "B", unregister: "b1" }, // gone already: nothing to do
    { as: "E", unstore: "b2" }, // the edition's admin
    { as: "E", unregister: "b2" },
    { as: "A", store: "cover", file: "p1", mime: "image/png" }, // the poster is the admins'
    { as: "E", store: "cover", file: "p2", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, // never a Word poster
    { as: "E", store: "cover", file: "p1", mime: "image/png" },
    { as: "E", register: "p1", pages: 2 }, // the first poster becomes the cover
    { as: "E", readerCover: "a1" }, // a lesson's file is no poster
    { as: "A", readerCover: null },
    { as: "E", readerCover: null },
    { as: "E", readerCover: "p1" },
    { as: "A", readerHeaders: ["שמאל", "ימין"] },
    { as: "E", readerHeaders: ["  כותרת   שמאל ", null] },
    { as: "E", readerHeaders: [" ", ""] }, // both empty: removed
    { as: "A", reopen: [1, 510] }, // the files stay — the speaker who left is theirs
    { as: "A", register: "a1", display: "שוב", pages: 9 }, // a retry whose first answer was lost: the row it made, nothing set on the draft
    { as: "A", store: [1, 510], file: "a2" }, // a draft now
    { as: "A", propose: "גמא", at: [1, 510] },
    { as: "A", close: "גמא", at: [1, 510] }, // another speaker
    { as: "A", store: [1, 510], file: "a3", mime: "image/jpeg" },
    { as: "A", register: "a3" }, // the new speaker's first file: in the reader again
    { as: "A", store: [1, 510], file: "a5", mime: "image/png" },
    { as: "A", register: "a5", pages: null }, // a picture the browser could not read: no page (out of the reader)
    { as: "E", unstore: "p1" },
    { as: "E", unregister: "p1" }, // the cover's file: the mark goes with it
    // a path is used once: a removal that stopped half way leaves the row, and nobody uploads at its path again
    { as: "A", store: [1, 510], file: "s1" },
    { as: "A", register: "s1" },
    { as: "A", unstore: "s1" }, // deleted — the row stays
    { as: "B", store: [1, 510], file: "s1" }, // refused: the path is the row's
    { as: "A", store: [1, 510], file: "s1" }, // the uploader too
    { as: "A", register: "s1" }, // a retry: the row it made
    { as: "A", unregister: "s1" },
    { archive: true },
    { as: "A", store: [1, 510], file: "a4" }, // an archive: its admins only
    { as: "A", unstore: "a3" }, // kept
    { as: "A", unregister: "a1" },
    { as: "E", unstore: "a1" },
    { as: "E", unregister: "a1" },
  ],

  // the cover set by itself: the first poster the browser could read — one it could not, the build never fetches
  "the reader's cover: the first poster the browser could read": [
    { as: "E", store: "cover", file: "p1", mime: "image/jpeg" },
    { as: "E", register: "p1", pages: null }, // not read: no cover — the schedule page
    { as: "E", readerCover: "p1" }, // nor by hand: bad_value
    { as: "E", store: "cover", file: "p2" },
    { as: "E", register: "p2", pages: 2 }, // the first one read: the cover
    { as: "E", store: "cover", file: "p3", mime: "image/png" },
    { as: "E", register: "p3" }, // a poster after it leaves the cover as it is
    { as: "E", unstore: "p2" },
    { as: "E", unregister: "p2" }, // the cover's file: the mark goes with it, and no other poster takes its place
    { as: "E", readerCover: "p3" },
  ],

  // ---- memorial times (milestone 5ב-2) — synthetic names only
  "memorial times: the fallen, slots, plans, the liaison, the materials, the policy": [
    // the fallen: one cross-year list, written by a global admin
    { as: "A", saveFallen: null, name: "חלל/ה לבדיקה א" },
    { as: "E", saveFallen: null, name: "חלל/ה לבדיקה א" }, // an edition's admin: forbidden
    { as: "admin", saveFallen: null, name: "  " },
    { as: "admin", saveFallen: null, name: "חלל/ה לבדיקה א", gender: "x" },
    { as: "admin", saveFallen: null, name: " חלל/ה   לבדיקה א " },
    { as: "admin", saveFallen: null, name: "חלל/ה לבדיקה ב", gender: "f", note: "הערה לבדיקה" },
    { as: "admin", saveFallen: null, name: "חלל/ה לבדיקה ג" },
    { as: "admin", saveFallen: "חלל/ה לבדיקה ג", name: "חלל/ה לבדיקה ג", active: false },
    { as: "admin", saveFallen: "חלל/ה לבדיקה ג", name: "חלל/ה לבדיקה ג", active: null },
    { as: "A", readFallen: true }, // no plan yet: none
    { as: "E", readFallen: true }, // an admin plans: all
    // slots: an edition's admin, inside a memorial row
    { as: "A", addSlot: [0, 780, 795] },
    { as: "L", addSlot: [0, 780, 795] },
    { as: "E", addSlot: [0, 510, 600] }, // a lesson row
    { as: "E", addSlot: [0, 780, 800] }, // past the row
    { as: "E", addSlot: [0, 780, 795] },
    { as: "E", addSlot: [0, 780, 790] }, // the room is taken
    { as: "E", addSlot: [0, 780, 790, "כיתה"] },
    { as: "E", addSlot: [1, 855, 870] },
    // as the edition's window allows the rows: Sunday opening at 14:00 takes its 13:00 memorial row off the grid
    { firstDayFrom: 840 },
    { as: "E", addSlot: [0, 790, 795, "כיתה"] }, // outside the grid now
    { as: "E", addSlot: [0, 855, 860] }, // the 14:15 row is still there
    { as: "E", removeSlot: [0, 855] },
    { firstDayFrom: 510 },
    // plans
    { as: "A", addPlan: "חלל/ה לבדיקה א" },
    { as: "E", addPlan: "חלל/ה לבדיקה ג" }, // not active
    { as: "E", addPlan: "חלל/ה לבדיקה א" },
    { as: "E", addPlan: "חלל/ה לבדיקה א" }, // one per fallen
    { as: "E", addPlan: "חלל/ה לבדיקה ב" },
    { as: "A", readFallen: true }, // the two planned here
    { as: "L", readFallen: true },
    { as: "E", updatePlan: "חלל/ה לבדיקה א", patch: { planned_minutes: 0 } },
    { as: "E", updatePlan: "חלל/ה לבדיקה א", patch: { planned_minutes: 1.5 } },
    { as: "E", updatePlan: "חלל/ה לבדיקה א", patch: { family_status: "maybe" } },
    { as: "E", updatePlan: "חלל/ה לבדיקה א", patch: { hard_stop: "yes" } },
    { as: "E", updatePlan: "חלל/ה לבדיקה א", patch: { hard_stop: true }, staleBy: 1 },
    { as: "A", updatePlan: "חלל/ה לבדיקה א", patch: { hard_stop: true } },
    { as: "E", updatePlan: "חלל/ה לבדיקה א", patch: { family_status: "confirmed", speaker_text: " דובר/ת   לבדיקה ", planned_minutes: 12, materials_note: "הערה\r\nלמקראה ", other: 1 } },
    { as: "E", updatePlan: "חלל/ה לבדיקה א", patch: { planned_minutes: 12 } }, // nothing changed
    // placing, and the liaison going with the plan
    { as: "E", placePlan: "חלל/ה לבדיקה א", at: [1, 510] }, // no memorial slot there
    { as: "E", placePlan: "חלל/ה לבדיקה א", at: [0, 780] },
    { as: "E", placePlan: "חלל/ה לבדיקה ב", at: [0, 780] }, // taken
    { as: "E", placePlan: "חלל/ה לבדיקה א", at: [0, 780] }, // the same slot: nothing
    { as: "E", escort: [1, 855], trainee: "חניכה לדוגמה", selfIntro: false }, // no plan on it
    { as: "A", escort: [0, 780], trainee: "חניכה לדוגמה", selfIntro: false }, // the liaison is an admin's to set
    { as: "E", escort: [0, 780], trainee: "חניכה לדוגמה", selfIntro: true },
    { as: "E", escort: [0, 780], trainee: "חניכה לדוגמה", selfIntro: false, note: "הערה למלווה" },
    { as: "E", issue: "escort", trainee: "חניכה לדוגמה", name: "liaison" },
    { anon: "escortView", token: "liaison" }, // the slot as the page shows any: never the fallen or the plan
    { anon: "escortTick", token: "liaison", at: [0, 780], item: "reminded", on: true }, // a memorial slot has no speaker's ticks: bad_value
    { anon: "escortTick", token: "liaison", at: [0, 780], item: "reminded", on: false },
    { anon: "escortTick", token: "liaison", at: [0, 780], item: "hug", on: true }, // the same answer as an item that does not exist
    { as: "E", placePlan: "חלל/ה לבדיקה א", at: [1, 855] }, // the liaison moves with it
    { anon: "escortView", token: "liaison" },
    // the materials: a slot with a plan
    { as: "A", store: [1, 855], file: "memorialpage" },
    { as: "A", register: "memorialpage" },
    { as: "A", store: [0, 780], file: "noplan" }, // no plan there now
    { as: "L", store: [1, 855], file: "bylogistics" },
    // a slot stays a slot
    { as: "E", move: [1, 855], to: [1, 870, 960] },
    { as: "A", update: [1, 855], patch: { title: "כותרת לבדיקה" } }, // its title would reach the anon links
    { as: "E", update: [1, 855], patch: { teach_min: 5 } },
    { as: "A", reshape: [1, 690], op: { op: "merge_next" } }, // 11:30 into 14:30 would swallow it
    { as: "E", removeSlot: [1, 855] }, // a plan on it
    { as: "E", deletePlan: "חלל/ה לבדיקה א" }, // placed
    { as: "E", placePlan: "חלל/ה לבדיקה א", at: null }, // off: the liaison leaves with it
    { anon: "escortView", token: "liaison" },
    { as: "A", removeSlot: [1, 855] },
    { as: "E", removeSlot: [1, 855] }, // its file's row stays, for removal
    { as: "E", removeSlot: [1, 510] }, // not a memorial slot
    { as: "E", deletePlan: "חלל/ה לבדיקה א" },
    { as: "admin", deleteFallen: "חלל/ה לבדיקה ב" }, // planned: deactivate instead
    { as: "E", deleteFallen: "חלל/ה לבדיקה ג" },
    { as: "admin", deleteFallen: "חלל/ה לבדיקה ג" },
    // the policy: the staff meeting's, never seeded
    { as: "A", policy: { placement: "לבדיקה" } },
    { as: "E", policy: { max_minutes: 181 } },
    { as: "E", policy: { placement: " לבדיקה: לפני הארוחה? ", max_minutes: 10 } },
    { as: "E", policy: { warn_adjacent_meal: false } },
    { as: "E", policy: {} },
  ],

  "a family's contact person: admins only, one fallen at a time": [
    { as: "admin", saveFallen: null, name: "חלל/ה לבדיקה א" },
    { as: "admin", saveFallen: null, name: "חלל/ה לבדיקה ב" },
    { as: "admin", setFallenContacts: "חלל/ה לבדיקה א", contact: "איש/אשת קשר לבדיקה", relation: "קרבה לבדיקה", phone: "555 0100 98", email: "family@example.org" },
    { as: "E", readFallenContacts: "חלל/ה לבדיקה א" }, // no plan in the admin's edition yet
    { as: "E", addPlan: "חלל/ה לבדיקה א" },
    { as: "E", readFallenContacts: "חלל/ה לבדיקה א" },
    { as: "E", readFallenContacts: "חלל/ה לבדיקה ב" },
    { as: "A", readFallenContacts: "חלל/ה לבדיקה א" },
    { as: "L", readFallenContacts: "חלל/ה לבדיקה א" },
    { as: "A", setFallenContacts: "חלל/ה לבדיקה א", contact: "לבדיקה" },
    { as: "E", setFallenContacts: "חלל/ה לבדיקה א", phone: "12-34" },
    { as: "E", setFallenContacts: "חלל/ה לבדיקה א", email: "not-an-email" },
    { as: "E", setFallenContacts: "חלל/ה לבדיקה א", contact: " איש/אשת קשר   לבדיקה ", relation: "קרבה לבדיקה", phone: "555 0100 98", email: "family@example.org" }, // the same
    { as: "E", setFallenContacts: "חלל/ה לבדיקה א", contact: "איש/אשת קשר לבדיקה", note: "הערה לבדיקה" },
    { as: "E", readFallenContacts: "חלל/ה לבדיקה א" },
    { as: "E", setFallenContacts: "חלל/ה לבדיקה ב" }, // nothing to write, and not theirs
    { sandbox: true },
    { as: "E", readFallenContacts: "חלל/ה לבדיקה א" }, // a practice week gives none
    { as: "admin", readFallenContacts: "חלל/ה לבדיקה א" },
  ],

  "the logistics screen's transports: never more than each lesson's details": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "B", propose: "בטא", cell: [1, 600, 690] },
    { as: "B", close: "בטא", at: [1, 600] },
    { as: "A", propose: "גמא", cell: [2, 510, 600] },
    { as: "A", close: "גמא", at: [2, 510] },
    { as: "A", pay: [1, 510], amount: null, transport: "round_trip" },
    { as: "B", pay: [1, 600], amount: null, transport: "one_way" },
    { as: "A", pay: [2, 510], amount: null, transport: "one_way" }, // stays pending
    // B's second lesson: an amount, no transport — approved, a payment and never a logistics transport
    { as: "B", propose: "זין", cell: [3, 600, 690] },
    { as: "B", close: "זין", at: [3, 600] },
    { as: "B", pay: [3, 600], amount: 300, transport: "none" },
    { as: "admin", decide: [[1, 510], [1, 600], [3, 600]], decision: "approved" },
    { as: "A", setTransport: [1, 510], address: "כתובת לדוגמה", time: "07:15", driver: "נהג/ת לדוגמה", phone: "555 0100 99", arranged: true },
    { as: "A", setTransport: [2, 510], address: "כתובת לדוגמה" },
    { as: "A", readTransports: true }, // the pending one is not a logistics item
    { as: "B", readTransports: true },
    { as: "L", readTransports: true },
    { as: "E", readTransports: true }, // the edition's admin handles none
    { as: "admin", readTransports: true },
    { archive: true },
    { as: "A", readTransports: true },
    { as: "L", readTransports: true },
    { as: "admin", readTransports: true },
  ],

  "the import: candidates into the pool — new, by name key, by phone, chosen; only what is empty; a re-run adds no one; all or nothing": [
    { as: "A", importCandidates: [{ row: 2, action: "new", name: "מועמד/ת לדוגמה" }] }, // a content member may not
    { as: "E", importCandidates: [{ row: 2, action: "new", name: "מועמד/ת לדוגמה" }] }, // nor the edition's admin
    {
      as: "admin",
      importCandidates: [
        { row: 2, action: "new", name: "מועמד/ת לדוגמה", title: "הרב", gender: "m", affiliation: "מוסד לדוגמה", topics: ["תנ\"ך"], phone: "000-000-0005", notes: "טווח ימים: א-ב" },
        // the same name key as a pool speaker: completes «בטא» — never a second one
        { row: 3, action: "new", name: "בטא", affiliation: "מוסד לבטא", phone: "0000000006", email: "beta@example.org" },
        // chosen by the admin («עמום»): fills «גמא»'s empty title and topics
        { row: 4, action: "merge", speaker: "גמא", name: "גאמא", title: "ד״ר", topics: ["פילוסופיה"] },
        // «אלפא» has a phone and a secretary note: only the e-mail is empty
        { row: 5, action: "merge", speaker: "אלפא", name: "אלפא", phone: "0000000007", email: "alpha@example.org", notes: "הערה לדוגמה" },
      ],
    },
    // another name, a phone the pool has now: a 'new' row is a new speaker — a phone alone never merges (the preview
    // shows «אותו טלפון כמו …» and sends such a row as a merge, the next step)
    { as: "admin", importCandidates: [{ row: 2, action: "new", name: "שם אחר לגמרי", affiliation: "מוסד שני" }, { row: 3, action: "new", name: "עוד שם", phone: "+972 (0)00 000 0005" }] },
    { as: "admin", importCandidates: [{ row: 2, action: "merge", speaker: "מועמד/ת לדוגמה", name: "שם שלישי", phone: "+972 (0)00 000 0005", email: "candidate@example.org" }] },
    // two names on one line, both new, in one import: two people, each with their own contacts
    {
      as: "admin",
      importCandidates: [
        { row: 2, action: "new", name: "בודק אלף", title: "הרב", gender: "m", phone: "000-000-0077" },
        { row: 3, action: "new", name: "בודקת בית", title: "הרבנית", gender: "f", phone: "0000000077", email: "beit@example.org", topics: ["נושא ב"] },
      ],
    },
    // a phone an earlier row's merge just gave a pool speaker: a 'new' row of another name is still someone new
    { as: "admin", importCandidates: [{ row: 2, action: "merge", speaker: "זין", name: "זין", phone: "0000000088" }, { row: 3, action: "new", name: "אדם אחר לגמרי", phone: "0000000088", email: "other.person@example.org" }] },
    // a note alone is counted as a note, not as a contact detail
    { as: "admin", importCandidates: [{ row: 2, action: "new", name: "רק הערה", notes: "טווח ימים: נסגר" }] },
    { as: "admin", importLookup: { speakers: ["בטא", "גמא"], phones: ["0000000005", "0000000006", "9999999999"] } },
    // the first rows again: nothing new, nothing more to fill
    { as: "admin", importCandidates: [{ row: 2, action: "new", name: "מועמד/ת לדוגמה", title: "הרב", gender: "m" }, { row: 3, action: "new", name: "בטא" }] },
    // «בטא» again, with another affiliation: its empty title and topics filled, its affiliation kept
    { as: "admin", importCandidates: [{ row: 2, action: "new", name: "בטא", title: "ד״ר", affiliation: "מוסד שלישי", topics: ["נושא לדוגמה"] }] },
    // «גמא» (ד״ר, f) with another title and gender while its empty affiliation is filled: both kept
    { as: "admin", importCandidates: [{ row: 2, action: "new", name: "גמא", title: "הרב", gender: "m", affiliation: "מוסד לגמא" }] },
    // «דלתא» given the title הרבנית and no gender; then a row «הרב דלתא»: the gender its own title contradicts is never filled
    { as: "admin", importCandidates: [{ row: 2, action: "merge", speaker: "דלתא", name: "דלתא", title: "הרבנית" }] },
    { as: "admin", importCandidates: [{ row: 2, action: "new", name: "דלתא", title: "הרב", gender: "m" }] },
    // the mirror: «אלפא» (f, no title) and a row «הרב אלפא» by its name key; «זין» (m, no title) chosen with «הרבנית»:
    // a title that says the other gender is never filled
    { as: "admin", importCandidates: [{ row: 2, action: "new", name: "אלפא", title: "הרב", gender: "m" }, { row: 3, action: "merge", speaker: "זין", name: "זין", title: "הרבנית", gender: "f" }] },
    // all or nothing, the row and the reason named
    { as: "admin", importCandidates: [{ row: 2, action: "new", name: "תקין/ה לדוגמה" }, { row: 3, action: "new", name: "טלפון שגוי", phone: "12-34" }] },
    { as: "admin", importCandidates: [{ row: 2, action: "new", name: "תקין/ה לדוגמה" }, { row: 7, action: "new", name: "מגדר מנוחש", title: "ד״ר", gender: "f" }] },
    { as: "admin", importCandidates: [{ row: 8, action: "new", name: "מגדר מנוחש", gender: "m" }] }, // no title: no gender either
    { as: "admin", importCandidates: [{ row: 9, action: "merge", speaker: "אין כזה", name: "אין כזה" }] },
    { as: "admin", importCandidates: [{ row: 10, action: "new", name: "   " }] },
    { as: "admin", importCandidates: [{ row: 11, action: "new", name: "תואר זר", title: "מר" }] },
    { as: "admin", importCandidates: [{ row: 12, action: "new", name: "מייל שגוי", email: "לא מייל" }] },
    { as: "admin", importCandidates: [{ row: 2, action: "new", name: "בלי מקור" }], source: "  " },
    { as: "admin", importRaw: { kind: "other", payload: { rows: [] } } },
    { as: "admin", importRaw: { kind: "candidates", payload: [] } },
    { as: "admin", importRaw: { kind: "candidates", payload: { source: "x", rows: "not rows" } } },
    { as: "admin", importRaw: { kind: "candidates", payload: { source: "x", rows: Array.from({ length: 1001 }, (_, i) => ({ row: i, action: "new", name: `x${i}` })) } } },
  ],

  "the import: the tracking sheet becomes an archive edition, the same label replaces it, a lesson that cannot be refuses all": [
    { as: "E", importArchive: { label: "תשפ\"ו", speakers: [], lessons: [] } }, // not the edition's admin's
    {
      as: "admin",
      importArchive: {
        label: "תשפ\"ו",
        speakers: [
          { row: 2, action: "new", name: "מרצה מן הארכיון", title: "הרבנית", gender: "f", phone: "000-000-0008" },
          { row: 3, action: "merge", speaker: "אלפא", name: "אלפא" },
          { row: 4, action: "new", name: "בטא" }, // the pool's «בטא»
          { row: 5, action: "new", name: "בטא" }, // twice in the sheet: one speaker in the lesson
        ],
        lessons: [
          { row: 2, day: 0, start: 510, end: 600, speakers: [0], category: "תנ\"ך", sources_kind: "sheet", pay_amount: 300, import_note: "קיבל הודעת סיכום מ: חניך/ה לדוגמה" },
          { row: 3, day: 0, start: 510, end: 600, room: 1, speakers: [1], sources_kind: "sheet_video" },
          { row: 4, day: 1, start: 600, end: 780, speakers: [2, 1, 3], audience: "שיעור להורים", sources_kind: "sheet", print_when: "before" },
          { row: 5, day: 3, start: 1470, end: 1560, room: 2, speakers: [0], sources_kind: "other", sources_note: "נשלח במייל" },
        ],
      },
    },
    // the same label, fewer lessons: replaced — no second edition, no second speaker
    { as: "admin", importArchive: { label: "תשפ\"ו", start_date: "2026-02-15", speakers: [{ row: 2, action: "new", name: "מרצה מן הארכיון", title: "הרבנית", gender: "f" }], lessons: [{ row: 2, day: 2, start: 870, end: 960, speakers: [0] }] } },
    // the same label with gershayim and with spaces around: the same archive, replaced — never a second one
    { as: "admin", importArchive: { label: " תשפ״ו ", speakers: [{ row: 2, action: "new", name: "מרצה מן הארכיון", title: "הרבנית", gender: "f" }], lessons: [{ row: 2, day: 3, start: 870, end: 960, speakers: [0] }] } },
    { as: "admin", importArchive: { label: "תשפ”ו", speakers: [{ row: 2, action: "new", name: "מרצה מן הארכיון", title: "הרבנית", gender: "f" }], lessons: [{ row: 2, day: 2, start: 870, end: 960, speakers: [0] }] } },
    { as: "admin", importArchive: { label: EDITION.label, speakers: [], lessons: [] } }, // a live edition's label
    { as: "admin", importArchive: { label: ` ${EDITION.label.replace(" ", "  ")} `, speakers: [], lessons: [] } }, // …spaced otherwise
    // two speakers with one phone keep their own lessons
    {
      as: "admin",
      importArchive: {
        label: "בדיקת טלפון משותף",
        speakers: [{ row: 2, action: "new", name: "בודק גימל", phone: "000-000-0066" }, { row: 3, action: "new", name: "בודקת דלת", phone: "0000000066" }],
        lessons: [{ row: 2, day: 0, start: 510, end: 600, speakers: [0] }, { row: 3, day: 1, start: 510, end: 600, speakers: [1] }],
      },
    },
    { as: "admin", importArchive: { label: FOREIGN_EDITION, speakers: [], lessons: [] } },
    { as: "admin", importArchive: { label: "  ", speakers: [], lessons: [] } },
    { as: "admin", importArchive: { label: "בדיקה", start_date: "2026-02-16", speakers: [], lessons: [] } }, // a Monday
    { as: "admin", importArchive: { label: "בדיקה", start_date: "2026-02-30", speakers: [], lessons: [] } },
    { as: "admin", importArchive: { label: "בדיקה", source: null, speakers: [], lessons: [] } },
    ...(
      [
        { row: 7, day: 0, start: 540, end: 600, speakers: [0] }, // the same room, overlapping
        { row: 8, day: 0, start: 540, end: 630, room: 1, speakers: [1] }, // the same speaker, twice at once
        { row: 9, day: 0, start: 512, end: 600, room: 2, speakers: [0] },
        { row: 10, day: 5, start: 510, end: 600, speakers: [0] },
        { row: 11, day: 2, start: 510, end: 600, speakers: [] },
        { row: 12, day: 2, start: 510, end: 600, speakers: [9] },
        { row: 13, day: 2, start: 510, end: 600, speakers: [0, 0] },
        { row: 14, day: 2, start: 510, end: 600, speakers: [0], room: 10 },
        { row: 15, day: 2, start: 510, end: 600, speakers: [0], pay_amount: 0 },
        { row: 16, day: 2, start: 510, end: 600, speakers: [0], category: "אין כזו" },
        { row: 17, day: 2, start: 510, end: 600, speakers: [0], sources_kind: "maybe" },
        { row: 18, day: 4, start: 1080, end: 1170, speakers: [0] }, // past the archive's Thursday (19:00)
        { row: 19, day: 4, start: 1470, end: 1560, speakers: [0] }, // a Thursday night the week did not have
      ] as ImportLessonStep[]
    ).map(
      (bad): Step => ({
        as: "admin",
        importArchive: {
          label: "בדיקה",
          speakers: [{ row: 2, action: "new", name: "מרצה בבדיקה" }, { row: 3, action: "new", name: "מרצה שני/ה בבדיקה" }],
          lessons: [{ row: 6, day: 0, start: 510, end: 600, speakers: [0, 1] }, bad],
        },
      }),
    ),
    // Thursday until 19:00 is the archive's week
    { as: "admin", importArchive: { label: "בדיקת חמישי", speakers: [{ row: 2, action: "new", name: "מרצה בבדיקה" }], lessons: [{ row: 2, day: 4, start: 1050, end: 1140, speakers: [0] }] } },
  ],

  // סבב רביעי: a channel chosen from the list and the admin's own note — no key for the file's text
  "the import: the escorts' file — the channel and the note, only where empty": [
    { as: "B", importPrefs: [{ row: 2, speaker: "אלפא", channel: "secretary", note: "בבוקר" }] },
    {
      as: "admin",
      importPrefs: [
        { row: 2, speaker: "אלפא", channel: "secretary", note: "בבוקר" }, // its note is there: only the channel
        { row: 3, speaker: "בטא", channel: "whatsapp", note: "רק בערב" },
        { row: 4, speaker: "גמא", channel: "other", note: "רק בבוקר" }, // «אחר»: the note only, contact_pref left
      ],
    },
    { as: "admin", importPrefs: [{ row: 2, speaker: "בטא", channel: "phone", note: "אחר" }] }, // nothing empty is left
    { as: "admin", importPrefs: [{ row: 2, speaker: "דלתא", channel: "email" }, { row: 4, speaker: "אין כזה", channel: "email" }] },
    { as: "admin", importPrefs: [{ row: 5, speaker: "דלתא", channel: "sms" }] },
    { as: "admin", importPrefs: [{ row: 6, speaker: "דלתא", channel: "phone", note: "א".repeat(301) }] },
    // the file's words have no field: a row that brings any other key is refused — before the speaker is looked up
    { as: "admin", importPrefs: [{ row: 7, speaker: "דלתא", channel: "phone", extra: { secretary_note: "דרך המזכירה" } }] },
    { as: "admin", importPrefs: [{ row: 8, speaker: "אין כזה", channel: "phone", extra: { phrases: ["דרך המזכירה"] } }] },
    { as: "admin", importPrefs: [{ row: 9, speaker: "דלתא", extra: { contact_pref: "phone" } }] },
    { as: "admin", importPrefs: [{ row: 10, speaker: "דלתא" }] }, // no channel
    { as: "admin", importPrefs: [{ row: 11, speaker: "דלתא", channel: 5 }] },
    { as: "admin", importPrefs: [{ row: 12, speaker: "דלתא", channel: "phone", note: 5 }] },
    { as: "admin", importPrefs: [{ row: 13, speaker: "דלתא", channel: "other", note: null }] }, // «אחר» with no note: nothing to fill
    { as: "admin", importPrefs: [{ row: 14, speaker: "דלתא", channel: "email", note: "  \r\n " }] }, // a blank note is none
  ],

  // סבב שלישי: the backstop of the wizard's stripContacts — a phone or an e-mail only in phone / email (app.has_contact)
  "the import: a phone or an e-mail in any other field refuses the whole import («contact_in_text»), naming the row": [
    ...(
      [
        { name: "מרצה עם מספר 000-000-0071" },
        { name: "מרצה עם שורה", affiliation: "מוסד\n000-000-0072" },
        { name: "מרצה עם מייל", affiliation: "someone@example.org" },
        { name: "מרצה עם נושא", topics: ["תנ״ך", "טל' +972-00-000-0073"] },
        { name: "מרצה עם הערה", notes: "להתקשר: 000\u200f-\u200f000\u200f-0074" },
      ] as Omit<ImportSpeakerStep, "row" | "action">[]
    ).map((bad): Step => ({ as: "admin", importCandidates: [{ row: 2, action: "new", name: "מרצה תקין/ה" }, { row: 5, action: "new", ...bad }] })),
    { as: "admin", importCandidates: [{ row: 2, action: "new", name: "מרצה תקין/ה" }], source: "source@example.org" },
    // what is no phone stays: a date, a range of years, of times — and the contacts themselves in phone and e-mail
    {
      as: "admin",
      importCandidates: [{ row: 2, action: "new", name: "מרצה עם תאריכים", affiliation: "מוסד 1948-1967", notes: "נקבע 12.3.2026 20:00, 8.30-10.00", phone: "000-000-0075", email: "dates@example.org" }],
    },
    ...(
      [
        { title: "שיעור 000-000-0076" },
        { audience: "שיעור להורים someone@example.org" },
        { sources_kind: "other", sources_note: "נשלח ל-000-000-0077" },
        { import_note: "הסעה: נהג (000) 000-0078" },
      ] as Partial<ImportLessonStep>[]
    ).map(
      (bad): Step => ({
        as: "admin",
        importArchive: {
          label: "בדיקת טלפון בטקסט",
          speakers: [{ row: 2, action: "new", name: "מרצה בבדיקה" }],
          lessons: [{ row: 6, day: 0, start: 510, end: 600, speakers: [0] }, { row: 7, day: 1, start: 510, end: 600, speakers: [0], ...bad }],
        },
      }),
    ),
    { as: "admin", importArchive: { label: "ארכיון 000-000-0079", speakers: [], lessons: [] } },
    { as: "admin", importArchive: { label: "ארכיון תקין", source: "tracking 000-000-0080", speakers: [], lessons: [] } },
    { as: "admin", importArchive: { label: "בדיקת טלפון בטקסט", speakers: [{ row: 2, action: "new", name: "מרצה בבדיקה" }], lessons: [{ row: 6, day: 0, start: 510, end: 600, speakers: [0], title: "תש״ח 1948-1967" }] } },
    { as: "admin", importPrefs: [{ row: 2, speaker: "אלפא", channel: "secretary" }, { row: 3, speaker: "בטא", channel: "phone", note: "בבוקר 000-000-0081" }] },
    { as: "admin", importPrefs: [{ row: 3, speaker: "בטא", channel: "email", note: "רק במייל: someone@example.org" }] },
    // סבב רביעי: the reviewers' forms — other digits, a separator, a spaced e-mail, what shows nothing
    { as: "admin", importPrefs: [{ row: 3, speaker: "בטא", channel: "phone", note: "בערב ٠٠٠-٠٠٠-٠٠٨٢" }] },
    { as: "admin", importPrefs: [{ row: 3, speaker: "בטא", channel: "phone", note: "בערב 000/000/0083" }] },
    { as: "admin", importPrefs: [{ row: 3, speaker: "בטא", channel: "email", note: "someone @example.org" }] },
    { as: "admin", importPrefs: [{ row: 3, speaker: "בטא", channel: "phone", note: "000\u0085000\u00850084" }] },
    { as: "admin", importPrefs: [{ row: 3, speaker: "בטא", channel: "secretary", note: "בבוקר, 1948-1967-1973" }] },
  ],

  // after the week (milestone 6)
  "«איך עבר»: who writes, when (Israel time), and who reads": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "B", propose: "בטא", cell: [1, 600, 690] },
    { as: "B", close: "בטא", at: [1, 600] },
    { as: "A", propose: "גמא", cell: [3, 870, 960] }, // a draft
    { as: "A", review: [1, 510], fields: { went_well: "טוב" } }, // the week's date TBD: closed to the handler
    { as: "E", review: [1, 510], fields: { went_well: "  טוב  ", invite_again: "yes", rating: 4 } }, // an admin, at any time
    { startDate: dateIn(0) },
    { as: "A", review: [1, 510], fields: { issues: "איחור" } }, // Monday is tomorrow
    { startDate: dateIn(-1) },
    { as: "A", review: [1, 510], fields: { issues: "איחור" } }, // Monday is today: not passed yet
    { startDate: dateIn(-2) },
    { as: "A", review: [1, 510], fields: { issues: "איחור קטן" }, staleBy: 1 }, // the version on screen was before E's
    { as: "A", review: [1, 510], fields: { went_well: "טוב", issues: "איחור קטן", invite_again: "maybe", overran: true, rating: 3 } },
    { as: "A", review: [1, 510], fields: { went_well: "טוב", issues: "איחור קטן", invite_again: "maybe", overran: true, rating: 3 } }, // the same again
    { as: "B", review: [1, 510], fields: { went_well: "x" } }, // not B's speaker
    { as: "L", review: [1, 510], fields: { went_well: "x" } },
    { as: "B", review: [1, 600], fields: {} },
    { as: "B", review: [1, 600], fields: { invite_again: "always" } },
    { as: "B", review: [1, 600], fields: { rating: 6 } },
    { as: "B", review: [1, 600], fields: { overran: true } }, // an overrun alone is a review
    { as: "A", review: [3, 870], fields: { went_well: "x" } }, // a draft
    { as: "A", review: [4, 510], fields: { went_well: "x" } }, // no lesson there
    { as: "A", readReviews: true },
    { as: "L", readReviews: true },
    { as: "A", speakerReviews: "אלפא" },
    { as: "L", speakerReviews: "אלפא" },
    { as: "A", returning: true },
    { as: "L", returning: true },
    { archive: true },
    { as: "A", review: [1, 510], fields: { went_well: "שוב" } },
    { as: "E", review: [1, 510], fields: { went_well: "שוב" } },
    { as: "A", speakerReviews: "אלפא" }, // last year's team reads no one's across the years
    { as: "admin", speakerReviews: "אלפא" },
  ],

  "the purge after the week": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "A", pay: [1, 510], amount: null, transport: "round_trip" },
    { as: "admin", decide: [[1, 510]], decision: "approved" },
    { as: "A", setTransport: [1, 510], address: "כתובת לדוגמה", driver: "נהג/ת לדוגמה", arranged: true },
    { as: "E", issue: "schedule", name: "s" },
    { as: "E", issue: "kk_signup", name: "k" },
    { anon: "kkForm", token: "k", from: "198.51.100.1" },
    { as: "admin", purge: "בדיקת התאמה" }, // the week's date TBD
    { startDate: dateIn(-4) },
    { as: "admin", purge: "בדיקת התאמה" }, // Thursday: not over yet
    { startDate: dateIn(-6) },
    { as: "E", purge: "בדיקת התאמה" }, // a global admin's only
    { as: "admin", purge: "בדיקת" },
    { as: "admin", purge: null },
    { anon: "kkForm", token: "k", from: "198.51.100.1" }, // the sign-up link still opens (its 30 days)
    { as: "admin", purge: " בדיקת התאמה " },
    { anon: "kkForm", token: "k", from: "198.51.100.1" },
    { anon: "scheduleView", token: "s" },
    { as: "A", readTransport: [1, 510] },
    { as: "admin", purge: "בדיקת התאמה" }, // again: nothing more
  ],

  // the two parts of v12 together: the archive the import makes is a past year for the summary and the speaker sheet;
  // a re-run never deletes «איך עבר» with the lessons it replaces; the purge clears what last year's sheet said
  "the import meets after the week: the imported year across the years, a review kept from a re-run, the archive purged": [
    {
      as: "admin",
      importArchive: {
        label: "תשפ\"ו",
        speakers: [{ row: 2, action: "merge", speaker: "אלפא", name: "אלפא" }, { row: 3, action: "merge", speaker: "גמא", name: "גמא" }],
        lessons: [
          { row: 2, day: 0, start: 510, end: 600, speakers: [0], import_note: "הסעה/תשלום: איסוף מתחנה לדוגמה\nקיבל הודעת סיכום מ: חניך/ה לדוגמה" },
          { row: 3, day: 1, start: 600, end: 690, speakers: [1], pay_amount: 250 },
        ],
      },
    },
    { as: "A", propose: "אלפא", cell: [1, 510, 600] },
    { as: "A", close: "אלפא", at: [1, 510] },
    { as: "A", returning: true }, // «אלפא» taught in the imported year — its date unknown: a past year
    { as: "L", returning: true },
    { as: "admin", review: [0, 510], edition: "תשפ\"ו", fields: { went_well: "עבר טוב באשתקד", invite_again: "yes", rating: 5 } },
    { as: "A", speakerReviews: "אלפא" }, // a past year's review, read by this year's content team
    { as: "L", speakerReviews: "אלפא" },
    { as: "A", speakerReviews: "גמא" }, // the year's other speaker: nothing written
    // the sheet's note: its own table, under the transport details' rule — for an archive, a global admin only
    { as: "admin", importNote: [0, 510], edition: "תשפ\"ו" },
    { as: "admin", importNote: [1, 600], edition: "תשפ\"ו" },
    { as: "A", importNote: [0, 510], edition: "תשפ\"ו" },
    { as: "E", importNote: [0, 510], edition: "תשפ\"ו" },
    { as: "L", importNote: [0, 510], edition: "תשפ\"ו" },
    // the same label again would replace its lessons, the review with them: refused, nothing changed
    { as: "admin", importArchive: { label: "תשפ\"ו", speakers: [{ row: 2, action: "merge", speaker: "אלפא", name: "אלפא" }], lessons: [{ row: 2, day: 2, start: 870, end: 960, speakers: [0] }] } },
    // the purge of an imported archive: a global admin's, the label typed, no date needed — the sheet's notes go
    { as: "E", purge: "תשפ\"ו", edition: "תשפ\"ו" },
    { as: "admin", purge: "בדיקת התאמה", edition: "תשפ\"ו" },
    { as: "admin", purge: "תשפ\"ו", edition: "תשפ\"ו" },
    { as: "admin", purge: "תשפ\"ו", edition: "תשפ\"ו" }, // again: nothing more
    { as: "admin", importNote: [0, 510], edition: "תשפ\"ו" }, // gone with the purge
    { as: "A", speakerReviews: "אלפא" }, // the review stays
    { as: "A", returning: true }, // and so does the year
    // a new import under another label: no review there, so it may be replaced at will
    { as: "admin", importArchive: { label: "בדיקה", speakers: [{ row: 2, action: "merge", speaker: "גמא", name: "גמא" }], lessons: [{ row: 2, day: 3, start: 870, end: 960, speakers: [0] }] } },
    { as: "admin", importArchive: { label: "בדיקה", speakers: [{ row: 2, action: "merge", speaker: "גמא", name: "גמא" }], lessons: [{ row: 2, day: 4, start: 510, end: 600, speakers: [0], import_note: "הערה לדוגמה" }] } },
  ],
};
