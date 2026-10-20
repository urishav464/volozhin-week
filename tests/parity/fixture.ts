// The base data every parity scenario starts from — synthetic only.
export type ActorKey = "admin" | "A" | "B" | "L" | "E";

/** `global`: an admin of every edition (members.edition_id null); everyone else belongs to the scenario's edition. */
export const MEMBERS: { key: ActorKey; email: string; role: "admin" | "content" | "logistics"; name: string; global?: true }[] = [
  { key: "admin", email: "admin@example.org", role: "admin", name: "מדריך", global: true },
  { key: "A", email: "a@example.org", role: "content", name: "חניך א" },
  { key: "B", email: "b@example.org", role: "content", name: "חניך ב" },
  { key: "L", email: "l@example.org", role: "logistics", name: "לוגיסטיקה" },
  { key: "E", email: "e@example.org", role: "admin", name: "אדמין המחזור" }, // this edition's admin only
];

export const ROOMS = [
  { name: "בית מדרש", sort: 1, is_default: true },
  { name: "כיתה", sort: 2, is_default: false },
  { name: "ספרייה", sort: 3, is_default: false },
];

/** A room that belongs to another edition: the SQL driver makes one there; the engine has no such room. */
export const FOREIGN_ROOM = "חדר של מחזור אחר";

/** The edition's trainees (escorts), names only. */
export const ROSTER: { name: string; gender: "m" | "f" | null }[] = [
  { name: "חניכה לדוגמה", gender: "f" },
  { name: "חניך לדוגמה", gender: "m" },
];

/** Another edition's label (a practice week): the SQL driver makes it; the engine's import host knows it by name. */
export const FOREIGN_EDITION = "מחזור אחר";

/** A trainee of another edition: the SQL driver makes one there; the engine has no such trainee. */
export const FOREIGN_TRAINEE = "חניך/ה של מחזור אחר";

export const SPEAKERS: { name: string; gender: "m" | "f" | null; vetted?: "pending" | "approved"; retired?: boolean }[] = [
  { name: "אלפא", gender: "f" },
  { name: "בטא", gender: "m" },
  { name: "גמא", gender: "f" },
  { name: "דלתא", gender: null },
  { name: "הא", gender: "m", vetted: "pending" },
  { name: "וו", gender: "f", retired: true },
  // the pool (milestone 2): names for «ייתכן שזה…», and a speaker B already handles
  { name: "פלונית אלמונית", gender: "f" },
  { name: "יוסף בן שמעון", gender: "m", vetted: "pending" },
  { name: "זין", gender: "m" },
];

/** Contacts some speakers start with — placeholder words only. */
export const CONTACTS: Record<string, { phone: string | null; email: string | null; secretary_note: string | null; notes: string | null }> = {
  "אלפא": { phone: "טלפון לדוגמה", email: null, secretary_note: "נתון לדוגמה", notes: null },
};

/** Approaches the edition starts with (owner by actor key), and their availability rows (an older, hand-entered shape: ranges across parts). */
export const APPROACHES: { speaker: string; owner: ActorKey; status: "claimed" }[] = [{ speaker: "זין", owner: "B", status: "claimed" }];
export const AVAILABILITY: { speaker: string; day: number; from: number; to: number; kind: "can" | "cannot"; note: string | null }[] = [
  { speaker: "זין", day: 2, from: 1200, to: 1830, kind: "can", note: "ערב ולילה" },
  { speaker: "זין", day: 3, from: 700, to: 1200, kind: "cannot", note: null },
];

/** A speaker as steps name them: «name», or «name#disambiguator» for a namesake. */
export function speakerLabel(s: { name: string; disambiguator: string | null }): string {
  return s.disambiguator ? `${s.name}#${s.disambiguator}` : s.name;
}
export function splitLabel(label: string): [string, string | null] {
  const i = label.indexOf("#");
  return i < 0 ? [label, null] : [label.slice(0, i), label.slice(i + 1)];
}

export interface CreateFields {
  name: string;
  title?: string | null;
  disambiguator?: string | null;
  gender?: string | null;
  affiliation?: string | null;
  bio_short?: string | null;
  topics?: unknown;
  contact_pref?: string | null;
}

export const CATEGORIES = ["תנ\"ך", "פילוסופיה"];

export const EDITION = { label: "בדיקת התאמה", first_day_from: 510, last_day_until: 1140 };

