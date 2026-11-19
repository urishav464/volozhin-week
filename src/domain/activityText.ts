// A speaker's timeline in Hebrew, from public.speaker_activity (or the demo's
// log): who did what, and the short note that came with it. Ids become names
// through the edition's team; a row only says what changed when compared with
// the approach's row before it, so the list is read newest first, as it comes.
// Never a contact value: the log holds field names only (CONTRACT «activity»).
import type { ActivityEntry } from "../data/speakers";
import { statusLabel } from "../lib/labels";
import { israelDate } from "./israelTime";
import { byGender } from "./names";
import { DAY_NAMES, type Day, dayRange } from "./time";
import type { ApproachStatus, Gender } from "./types";

export interface TimelineLine {
  id: number;
  at: string;
  /** The member who did it; null when nobody signed in did (the SQL Editor). */
  who: string | null;
  text: string;
  note: string | null;
}

export interface TimelineContext {
  /** A members.id as a name, or null when it is not on this edition's team. */
  name: (memberId: number) => string | null;
  /** The speaker's gender — the sentences are about them. */
  gender: Gender | null;
  /** A lesson id as «ראשון 08:30», when it is in the loaded week. */
  lesson?: (lessonId: number) => string | null;
}

const SPEAKER_FIELD: Record<string, string> = {
  title: "תואר",
  name: "שם",
  disambiguator: "פרט מבחין",
  gender: "מגדר",
  affiliation: "מוסד",
  bio_short: "תיאור קצר",
  public_bio: "תיאור לאתר האורחים",
  topics: "נושאים",
  contact_pref: "דרך תקשורת",
  retired: "פעיל/ה",
};

const CONTACT_FIELD: Record<string, string> = { phone: "טלפון", email: "מייל", secretary_note: "דרך המזכירות", notes: "הערות" };

/** v6–v13 logged availability by part of a day (the chips v14's slots replaced); those rows still read. */
const LEGACY_PART: Record<string, string> = { morning: "בוקר", afternoon: "צהריים", evening: "ערב", night: "לילה" };

const num = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const list = (v: unknown, labels: Record<string, string>) => (Array.isArray(v) ? v.map((f) => labels[String(f)] ?? String(f)).join(", ") : "");

export function timeline(entries: ActivityEntry[], ctx: TimelineContext): TimelineLine[] {
  const g = ctx.gender;
  const member = (id: number | null) => (id == null ? null : (ctx.name(id) ?? "חבר/ת צוות"));
  const at = (lessonId: number | null) => {
    const l = lessonId != null ? ctx.lesson?.(lessonId) : null;
    return l ? ` (${l})` : "";
  };

  return entries.map((e, i) => {
    const d = e.detail ?? {};
    const note = str(d.note);
    let text: string;
    if (e.entity === "speakers") {
      if (e.kind === "insert") text = `${byGender(g, "נוסף", "נוספה")} למאגר${d.vetted === "approved" ? ` ${byGender(g, "ואושר", "ואושרה")}` : ""}`;
      else if (e.kind === "update") text = `הפרטים עודכנו: ${list(d.fields, SPEAKER_FIELD)}`;
      else if (e.kind === "vet")
        text = d.vetted === "approved" ? byGender(g, "אושר", "אושרה") : d.vetted === "rejected" ? byGender(g, "נדחה", "נדחתה", "נדחה/תה") : `${byGender(g, "הוחזר", "הוחזרה")} להמתנה לאישור`;
      else if (e.kind === "contacts") text = `פרטי הקשר עודכנו: ${list(d.fields, CONTACT_FIELD)}`;
      // v19: the guests' photo — set or removed, never the bytes
      else if (e.kind === "photo") text = d.set === false ? "התמונה לאתר האורחים הוסרה" : "הועלתה תמונה לאתר האורחים";
      else text = e.kind;
    } else if (e.entity === "approaches" && e.kind === "availability" && num(d.marked) != null) {
      // v18: a set of time ranges (set_availability_ranges) — one line for the whole update: how many slots it marked
      const marked = num(d.marked)!;
      text = `עודכנה הזמינות — ${marked === 1 ? "משבצת אחת" : `${marked} משבצות`}`;
    } else if (e.entity === "approaches" && e.kind === "availability") {
      // v14: one slot — its day and the row's range (an LRM before it); before: a part of a day
      const day = num(d.day);
      const [start, end] = [num(d.start), num(d.end)];
      const part = LEGACY_PART[String(d.part)];
      const when = day == null || !DAY_NAMES[day as Day] ? null : start != null && end != null ? dayRange(day, start, end) : part ? `${DAY_NAMES[day as Day]} ${part}` : null;
      const kind = d.kind === "can" ? byGender(g, "יכול", "יכולה") : d.kind === "cannot" ? byGender(g, "לא יכול", "לא יכולה") : "לא ידוע";
      text = when ? `זמינות: ${when} — ${kind}` : "זמינות עודכנה";
    } else if (e.entity === "approaches") {
      const owner = num(d.owner);
      const offered = num(d.offered_to);
      const status = d.status as ApproachStatus;
      if (e.kind === "insert") {
        text = [owner != null ? `בטיפול ${member(owner)}` : "נפתחה פנייה", statusLabel(status, g)].join(" · ");
      } else if (e.kind === "delete") {
        text = "הפנייה נמחקה";
      } else if (typeof d.public_ok === "boolean") {
        // v19 set_public_ok: the one thing that changed — never «הערה»
        text = d.public_ok ? `${byGender(g, "אושר", "אושרה")} להופיע באתר האורחים` : `${byGender(g, "הוסר", "הוסרה")} מאתר האורחים`;
      } else {
        // The approach's row before this one (older, so later in the list).
        const prev = entries.slice(i + 1).find((x) => x.entity === "approaches" && x.entity_id === e.entity_id && (x.kind === "insert" || x.kind === "update"));
        const parts: string[] = [];
        if (!prev) {
          // Nothing earlier to compare with (an older row is past the list): say where it stands.
          parts.push(owner != null ? `בטיפול ${member(owner)}` : "בלי מטפל/ת");
          if (offered != null) parts.push(`הוצע להעביר את הטיפול ל${member(offered)}`);
          parts.push(statusLabel(status, g));
        } else {
          const p = prev.detail ?? {};
          const pOwner = num(p.owner);
          const pOffered = num(p.offered_to);
          if (owner !== pOwner) parts.push(owner == null ? `${byGender(g, "חזר", "חזרה")} למאגר, בלי מטפל/ת` : `הטיפול עבר ל${member(owner)}`);
          if (offered != null && offered !== pOffered) parts.push(`הוצע להעביר את הטיפול ל${member(offered)}`);
          if (offered == null && pOffered != null && owner === pOwner) parts.push("ההצעה להעביר לא התקבלה או בוטלה");
          if (status !== p.status) parts.push(statusLabel(status, g));
        }
        text = parts.length ? parts.join(" · ") : "הערה";
      }
    } else if (e.entity === "pitches") {
      const lesson = num(d.lesson);
      if (e.kind === "insert") text = `${byGender(g, "הוצע", "הוצעה")} למשבצת${at(lesson)}`;
      else if (e.kind === "delete") text = `משבצת${at(lesson)} בוטלה`;
      else {
        const s = String(d.state);
        const what: Record<string, string> = {
          candidate: `${byGender(g, "מועמד", "מועמדת")} למשבצת`,
          approached: "פנו על משבצת",
          declined: `${statusLabel("declined", g)} למשבצת`,
          accepted: "השיעור נסגר",
          withdrawn: `${byGender(g, "הוסר", "הוסרה")} ממשבצת`,
          superseded: "משבצת נסגרה עם מרצה אחר/ת",
        };
        text = `${what[s] ?? "משבצת עודכנה"}${at(lesson)}`;
      }
    } else text = e.kind;
    return { id: e.id, at: e.at, who: member(e.actor), text, note };
  });
}

