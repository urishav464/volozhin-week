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
    { as: "A", claim: "גמא" },
    { as: "A", create: { name: "מרצה חדשה לגמרי" } },
    { as: "A", setStatus: "אלפא", status: "no_answer" },
    { as: "admin", create: { name: "מרצה חדשה לגמרי", gender: "f" } },
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
};
