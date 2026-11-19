// v19's six scenarios (docs/CONTRACT.md «v19»): «נשלח לדפוס», presentations, the guests' words, the photo, the guests'
// schedule and the log — each step pinned (`is`), so a twin that agrees with the other on a WRONG answer still fails.
// Synthetic only: the photos are built byte by byte (src/testing/photos.ts), the phones are the 000-… placeholders.
import { nonCanonical, photoBase64 } from "../../src/testing/photos";
import { EDITION, PPTX, stable, type Step } from "./fixture";

const CLEAN = photoBase64("clean");
/** The clean photo's base64 with one character made a space: the same length, not the alphabet. */
const SPACED = `${CLEAN.slice(0, 40)} ${CLEAN.slice(41)}`;

/** The 29 fixed rows of the fixture's week (TEMPLATE_2026; Sunday opens 08:30, Thursday closes 19:00). */
const FIXED_ROWS = [0, 1, 2, 3, 4].flatMap((day) =>
  (
    [
      [420, 480, "ארוחת בוקר / חבורות"],
      [480, 510, "דרך ארץ — חבורות לימוד בהובלת החניכים"],
      [795, 855, "ארוחת צהריים / חבורות"],
      [1140, 1200, "ארוחת ערב / חבורות"],
      [1290, 1350, "מכריכה לכריכה"],
      [1440, 1470, "ארוחת חצות וניגונים / חבורות"],
      [1740, 1830, "מכריכה לכריכה"],
    ] as const
  )
    // Sunday from 08:30: the two rows that end by then are not in play; Thursday until 19:00: none from then
    .filter(([start, end]) => !(day === 0 && end <= 510) && !(day === 4 && start >= 1140))
    .map(([start_min, end_min, label]) => ({ day, start_min, end_min, label })),
);
const FIXED = FIXED_ROWS.map((f) => `${f.day}|${f.start_min}-${f.end_min}|${f.label}`).join(" ; ");

/** A row of the guests' schedule as schedule_view answers it: the ten keys, the note, the people (the fixture's rooms, no category, no title). */
const guestRow = (kind: "lesson" | "memorial", day: number, start_min: number, end_min: number, speaker: string, note: string | null, people: number[]) => ({
  kind, day, date: null, start_min, end_min, speaker, title: null, category: "", room: "בית מדרש", parallel: false, note, people,
});
/** The whole answer at the scenario's end — written out, so both sides are held to it, not only to each other. */
const WHOLE = stable({
  edition: { label: EDITION.label, start_date: null },
  rows: [
    guestRow("memorial", 0, 780, 795, "", null, []),
    guestRow("lesson", 1, 510, 585, "בטא · גמא", "שורה לאורחים", [0]),
    guestRow("lesson", 1, 600, 675, "אלפא", null, []),
    guestRow("lesson", 2, 510, 585, "אלפא", null, []),
  ],
  people: [{ label: "בטא", bio: null, photo: null }],
  fixed: FIXED_ROWS,
});

