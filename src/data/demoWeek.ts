// The demo edition: synthetic people only («מרצה 07»), no dates (TBD), and every
// shape last year's grid had — a parallel pair, a 60+30 split, an all-night
// merge, memorial slots — so the decision gate exercises them all. The pool's
// demo (milestone 2) adds a speaker for every «המרצים שלי» group, a hand-over
// waiting for the demo user, a few contacts made of placeholder words (never
// a number or address that could be someone's) and a past edition's lessons.
// Milestone 3 adds a lesson in every stage: payment asked, approved (and paid),
// rejected; a volunteer; a message sent, and one sent and then moved; escorts
// from a synthetic roster (two lessons close together for one of them); every
// kind of sources; transport details made of placeholder words — and, for the
// demo user, a closed lesson in every «המרצים שלי» group. No message template
// and no duty phrases: those are the instructor's wording, never ours.
// Milestone 5ב-2 adds memorial times: nine synthetic fallen («חלל/ה לדוגמה 1»
// … 9 — the real names are entered by the instructor, in the app only), three
// plans (one placed on Sunday's slot, with a liaison from the synthetic
// roster), a family's contact made of placeholder words — and no memorial
// policy: that is the staff meeting's.
import { TEMPLATE_2026 } from "../domain/template2026";
import type { Day } from "../domain/time";
import {
  type Approach, type Category, type Gender, LESSON_STAGE_DEFAULTS, type Lesson, type LessonSpeaker, type Pitch, type RosterMember, type SourceFile, type Speaker,
  type SpeakerContacts, type TransportDetails, type Week,
} from "../domain/types";
import type { Sample } from "./demoFiles";
import type { StoredObject } from "./engine";
import type { Fallen, FallenContacts } from "./memorial";
import type { ActivityEntry, HistoryLesson } from "./speakers";
import type { LessonReview, SpeakerReview } from "./reviews";

export const DEMO_CATEGORIES: Category[] = [
  ["תנ\"ך", "#8a5a2b"],
  ["תלמוד, הלכה ומדרש", "#5b4a8b"],
  ["מחשבת ישראל", "#2f6f73"],
  ["חסידות וקבלה", "#7a3e6d"],
  ["פילוסופיה", "#3d5a99"],
  ["ספרות ואמנות", "#a0522d"],
  ["ציונות והיסטוריה", "#5e7a2e"],
  ["חברה ואקטואליה", "#9a6b00"],
  ["מדע ונפש", "#2e7d5b"],
  ["דתות ותרבויות העולם", "#6b6b2e"],
].map(([name, color], i) => ({ id: i + 1, name, color, sort: i + 1, active: true }));

const TITLES: [string | null, Gender][] = [
  ["ד״ר", "m"], ["ד״ר", "f"], ["פרופ׳", "m"], ["פרופ׳", "f"], ["הרב", "m"], ["הרבנית", "f"], [null, "m"], [null, "f"],
];

