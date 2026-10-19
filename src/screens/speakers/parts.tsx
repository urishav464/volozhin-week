// Pieces the speaker screens share: the profile's form fields (create and
// edit), free topic tags, the availability chips, a toast, and a section title.
// Built from «הגדרות»'s kit (src/screens/settings/kit.tsx): one column on a
// phone, every control at least 44px tall.
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { CONTACT_PREFS, LIMITS } from "../../data/speakerRules";
import type { SpeakerPatch } from "../../data/speakers";
import { type Chip as AvailabilityChip, DAY_PARTS, type DayPart, chipsOf } from "../../domain/dayParts";
import { byGender } from "../../domain/names";
import { DAYS, DAY_NAMES, type Day, fmtRange } from "../../domain/time";
import type { Availability, ContactPref, Gender, Speaker } from "../../domain/types";
import { CONTACT_PREF_LABEL } from "../../lib/labels";
import { Button, Field, GenderField, INPUT } from "../settings/kit";
import { useWeekStore } from "../weekStore";

// ------------------------------------------------------------------ a section of a sheet or a screen

export function Section({ title, aside, children, label }: { title: ReactNode; aside?: ReactNode; children: ReactNode; label?: string }) {
  return (
    <section aria-label={label} className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="font-display text-base font-semibold">{title}</h3>
        {aside && <span className="text-sm text-ink-soft">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ the profile's fields

export interface ProfileForm {
  title: string;
  name: string;
  disambiguator: string;
  gender: Gender | null;
  affiliation: string;
  bio_short: string;
  topics: string[];
  /** A topic typed but not yet added with Enter or «הוספה»: it is saved with the rest, never dropped. */
  topicDraft: string;
  contact_pref: ContactPref | "";
}

export const EMPTY_FORM: ProfileForm = { title: "", name: "", disambiguator: "", gender: null, affiliation: "", bio_short: "", topics: [], topicDraft: "", contact_pref: "" };

export function formOf(s: Speaker): ProfileForm {
  return {
    title: s.title ?? "",
    name: s.name,
    disambiguator: s.disambiguator ?? "",
    gender: s.gender,
    affiliation: s.affiliation ?? "",
    bio_short: s.bio_short ?? "",
    topics: [...s.topics],
    topicDraft: "",
    contact_pref: s.contact_pref ?? "",
  };
}

/** The tags with a typed topic added, as «הוספה» would add it (one space between words, no repeats, at most 10). */
export function withTopic(tags: string[], draft: string): string[] {
  const t = draft.replace(/\s+/g, " ").trim();
  return t && !tags.includes(t) && tags.length < LIMITS.topics ? [...tags, t] : tags;
}

/** The form as the port takes it — the database cleans and checks every field again (CONTRACT «Text and lists»). */
export function fieldsOf(f: ProfileForm) {
  return {
    title: f.title || null,
    name: f.name,
    disambiguator: f.disambiguator.trim() || null,
    gender: f.gender,
    affiliation: f.affiliation.trim() || null,
    bio_short: f.bio_short.trim() || null,
    topics: withTopic(f.topics, f.topicDraft),
    contact_pref: f.contact_pref || null,
  };
}

/** Only what changed, so an edit never touches a field someone else just saved. */
export function patchOf(s: Speaker, f: ProfileForm): SpeakerPatch {
  const next = fieldsOf(f);
  const was = fieldsOf(formOf(s));
  const out: SpeakerPatch = {};
  for (const k of Object.keys(next) as (keyof typeof next)[]) {
    if (JSON.stringify(next[k]) !== JSON.stringify(was[k])) (out as Record<string, unknown>)[k] = next[k];
  }
  return out;
}

/**
 * Title, (name,) disambiguator, gender, affiliation, a short bio, topics and the
 * preferred channel. Gender is chosen, never guessed from the name. `invalid`
 * names the field a refusal is about, so it is marked and described.
 */
export function ProfileFields({
  id,
  form,
  set,
  titles,
  withName,
  invalid,
  problem,
  needDisambiguator,
}: {
  id: string;
  form: ProfileForm;
  set: (patch: Partial<ProfileForm>) => void;
  titles: readonly string[];
  withName: boolean;
  invalid?: "name" | "disambiguator" | null;
  problem?: string | null;
  /** A speaker of this very name is in the pool: another person needs a disambiguator. */
  needDisambiguator?: boolean;
}) {
  const err = (f: "name" | "disambiguator") => (invalid === f ? { "aria-invalid": true as const, "aria-describedby": `${id}-problem` } : {});
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field id={`${id}-title`} label="תואר">
          <select id={`${id}-title`} value={form.title} onChange={(e) => set({ title: e.target.value })} className={INPUT}>
            <option value="">ללא תואר</option>
            {/* a title saved before the list changed stays choosable */}
            {[...titles, ...(form.title && !titles.includes(form.title) ? [form.title] : [])].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        {withName && (
          <Field id={`${id}-name`} label="שם (בלי תואר)">
            <input id={`${id}-name`} value={form.name} maxLength={LIMITS.name} onChange={(e) => set({ name: e.target.value })} className={INPUT} autoComplete="off" {...err("name")} />
          </Field>
        )}
      </div>
      <Field
        id={`${id}-dis`}
        label={needDisambiguator ? "פרט מבחין (חובה: יש במאגר מרצה בשם הזה)" : "פרט מבחין (לא חובה)"}
        hint="מוסד או עיר, כדי להבדיל בין שני אנשים באותו שם."
      >
        <input id={`${id}-dis`} value={form.disambiguator} maxLength={LIMITS.disambiguator} onChange={(e) => set({ disambiguator: e.target.value })} className={INPUT} {...err("disambiguator")} />
      </Field>
      {problem && (
        <p id={`${id}-problem`} role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
          {problem}
        </p>
      )}
      <GenderField name={`${id}-gender`} value={form.gender} onChange={(gender) => set({ gender })} legend="מגדר" unknown="לא ידוע" />
      <Field id={`${id}-aff`} label="מוסד">
        <input id={`${id}-aff`} value={form.affiliation} maxLength={LIMITS.affiliation} onChange={(e) => set({ affiliation: e.target.value })} className={INPUT} />
      </Field>
      <Field id={`${id}-bio`} label="תיאור קצר" hint="כמה מילים על המרצה ועל מה שמלמד/ת. גלוי לכל הצוות.">
        <textarea id={`${id}-bio`} value={form.bio_short} maxLength={LIMITS.bio_short} rows={3} onChange={(e) => set({ bio_short: e.target.value })} className={`${INPUT} py-2`} />
      </Field>
      <TagInput id={`${id}-topics`} tags={form.topics} draft={form.topicDraft} onChange={set} />
      <Field id={`${id}-pref`} label="ערוץ קשר מועדף" hint="רק הערוץ. המספר או הכתובת נכנסים לפרטי הקשר.">
        <select id={`${id}-pref`} value={form.contact_pref} onChange={(e) => set({ contact_pref: e.target.value as ContactPref | "" })} className={INPUT}>
          <option value="">לא צוין</option>
          {CONTACT_PREFS.map((p) => (
            <option key={p} value={p}>
              {CONTACT_PREF_LABEL[p]}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

/**
 * Free topic tags: type and press Enter (or «הוספה»); × takes one away. At most 10, each up to 40 characters.
 * A topic typed and left without Enter is added when the field loses focus — and the form's own submit
 * takes a pending one too (fieldsOf), so tapping «שמירה» right after typing never drops it.
 */
export function TagInput({
  id,
  tags,
  draft,
  onChange,
}: {
  id: string;
  tags: string[];
  draft: string;
  onChange: (p: { topics?: string[]; topicDraft: string }) => void;
}) {
  const full = tags.length >= LIMITS.topics;
  const add = () => {
    if (!draft) return;
    onChange({ topics: withTopic(tags, draft), topicDraft: "" });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault(); // not the form's submit
      add();
    }
  };
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        נושאים
      </label>
      {tags.length > 0 && (
        <ul aria-label="הנושאים שנבחרו" className="mb-1.5 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-full border border-line bg-paper ps-3 text-sm">
              {t}
              <button type="button" onClick={() => onChange({ topics: tags.filter((x) => x !== t), topicDraft: draft })} aria-label={`הסרת הנושא ${t}`} className="inline-flex size-9 items-center justify-center rounded-full text-ink-soft hover:bg-line/60">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          maxLength={LIMITS.topic}
          disabled={full}
          onChange={(e) => onChange({ topicDraft: e.target.value })}
          onKeyDown={onKey}
          onBlur={add}
          placeholder={full ? "אפשר עד 10 נושאים" : "למשל: תנ״ך, שירה"}
          className={INPUT}
        />
        <Button onClick={add} disabled={!draft.trim() || full}>
          הוספה
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ availability: 5 days × 4 parts

/** «06:30–13:00»: a part's hours, as the grid's clock shows them (the evening ends at «24:00», not «00:00»). */
const partHours = (p: (typeof DAY_PARTS)[number]) => (p.to === 1440 ? `${fmtRange(p.from, p.to).split("–")[0]}–24:00` : fmtRange(p.from, p.to));

const KIND_TEXT = (kind: AvailabilityChip["kind"], g: Gender | null) =>
  kind === "can" ? byGender(g, "יכול", "יכולה") : kind === "cannot" ? byGender(g, "לא יכול", "לא יכולה") : "לא ידוע";

/**
 * The chips of one approach's availability. Tap a chip to choose it, then
 * «יכול/ה», «לא» or «לא ידוע» (with an optional note) — each a single save.
 * Without `onSet` the grid is read-only.
 */
export function AvailabilityGrid({
  rows,
  gender,
  onSet,
  busy,
}: {
  rows: Availability[];
  gender: Gender | null;
  onSet?: (day: Day, part: DayPart, kind: "can" | "cannot" | null, note: string | null) => Promise<boolean>;
  busy?: boolean;
}) {
  const chips = chipsOf(rows);
  const [picked, setPicked] = useState<{ day: Day; part: DayPart } | null>(null);
  const [note, setNote] = useState("");
  const chip = picked && chips.find((c) => c.day === picked.day && c.part === picked.part);
  useEffect(() => setNote(chip?.note ?? ""), [chip?.note, picked?.day, picked?.part]);
  const save = async (kind: "can" | "cannot" | null) => {
    if (!picked || !onSet) return;
    if (await onSet(picked.day, picked.part, kind, kind == null ? null : note.trim() || null)) setPicked(null);
  };
  const tone = (c: AvailabilityChip) =>
    c.kind === "can" ? "border-ok/50 bg-ok/10 text-ok" : c.kind === "cannot" ? "border-bad/40 bg-bad/10 text-bad" : "border-line bg-card text-ink-soft";
  const part = picked && DAY_PARTS.find((p) => p.part === picked.part)!;
  const notes = chips.filter((c) => c.note);
  return (
    <div className="space-y-2">
      <table className="w-full table-fixed border-separate border-spacing-1 text-sm" aria-label="זמינות לפי ימים וחלקי יום">
        <thead>
          <tr>
            <th scope="col" className="w-14">
              <span className="sr-only">יום</span>
            </th>
            {DAY_PARTS.map((p) => (
              <th key={p.part} scope="col" className="text-xs font-semibold text-ink-soft">
                {p.label}
                <span className="block text-[11px] font-normal">
                  <bdi>{partHours(p)}</bdi>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((d) => (
            <tr key={d}>
              <th scope="row" className="text-start text-xs font-semibold text-ink-soft">
                {DAY_NAMES[d]}
              </th>
              {DAY_PARTS.map((p) => {
                const c = chips.find((x) => x.day === d && x.part === p.part)!;
                const label = `${DAY_NAMES[d]} ${p.label}: ${KIND_TEXT(c.kind, gender)}${c.partial ? " (בחלק מהזמן)" : ""}${c.note ? ` — ${c.note}` : ""}`;
                const mark = c.kind === "can" ? "✓" : c.kind === "cannot" ? "✗" : "?";
                const on = picked?.day === d && picked.part === p.part;
                return (
                  <td key={p.part}>
                    {onSet ? (
                      <button
                        type="button"
                        aria-label={label}
                        aria-pressed={on}
                        onClick={() => setPicked(on ? null : { day: d, part: p.part })}
                        className={`flex min-h-11 w-full items-center justify-center rounded-lg border font-bold ${tone(c)} ${on ? "ring-2 ring-ink" : ""}`}
                      >
                        {mark}
                        {(c.partial || c.note) && <span aria-hidden className="text-[10px] font-normal">•</span>}
                      </button>
                    ) : (
                      <span role="img" aria-label={label} title={label} className={`flex min-h-9 w-full items-center justify-center rounded-lg border font-bold ${tone(c)}`}>
                        {mark}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {notes.length > 0 && (
        <ul aria-label="הערות על הזמינות" className="space-y-0.5 text-sm">
          {notes.map((c) => (
            <li key={`${c.day}:${c.part}`}>
              <span className="font-semibold">
                {DAY_NAMES[c.day]} {DAY_PARTS.find((p) => p.part === c.part)!.label}:
              </span>{" "}
              {c.note}
            </li>
          ))}
        </ul>
      )}
      {picked && part && onSet && (
        <div role="group" aria-label={`זמינות ${DAY_NAMES[picked.day]} ${part.label}`} className="space-y-2 rounded-lg border border-line bg-paper p-3">
          <p className="text-sm font-semibold">
            {DAY_NAMES[picked.day]} · {part.label} <bdi className="font-normal text-ink-soft">{partHours(part)}</bdi>
          </p>
          <Field id="avail-note" label="הערה (לא חובה)">
            <input id="avail-note" value={note} maxLength={LIMITS.avail_note} onChange={(e) => setNote(e.target.value)} className={INPUT} placeholder="למשל: רק עד 21:00" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button kind="primary" busy={busy} onClick={() => void save("can")}>
              {byGender(gender, "יכול", "יכולה")}
            </Button>
            <Button busy={busy} onClick={() => void save("cannot")}>
              {byGender(gender, "לא יכול", "לא יכולה")}
            </Button>
            <Button kind="quiet" busy={busy} onClick={() => void save(null)}>
              לא ידוע
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ a toast

export type Notify = (kind: "ok" | "error", text: string) => void;

/** A screen's toast: «נשמר» for a while, an error longer; × closes it. */
export function useToast(bottom = "bottom-6") {
  const [toast, setToast] = useState<{ kind: "ok" | "error"; text: string; at: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "error" ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const notify: Notify = useCallback((kind, text) => setToast({ kind, text, at: Date.now() }), []);
  const clear = useCallback(() => setToast(null), []);
  const node = toast && (
    <div
      key={toast.at}
      role={toast.kind === "error" ? "alert" : "status"}
      className={`fixed inset-x-0 ${bottom} z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-xl px-4 py-2.5 text-sm shadow-xl ${toast.kind === "error" ? "bg-bad text-paper" : "bg-ink text-paper"}`}
    >
      <span>{toast.text}</span>
      <button type="button" aria-label="סגירת ההודעה" onClick={clear} className="-my-1.5 -me-2 inline-flex size-11 items-center justify-center rounded-md text-lg leading-none hover:bg-paper/10">
        ×
      </button>
    </div>
  );
  return { notify, clear, node };
}

// ------------------------------------------------------------------ the edition

/** Which edition the screen is about — the same choice as the week's; a picker when there is more than one. */
export function EditionSelect() {
  const { editions, editionId, select, week } = useWeekStore();
  if (editions.length <= 1) return week ? <span className="text-ink-soft">{week.edition.label}</span> : null;
  return (
    <select aria-label="מחזור" value={editionId ?? ""} onChange={(e) => select(Number(e.target.value))} className="min-h-11 rounded-lg border border-line bg-card px-2 font-semibold">
      {editions.map((e) => (
        <option key={e.id} value={e.id}>
          {e.label}
          {e.status === "archived" ? " (ארכיון)" : e.kind === "demo" ? " (הדגמה)" : e.kind === "practice" ? " (תרגול)" : ""}
        </option>
      ))}
    </select>
  );
}