/**
 * «מה קרה» on the speaker page (the reset, phase 2), curated: what a teammate needs to know — the speaker added to the
 * pool and vetted, the approach (who handles them, the call's results, hand-overs; v19 the approval to show them to
 * guests), the guests' photo (v19), the pitches (proposed, closed, withdrawn). Edits of the record and of the contacts
 * are left out (the page shows them as they are now), and the availability taps one member made on one day in Israel become ONE line: how many slots, on which days — a set of
 * time ranges (v18) is one line already, and a single tap keeps its own line (it says which slot). Newest first, as
 * given; the line stands where the group's newest entry stood, with its id and time.
 */
export function curate(entries: readonly ActivityEntry[]): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  const groups = new Map<string, { at: number; slots: Set<string>; days: Set<number>; n: number }>();
  for (const e of entries) {
    if (e.entity === "speakers") {
      // v19: the guests' photo is what a guest will see — kept, like the approval to show the speaker (an approach's line)
      if (e.kind === "insert" || e.kind === "vet" || e.kind === "photo") out.push(e);
      continue;
    }
    if (e.entity === "pitches") {
      out.push(e);
      continue;
    }
    if (e.entity !== "approaches") continue;
    const d = e.detail ?? {};
    if (e.kind !== "availability" || num(d.marked) != null) {
      out.push(e);
      continue;
    }
    // one slot's tap (v14), or a part of a day (before): by who and the Israel date
    const ms = Date.parse(e.at);
    const key = `${e.actor ?? ""}|${e.edition_id ?? ""}|${Number.isNaN(ms) ? e.at : israelDate(e.at)}`;
    let g = groups.get(key);
    if (!g) {
      g = { at: out.length, slots: new Set(), days: new Set(), n: 0 };
      groups.set(key, g);
      out.push(e);
    }
    g.n += 1;
    const day = num(d.day);
    g.slots.add(`${day ?? ""}:${num(d.start) ?? String(d.part ?? "")}`);
    if (day != null) g.days.add(day);
  }
  for (const g of groups.values()) {
    if (g.n < 2) continue;
    const first = out[g.at];
    out[g.at] = { ...first, detail: { speaker: first.detail?.speaker, marked: g.slots.size, days: [...g.days].sort((a, b) => a - b) } };
  }
  return out;
}