export function demoWeek(): Week {
  const speakers: Speaker[] = Array.from({ length: 60 }, (_, i) => {
    const [title, gender] = TITLES[i % TITLES.length];
    const n = String(i + 1).padStart(2, "0");
    const cat = DEMO_CATEGORIES[i % DEMO_CATEGORIES.length];
    return {
      id: i + 1,
      title,
      name: `מרצה ${n}`,
      disambiguator: null,
      gender: i === 59 ? null : gender, // one unknown, so the "gender missing" path shows
      affiliation: "מוסד לדוגמה",
      bio_short: `מלמד/ת ${cat.name} (נתון לדוגמה)`,
      topics: [cat.name],
      contact_pref: null,
      vetted: i >= 55 ? "pending" : "approved",
      vetted_by: i >= 55 ? null : 1,
      vetted_note: null,
      retired: false,
      name_key: `מרצה ${n}`,
      version: 1,
    };
  });

  const lessons: Lesson[] = [];
  const lessonSpeakers: LessonSpeaker[] = [];
  const approaches: Approach[] = [];
  const pitches: Pitch[] = [];
  let lessonId = 0;
  let approachId = 0;
  let pitchId = 0;

  const approachOf = (speakerId: number, status: Approach["status"] = "approached", owner = 1 + (speakerId % 4)): Approach => {
    let a = approaches.find((x) => x.speaker_id === speakerId);
    if (!a) {
      a = { id: ++approachId, speaker_id: speakerId, owner_member_id: owner, status, avail_note: null, offered_to: null, version: 1 };
      approaches.push(a);
    }
    return a;
  };

  const lesson = (day: Day, start: number, end: number, extra: Partial<Lesson> = {}): Lesson => {
    const l: Lesson = {
      id: ++lessonId, kind: "lesson", state: "draft", day, start_min: start, end_min: end, room_id: 1,
      title: null, category_id: null, audience: null, teach_min: null, parallel_reason: null, ...LESSON_STAGE_DEFAULTS,
      version: 1, updated_by: null, ...extra,
    };
    lessons.push(l);
    return l;
  };

  const closed = (day: Day, start: number, end: number, speakerId: number, extra: Partial<Lesson> = {}) => {
    const s = speakers[speakerId - 1];
    const cat = DEMO_CATEGORIES.find((c) => c.name === s.topics[0])!;
    const l = lesson(day, start, end, { state: "closed", title: `שיעור לדוגמה ${lessonId + 1}`, category_id: cat.id, ...extra });
    lessonSpeakers.push({ lesson_id: l.id, speaker_id: speakerId, role: "lead" });
    const a = approachOf(speakerId, "positive");
    pitches.push({ id: ++pitchId, lesson_id: l.id, approach_id: a.id, state: "accepted", proposed_by: a.owner_member_id, at: "2026-11-01T10:00:00Z" });
    return l;
  };

  const drafted = (day: Day, start: number, end: number, speakerIds: number[], state: Pitch["state"] = "approached") => {
    const l = lesson(day, start, end);
    for (const id of speakerIds) {
      const a = approachOf(id);
      pitches.push({ id: ++pitchId, lesson_id: l.id, approach_id: a.id, state, proposed_by: a.owner_member_id, at: "2026-11-02T10:00:00Z" });
    }
    return l;
  };

  // The stages (milestone 3), synthetic: amounts are example numbers, notes say «לדוגמה».
  const at = (d: number) => `2026-11-${String(d).padStart(2, "0")}T10:00:00Z`;
  const sent = (by: number) => ({ confirm_sent_at: at(10), confirm_sent_by: by });
  const approved = { approval: "approved" as const, approved_by: 1, approved_at: at(8) };

  // Sunday (opens 08:30 in this demo): mostly men so far → the day asks for women.
  // 08:30 is done in every stage; 10:00 and 11:30 share one escort with no break between.
  closed(0, 510, 600, 1, {
    title: "פתיחת השבוע (לדוגמה)", category_id: 3, teach_min: 75,
    pay_amount: 100, transport: "one_way", ...approved, paid_at: at(12), ...sent(2),
    escort_roster_id: 1, sources_kind: "sheet", print_when: "before", sources_note: "דף מקורות (נתון לדוגמה)", in_reader: true,
  });
  closed(0, 600, 690, 3, { ...sent(4), escort_roster_id: 2, sources_kind: "presentation", presentation_url: "https://slides.example/presentation-demo" });
  closed(0, 690, 780, 5, { category_id: 3, escort_roster_id: 2 });
  closed(0, 870, 960, 7);
  drafted(0, 960, 1050, [9, 11]);
  closed(0, 1470, 1560, 2, { self_intro: true, sources_kind: "none" });

  // Monday: a 60+30 split at 14:30, and the all-night merge 00:30–05:00.
  closed(1, 510, 600, 4, { pay_amount: 200, transport: "round_trip", approval: "pending" }); // waits for the instructor
  closed(1, 600, 690, 6, { pay_amount: 300, approval: "rejected", approval_note: "נתון לדוגמה: לבדוק שוב את הסכום", approved_by: 1, approved_at: at(9) });
  closed(1, 870, 930, 8, { teach_min: 60, ...sent(1), needs_reconfirm: true }); // moved after the message went out
  closed(1, 930, 960, 10, { teach_min: 30, sources_kind: "sheet_video", print_when: "same_day" });
  closed(1, 1200, 1290, 12, { pay_amount: 200, ...approved }); // approved, not yet paid; the message still to send
  closed(1, 1470, 1740, 14, { title: "סדר לילה לדוגמה (כל הלילה)", teach_min: 270 });

  // Tuesday: a parallel pair at 16:00 in two rooms; back-to-back same category in the morning.
  closed(2, 510, 600, 21, { category_id: 1, sources_kind: "other", sources_note: "ספר שהמרצה מביא/ה (נתון לדוגמה)" });
  closed(2, 600, 690, 31, { category_id: 1 });
  closed(2, 960, 1050, 16, { room_id: 1, escort_roster_id: 3, sources_kind: "sheet_presentation", ...sent(1) }); // the demo user's: all in place
  closed(2, 960, 1050, 17, { room_id: 2, parallel_reason: "דוגמה לשיעורים מקבילים" });
  drafted(2, 1200, 1290, [56], "candidate"); // not yet vetted → candidate only

  // Wednesday: a declined approach still pitched, and an empty evening.
  closed(3, 600, 690, 19, { transport: "one_way", ...approved });
  closed(3, 690, 780, 20, { escort_roster_id: 4, escort_note: "נתון לדוגמה: להגיע רבע שעה לפני", ...sent(1) }); // sources still to come
  const declined = approachOf(23, "declined");
  pitches.push({ id: ++pitchId, lesson_id: lesson(3, 870, 960).id, approach_id: declined.id, state: "approached", proposed_by: 2, at: "2026-11-03T10:00:00Z" });

  // Thursday: a shaped-but-empty cell (a draft with no pitch), and the parents' lesson.
  lesson(4, 690, 780);
  closed(4, 1050, 1140, 24, { audience: "שיעור להורים", ...sent(1) }); // no escort yet

  // Memorial slots: placeholders only — names of the fallen are entered by the instructor, never seeded.
  for (const day of [0, 1, 2, 3, 4] as Day[]) lesson(day, 780, 795, { kind: "memorial", title: "זמן זיכרון" });
  // Sunday's slot holds the first synthetic fallen's plan; its escort is the family's liaison (synthetic).
  const sundayMemorial = lessons.find((l) => l.kind === "memorial" && l.day === 0)!;
  sundayMemorial.escort_roster_id = 4;

  // «המרצים שלי» for the demo user (member 1): one speaker in each group the grid has not filled.
  approachOf(32, "claimed", 1); // לפנות
  approachOf(36, "no_answer", 1); // מחכה לתשובה
  approachOf(28, "positive", 1); // לסגור שעה
  approachOf(13, "approached", 2).offered_to = 1; // a hand-over waiting for the demo user's answer

  // Availability chips: Sunday morning «לא», Tuesday evening and night «יכול/ה».
  const availability = [
    { id: 1, approach_id: approachOf(9).id, day: 0 as Day, from_min: 390, to_min: 780, kind: "cannot" as const, note: "דוגמה: לא בבקרים" },
    { id: 2, approach_id: approachOf(30, "claimed").id, day: 2 as Day, from_min: 1140, to_min: 1440, kind: "can" as const, note: null },
    { id: 3, approach_id: approachOf(30, "claimed").id, day: 2 as Day, from_min: 1440, to_min: 1830, kind: "can" as const, note: null },
  ];

  return {
    edition: { id: 1, label: "הדגמה", kind: "demo", start_date: null, first_day_from: 510, last_day_until: 1140, status: "planning", settings: { lesson_minutes: 75, row_minutes: 90 } },
    rows: TEMPLATE_2026,
    rooms: [
      { id: 1, name: "בית מדרש", sort: 1, is_default: true },
      { id: 2, name: "כיתת בית מדרש", sort: 2, is_default: false },
      { id: 3, name: "כיתה ג׳", sort: 3, is_default: false },
    ],
    categories: DEMO_CATEGORIES,
    speakers,
    approaches,
    availability,
    lessons,
    lessonSpeakers,
    pitches,
    team: [
      { id: 1, display_name: "מדריך/ה (הדגמה)", gender: null, role: "admin" },
      { id: 2, display_name: "חניך/ה א׳", gender: null, role: "content" },
      { id: 3, display_name: "חניך/ה ב׳", gender: null, role: "content" },
      { id: 4, display_name: "חניך/ה ג׳", gender: null, role: "content" },
      { id: 5, display_name: "לוגיסטיקה (הדגמה)", gender: null, role: "logistics" },
    ],
    roster: DEMO_ROSTER.map((r) => ({ ...r })),
    // the first escort reminded the speaker of Sunday's opening and will meet them at the parking (synthetic times)
    escortTicks: [
      { lesson_id: 1, item: "reminded", at: at(13) },
      { lesson_id: 1, item: "met", at: at(14) },
    ],
    sourceFiles: [],
    memorialPlans: [
      {
        id: 1, fallen_id: 1, lesson_id: sundayMemorial.id, family_status: "confirmed", speaker_text: "בן/בת משפחה (נתון לדוגמה)", planned_minutes: 10, hard_stop: true,
        materials_note: "עמוד זיכרון למקראה (נתון לדוגמה)", version: 1,
      },
      { id: 2, fallen_id: 2, lesson_id: null, family_status: "invited", speaker_text: null, planned_minutes: 20, hard_stop: false, materials_note: null, version: 1 },
      { id: 3, fallen_id: 3, lesson_id: null, family_status: "not_contacted", speaker_text: null, planned_minutes: null, hard_stop: false, materials_note: null, version: 1 },
    ],
    fallen: DEMO_FALLEN.slice(0, 3).map(({ id, name, gender }) => ({ id, name, gender })),
  };
}