/** Where a lesson is: [day, start_min, room name?] — the room defaults to the default room. */
export type At = [number, number, string?];

export type Step =
  | { as: ActorKey; propose: string; cell: [number, number, number, string?]; mode?: "self" | "offer" }
  | { as: ActorKey; propose: string; at: At; mode?: "self" | "offer" }
  | { as: ActorKey; unpropose: string; at: At }
  | { as: ActorKey; setPitch: string; at: At; state: "candidate" | "approached" | "declined" }
  | { as: ActorKey; close: string; at: At }
  | { as: ActorKey; reopen: At }
  | { as: ActorKey; move: At; to: [number, number, number, string?] }
  | { as: ActorKey; reshape: [number, number]; op: { op: "split_parallel"; count: 2 | 3; reason: string } | { op: "split_time"; parts: number[] } | { op: "merge_next" } | { op: "reset" } }
  | { as: ActorKey; update: At; patch: { title?: string | null; category?: string | null; audience?: string | null; teach_min?: number | null }; staleBy?: number }
  | { archive: true }
  /** The edition becomes a practice week (kind 'practice'): the real pool, no right over it. */
  | { sandbox: true }
  // the speaker pool (CONTRACT.md «The speaker pool») — speakers by label
  | { as: ActorKey; matches: string }
  | { as: ActorKey; create: CreateFields; opts?: { claim?: boolean; approve?: boolean; confirmed?: boolean } }
  | { as: ActorKey; updateSpeaker: string; patch: Record<string, unknown>; staleBy?: number }
  | { as: ActorKey; vet: string[]; state: string; note?: string | null }
  | { as: ActorKey; readContacts: string }
  | { as: ActorKey; setContacts: string; phone?: string | null; email?: string | null; secretary_note?: string | null; notes?: string | null }
  | { as: ActorKey; claim: string }
  | { as: ActorKey; setStatus: string; status: string; note?: string | null; staleBy?: number }
  | { as: ActorKey; handOver: string; to: ActorKey | null; note?: string | null }
  | { as: ActorKey; answerHandOver: string; accept: boolean; note?: string | null }
  | { as: ActorKey; avail: string; day: number; part: string; kind: string | null; note?: string | null }
  // from placement to arrival (milestone 3) — lessons by place, trainees by name
  | { as: ActorKey; pay: At; amount: number | null; transport: string; staleBy?: number }
  | { as: ActorKey; decide: At[]; decision: string; note?: string | null; staleBy?: number }
  | { as: ActorKey; sent: At; staleBy?: number }
  | { as: ActorKey; escort: At; trainee: string | null; selfIntro: boolean | null; note?: string | null; staleBy?: number }
  | { as: ActorKey; sources: At; kind: string; print: string; note?: string | null; url?: string | null; inReader: boolean | null; staleBy?: number }
  | { as: ActorKey; paid: At; value: boolean | null }
  | { as: ActorKey; readTransport: At }
  | { as: ActorKey; setTransport: At; address?: string | null; time?: string | null; driver?: string | null; phone?: string | null; arranged?: boolean }
  | { as: ActorKey; template: string | null }
  | { as: ActorKey; duty: unknown }
  // links and מכריכה לכריכה (milestone 5a) — tokens by the name a step gave them, groups by title, tracks by [day, start]
  | { as: ActorKey; issue: string; trainee?: string | null; name: string }
  | { as: ActorKey; revoke: string }
  /** `from`: the caller's address as the API would report it (a class link's rate limit is per address); `times`: the call made that many times, the last answer kept. */
  | { anon: "escortView" | "kkForm" | "scheduleView"; token: string; from?: string; times?: number }
  | { anon: "escortTick"; token: string; at: At; item: string; on: boolean | null }
  | { anon: "escortPickup"; token: string; at: At; address: string | null }
  | { anon: "kkSignup"; token: string; trainee: string; group: string }
  | { as: ActorKey; kkAdd: [number, number]; fields: KkStepFields }
  | { as: ActorKey; kkUpdate: string; patch: KkStepFields }
  | { as: ActorKey; kkDelete: string }
  | { as: ActorKey; kkPlace: string; trainee: string }
  | { as: ActorKey; kkUnplace: [number, number]; trainee: string }
  | { as: ActorKey; kkWindow: [string | null, string | null] }
  | { as: ActorKey; bookOrder: string; copies: number | null; ordered: boolean | null }
  /** The week's opening Sunday, set by hand (the «מחזור» tab writes the row directly): a yyyy-mm-dd or TBD. */
  | { startDate: string | null }
  /** Sunday's opening minute, set by hand (as the «מחזור» tab writes it). */
  | { firstDayFrom: number | null }
  /** A link's expiry moved into the past, by hand. */
  | { expire: string }
  /** Ten minutes passed for a link's rate limit (its counts' windows moved back by hand). */
  | { rateWindowPassed: string }
  /** A link's count for one caller (`from`; an escort's link has one count) set by hand, as if that many calls were made now. */
  | { rateHits: string; from?: string; hits: number }
  // the sources' files (milestone 5ב-1) — files by the label a step gave them (an ASCII word: it is the stored name too)
  /** An upload through the Storage API to the lesson's folder (or the poster's): the bucket's limits, then the INSERT policy. */
  | { as: ActorKey; store: At | "cover"; file: string; mime?: string; size?: number }
  /** register_source_file for a stored file — `for` names another target in the call than the file's own folder. */
  | { as: ActorKey; register: string; display?: string; pages?: number | null; for?: At | "cover" }
  /** A delete through the Storage API, as the caller: «deleted» or «kept». */
  | { as: ActorKey; unstore: string }
  | { as: ActorKey; unregister: string }
  | { as: ActorKey; readerHeaders: [string | null, string | null] }
  | { as: ActorKey; readerCover: string | null }
  // memorial times and logistics (milestone 5ב-2) — the fallen by name, slots by place, plans by their fallen's name
  /** save_fallen: `saveFallen` names the one to rewrite (null: a new one). */
  | { as: ActorKey; saveFallen: string | null; name: string; gender?: string | null; note?: string | null; active?: boolean | null }
  | { as: ActorKey; deleteFallen: string }
  /** The fallen the caller sees, by name. */
  | { as: ActorKey; readFallen: true }
  | { as: ActorKey; readFallenContacts: string }
  | { as: ActorKey; setFallenContacts: string; contact?: string | null; relation?: string | null; phone?: string | null; email?: string | null; note?: string | null }
  | { as: ActorKey; addSlot: [number, number, number, string?] }
  | { as: ActorKey; removeSlot: At }
  | { as: ActorKey; addPlan: string }
  | { as: ActorKey; updatePlan: string; patch: Record<string, unknown>; staleBy?: number }
  | { as: ActorKey; placePlan: string; at: At | null; staleBy?: number }
  | { as: ActorKey; deletePlan: string }
  | { as: ActorKey; policy: { placement?: string | null; max_minutes?: number | null; warn_adjacent_meal?: boolean | null } }
  /** get_transports_for: the caller's approved transports, by lesson. */
  | { as: ActorKey; readTransports: true }
  // the import of 5786 (v12) — a merge names its pool speaker by label, a lesson its category by name
  | { as: ActorKey; importCandidates: ImportSpeakerStep[]; source?: string | null }
  | { as: ActorKey; importArchive: ImportArchiveStep }
  | { as: ActorKey; importPrefs: { row: number; speaker: string; contact_pref?: string | null; secretary_note?: string | null }[] }
  | { as: ActorKey; importLookup: { speakers: string[]; phones: string[] } }
  /** import_commit with a payload as it is (a wrong kind, a wrong shape). */
  | { as: ActorKey; importRaw: { kind: string; payload: unknown } }
  // after the week (milestone 6) — a review by its lesson's place; the speaker by label
  /** «איך עבר» on a lesson of the edition — or, with `edition`, of the archive edition of that label (the import's). */
  | { as: ActorKey; review: At; edition?: string; fields: { went_well?: string | null; issues?: string | null; invite_again?: string | null; overran?: boolean | null; rating?: number | null }; staleBy?: number }
  /** load_reviews: the edition's reviews the caller reads. */
  | { as: ActorKey; readReviews: true }
  | { as: ActorKey; speakerReviews: string }
  /** edition_returning. */
  | { as: ActorKey; returning: true }
  /** purge_edition_private, with the label typed as given (null: none). */
  | { as: ActorKey; purge: string | null; edition?: string };