export const V19: Record<string, Step[]> = {
  "v19 «נשלח לדפוס»: logistics or an admin; a re-stamp; nothing to remove is nothing; an archive's admins only": [
    { as: "L", readerSent: true, is: "ok" },
    { as: "A", readerSent: true, is: "forbidden" },
    { as: "L", readerSent: null, is: "bad_value" },
    { as: "A", readerSent: null, is: "forbidden" }, // the role first
    { as: "E", readerSent: true, is: "ok" }, // again: a new stamp, by E
    { as: "admin", readerSent: false, is: "ok" },
    { as: "L", readerSent: false, is: "ok" }, // nothing to remove
    { as: "L", readerSent: true, is: "ok" },
    { archive: true, is: "ok" },
    { as: "L", readerSent: false, is: "archived" },
    { as: "E", readerSent: false, is: "ok" },
  ],

  "v19 presentations: a pptx only as one; never the lesson's sources, a memorial slot's, or the reader's cover": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600], is: "ok" },
    { as: "A", close: "אלפא", at: [1, 510], is: "ok" },
    { as: "A", store: [1, 510], file: "deck", mime: PPTX, is: "ok" }, // the bucket takes a pptx now
    { as: "A", register: "deck", is: "bad_file" }, // the five-argument call: a source — never a pptx
    { as: "A", register: "deck", kind: "slides", is: "bad_value" },
    { as: "A", register: "deck", kind: null, is: "bad_value" },
    { as: "A", register: "deck", kind: "presentation", is: "ok" }, // the lesson unchanged: still pending, not in the reader
    { as: "A", store: [1, 510], file: "sheet", is: "ok" },
    { as: "A", register: "sheet", pages: 2, is: "ok" }, // the first SOURCE file: a sheet, in the reader
    { as: "A", store: [1, 510], file: "pdfdeck", is: "ok" },
    { as: "A", register: "pdfdeck", kind: "presentation", pages: 3, is: "ok" }, // a presentation may be a PDF
    { as: "L", store: [1, 510], file: "ldeck", mime: PPTX, is: "upload_refused" },
    // a memorial slot with a plan: its materials are sources only
    { as: "admin", saveFallen: null, name: "חלל/ה לבדיקה א", is: "ok" },
    { as: "E", addSlot: [0, 780, 795], is: "ok" },
    { as: "E", addPlan: "חלל/ה לבדיקה א", is: "ok" },
    { as: "E", placePlan: "חלל/ה לבדיקה א", at: [0, 780], is: "ok" },
    { as: "A", store: [0, 780], file: "mdeck", mime: PPTX, is: "ok" },
    { as: "A", register: "mdeck", kind: "presentation", is: "bad_value" },
    { as: "A", register: "mdeck", is: "bad_file" },
    // the week's presentation, on the cover path: the edition's admins, never the cover
    { as: "A", store: "cover", file: "wdeck", mime: PPTX, is: "upload_refused" },
    { as: "E", store: "cover", file: "wdeck", mime: PPTX, is: "ok" },
    { as: "E", register: "wdeck", is: "bad_file" },
    { as: "E", register: "wdeck", kind: "presentation", is: "ok" }, // cover=false, the edition's cover still none
    { as: "E", store: "cover", file: "wpdf", is: "ok" },
    { as: "E", register: "wpdf", kind: "presentation", pages: 1, is: "ok" }, // a readable PDF: the cover stays none
    { as: "E", readerCover: "wpdf", is: "bad_value" },
    { as: "A", unstore: "deck", is: "deleted" },
    { as: "A", unregister: "deck", is: "ok" },
  ],

  "v19 a guest's words: a speaker's public_bio and a lesson's public_note — their limits, no phone, who writes": [
    { as: "admin", updateSpeaker: "אלפא", patch: { public_bio: "  תיאור לאורחים,\r\nבשתי שורות  " }, is: "ok" },
    { as: "A", updateSpeaker: "אלפא", patch: { public_bio: "תיאור אחר" }, is: "not_handler" },
    { as: "A", claim: "אלפא", is: "ok" },
    { as: "A", updateSpeaker: "אלפא", patch: { public_bio: "א".repeat(601) }, is: "bad_value" },
    { as: "A", updateSpeaker: "אלפא", patch: { public_bio: "א".repeat(600) }, is: "ok" },
    { as: "A", updateSpeaker: "אלפא", patch: { public_bio: "לפרטים: someone@example.org" }, is: "contact_in_text" },
    { as: "A", updateSpeaker: "אלפא", patch: { public_bio: "לפרטים: 000-000-0081" }, is: "contact_in_text" },
    { as: "A", updateSpeaker: "אלפא", patch: { public_bio: null }, is: "ok" },
    { as: "L", updateSpeaker: "אלפא", patch: { public_bio: "תיאור" }, is: "forbidden" },
    { as: "A", create: { name: "מרצה לאורחים", public_bio: "תיאור לדוגמה" }, opts: { confirmed: true }, is: "ok" },
    { as: "A", create: { name: "מרצה עם טלפון", public_bio: "טל' 000-000-0082" }, opts: { confirmed: true }, is: "contact_in_text" },
    // a lesson's note for guests
    { as: "A", propose: "אלפא", cell: [1, 600, 690], is: "ok" },
    { as: "A", close: "אלפא", at: [1, 600], is: "ok" },
    { as: "A", publicNote: [1, 600], note: "  שורה לאורחים  ", is: "ok" },
    { as: "A", publicNote: [1, 600], note: "א".repeat(401), is: "bad_value" },
    { as: "A", publicNote: [1, 600], note: "א".repeat(400), is: "ok" },
    { as: "A", publicNote: [1, 600], note: "לשאלות: 000-000-0083", is: "contact_in_text" },
    { as: "L", publicNote: [1, 600], note: "שורה", is: "forbidden" },
    { as: "A", publicNote: [1, 600], note: "שורה", staleBy: 1, is: "stale" },
    { as: "A", publicNote: [1, 600], note: "א".repeat(401), staleBy: 1, is: "stale" }, // the version before the note
    { as: "A", propose: "בטא", cell: [2, 510, 600], is: "ok" },
    { as: "A", publicNote: [2, 510], note: "שורה על טיוטה", is: "ok" }, // a draft's too
    { as: "E", addSlot: [0, 780, 795], is: "ok" },
    { as: "E", publicNote: [0, 780], note: "שורה", is: "memorial_slot" },
    { as: "A", reopen: [1, 600], is: "ok" }, // the note stays: it is the slot's, not the speaker's
    { as: "A", publicNote: [1, 600], note: null, is: "ok" },
  ],

  "v19 the photo: who may set it, only a small clean baseline JPEG, the bytes kept and read back canonical, removed": [
    { as: "A", photo: "אלפא", bytes: "clean", is: "not_handler" }, // nobody's: A does not handle אלפא
    { as: "L", photo: "אלפא", bytes: "clean", is: "forbidden" },
    { as: "admin", photo: "אלפא", bytes: "clean", is: "ok" },
    { as: "A", readPhoto: "אלפא", is: "clean|at=y" }, // every member reads
    { as: "L", readPhoto: "אלפא", is: "clean|at=y" },
    { as: "A", readPhoto: "בטא", is: "none" },
    { as: "A", claim: "בטא", is: "ok" },
    { as: "A", photo: "בטא", bytes: "exif", is: "bad_file" },
    { as: "A", photo: "בטא", bytes: "progressive", is: "bad_file" },
    { as: "A", photo: "בטא", bytes: "trailer", is: "bad_file" },
    { as: "A", photo: "בטא", bytes: "big", is: "bad_file" },
    { as: "A", photo: "בטא", bytes: "garbage", is: "bad_file" },
    { as: "A", photo: "בטא", raw: "", is: "bad_file" },
    { as: "A", photo: "בטא", raw: "abc", is: "bad_file" },
    { as: "A", photo: "בטא", raw: SPACED, is: "bad_file" },
    { as: "A", photo: "בטא", raw: nonCanonical(CLEAN), is: "ok" }, // the same bytes: stored as them, read back canonical
    { as: "A", readPhoto: "בטא", is: "clean|at=y" },
    { as: "A", photo: "מרצה שאיננו", bytes: "clean", is: "stale" },
    { as: "A", photo: "בטא", bytes: null, is: "ok" },
    { as: "A", photo: "בטא", bytes: null, is: "ok" }, // nothing to remove
    { as: "E", photo: "גמא", bytes: "clean", is: "ok" }, // the edition's admin
    { sandbox: true, is: "ok" },
    { as: "A", photo: "בטא", bytes: "clean", is: "not_handler" }, // a practice week gives no right over the pool's record
    { as: "E", photo: "גמא", bytes: null, is: "not_handler" },
    { as: "admin", photo: "אלפא", bytes: null, is: "ok" },
  ],

  "v19 the guest schedule: people only with this edition's public_ok, in order of appearance; fixed rows; notes; taken back at once": [
    { as: "E", issue: "schedule", name: "s", is: "ok" },
    { as: "B", propose: "בטא", cell: [1, 510, 600], is: "ok" },
    { as: "B", close: "בטא", at: [1, 510], is: "ok" },
    { as: "A", propose: "אלפא", cell: [1, 600, 690], is: "ok" },
    { as: "A", close: "אלפא", at: [1, 600], is: "ok" },
    { as: "A", propose: "אלפא", cell: [2, 510, 600], is: "ok" },
    { as: "A", close: "אלפא", at: [2, 510], is: "ok" },
    { anon: "scheduleView", token: "s", part: "keys", is: "edition,fixed,people,rows" },
    // nobody approved: the names on the rows as on the poster, no people
    { anon: "scheduleView", token: "s", part: "people", is: "none" },
    { anon: "scheduleView", token: "s", part: "rows", is: "1|510-585|lesson|בטא|note=-|people=- ; 1|600-675|lesson|אלפא|note=-|people=- ; 2|510-585|lesson|אלפא|note=-|people=-" },
    { as: "A", publicOk: "אלפא", ok: true, is: "ok" },
    { anon: "scheduleView", token: "s", part: "people", is: "אלפא|bio=-|photo=-" },
    { anon: "scheduleView", token: "s", part: "rows", is: "1|510-585|lesson|בטא|note=-|people=- ; 1|600-675|lesson|אלפא|note=-|people=0 ; 2|510-585|lesson|אלפא|note=-|people=0" },
    { as: "A", updateSpeaker: "אלפא", patch: { public_bio: "תיאור לדוגמה" }, is: "ok" },
    { as: "A", photo: "אלפא", bytes: "clean", is: "ok" },
    { anon: "scheduleView", token: "s", part: "people", is: "אלפא|bio=תיאור לדוגמה|photo=clean" },
    // בטא appears first in the grid: first among the people, the indexes follow
    { as: "B", publicOk: "בטא", ok: true, is: "ok" },
    { anon: "scheduleView", token: "s", part: "people", is: "בטא|bio=-|photo=- ; אלפא|bio=תיאור לדוגמה|photo=clean" },
    { anon: "scheduleView", token: "s", part: "rows", is: "1|510-585|lesson|בטא|note=-|people=0 ; 1|600-675|lesson|אלפא|note=-|people=1 ; 2|510-585|lesson|אלפא|note=-|people=1" },
    // a co-speaker without an approach: in the row's names, never among the people
    { coSpeaker: "גמא", at: [1, 510], is: "ok" },
    { anon: "scheduleView", token: "s", part: "rows", is: "1|510-585|lesson|בטא · גמא|note=-|people=0 ; 1|600-675|lesson|אלפא|note=-|people=1 ; 2|510-585|lesson|אלפא|note=-|people=1" },
    { anon: "scheduleView", token: "s", part: "people", is: "בטא|bio=-|photo=- ; אלפא|bio=תיאור לדוגמה|photo=clean" },
    // set_public_ok's rule
    { as: "L", publicOk: "אלפא", ok: false, is: "forbidden" },
    { as: "B", publicOk: "אלפא", ok: false, is: "not_handler" },
    { as: "A", publicOk: "אלפא", ok: false, staleBy: 1, is: "stale" },
    { as: "A", publicOk: "אלפא", ok: null, is: "bad_value" },
    { as: "A", publicOk: "גמא", ok: true, is: "stale" }, // no approach
    { as: "A", publicOk: "אלפא", ok: true, is: "ok" }, // unchanged: no new version
    // taken back: gone at once, the indexes shift
    { as: "A", publicOk: "אלפא", ok: false, is: "ok" },
    { anon: "scheduleView", token: "s", part: "people", is: "בטא|bio=-|photo=-" },
    { as: "B", publicNote: [1, 510], note: "שורה לאורחים", is: "ok" },
    { as: "E", addSlot: [0, 780, 795], is: "ok" },
    {
      anon: "scheduleView", token: "s", part: "rows",
      is: "0|780-795|memorial|-|note=-|people=- ; 1|510-585|lesson|בטא · גמא|note=שורה לאורחים|people=0 ; 1|600-675|lesson|אלפא|note=-|people=- ; 2|510-585|lesson|אלפא|note=-|people=-",
    },
    { anon: "scheduleView", token: "s", part: "fixed", is: FIXED },
    { anon: "scheduleView", token: "s", is: WHOLE }, // and the whole answer
  ],

  "v19 the log: a photo set or removed (never its bytes), public_ok when it changed — nothing for what changed nothing": [
    { as: "A", claim: "אלפא", is: "ok" },
    { as: "A", photo: "אלפא", bytes: "clean", is: "ok" },
    { as: "A", photo: "אלפא", bytes: "clean", is: "ok" }, // again: a line every time
    { as: "A", photo: "אלפא", bytes: null, is: "ok" },
    { as: "A", photo: "אלפא", bytes: null, is: "ok" }, // nothing went: no line
    { as: "A", publicOk: "אלפא", ok: true, is: "ok" },
    { as: "A", publicOk: "אלפא", ok: true, is: "ok" }, // unchanged: no line
    { as: "E", publicOk: "אלפא", ok: false, is: "ok" },
    { as: "A", setStatus: "אלפא", status: "approached", is: "ok" }, // an approach's line without public_ok
    {
      log: ["photo", "public_ok"],
      is: [
        `photo|speakers|אלפא|by=A|{"set":true}`,
        `photo|speakers|אלפא|by=A|{"set":true}`,
        `photo|speakers|אלפא|by=A|{"set":false}`,
        `public_ok|approaches|אלפא|by=A|{"owner":"A","public_ok":true,"speaker":"אלפא","status":"claimed"}`,
        `public_ok|approaches|אלפא|by=E|{"owner":"A","public_ok":false,"speaker":"אלפא","status":"claimed"}`,
      ].join(" ; "),
    },
  ],
};