/** The demo's fallen: nine synthetic names — the real ones are entered by the instructor, in the app only. */
export const DEMO_FALLEN: Fallen[] = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, name: `חלל/ה לדוגמה ${i + 1}`, gender: null, note: null, active: true }));

/** A family's contact person in the demo: placeholder words and an example.org address (which never delivers). */
export function demoFallenContacts(): Record<number, FallenContacts> {
  return { 1: { contact_name: "איש/אשת קשר לדוגמה", relation: "קרבה לדוגמה", phone: "טלפון לדוגמה", email: "family1@example.org", note: null } };
}

/** The demo's trainees (names only) — escorts come from here. */
export const DEMO_ROSTER: RosterMember[] = [
  ["מלווה לדוגמה א׳", "f"],
  ["מלווה לדוגמה ב׳", "m"],
  ["מלווה לדוגמה ג׳", "f"],
  ["מלווה לדוגמה ד׳", "m"],
  ["מלווה לדוגמה ה׳", null],
  ["מלווה לדוגמה ו׳", "f"],
].map(([full_name, gender], i) => ({ id: i + 1, full_name: full_name as string, gender: gender as Gender | null }));

/** Transport details for the demo (kept apart from the week, like the database): placeholder words only. */
export function demoTransport(week: Week): Record<string, TransportDetails> {
  const key = (day: number, start: number) => `${week.edition.id}:${week.lessons.find((l) => l.day === day && l.start_min === start && l.state === "closed")!.id}`;
  return {
    [key(0, 510)]: { pickup_address: "כתובת לדוגמה", pickup_time: "07:15 (לדוגמה)", driver_name: "נהג/ת לדוגמה", driver_phone: "טלפון לדוגמה", arranged: true },
    [key(1, 510)]: { pickup_address: "כתובת לדוגמה", pickup_time: null, driver_name: null, driver_phone: null, arranged: false },
  };
}

