// Pieces the speaker screens share: the profile's form fields (create and
// edit), free topic tags, the availability grid (slot by slot) and a toast.
// Built from «הגדרות»'s kit (src/screens/settings/kit.tsx): one column on a
// phone, every control at least 44px tall.
import { type FormEvent, type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CONTACT_PREFS, LIMITS } from "../../data/speakerRules";
import type { SpeakerPatch } from "../../data/speakers";
import { activeLessonRows, nextKind, type SlotKind, slotKey } from "../../domain/availability";
import { byGender } from "../../domain/names";
import { DAYS, DAY_NAMES, type Day, dayRange, fmtRange } from "../../domain/time";
import type { Category, ContactPref, Edition, Gender, GridRow, SlotAvailability, Speaker } from "../../domain/types";
import { CONTACT_PREF_LABEL } from "../../lib/labels";
import { Button, Field, Fold, GenderField, INPUT } from "../settings/kit";
import { useWeekStore } from "../weekStore";

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
 * `fold` (creating a speaker, a quick act): what is not needed now — the
 * disambiguator unless it is, the bio, the channel and the create flow's own
 * `extra` — waits closed in «עוד פרטים»; the sheet holds every field later.
 */
export function ProfileFields({
  id,
  form,
  set,
  titles,
  categories,
  withName,
  invalid,
  problem,
  needDisambiguator,
  fold,
  extra,
}: {
  id: string;
  form: ProfileForm;
  set: (patch: Partial<ProfileForm>) => void;
  titles: readonly string[];
  /** The week's topics, offered under the topic field. */
  categories: readonly Category[];
  withName: boolean;
  invalid?: "name" | "disambiguator" | null;
  problem?: string | null;
  /** A speaker of this very name is in the pool: another person needs a disambiguator. */
  needDisambiguator?: boolean;
  fold?: boolean;
  extra?: ReactNode;
}) {
  const err = (f: "name" | "disambiguator") => (invalid === f ? { "aria-invalid": true as const, "aria-describedby": `${id}-problem` } : {});
  const dis = (
    <Field
      id={`${id}-dis`}
      label={needDisambiguator ? "פרט מבחין (חובה: יש במאגר מרצה בשם הזה)" : "פרט מבחין (לא חובה)"}
      hint={needDisambiguator ? "מוסד או עיר" : undefined}
    >
      <input id={`${id}-dis`} value={form.disambiguator} maxLength={LIMITS.disambiguator} onChange={(e) => set({ disambiguator: e.target.value })} className={INPUT} {...err("disambiguator")} />
    </Field>
  );
  // a refusal about it, or a namesake in the pool, keeps it in sight (and focusable)
  const disFolded = fold && !needDisambiguator && invalid !== "disambiguator";
  const bio = (
    <Field id={`${id}-bio`} label="תיאור קצר" hint="גלוי לכל הצוות">
      <textarea id={`${id}-bio`} value={form.bio_short} maxLength={LIMITS.bio_short} rows={3} onChange={(e) => set({ bio_short: e.target.value })} className={`${INPUT} py-2`} />
    </Field>
  );
  const topics = <TagInput id={`${id}-topics`} tags={form.topics} draft={form.topicDraft} categories={categories} onChange={set} />;
  const pref = (
    <Field id={`${id}-pref`} label="ערוץ קשר מועדף" hint="המספר עצמו — בפרטי הקשר">
      <select id={`${id}-pref`} value={form.contact_pref} onChange={(e) => set({ contact_pref: e.target.value as ContactPref | "" })} className={INPUT}>
        <option value="">לא צוין</option>
        {CONTACT_PREFS.map((p) => (
          <option key={p} value={p}>
            {CONTACT_PREF_LABEL[p]}
          </option>
        ))}
      </select>
    </Field>
  );
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
      {!disFolded && dis}
      {problem && (
        <p id={`${id}-problem`} role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
          {problem}
        </p>
      )}
      <GenderField name={`${id}-gender`} value={form.gender} onChange={(gender) => set({ gender })} legend="מגדר" unknown="לא ידוע" />
      <Field id={`${id}-aff`} label="מוסד">
        <input id={`${id}-aff`} value={form.affiliation} maxLength={LIMITS.affiliation} onChange={(e) => set({ affiliation: e.target.value })} className={INPUT} />
      </Field>
      {fold ? (
        <>
          {topics}
          <Fold title="עוד פרטים" hint="לא חובה · אפשר גם בכרטיס" size="sm">
            <div className="space-y-3">
              {disFolded && dis}
              {bio}
              {pref}
              {extra}
            </div>
          </Fold>
        </>
      ) : (
        <>
          {bio}
          {topics}
          {pref}
          {extra}
        </>
      )}
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
  categories,
  onChange,
}: {
  id: string;
  tags: string[];
  draft: string;
  /** The week's topics: a tag of that very name wears its colour (and the pool's topic filter finds it); one tap adds one not yet chosen. */
  categories: readonly Category[];
  onChange: (p: { topics?: string[]; topicDraft: string }) => void;
}) {
  const full = tags.length >= LIMITS.topics;
  const active = categories.filter((c) => c.active);
  const colorOf = (t: string) => active.find((c) => c.name === t)?.color;
  const offered = full ? [] : active.filter((c) => !tags.includes(c.name));
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
          {tags.map((t) => {
            const color = colorOf(t);
            return (
              <li
                key={t}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-paper ps-3 text-sm"
                style={color ? { backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`, borderColor: `color-mix(in srgb, ${color} 35%, transparent)` } : undefined}
              >
                {color && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
                {t}
                <button type="button" onClick={() => onChange({ topics: tags.filter((x) => x !== t), topicDraft: draft })} aria-label={`הסרת הנושא ${t}`} className="inline-flex size-9 items-center justify-center rounded-full text-ink-soft hover:bg-line/60">
                  ×
                </button>
              </li>
            );
          })}
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
      {offered.length > 0 && (
        <ul aria-label="נושאי השבוע" className="mt-1.5 flex flex-wrap gap-1">
          {offered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onChange({ topics: withTopic(tags, c.name), topicDraft: draft })}
                aria-label={`הוספת הנושא ${c.name}`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-line px-2.5 text-xs text-ink-soft hover:bg-line/40 hover:text-ink sm:min-h-8"
              >
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ availability: the days × the week's lesson rows (v14)

type Mark = { kind: SlotKind; note: string | null } | null;

const KIND_TEXT = (kind: SlotKind | null, g: Gender | null) =>
  kind === "can" ? byGender(g, "יכול", "יכולה") : kind === "cannot" ? byGender(g, "לא יכול", "לא יכולה") : "לא ידוע";
const GLYPH: Record<SlotKind, string> = { can: "✓", cannot: "✗" };
const TONE: Record<SlotKind | "none", string> = { can: "border-ok/50 bg-ok/10 text-ok", cannot: "border-bad/40 bg-bad/10 text-bad", none: "border-line bg-card text-ink-soft" };
/** A slot outside the week's hours (Sunday before the opening, Thursday after the close): the grid's own hatching. */
const HATCH = "bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(29,42,68,0.06)_6px_8px)]";

/** «ראשון 08:30–10:00» — a slot's name for a screen reader (an accessible name is not laid out: no LRM). */
const slotName = (day: Day, r: GridRow) => `${DAY_NAMES[day]} ${fmtRange(r.start_min, r.end_min)}`;

/**
 * A speaker's availability, slot by slot: the days are columns, the week's lesson rows are rows. Each slot in play is a
 * button that cycles — (not known) → ✓ → ✗ → — and saves at once: the change shows before the answer, and a refusal
 * puts it back (the runner toasts why); every save is said once in a polite line under the grid, not in a toast. The
 * arrow keys move between the slots (one tab stop for the grid). A note belongs to a marked slot: the list under the
 * grid, and «+ הערה». Without `onSet` the grid is read-only.
 */
export function SlotGrid({
  rows,
  edition,
  slots,
  gender,
  onSet,
}: {
  rows: readonly GridRow[];
  edition: Edition;
  /** This speaker's slots this edition. */
  slots: readonly SlotAvailability[];
  /** The speaker's: the words are about them. */
  gender: Gender | null;
  /** One slot saved; false when it was refused. */
  onSet?: (day: Day, rowId: number, kind: SlotKind | null, note: string | null) => Promise<boolean>;
}) {
  const id = useId();
  const active = useMemo(() => DAYS.map((d) => activeLessonRows(rows, edition, d)), [rows, edition]);
  const live = useMemo(() => new Set(active.flatMap((list, d) => list.map((r) => slotKey(d, r.id)))), [active]);
  // every lesson row in play on some day; a slot of it that is not in play that day is hatched
  const lines = useMemo(() => rows.filter((r) => active.some((list) => list.includes(r))).sort((a, b) => a.start_min - b.start_min), [rows, active]);
  const saved = useMemo(() => new Map(slots.map((v) => [slotKey(v.day, v.row_id), v])), [slots]);

  // A tap shows at once; its save waits for the ones before it (in order), and once a slot has none left the week
  // read again speaks for it — what was saved, or what was there before a refusal.
  const [shown, setShown] = useState<Map<string, Mark>>(() => new Map());
  const pending = useRef(new Map<string, number>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [said, setSaid] = useState("");
  const markOf = (key: string): Mark => {
    if (shown.has(key)) return shown.get(key) ?? null;
    const v = saved.get(key);
    return v ? { kind: v.kind, note: v.note } : null;
  };
  const save = (day: Day, r: GridRow, kind: SlotKind | null, note: string | null, done: string) => {
    if (!onSet) return Promise.resolve(false);
    const key = slotKey(day, r.id);
    pending.current.set(key, (pending.current.get(key) ?? 0) + 1);
    // never rejects: a failed save must not stop the ones queued after it
    const next = queue.current.then(async () => {
      const ok = await onSet(day, r.id, kind, note).catch(() => false);
      if (ok) setSaid(done);
      const left = (pending.current.get(key) ?? 1) - 1;
      if (left > 0) pending.current.set(key, left);
      else {
        pending.current.delete(key);
        setShown((m) => {
          const out = new Map(m);
          out.delete(key);
          return out;
        });
      }
      return ok;
    });
    queue.current = next;
    return next;
  };
  const tap = (day: Day, r: GridRow) => {
    const key = slotKey(day, r.id);
    const was = markOf(key);
    const kind = nextKind(was?.kind ?? null);
    const note = kind ? (was?.note ?? null) : null; // «לא ידוע» keeps no note
    setShown((m) => new Map(m).set(key, kind ? { kind, note } : null));
    void save(day, r, kind, note, `נשמר: ${dayRange(day, r.start_min, r.end_min)} — ${KIND_TEXT(kind, gender)}`);
  };

  // One tab stop: the slot last touched, else the first in play; the arrows move it (right to left: ← is the next day).
  const [stop, setStop] = useState<string | null>(null);
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const order = lines.flatMap((r) => DAYS.map((d) => slotKey(d, r.id)).filter((k) => live.has(k)));
  const tabStop = stop && live.has(stop) ? stop : order[0];
  const move = (e: KeyboardEvent<HTMLButtonElement>, day: Day, line: number) => {
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const steps: Record<string, [number, number]> = { ArrowDown: [0, 1], ArrowUp: [0, -1], ArrowLeft: [rtl ? 1 : -1, 0], ArrowRight: [rtl ? -1 : 1, 0] };
    let to: string | undefined;
    if (steps[e.key]) {
      const [dx, dy] = steps[e.key];
      for (let x = day + dx, y = line + dy; x >= 0 && x < DAYS.length && y >= 0 && y < lines.length; x += dx, y += dy) {
        const k = slotKey(x, lines[y].id);
        if (live.has(k)) {
          to = k;
          break;
        }
      }
    } else if (e.key === "Home" || e.key === "End") {
      const inRow = DAYS.map((d) => slotKey(d, lines[line].id)).filter((k) => live.has(k));
      to = e.key === "Home" ? inRow[0] : inRow[inRow.length - 1];
    } else return;
    e.preventDefault();
    if (to) {
      setStop(to);
      cells.current.get(to)?.focus();
    }
  };

  // The notes, a run of neighbouring slots with the same word and note said once («ראשון 08:30–13:00»).
  const notes: { key: string; day: Day; from: GridRow; to: GridRow; kind: SlotKind; note: string }[] = [];
  for (const d of DAYS) {
    let last: (typeof notes)[number] | null = null;
    for (const r of active[d]) {
      const m = markOf(slotKey(d, r.id));
      if (m?.note && last && last.kind === m.kind && last.note === m.note) last.to = r;
      else {
        last = m?.note ? { key: slotKey(d, r.id), day: d, from: r, to: r, kind: m.kind, note: m.note } : null;
        if (last) notes.push(last);
      }
    }
  }
  const marked = lines.flatMap((r) =>
    DAYS.flatMap((d) => {
      const key = slotKey(d, r.id);
      const m = live.has(key) ? markOf(key) : null;
      return m ? [{ key, day: d, row: r, mark: m }] : [];
    }),
  );

  return (
    <div className="space-y-2">
      <p id={`${id}-how`} className="text-xs text-ink-soft">
        ✓ {KIND_TEXT("can", gender)} · ✗ {KIND_TEXT("cannot", gender)} · — לא ידוע.
        {onSet && " הקשה על משבצת מחליפה ביניהם, והשינוי נשמר מיד. במקלדת: החיצים עוברים בין המשבצות."}
      </p>
      <table className="w-full table-fixed border-separate border-spacing-1 text-sm" aria-label="זמינות לפי ימים ושעות">
        <thead>
          <tr>
            <th scope="col" className="w-16">
              <span className="sr-only">שעה</span>
            </th>
            {DAYS.map((d) => (
              <th key={d} scope="col" className="text-xs font-semibold text-ink-soft">
                {DAY_NAMES[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((r, line) => (
            <tr key={r.id}>
              <th scope="row" className="text-start text-[11px] font-normal leading-tight text-ink-soft tabular-nums">
                <bdi>{fmtRange(r.start_min, r.end_min)}</bdi>
              </th>
              {DAYS.map((d) => {
                const key = slotKey(d, r.id);
                if (!live.has(key)) {
                  return (
                    <td key={d} className={`rounded-lg ${HATCH}`} title="מחוץ לשעות השבוע">
                      <span className="sr-only">מחוץ לשעות השבוע</span>
                    </td>
                  );
                }
                const m = markOf(key);
                const label = `${slotName(d, r)}: ${KIND_TEXT(m?.kind ?? null, gender)}${m?.note ? ` — ${m.note}` : ""}`;
                const face = (
                  <>
                    {m ? GLYPH[m.kind] : "—"}
                    {m?.note && <span aria-hidden className="text-[10px] font-normal">•</span>}
                  </>
                );
                const tone = TONE[m?.kind ?? "none"];
                return (
                  <td key={d}>
                    {onSet ? (
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) cells.current.set(key, el);
                          else cells.current.delete(key);
                        }}
                        tabIndex={key === tabStop ? 0 : -1}
                        aria-label={label}
                        aria-describedby={`${id}-how`}
                        data-slot={key}
                        onClick={() => tap(d, r)}
                        onFocus={() => setStop(key)}
                        onKeyDown={(e) => move(e, d, line)}
                        className={`flex min-h-11 w-full items-center justify-center rounded-lg border font-bold ${tone}`}
                      >
                        {face}
                      </button>
                    ) : (
                      <span role="img" aria-label={label} title={label} data-slot={key} className={`flex min-h-9 w-full items-center justify-center rounded-lg border font-bold ${tone}`}>
                        {face}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {onSet && (
        <p aria-live="polite" data-slot-said className="min-h-4 text-xs text-ink-soft">
          {said}
        </p>
      )}
      {notes.length > 0 && (
        <ul aria-label="הערות על הזמינות" className="space-y-0.5 text-sm">
          {notes.map((n) => (
            <li key={n.key}>
              <span className="font-semibold">
                {DAY_NAMES[n.day]} <bdi>{fmtRange(n.from.start_min, n.to.end_min)}</bdi>
              </span>{" "}
              · {KIND_TEXT(n.kind, gender)} — {n.note}
            </li>
          ))}
        </ul>
      )}
      {onSet && marked.length > 0 && (
        <Fold title="+ הערה" hint="למשבצת שסומנה" size="sm">
          <SlotNote marked={marked} gender={gender} onSave={(day, r, kind, note) => save(day, r, kind, note, `ההערה נשמרה: ${dayRange(day, r.start_min, r.end_min)}`)} />
        </Fold>
      )}
    </div>
  );
}

/** «+ הערה»: a marked slot, its note — saved with the slot's own mark (an empty note takes it away). */
function SlotNote({
  marked,
  gender,
  onSave,
}: {
  marked: { key: string; day: Day; row: GridRow; mark: NonNullable<Mark> }[];
  gender: Gender | null;
  onSave: (day: Day, r: GridRow, kind: SlotKind, note: string | null) => Promise<boolean>;
}) {
  const id = useId();
  const [key, setKey] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = marked.find((m) => m.key === key);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pick) return;
    setBusy(true);
    const ok = await onSave(pick.day, pick.row, pick.mark.kind, note.trim() || null);
    setBusy(false);
    if (ok) {
      setKey("");
      setNote("");
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} aria-label="הערה למשבצת" className="space-y-2 rounded-lg border border-line bg-paper p-3" noValidate>
      <Field id={`${id}-slot`} label="המשבצת">
        <select
          id={`${id}-slot`}
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setNote(marked.find((m) => m.key === e.target.value)?.mark.note ?? "");
          }}
          className={INPUT}
        >
          <option value="">בחירה</option>
          {marked.map((m) => (
            <option key={m.key} value={m.key}>
              {dayRange(m.day, m.row.start_min, m.row.end_min)} · {KIND_TEXT(m.mark.kind, gender)}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${id}-note`} label="ההערה" hint="גלויה לכל הצוות. שדה ריק מוחק את ההערה.">
        <input id={`${id}-note`} value={note} maxLength={LIMITS.avail_note} disabled={!pick} onChange={(e) => setNote(e.target.value)} aria-describedby={`${id}-note-hint`} className={INPUT} placeholder="למשל: רק עד 21:00" />
      </Field>
      <Button kind="primary" type="submit" disabled={!pick || note.trim() === (pick.mark.note ?? "")} busy={busy} busyLabel="שומר…">
        שמירה
      </Button>
    </form>
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
      className={`fixed inset-x-0 ${bottom} z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-xl px-4 py-2.5 text-sm shadow-xl print:hidden ${toast.kind === "error" ? "bg-bad text-paper" : "bg-ink text-paper"}`}
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
