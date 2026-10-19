// Scenarios that walk docs/CONTRACT.md clause by clause. Each runs on the
// engine and on the SQL; every step's result and the whole state after it
// must be identical.
import { FOREIGN_ROOM, FOREIGN_TRAINEE, type Step } from "./fixture";

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
    { as: "admin", reopen: [1, 510, "כיתה"] }, // a draft again: no flag
    { as: "A", move: [1, 510, "כיתה"], to: [3, 870, 960] }, // a draft moves: no flag
    { as: "A", close: "אלפא", at: [3, 870] }, // closed again after its message → flag
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
};