/** Contacts for the demo's sheet: placeholder words, and addresses at example.org (which never delivers). */
export function demoContacts(): Record<number, SpeakerContacts> {
  const one = (n: number, extra: Partial<SpeakerContacts> = {}): SpeakerContacts => ({
    phone: "טלפון לדוגמה",
    email: `speaker${String(n).padStart(2, "0")}@example.org`,
    secretary_note: null,
    notes: null,
    ...extra,
  });
  return {
    4: one(4),
    8: one(8, { secretary_note: "דרך המזכירות (נתון לדוגמה)" }),
    12: one(12, { notes: "מעדיף/ה הודעה לפני שיחה (נתון לדוגמה)" }),
    28: one(28, { email: null }),
    32: one(32, { phone: null }),
  };
}

/** Lessons a few demo speakers taught in a past edition — synthetic, like the rest of the demo. */
export function demoHistory(): Record<number, HistoryLesson[]> {
  const past = (speaker: number, day: Day, start: number, title: string | null): [number, HistoryLesson[]] => [
    speaker,
    [{ edition_id: -1, edition_label: "מחזור קודם (לדוגמה)", edition_kind: "archive", start_date: null, day, start_min: start, end_min: start + 90, title, category: DEMO_CATEGORIES[speaker % DEMO_CATEGORIES.length].name, role: "lead" }],
  ];
  return Object.fromEntries([past(1, 0, 510, "שיעור לדוגמה"), past(4, 2, 870, null), past(9, 1, 1200, "שיעור לדוגמה"), past(28, 3, 600, "שיעור לדוגמה")]);
}