/** A speaker row of an import step: as SpeakerRow, the merge target by its label. */
export interface ImportSpeakerStep {
  row: number;
  action: "new" | "merge";
  speaker?: string;
  name: string;
  title?: string | null;
  gender?: string | null;
  affiliation?: string | null;
  topics?: string[];
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export interface ImportLessonStep {
  row: number;
  day: number;
  start: number;
  end: number;
  room?: number;
  title?: string | null;
  category?: string | null;
  audience?: string | null;
  sources_kind?: string;
  print_when?: string;
  sources_note?: string | null;
  pay_amount?: number | null;
  import_note?: string | null;
  speakers: number[];
}

export interface ImportArchiveStep {
  label: string;
  start_date?: string | null;
  source?: string | null;
  speakers: ImportSpeakerStep[];
  lessons: ImportLessonStep[];
}

/** The payload rows of an import step, the merge target's id looked up by label. */
export function speakerRows(rows: ImportSpeakerStep[], idOf: (label: string) => number) {
  return rows.map((r) => ({
    row: r.row, action: r.action, speaker_id: r.action === "merge" ? idOf(r.speaker ?? "") : null, title: r.title ?? null, name: r.name, gender: r.gender ?? null,
    affiliation: r.affiliation ?? null, topics: r.topics ?? [], phone: r.phone ?? null, email: r.email ?? null, notes: r.notes ?? null,
  }));
}

/** The archive payload of an import step, a category looked up by name. */
export function archivePayloadOf(a: ImportArchiveStep, idOf: (label: string) => number, categoryId: (name: string) => number) {
  return {
    label: a.label, start_date: a.start_date ?? null, source: a.source === undefined ? "tracking-5786" : a.source, titles_from: null,
    speakers: speakerRows(a.speakers, idOf),
    lessons: a.lessons.map((l) => ({
      row: l.row, day: l.day, start_min: l.start, end_min: l.end, room: l.room ?? 0, title: l.title ?? null, category_id: l.category == null ? null : categoryId(l.category),
      audience: l.audience ?? null, sources_kind: l.sources_kind ?? "pending", print_when: l.print_when ?? "none", sources_note: l.sources_note ?? null,
      pay_amount: l.pay_amount ?? null, import_note: l.import_note ?? null, speakers: l.speakers,
    })),
  };
}

/** An import's answer as one comparable string: the counts, and each speaker row by the label it resolved to. */
export function importRead(r: { created: number; merged: number; filled: number; contacts: number; lessons: number; replaced: number; speakers: { row: number; speaker_id: number; created: boolean }[] }, label: (id: number) => string): string {
  const head = `created=${r.created}|merged=${r.merged}|filled=${r.filled}|contacts=${r.contacts}|lessons=${r.lessons}|replaced=${r.replaced}`;
  return `${head}|${r.speakers.map((s) => `${s.row}:${label(s.speaker_id)}${s.created ? "+" : ""}`).join(",")}`;
}

/** import_lookup's answer as one comparable string. */
export function lookupRead(r: { phones: { key: string; speaker_id: number }[]; contacts: { speaker_id: number; phone: boolean; email: boolean; secretary_note: boolean; notes: boolean }[] }, label: (id: number) => string): string {
  const phones = r.phones.map((p) => `${p.key}=${label(p.speaker_id)}`).sort().join(",");
  const contacts = r.contacts.map((c) => `${label(c.speaker_id)}:${[c.phone && "p", c.email && "e", c.secretary_note && "s", c.notes && "n"].filter(Boolean).join("")}`).sort().join(",");
  return `phones=${phones || "-"}|contacts=${contacts || "-"}`;
}

/** An archive edition's lesson as the state compares it. */
export function archiveLessonLine(edition: string, l: {
  day: number; start_min: number; end_min: number; state: string; kind: string; title: string | null; audience: string | null; sources_kind: string; print_when: string;
  sources_note: string | null; pay_amount: number | null; import_note?: string | null; version: number;
}, room: string, category: string, speakers: string): string {
  return [`lesson|${edition}`, `${l.day}|${l.start_min}-${l.end_min}|${room}`, l.kind, l.state, `t=${d(l.title)}`, `c=${category}`, `a=${d(l.audience)}`,
    `sk=${l.sources_kind}`, `pw=${l.print_when}`, `sn=${d(l.sources_note)}`, `pay=${d(l.pay_amount)}`, `n=${d(l.import_note)}`, `v=${l.version}`, `sp=${speakers}`].join("|");
}

/** A group's fields as steps write them: a room by name, a trainee leader by name. */
export type KkStepFields = Record<string, unknown> & { room?: string; leaders?: ({ kind: string; trainee?: string; label?: string } | Record<string, unknown>)[] };

/** An unknown token name: a well-formed token that opens nothing. */
export const NO_SUCH_TOKEN = "AAAAAAAAAAAAAAAAAAAAAA";

/** The comparable state: everything keyed by natural keys, never by ids. */
export interface Normal {
  lessons: string[];
  pitches: string[];
  approaches: string[];
  /** lesson_speakers */
  speakers: string[];
  /** the speakers themselves */
  pool: string[];
  contacts: string[];
  availability: string[];
  /** transport_details, by lesson */
  transport: string[];
  /** the edition's template and duty phrases, and the sign-up window */
  edition: string[];
  /** share_links: scope, subject, revoked, expiry (by rule), who issued */
  links: string[];
  /** kk_tracks, kk_groups (with leaders), kk_signups, book_orders */
  kk: string[];
  /** escort_ticks */
  ticks: string[];
  /** source_files, by where they are and their display name */
  files: string[];
  /** what the «sources» bucket holds, by file label */
  objects: string[];
  /** the fallen, their families' contacts, and the edition's memorial plans (by their fallen's name) */
  memorial: string[];
  /** archive editions (the import of 5786): each edition, its rooms, its lessons with their speakers */
  archive: string[];
  /** «איך עבר», by lesson */
  reviews: string[];
}

/** A review as the state (and a read) compares it: by its lesson's place, its speaker by label, who wrote it by key. */
export function reviewLine(where: string, r: {
  speaker: string; went_well: string | null; issues: string | null; invite_again: string | null; overran: boolean; rating: number | null; by: string; version: number;
}): string {
  return `review|${where}|spk=${r.speaker}|ww=${d(r.went_well)}|is=${d(r.issues)}|ia=${d(r.invite_again)}|ov=${r.overran}|r=${d(r.rating)}|by=${r.by}|v=${r.version}`;
}

/** What a purge answers, as one comparable string (the time apart: it is the clock's). */
export function purgeRead(r: { transport_details: number; import_notes: number; links_revoked: number; link_hits: number; purged_at: unknown }): string {
  return `purged|t=${r.transport_details}|n=${r.import_notes}|l=${r.links_revoked}|h=${r.link_hits}|at=${r.purged_at == null ? "-" : "y"}`;
}

/** A fallen as the state compares it. */
export function fallenLine(f: { name: string; gender: string | null; note: string | null; active: boolean }): string {
  return `fallen|${f.name}|g=${d(f.gender)}|n=${d(f.note)}|active=${f.active}`;
}

/** A family's contact person as the state (and a read) compares it. */
export function fallenContactsLine(label: string, c: { contact_name: string | null; relation: string | null; phone: string | null; email: string | null; note: string | null }): string {
  return `${label}|c=${d(c.contact_name)}|r=${d(c.relation)}|p=${d(c.phone)}|e=${d(c.email)}|n=${d(c.note)}`;
}

/** A memorial plan as the state compares it: by its fallen, its slot by place. */
export function planLine(fallen: string, slot: string, p: {
  family_status: string; speaker_text: string | null; planned_minutes: number | null; hard_stop: boolean; materials_note: string | null; version: number;
}): string {
  return `plan|${fallen}|at=${slot}|${p.family_status}|sp=${d(p.speaker_text)}|m=${d(p.planned_minutes)}|hs=${p.hard_stop}|mn=${d(p.materials_note)}|v=${p.version}`;
}

/** A stored file's place: <edition>/<lesson|cover>/<a uuid made from its label>-<label>.<ext>. */
export function filePath(edition: number, lesson: number | null, label: string, mime: string): string {
  const n = [...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1e12, 7);
  const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx" : mime === "application/pdf" ? "pdf" : "txt";
  return `${edition}/${lesson ?? "cover"}/00000000-0000-4000-8000-${String(n).padStart(12, "0")}-${label}.${ext}`;
}

/** A source_files row as the state compares it. */
export function fileLine(where: string, f: { display_name: string; mime: string; size_bytes: number | string; page_count: number | null; cover: boolean }, speaker: string, by: string, fallen = "-"): string {
  return `${where}|${f.display_name}|${f.mime}|${f.size_bytes}|p=${d(f.page_count)}|cover=${f.cover}|spk=${speaker}|by=${by}|fallen=${fallen}`;
}

const d = (v: unknown) => (v == null ? "-" : String(v));

export function poolLine(s: {
  name: string; disambiguator: string | null; title: string | null; gender: string | null; affiliation: string | null; bio_short: string | null;
  topics: string[]; contact_pref: string | null; vetted: string; vetted_note: string | null; retired: boolean; version: number;
}, vettedBy: string): string {
  return [speakerLabel(s), `t=${d(s.title)}`, `g=${d(s.gender)}`, `a=${d(s.affiliation)}`, `b=${d(s.bio_short)}`, `tp=${s.topics.join(",")}`,
    `cp=${d(s.contact_pref)}`, `vt=${s.vetted}`, `vb=${vettedBy}`, `vn=${d(s.vetted_note)}`, `r=${s.retired}`, `v=${s.version}`].join("|");
}

export function contactsLine(label: string, c: { phone: string | null; email: string | null; secretary_note: string | null; notes: string | null }): string {
  return `${label}|p=${d(c.phone)}|e=${d(c.email)}|s=${d(c.secretary_note)}|n=${d(c.notes)}`;
}

/** What a contacts read returns, as one comparable string. */
export function contactsRead(c: { phone: string | null; email: string | null; secretary_note: string | null; notes: string | null } | null): string {
  return c == null ? "hidden" : contactsLine("seen", c);
}

/** What a matches read returns, as one comparable string (the order of «similar» ones depends on collation, so sorted). */
export function matchesRead(list: { name: string; disambiguator: string | null; match: string }[]): string {
  return list.map((m) => `${speakerLabel(m)}:${m.match}`).sort().join(",") || "none";
}

export function lessonKey(l: { day: number; start_min: number; end_min: number; room: string }) {
  return `${l.day}|${l.start_min}-${l.end_min}|${l.room}`;
}

/** A lesson as the state compares it — `member` and `trainee` name ids; times are compared as set or not. */
export function lessonLine(
  key: string,
  l: {
    kind: string; state: string; title: string | null; audience: string | null; teach_min: number | null; parallel_reason: string | null;
    pay_amount: number | null; transport: string; approval: string; approval_note: string | null; approved_by: unknown; approved_at: unknown; paid_at: unknown;
    confirm_sent_at: unknown; confirm_sent_by: unknown; needs_reconfirm: boolean; self_intro: boolean; escort_note: string | null;
    sources_kind: string; print_when: string; sources_note: string | null; presentation_url: string | null; in_reader: boolean; version: number;
  },
  category: string,
  member: (id: unknown) => string,
  trainee: string,
): string {
  const set = (v: unknown) => (v == null ? "-" : "y");
  return [
    key, l.kind, l.state, `t=${d(l.title)}`, `c=${category}`, `a=${d(l.audience)}`, `tm=${d(l.teach_min)}`, `p=${d(l.parallel_reason)}`,
    `pay=${d(l.pay_amount)}`, `tr=${l.transport}`, `ap=${l.approval}`, `an=${d(l.approval_note)}`, `ab=${member(l.approved_by)}`, `aat=${set(l.approved_at)}`,
    `paid=${set(l.paid_at)}`, `sent=${set(l.confirm_sent_at)}`, `sb=${member(l.confirm_sent_by)}`, `rc=${l.needs_reconfirm}`,
    `es=${trainee}`, `si=${l.self_intro}`, `en=${d(l.escort_note)}`,
    `sk=${l.sources_kind}`, `pw=${l.print_when}`, `sn=${d(l.sources_note)}`, `url=${d(l.presentation_url)}`, `ir=${l.in_reader}`, `v=${l.version}`,
  ].join("|");
}

export function transportLine(label: string, t: { pickup_address: string | null; pickup_time: string | null; driver_name: string | null; driver_phone: string | null; arranged: boolean }): string {
  return `${label}|addr=${d(t.pickup_address)}|time=${d(t.pickup_time)}|drv=${d(t.driver_name)}|ph=${d(t.driver_phone)}|arr=${t.arranged}`;
}

/** What a transport read returns, as one comparable string. */
export function transportRead(t: Parameters<typeof transportLine>[1] | null): string {
  return t == null ? "hidden" : transportLine("seen", t);
}

/** The edition's template and phrases, as comparable lines. */
export function editionLines(settings: {
  confirm_template?: string | null; duty_phrases?: { when: string; text: string }[] | null; kk_window?: { opens_at: string; closes_at: string } | null;
  reader_headers?: [string, string] | null;
  memorial?: object | null;
}, cover = "-", purged = false): string[] {
  return [
    `purged=${purged ? "y" : "-"}`,
    `memorial=${settings.memorial ? stable(settings.memorial) : "-"}`,
    `template=${d(settings.confirm_template)}`,
    `duty=${(settings.duty_phrases ?? []).map((p) => `${p.when}:${p.text}`).join(",") || "-"}`,
    `window=${settings.kk_window ? `${settings.kk_window.opens_at}..${settings.kk_window.closes_at}` : "-"}`,
    `headers=${settings.reader_headers ? settings.reader_headers.join("|") : "-"}`,
    `cover=${cover}`,
  ];
}

/** A link's expiry as the state compares it: «+720h» after issue (the date TBD), «past» once over (a hand edit's instant differs by milliseconds), else the instant. */
export function expiryOf(createdAt: string | Date, expiresAt: string | Date): string {
  const [c, e] = [new Date(createdAt).getTime(), new Date(expiresAt).getTime()];
  if (e - c === 720 * 3_600_000) return "+720h";
  return e <= Date.now() ? "past" : new Date(e).toISOString();
}

export function linkLine(l: { scope: string; trainee: string; revoked: boolean; created_at: string | Date; expires_at: string | Date; by: string }): string {
  return `${l.scope}|${l.trainee}|rev=${l.revoked ? "y" : "-"}|exp=${expiryOf(l.created_at, l.expires_at)}|by=${l.by}`;
}

/** JSON with every object's keys sorted — a view compared whole, whichever order its keys came in. */
export function stable(v: unknown): string {
  const norm = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(norm) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, y]) => [k, norm(y)])) : x;
  return JSON.stringify(norm(v));
}

