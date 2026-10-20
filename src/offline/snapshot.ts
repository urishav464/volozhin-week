// What a device keeps for the day the internet is gone, and when it may show it — pure, so every rule is a unit test
// (src/offline/snapshot.test.ts). After every successful load of the edition's Week the app saves a snapshot
// {userId, editionId, savedAt, schemaVersion, week}, and with it the last whoami answer of that user. Started without
// a connection, it shows the day view from the snapshot, read-only — only to the user it was saved for (the Supabase
// session stored on the device), never across a schema version. Only the Week is kept: it holds no contact details
// and no transport details (speaker_contacts, transport_details and a bereaved family's fallen_contacts are fetched
// one at a time, never in a Week), which the type below and the runtime check of the keys both hold. The memorial
// times (v11) are in it as the team reads them: the plans and the names of the fallen — never a family's contact.
import type { FallenContacts } from "../data/memorial";
import type { Me } from "../data/types";
import type { SpeakerContacts, TransportDetails, Week } from "../domain/types";

export interface WeekSnapshot {
  /** The Supabase user (auth uid) whose session loaded it. */
  userId: string;
  editionId: number;
  /** When it was loaded (ISO) — the banner's «מוצג המצב מ-…». */
  savedAt: string;
  /** EXPECTED_SCHEMA_VERSION of the build that saved it; another version drops it. */
  schemaVersion: number;
  week: Week;
}

export interface WhoamiSnapshot {
  userId: string;
  savedAt: string;
  me: Me;
}

/** The Week's own keys: a snapshot's week has these and nothing else. A new key in Week fails tsc here until it is looked at. */
export const WEEK_KEYS = [
  "edition",
  "rows",
  "rooms",
  "categories",
  "speakers",
  "approaches",
  "availability",
  "lessons",
  "lessonSpeakers",
  "pitches",
  "team",
  "roster",
  "escortTicks",
  "sourceFiles",
  // v11: the memorial plans (status, who speaks, minutes, the reader's note) and the fallen's names — looked at for
  // personal data when the two halves of 5ב-2 met: neither carries a family's contact (fallen_contacts, one at a time)
  "memorialPlans",
  "fallen",
] as const satisfies readonly (keyof Week)[];
type Unlisted = Exclude<keyof Week, (typeof WEEK_KEYS)[number]>;
const everyKeyListed: [Unlisted] extends [never] ? true : Unlisted = true;
void everyKeyListed;

/**
 * Keys that are personal data wherever they turn up: a speaker's contacts, a transport's details, a bereaved family's
 * contact person, an address. A family contact's `note` is the one key left out: availability's own `note` (a chip's
 * «לא בבקרים») shares its name — the family's note never travels without its `contact_name` and `relation`.
 */
export type PersonalKey = keyof SpeakerContacts | keyof TransportDetails | Exclude<keyof FallenContacts, "note"> | "address";
export const PERSONAL_KEYS = [
  "phone",
  "email",
  "secretary_note",
  "notes",
  "pickup_address",
  "pickup_time",
  "driver_name",
  "driver_phone",
  "arranged",
  "contact_name",
  "relation",
  "address",
] as const satisfies readonly PersonalKey[];
type MissedPersonal = Exclude<PersonalKey, (typeof PERSONAL_KEYS)[number]>;
const everyPersonalKeyListed: [MissedPersonal] extends [never] ? true : MissedPersonal = true;
void everyPersonalKeyListed;

/** Every property name anywhere inside T (through arrays and nested objects). */
export type DeepKeys<T> = T extends readonly (infer U)[] ? DeepKeys<U> : T extends object ? { [K in keyof T]-?: K | DeepKeys<T[K]> }[keyof T] : never;

/**
 * The runtime half: a week with a key that is not the Week's, or a personal key anywhere inside it, is refused — it
 * is never written to the device. Throws; returns the week when it passes.
 */