/**
 * «איך עבר» in the demo week (milestone 6): three of its lessons, written by the demo's team — the words say «לדוגמה».
 * Each written by the lesson's handler, as after the week (the demo's week has no date: in it, only an admin may write
 * one now).
 */
export function demoReviews(week: Week): (LessonReview & { edition_id: number })[] {
  const at = (day: number, start: number) => week.lessons.find((l) => l.day === day && l.start_min === start && l.state === "closed" && l.kind === "lesson")!;
  const lead = (lessonId: number) => week.lessonSpeakers.find((x) => x.lesson_id === lessonId && x.role === "lead")?.speaker_id ?? null;
  const one = (day: number, start: number, r: Pick<LessonReview, "went_well" | "issues" | "invite_again" | "overran" | "rating">) => {
    const l = at(day, start);
    const handler = week.approaches.find((x) => x.speaker_id === lead(l.id))?.owner_member_id ?? null;
    return { lesson_id: l.id, edition_id: week.edition.id, speaker_id: lead(l.id), ...r, written_by: handler, written_at: "2026-11-20T10:00:00.000Z", version: 1 };
  };
  return [
    one(0, 510, { went_well: "נתון לדוגמה: השיעור היה ברור, והחניכים שאלו הרבה.", issues: null, invite_again: "yes", overran: false, rating: 5 }),
    one(0, 600, { went_well: null, issues: "נתון לדוגמה: התחיל באיחור של כמה דקות.", invite_again: "maybe", overran: true, rating: 3 }),
    one(2, 510, { went_well: null, issues: "נתון לדוגמה: לא התאים לקהל.", invite_again: "no", overran: false, rating: null }),
  ];
}

/** «איך עבר» from the past edition the demo's history names (synthetic, like it): what the speaker sheet shows across the years. */
export function demoPastReviews(): Record<number, SpeakerReview[]> {
  const past = (speaker: number, lessonId: number, r: Pick<SpeakerReview, "went_well" | "issues" | "invite_again" | "overran" | "rating">): [number, SpeakerReview[]] => {
    const h = demoHistory()[speaker][0];
    return [
      speaker,
      [{ edition_id: h.edition_id, edition_label: h.edition_label, edition_kind: "archive", start_date: null, lesson_id: lessonId, day: h.day, start_min: h.start_min, end_min: h.end_min, title: h.title, ...r, written_at: "2026-02-20T10:00:00.000Z" }],
    ];
  };
  return Object.fromEntries([
    past(1, -1, { went_well: "נתון לדוגמה: שיעור חזק, כדאי להזמין שוב.", issues: null, invite_again: "yes", overran: false, rating: 5 }),
    past(9, -2, { went_well: null, issues: "נתון לדוגמה: חרג/ה מהזמן.", invite_again: "maybe", overran: true, rating: 3 }),
  ]);
}

