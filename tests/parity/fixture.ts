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
  | { anon: "escortView" | "kkForm" | "scheduleView"; token: string }
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
  /** A link's expiry moved into the past, by hand. */
  | { expire: string };

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
}): string[] {
  return [
    `template=${d(settings.confirm_template)}`,
    `duty=${(settings.duty_phrases ?? []).map((p) => `${p.when}:${p.text}`).join(",") || "-"}`,
    `window=${settings.kk_window ? `${settings.kk_window.opens_at}..${settings.kk_window.closes_at}` : "-"}`,
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

export interface Driver {
  run(step: Step): Promise<string>; // "ok" or the contract's code
  state(): Promise<Normal>;
  close(): Promise<void>;
}