export function assertWeekOnly(week: unknown): Week {
  if (!week || typeof week !== "object" || Array.isArray(week)) throw new Error("snapshot: not a week");
  const allowed = new Set<string>(WEEK_KEYS);
  for (const k of Object.keys(week)) if (!allowed.has(k)) throw new Error(`snapshot: «${k}» is not a key of the Week`);
  for (const k of WEEK_KEYS) if (!(k in week)) throw new Error(`snapshot: the week has no «${k}»`);
  const personal = new Set<string>(PERSONAL_KEYS);
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (personal.has(k)) throw new Error(`snapshot: personal data at ${path}.${k}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(week, "week");
  return week as Week;
}

/** The snapshot to save after a load; throws (and nothing is saved) when the week fails `assertWeekOnly`. */
export function makeWeekSnapshot(userId: string, editionId: number, week: Week, savedAt: Date, schemaVersion: number): WeekSnapshot {
  return { userId, editionId, savedAt: savedAt.toISOString(), schemaVersion, week: assertWeekOnly(week) };
}

/** A stored snapshot, checked again on the way out: anything malformed reads as none. */
export function readWeekSnapshot(raw: unknown): WeekSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<WeekSnapshot>;
  if (typeof r.userId !== "string" || !r.userId || typeof r.editionId !== "number" || typeof r.schemaVersion !== "number") return null;
  if (typeof r.savedAt !== "string" || Number.isNaN(Date.parse(r.savedAt))) return null;
  try {
    return { userId: r.userId, editionId: r.editionId, savedAt: r.savedAt, schemaVersion: r.schemaVersion, week: assertWeekOnly(r.week) };
  } catch {
    return null;
  }
}

export function readWhoamiSnapshot(raw: unknown): WhoamiSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<WhoamiSnapshot>;
  if (typeof r.userId !== "string" || !r.userId || typeof r.savedAt !== "string") return null;
  const me = r.me as Partial<Me> | undefined;
  if (!me || me.status !== "ok" || typeof me.schema_version !== "number" || !Array.isArray(me.memberships)) return null;
  return { userId: r.userId, savedAt: r.savedAt, me: me as Me };
}

export type OfflineDecision =
  /** Show this week, read-only, as this member. */
  | { kind: "show"; snapshot: WeekSnapshot; me: Me }
  /** Nothing to show (yet); keep what is stored. */
  | { kind: "none" }
  /**
   * A copy saved by a NEWER build is on the device — kept, not shown by this one: the screen says so, and offers the
   * waiting worker's «רענון», which brings the build that shows it.
   */
  | { kind: "newer" }
  /** What is stored belongs to nobody signed in here, to another user, or to an older schema: delete it. */
  | { kind: "drop" };

/**
 * May this device show its snapshot? Only with a Supabase session stored on the device, of the very user both the
 * snapshot and the cached whoami were saved for, saved by a build of this schema version, for an edition that member
 * belongs to. A copy from a NEWER schema is kept, not shown: a page that already ran the next build (a reload after
 * a deploy, the old worker still in charge) saved it, and offline the old worker serves its own older shell. That
 * shell cannot read it, but must not destroy it — «רענון» (the waiting worker) brings the build that shows it.
 */
export function offlineDecision(input: {
  deviceUserId: string | null;
  snapshot: WeekSnapshot | null;
  whoami: WhoamiSnapshot | null;
  expectedVersion: number;
}): OfflineDecision {
  const { deviceUserId: uid, snapshot: s, whoami: w, expectedVersion } = input;
  if (!s && !w) return { kind: "none" };
  if (uid == null) return { kind: "drop" };
  if ((s && s.userId !== uid) || (w && w.userId !== uid)) return { kind: "drop" };
  if ((s && s.schemaVersion > expectedVersion) || (w && w.me.schema_version > expectedVersion)) return { kind: "newer" };
  if ((s && s.schemaVersion !== expectedVersion) || (w && w.me.schema_version !== expectedVersion)) return { kind: "drop" };
  if (!s || !w) return { kind: "none" };
  const member = w.me.global_admin || w.me.memberships.some((m) => m.edition_id == null || m.edition_id === s.editionId);
  if (!member) return { kind: "drop" };
  return { kind: "show", snapshot: s, me: w.me };
}