const byText = <T>(key: (x: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

/** What a public read returns, as one comparable string: lessons by place, ids by name, tick times as set/unset, lists the SQL orders by collation sorted. */
export function publicRead(
  kind: "escortView" | "escortTick" | "kkForm" | "scheduleView",
  v: unknown,
  names: { lesson: (id: number) => string; track: (id: number) => string; group: (id: number) => string; trainee: (id: number) => string },
): string {
  const ticks = (t: Record<string, string | null>) => Object.fromEntries(Object.entries(t).map(([k, x]) => [k, x == null ? "-" : "y"]));
  if (kind === "escortTick") return stable(ticks(v as Record<string, string | null>));
  if (kind === "scheduleView") return stable(v);
  if (kind === "escortView") {
    const x = structuredClone(v) as { lessons: { lesson_id: number | string; ticks: Record<string, string | null> }[] };
    for (const l of x.lessons) Object.assign(l, { lesson_id: names.lesson(Number(l.lesson_id)), ticks: ticks(l.ticks) });
    return stable(x);
  }
  const f = structuredClone(v) as {
    roster: { id: number | string; full_name: string }[];
    tracks: { id: number | string; groups: { id: number | string; title: string }[] }[];
  };
  f.roster = f.roster.map((r) => ({ ...r, id: names.trainee(Number(r.id)) })).sort(byText((r) => r.full_name));
  f.tracks = f.tracks
    .map((t) => ({ ...t, id: names.track(Number(t.id)), groups: t.groups.map((g) => ({ ...g, id: names.group(Number(g.id)) })).sort(byText((g) => g.title)) }))
    .sort(byText((t) => String(t.id)));
  return stable(f);
}

/** The answers of a call made several times, as one string: runs of the same answer counted («60× … | 1× link_invalid»). */
export function answers(list: string[]): string {
  if (list.length === 1) return list[0];
  const runs: [number, string][] = [];
  for (const x of list) {
    const last = runs[runs.length - 1];
    if (last && last[1] === x) last[0]++;
    else runs.push([1, x]);
  }
  return runs.map(([n, x]) => `${n}× ${x}`).join(" | ");
}

export interface Driver {
  run(step: Step): Promise<string>; // "ok" or the contract's code
  state(): Promise<Normal>;
  close(): Promise<void>;
}