/** A short timeline for the demo's sheet: the hand-over waiting for the demo user (the grid's own commands are not logged in memory). */
export function demoLog(week: Week, now = Date.now()): ActivityEntry[] {
  const a = week.approaches.find((x) => x.speaker_id === 13);
  if (!a) return [];
  // Days before the demo opens, so what the visitor does next comes after it.
  const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
  const row = (id: number, at: string, kind: string, detail: Record<string, unknown>): ActivityEntry => ({
    id, at, actor: 2, edition_id: week.edition.id, entity: "approaches", entity_id: a.id, kind, detail: { owner: 2, speaker: 13, ...detail },
  });
  return [
    row(1, daysAgo(3), "insert", { status: "claimed" }),
    row(2, daysAgo(2), "update", { status: "approached", note: "פנייה ראשונה (נתון לדוגמה)" }),
    row(3, daysAgo(1), "update", { status: "approached", offered_to: 1, note: "הצעה להעביר (נתון לדוגמה)" }),
  ];
}

/**
 * The demo's sources (milestone 5ב-1): a few lessons with sample files — Sunday's opening (two PDFs: in the
 * reader), Tuesday's 16:00 in the בית מדרש (a picture, marked for the reader), Tuesday's 08:30 (a Word file only:
 * «צריך PDF»), and Monday's 15:30 marked with nothing yet («חסר»). The files are made in the browser when first
 * opened (src/data/demoFiles.ts); here, only their rows and what the bucket would record of them.
 */
export function seedDemoSources(week: Week): { samples: Record<string, Sample>; objects: Record<string, StoredObject> } {
  const at = (day: number, start: number, room = 1) => week.lessons.find((l) => l.day === day && l.start_min === start && l.room_id === room && l.state === "closed")!;
  const lead = (lessonId: number) => week.lessonSpeakers.find((x) => x.lesson_id === lessonId && x.role === "lead")?.speaker_id ?? null;
  const samples: Record<string, Sample> = {};
  const objects: Record<string, StoredObject> = {};
  let n = 0;
  const add = (lessonId: number, display: string, sample: Sample, size: number, by: number) => {
    n++;
    const ext = sample.kind === "docx" ? "docx" : sample.kind;
    const mime = sample.kind === "pdf" ? "application/pdf" : sample.kind === "png" ? "image/png" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const path = `${week.edition.id}/${lessonId}/00000000-0000-4000-8000-${String(n).padStart(12, "0")}-sample-${n}.${ext}`;
    week.sourceFiles.push({
      id: n, lesson_id: lessonId, cover: false, speaker_id: lead(lessonId), fallen_id: null, storage_path: path, display_name: display, mime: mime as SourceFile["mime"],
      size_bytes: size, page_count: sample.kind === "pdf" ? sample.pages : sample.kind === "png" ? 1 : null, uploaded_by: by, uploaded_at: "2026-11-15T10:00:00Z",
    });
    samples[path] = sample;
    objects[path] = { mime, size, owner: `member:${by}` };
  };
  const opening = at(0, 510);
  add(opening.id, "דף מקורות לדוגמה.pdf", { kind: "pdf", title: "פתיחת השבוע (לדוגמה)", pages: 2, size: [420, 595] }, 48_000, 2);
  add(opening.id, "מקור נוסף לדוגמה.pdf", { kind: "pdf", title: "פתיחת השבוע (לדוגמה)", pages: 1, size: [612, 792] }, 21_000, 2);
  const tuesday = at(2, 960, 1);
  tuesday.in_reader = true;
  add(tuesday.id, "צילום מקור לדוגמה.png", { kind: "png", title: "שיעור לדוגמה", pages: 1 }, 90_000, 1);
  const word = at(2, 510);
  word.in_reader = true;
  add(word.id, "מקורות לדוגמה.docx", { kind: "docx", title: "שיעור לדוגמה", pages: 1 }, 12_000, 3);
  at(1, 930).in_reader = true; // marked, nothing arrived: «חסר»
  return { samples, objects };
}
