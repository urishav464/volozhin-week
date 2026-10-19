// A speaker's timeline in Hebrew, from public.speaker_activity (or the demo's
// log): who did what, and the short note that came with it. Ids become names
// through the edition's team; a row only says what changed when compared with
// the approach's row before it, so the list is read newest first, as it comes.
// Never a contact value: the log holds field names only (CONTRACT «activity»).
import type { ActivityEntry } from "../data/speakers";
import { statusLabel } from "../lib/labels";
import { dayPart, DAY_PARTS } from "./dayParts";
import { byGender } from "./names";
import { DAY_NAMES, type Day } from "./time";
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
  topics: "נושאים",
  contact_pref: "ערוץ קשר מועדף",
  retired: "פעיל/ה",
};

const CONTACT_FIELD: Record<string, string> = { phone: "טלפון", email: "מייל", secretary_note: "דרך המזכירות", notes: "הערות" };

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
      else text = e.kind;
    } else if (e.entity === "approaches" && e.kind === "availability") {
      const part = DAY_PARTS.find((p) => p.part === d.part)?.label ?? String(d.part);
      const day = DAY_NAMES[num(d.day) as Day] ?? "";
      const kind = d.kind === "can" ? byGender(g, "יכול", "יכולה") : d.kind === "cannot" ? byGender(g, "לא יכול", "לא יכולה") : "לא ידוע";
      text = dayPart(String(d.part)) ? `זמינות: ${day} ${part} — ${kind}` : "זמינות עודכנה";
    } else if (e.entity === "approaches") {
      const owner = num(d.owner);
      const offered = num(d.offered_to);
      const status = d.status as ApproachStatus;
      if (e.kind === "insert") {
        text = [owner != null ? `בטיפול ${member(owner)}` : "נפתחה פנייה", statusLabel(status, g)].join(" · ");
      } else if (e.kind === "delete") {
        text = "הפנייה נמחקה";
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
          declined: `${byGender(g, "סירב", "סירבה")} למשבצת`,
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
