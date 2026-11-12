// The import wizard's «מה ייכנס» (src/screens/settings/ImportTab.tsx): «צריך להחליט» — only what holds «ייבוא» back
// (each «עמום» card, «כפולה» group, a cell's other name, a note to fix, the archive's name) — and the rest folded with
// its defaults applied: the speakers «חדש · תואם · עמום · מדולג», what a match would fill, «עריכה» of a card's name,
// title and affiliation; the lessons, topics → categories, the sources' words, the lines decided; the escorts' channels.
// Lists, one card per row, the same at every width.
import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from "react";
import { fmtRange } from "../../domain/time";
import { dayLabel } from "../../reader/model";
import { PRINT_WHEN_LABEL, SOURCES_LABEL } from "../../domain/stages";
import type { Category, PrintWhen, SourcesKind } from "../../domain/types";
import { CONTACT_PREF_LABEL } from "../../lib/labels";
import type { CandidatePreview, MatchContext } from "../../import/candidates";
import {
  answerSaves, CHANNEL_LABEL, type EscortAnswer, escortFill, escortFills, type EscortsPreview as EscortsRowPreview, IMPORT_CHANNELS, type ImportChannel, namedEscort, noteProblem, type ShownPhrase,
} from "../../import/escorts";
import { LIMITS } from "../../data/speakerRules";
import { actionOf, type Choice, fillPlan, type Resolved, type RowStatus, type SpeakerFill, type SpeakerMatch } from "../../import/match";
import { DESIGN_SOURCES, sourcesKey, type SourcesRule, SUGGESTED_SOURCES } from "../../import/sources";
import { ARCHIVE_ROOM, parallelRoomName } from "../../data/importRules";
import { editProblem, type SpeakerEdit } from "../../import/edit";
import type { LineKind } from "../../import/lines";
import { scrubContacts } from "../../import/phone";
import type { DoubleGroup, ExtraLine, GroupDecision, LessonPlan, LineAs, TrackingRead, TrackingSpeakerPreview } from "../../import/tracking";
import { sourcesValuesOf, topicsOf } from "../../import/tracking";
import { Badge, Button, CHOICE, CHOICE_OFF, CHOICE_ON, Fold, INPUT } from "./kit";

export const STATUS: Record<RowStatus, { label: string; tone: "ok" | "accent" | "bad" | "muted" }> = {
  new: { label: "חדש", tone: "ok" },
  match: { label: "תואם", tone: "accent" },
  ambiguous: { label: "עמום", tone: "bad" },
  skip: { label: "מדולג", tone: "muted" },
};

const rowsSaid = (rows: number[]) => (rows.length === 1 ? `שורה ${rows[0]}` : `שורות ${rows.join(", ")}`);

/** What a row will do to its speaker: the match and what it fills, or the choice an «עמום» needs. */
function SpeakerDecision({
  name,
  status,
  match,
  fill,
  pool,
  choice,
  onChoose,
  blocked = null,
}: {
  name: string;
  status: RowStatus;
  match: SpeakerMatch | null;
  fill: SpeakerFill | null;
  pool: MatchContext | null;
  choice: Choice | undefined;
  onChoose: (c: Choice | null) => void;
  /** «כמו …» names a row that is left out (or itself undecided): why the choice cannot stand. */
  blocked?: string | null;
}) {
  const id = useId();
  const action = actionOf(status, match, choice);
  const target = action?.action === "merge" && pool ? pool.pool.find((s) => s.id === action.target) : undefined;
  const sheet = match?.sheet ?? [];
  const inSheet = sheet.length > 0 && (match?.candidates.length ?? 0) === 0;
  const fills = target && fill ? fillPlan(target, pool?.flags.get(target.id), fill) : [];
  return (
    <div className="mt-1 space-y-1 text-sm">
      {status === "match" && match?.candidates[0] && (
        <p>
          {match.via === "phone" ? "אותו טלפון כמו" : "כבר במאגר:"} <b>{match.candidates[0].label}</b>
        </p>
      )}
      {status === "ambiguous" && match && (
        <fieldset data-decide className="min-w-0 rounded-lg border border-line bg-paper-light p-2">
          <legend className="px-1 font-bold text-navy">
            מי זה/זו?{" "}
            {inSheet
              ? sheet.some((c) => c.via === "phone")
                ? "באותה טבלה יש שורה עם אותו טלפון"
                : "באותה טבלה יש שורה עם שם דומה"
              : match.via === "similar"
                ? "יש במאגר שם דומה"
                : match.via === "phone"
                  ? "כמה מרצים עם הטלפון הזה"
                  : "כמה מרצים בשם הזה"}
          </legend>
          <div className="flex flex-col gap-1">
            {sheet.map((c) => (
              <label key={`sheet-${c.ref}`} className="inline-flex min-h-11 cursor-pointer items-center gap-2">
                <input type="radio" name={`${id}-who`} checked={choice?.action === "same" && choice.ref === c.ref} onChange={() => onChoose({ action: "same", ref: c.ref })} className="accent-navy" />
                {/* one flex item: the bracket flows on after the name, never a narrow column of its own */}
                <span className="min-w-0">
                  אותו/ה מרצה כמו {c.label} <span className="whitespace-nowrap text-ink-soft">{c.via === "phone" ? "(אותו טלפון)" : `(דמיון ${c.similarity?.toFixed(2)})`}</span>
                </span>
              </label>
            ))}
            {match.candidates.map((c) => (
              <label key={c.id} className="inline-flex min-h-11 cursor-pointer items-center gap-2">
                <input type="radio" name={`${id}-who`} checked={choice?.action === "merge" && choice.target === c.id} onChange={() => onChoose({ action: "merge", target: c.id })} className="accent-navy" />
                <span className="min-w-0">
                  להשלים את {c.label}
                  {c.similarity != null && <span className="text-ink-soft">{" "}<span className="whitespace-nowrap">(דמיון {c.similarity.toFixed(2)})</span></span>}
                </span>
              </label>
            ))}
            {match.allowNew && (
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
                <input type="radio" name={`${id}-who`} checked={choice?.action === "new"} onChange={() => onChoose({ action: "new" })} className="accent-navy" />
                {name} — מרצה חדש/ה{sheet.some((c) => c.via === "phone") ? " (גם אם הטלפון משותף — למשל זוג או משרד)" : ""}
              </label>
            )}
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
              <input type="radio" name={`${id}-who`} checked={choice?.action === "skip"} onChange={() => onChoose({ action: "skip" })} className="accent-navy" />
              דילוג על {name}
            </label>
          </div>
        </fieldset>
      )}
      {action?.action === "merge" && (
        <p className="text-ink-soft">{fills.length ? `יושלם (רק מה שחסר): ${fills.join(", ")}` : "אין מה להשלים — שום דבר לא נדרס."}</p>
      )}
      {action?.action === "same" && blocked && <p className="text-bad">{blocked}</p>}
      {action?.action === "same" && !blocked && <p className="text-ink-soft">מרצה אחד/ת עם השורה ההיא: מה שחסר שם יושלם מכאן.</p>}
      {(status === "new" || status === "match") && (
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-ink-soft">
          <input type="checkbox" checked={choice?.action === "skip"} onChange={(e) => onChoose(e.target.checked ? { action: "skip" } : null)} className="size-5 accent-navy" />
          לא לייבא
        </label>
      )}
    </div>
  );
}

function Facts({ items }: { items: (string | null | false | undefined)[] }) {
  const xs = items.filter((x): x is string => !!x);
  return xs.length ? <p className="text-sm text-ink-soft break-words">{xs.join(" · ")}</p> : null;
}

function Warnings({ items }: { items: string[] }) {
  return items.length ? (
    <ul className="mt-1 list-disc ps-5 text-sm text-ink-soft">
      {items.map((w, i) => (
        <li key={i}>{w}</li>
      ))}
    </ul>
  ) : null;
}

const genderSaid = (g: string | null) => (g === "m" ? "מגדר: זכר (הצעה, מהתואר)" : g === "f" ? "מגדר: נקבה (הצעה, מהתואר)" : null);

/**
 * «עריכה» of a speaker card (DECISIONS «סבב שישי»): its name, title and affiliation as the admin reads them — they
 * replace what was read, are matched again, and are checked as the file's text is (no phone, no e-mail; a title from the
 * list; the pool's lengths). In the tracking sheet also what the names beside or under another that it is are.
 */
function EditSpeaker({
  start,
  titles,
  escorts,
  lines = [],
  onLine,
  onSave,
  onCancel,
  nameRef,
}: {
  start: SpeakerEdit;
  titles: readonly string[];
  escorts: readonly string[];
  lines?: ExtraLine[];
  onLine?: (id: string, as: LineAs, byKeyboard: boolean) => void;
  /** byKeyboard: «שמירת העריכה» pressed by the keyboard (a click's detail is 0). */
  onSave: (e: SpeakerEdit, byKeyboard: boolean) => void;
  onCancel: () => void;
  /** The name's field (Editable's, which focuses it). */
  nameRef: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const [title, setTitle] = useState(start.title ?? "");
  const [name, setName] = useState(start.name);
  const [affiliation, setAffiliation] = useState(start.affiliation ?? "");
  const value: SpeakerEdit = { title: title || null, name, affiliation: affiliation || null };
  const problem = editProblem(value, titles);
  const escort = namedEscort(name, escorts);
  return (
    <div role="group" aria-label="עריכה" className="mt-1.5 rounded-xl bg-sand-soft p-2.5">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <label htmlFor={`${id}-t`} className="mb-0.5 block text-sm font-semibold">
            תואר
          </label>
          <select id={`${id}-t`} value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT}>
            <option value="">בלי תואר</option>
            {titles.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-n`} className="mb-0.5 block text-sm font-semibold">
            שם
          </label>
          <input ref={nameRef} id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} aria-describedby={`${id}-p`} className={INPUT} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-a`} className="mb-0.5 block text-sm font-semibold">
            שיוך מוסדי
          </label>
          <input id={`${id}-a`} value={affiliation} onChange={(e) => setAffiliation(e.target.value)} aria-describedby={`${id}-p`} className={INPUT} />
        </div>
      </div>
      <p id={`${id}-p`} className={`mt-1 text-sm ${problem || escort ? "text-bad" : "text-ink-soft"}`}>
        {problem ?? (escort ? `בשם יש מילה מעמודת המלווים («${escort}»).` : "מה שכותבים כאן מחליף את מה שנקרא מהקובץ ונבדק שוב מול המאגר. מגדר — רק מהתואר. בלי טלפון ובלי מייל.")}
      </p>
      {lines.map((l) => (
        <LineChoice key={l.id} line={l} onChoose={(as, byKeyboard) => onLine?.(l.id, as, byKeyboard)} legend={`שורה ${l.row}: «${l.text}» ליד ${l.ofName} — מה זה?`} />
      ))}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button kind="primary" disabled={!!problem} onClick={(ev) => onSave(value, ev.detail === 0)}>
          שמירת העריכה
        </Button>
        <Button onClick={onCancel}>ביטול</Button>
      </div>
    </div>
  );
}

/** A card's «עריכה» button and form, and «נערך ידנית» once edited (with «ביטול העריכה»: back to what was read). */
function Editable({
  fields,
  edited,
  titles,
  escorts,
  lines,
  onLine,
  onEdit,
  focusEdit = null,
}: {
  fields: SpeakerEdit;
  edited: boolean;
  titles: readonly string[];
  escorts: readonly string[];
  lines?: ExtraLine[];
  onLine?: (id: string, as: LineAs, byKeyboard: boolean) => void;
  /** The admin's reading (null: back to the file's); byKeyboard: saved or taken back by the keyboard. */
  onEdit: (e: SpeakerEdit | null, byKeyboard: boolean) => void;
  /**
   * Set by a list whose cards an «עריכה» merges: for the render after which this card takes the focus (also as it mounts) —
   * «scroll» from the keyboard; «still» from a click, a tap or a screen reader's action: the focus moves, the page does not.
   */
  focusEdit?: "scroll" | "still" | null;
}) {
  const [open, setOpen] = useState(false);
  // opened by «עריכה»: the keyboard goes on into the form, to the name
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);
  // the form closed (saved or cancelled), or the edit taken back: the keyboard returns to this card's «עריכה»
  const editRef = useRef<HTMLButtonElement>(null);
  const [refocus, setRefocus] = useState(0);
  useEffect(() => {
    if (refocus) editRef.current?.focus();
  }, [refocus]);
  // the list's hand-off: to «עריכה», or — the card's own form open, so no «עריכה» shown — to the form's name (its fold
  // opened, when the card it merged into is folded)
  useEffect(() => {
    if (!focusEdit) return;
    const el = editRef.current ?? nameRef.current;
    const fold = el?.closest("details");
    if (fold && !fold.open) fold.open = true;
    el?.focus({ preventScroll: focusEdit === "still" });
  }, [focusEdit]);
  const close = () => {
    setOpen(false);
    setRefocus((n) => n + 1);
  };
  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {edited && <Badge tone="neutral">נערך ידנית</Badge>}
        {!open && (
          <Button ref={editRef} kind="quiet" aria-label={`עריכה — ${fields.name}`} onClick={() => setOpen(true)}>
            עריכה
          </Button>
        )}
        {edited && !open && (
          <Button
            kind="quiet"
            onClick={(ev) => {
              onEdit(null, ev.detail === 0);
              setRefocus((n) => n + 1);
            }}
          >
            ביטול העריכה
          </Button>
        )}
      </div>
      {open && (
        <EditSpeaker
          start={fields}
          titles={titles}
          escorts={escorts}
          lines={lines}
          onLine={onLine}
          onSave={(e, byKeyboard) => {
            onEdit(e, byKeyboard);
            close();
          }}
          onCancel={close}
          nameRef={nameRef}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ «מה ייכנס»: what waits, and the rest folded

/** A card in «צריך להחליט»: boxed, as a group or a line is. */
const BOX = "rounded-lg border border-line bg-card p-2.5";
/** A group or a line, wherever it is. */
const ITEM = "rounded-lg border border-line bg-paper-light p-2.5";

/** «חדש 12 · תואם 3 · מדולג 2» — a fold's hint (no zeros). */
function countsSaid(statuses: RowStatus[]): string {
  return (["new", "match", "ambiguous", "skip"] as const)
    .map((s) => [s, statuses.filter((x) => x === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${STATUS[s].label} ${n}`)
    .join(" · ");
}

/** What waits, as ImportTab counts it (the summary's and the blockers' count) — not only the check's set. */
export interface DecideCounts {
  /** All that waits now. */
  waiting: number;
  /** What waits but is not in the list: it began to wait after the check (it is left where the admin is working). */
  elsewhere: number;
  /** «לראשונה שמחכה להחלטה». */
  toFirst: () => void;
}

/**
 * «צריך להחליט (N)» — always open: only what holds «ייבוא» back, one after another. The set is the check's (ImportTab
 * takes it when a check's answer arrives): an item decided stays, showing its choice, so the keyboard is never left on
 * nothing. N counts what still waits — also what began to wait after the check, outside the list, which is said so.
 */
function DecideList({ counts, children, empty }: { counts: DecideCounts; children: ReactNode; empty: boolean }) {
  const id = useId();
  const { waiting, elsewhere } = counts;
  return (
    <section aria-labelledby={id} className="mb-3">
      <h4 id={id} className="mb-2 text-[15px] font-bold text-navy">
        צריך להחליט ({waiting})
      </h4>
      {!empty && (
        <ul aria-label="צריך להחליט" className="space-y-2">
          {children}
        </ul>
      )}
      {empty && waiting === 0 && <p className="text-sm text-ink-soft">אין מה להחליט.</p>}
      {elsewhere > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
          <span>{elsewhere === 1 ? "עוד החלטה אחת מחכה, מחוץ לרשימה הזו." : `עוד ${elsewhere} החלטות מחכות, מחוץ לרשימה הזו.`}</span>
          <Button kind="quiet" onClick={counts.toFirst}>
            לראשונה שמחכה להחלטה
          </Button>
        </div>
      )}
    </section>
  );
}

/** The folds under «צריך להחליט»: everything else, its defaults already applied. */
function Rest({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-sage/60 border-t border-sage/60">{children}</div>;
}

/** A speakers' fold: «כל המרצים», or «שאר המרצים» when some are in «צריך להחליט». */
function SpeakersFold({ some, statuses, children }: { some: boolean; statuses: RowStatus[]; children: ReactNode }) {
  return (
    <Fold title={`${some ? "שאר המרצים" : "כל המרצים"} (${statuses.length})`} hint={countsSaid(statuses)}>
      <ul aria-label="המרצים" className="divide-y divide-sage/60 border-y border-sage/60">
        {children}
      </ul>
    </Fold>
  );
}

// ------------------------------------------------------------------ (a) the candidates

function CandidateCard({
  r,
  pool,
  choice,
  open,
  onChoose,
  titles,
  escorts,
  onEdit,
  box,
}: {
  r: CandidatePreview;
  pool: MatchContext;
  choice: Choice | undefined;
  /** Undecided: an «עמום» with no choice, or «כמו שורה N» naming a row left out. */
  open: boolean;
  onChoose: (c: Choice | null) => void;
  titles: readonly string[];
  escorts: readonly string[];
  onEdit: (e: SpeakerEdit | null) => void;
  box: boolean;
}) {
  const d = r.data;
  const name = d ? `${d.title ? `${d.title} ` : ""}${d.name}` : "—";
  return (
    <li data-row={r.row} data-ref={r.ref} data-undecided={open || undefined} className={box ? BOX : "py-2"}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm text-ink-soft">שורה {r.row}</span>
        <span className="min-w-0 flex-1 font-bold text-navy break-words">{name}</span>
        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
      </div>
      {r.skip && <p className="text-sm text-ink-soft">{r.skip}</p>}
      {r.nameWarning && <p className="text-sm text-bad">{r.nameWarning}</p>}
      {r.fields && <Editable fields={r.fields} edited={!!r.edited} titles={titles} escorts={escorts} onEdit={(e) => onEdit(e)} />}
      {d && (
        <>
          <Facts items={[genderSaid(d.gender), d.affiliation, d.topics.join(", "), d.phone && "יש טלפון", d.email && "יש מייל", d.notes && "יש הערות"]} />
          <SpeakerDecision
            name={name}
            status={r.status}
            match={r.match}
            fill={d}
            pool={pool}
            choice={choice}
            onChoose={onChoose}
            blocked={choice?.action === "same" && open ? `שורה ${choice.ref.split(":")[0]} לא מיובאת (או עוד מחכה להחלטה) — בוחרים אחרת.` : null}
          />
        </>
      )}
      <Warnings items={r.warnings} />
    </li>
  );
}

export function CandidatesReview({
  rows,
  pool,
  choices,
  resolved,
  onChoose,
  titles,
  escorts,
  onEdit,
  lines,
  onLine,
  decide,
  counts,
}: {
  rows: CandidatePreview[];
  pool: MatchContext;
  choices: Map<string, Choice>;
  /** Each row's action as the commit takes it, by its ref (null: undecided). */
  resolved: Map<string, Resolved | null>;
  onChoose: (key: string, c: Choice | null) => void;
  titles: readonly string[];
  escorts: readonly string[];
  /** «עריכה» of a row (by its ref; null: back to what was read). */
  onEdit: (ref: string, e: SpeakerEdit | null) => void;
  lines: ExtraLine[];
  onLine: (id: string, as: LineAs) => void;
  /** «צריך להחליט»: the check's set — «sp:<ref>», «l:<line id>». */
  decide: ReadonlySet<string>;
  counts: DecideCounts;
}) {
  const open = (r: CandidatePreview) => !!r.data && resolved.get(r.ref) == null;
  const inDecide = (r: CandidatePreview) => decide.has(`sp:${r.ref}`);
  const cards = rows.filter(inDecide);
  const rest = rows.filter((r) => !inDecide(r));
  const lineItems = lines.filter((l) => decide.has(`l:${l.id}`));
  const lineRest = lines.filter((l) => !decide.has(`l:${l.id}`));
  const card = (r: CandidatePreview, box: boolean) => (
    <CandidateCard
      key={r.ref}
      r={r}
      pool={pool}
      choice={choices.get(r.ref)}
      open={open(r)}
      onChoose={(c) => onChoose(r.ref, c)}
      titles={titles}
      escorts={escorts}
      onEdit={(e) => onEdit(r.ref, e)}
      box={box}
    />
  );
  return (
    <>
      <DecideList counts={counts} empty={lineItems.length + cards.length === 0}>
        {lineItems.map((l) => (
          <LineItem key={l.id} line={l} onChoose={(as) => onLine(l.id, as)} />
        ))}
        {cards.map((r) => card(r, true))}
      </DecideList>
      <Rest>
        {rest.length > 0 && (
          <SpeakersFold some={cards.length > 0} statuses={rest.map((r) => r.status)}>
            {rest.map((r) => card(r, false))}
          </SpeakersFold>
        )}
        {lineRest.length > 0 && <LinesFold lines={lineRest} onChoose={onLine} />}
      </Rest>
    </>
  );
}

// ------------------------------------------------------------------ (b) the tracking sheet

function GroupItem({ g, read, decision, onDecide }: { g: DoubleGroup; read: TrackingRead; decision: GroupDecision | undefined; onDecide: (d: GroupDecision) => void }) {
  const id = useId();
  const rs = g.rows.map((n) => read.rows.find((r) => r.row === n)!);
  const one = g.rows.length === 1;
  return (
    <li data-group={g.id} data-undecided={decision == null || undefined} className={ITEM}>
      <p className="text-sm font-semibold">{rowsSaid(g.rows)} · «כפולה»</p>
      <div className="mb-1 text-sm text-ink-soft">
        {rs.map((r) => (
          <p key={r.row} className="break-words">
            {r.speakerKeys.map((k) => read.speakers.find((s) => s.key === k)?.name ?? k).join(" + ") || "בלי מרצה"}
            {r.title ? ` · ${r.title}` : ""}
          </p>
        ))}
      </div>
      <fieldset className="min-w-0">
        <legend className="sr-only">{rowsSaid(g.rows)}: מה הן?</legend>
        <div className="flex flex-wrap gap-1.5">
          {(["parallel", "merge"] as const).map((d) => (
            <label key={d} className={`${CHOICE} ${decision === d ? CHOICE_ON : CHOICE_OFF}`}>
              <input type="radio" name={`${id}-${g.id}`} checked={decision === d} onChange={() => onDecide(d)} className="accent-navy" />
              {d === "parallel" ? (one ? "שיעור במשבצת אחת" : "מקבילים — כל שורה בחדר משלה") : one ? "שיעור כפול — שתי משבצות" : "שיעור אחד מאוחד"}
            </label>
          ))}
        </div>
      </fieldset>
    </li>
  );
}

function TopicsList({ read, categories, value, onChange }: { read: TrackingRead; categories: Category[]; value: Map<string, number | null>; onChange: (k: string, v: number | null) => void }) {
  const id = useId();
  return (
    <>
      <p className="mb-2 text-sm text-ink-soft">קטגוריה באותו שם מוצעת; אחרת בלי קטגוריה.</p>
      <ul aria-label="נושאים" className="grid gap-2 sm:grid-cols-2">
        {topicsOf(read).map((t) => (
          <li key={t.key} className="min-w-0">
            <label htmlFor={`${id}-${t.key}`} className="mb-0.5 block text-sm font-semibold break-words">
              {t.text} <span className="font-normal text-ink-soft">({t.count})</span>
            </label>
            <select id={`${id}-${t.key}`} value={value.get(t.key) ?? ""} onChange={(e) => onChange(t.key, e.target.value ? Number(e.target.value) : null)} className={INPUT}>
              <option value="">בלי קטגוריה</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </>
  );
}

function SourcesList({ read, value, onChange }: { read: TrackingRead; value: Map<string, SourcesRule>; onChange: (k: string, v: SourcesRule) => void }) {
  const id = useId();
  return (
    <>
      <p className="mb-2 text-sm text-ink-soft">מה שנכתב ב«מקורות» ← מקורות השיעור. כל תרגום ניתן לשינוי.</p>
      <ul aria-label="ערכי המקורות" className="space-y-2">
        {sourcesValuesOf(read).map((v) => {
          const rule = value.get(v.key) ?? { kind: "pending" as const, print: "none" as const };
          const k = sourcesKey(v.text);
          const origin = !k ? "תא ריק: טרם התקבלו" : DESIGN_SOURCES[k] ? null : SUGGESTED_SOURCES[k] ? "הצעה" : "לא מוכר — המילים נשמרות בהערת המקורות";
          // a phone or an e-mail in the words: taken out of the note (scrubContacts) — said before the commit
          const contact = scrubContacts(v.text).scrubbed;
          return (
            <li key={v.key} className={ITEM}>
              <p className="text-sm font-semibold break-words">
                «{v.text || "ריק"}» <span className="font-normal text-ink-soft">({v.count})</span> {origin && <Badge tone={origin === "הצעה" ? "accent" : "muted"}>{origin}</Badge>}{" "}
                {contact && <Badge tone="bad">יש כאן טלפון או מייל — לא יישמרו</Badge>}
              </p>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${id}-${v.key}-k`} className="sr-only">
                    המקורות של «{v.text || "ריק"}»
                  </label>
                  <select id={`${id}-${v.key}-k`} value={rule.kind} onChange={(e) => onChange(v.key, { ...rule, kind: e.target.value as SourcesKind })} className={INPUT}>
                    {(Object.keys(SOURCES_LABEL) as SourcesKind[]).map((s) => (
                      <option key={s} value={s}>
                        {SOURCES_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${id}-${v.key}-p`} className="sr-only">
                    ההדפסה של «{v.text || "ריק"}»
                  </label>
                  <select id={`${id}-${v.key}-p`} value={rule.print} onChange={(e) => onChange(v.key, { ...rule, print: e.target.value as PrintWhen })} className={INPUT}>
                    {(Object.keys(PRINT_WHEN_LABEL) as PrintWhen[]).map((p) => (
                      <option key={p} value={p}>
                        {PRINT_WHEN_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function SpeakerCard({
  r,
  pool,
  choice,
  open,
  onChoose,
  postPhones,
  titles,
  escorts,
  lines,
  skipped,
  onLine,
  onEdit,
  focusEdit,
  box,
}: {
  r: TrackingSpeakerPreview;
  pool: MatchContext;
  choice: Choice | undefined;
  open: boolean;
  onChoose: (c: Choice | null) => void;
  postPhones: ReadonlyMap<string, { value: string; key: string | null; row: number }>;
  titles: readonly string[];
  escorts: readonly string[];
  lines: ExtraLine[];
  skipped: ReadonlySet<number>;
  onLine: (id: string, as: LineAs, byKeyboard: boolean) => void;
  onEdit: (e: SpeakerEdit | null, byKeyboard: boolean) => void;
  focusEdit: "scroll" | "still" | null;
  box: boolean;
}) {
  const s = r.speaker;
  const name = `${s.title ? `${s.title} ` : ""}${s.name}`;
  // the phone it gets only after the choices (a row of two, one left): shown, and whose in the pool it already is
  const post = s.phone ? undefined : postPhones.get(s.key);
  const target = actionOf(r.status, r.match, choice);
  const owners = post?.key ? (pool.phones.get(post.key) ?? []).filter((id) => !(target?.action === "merge" && target.target === id)) : [];
  const owner = owners.length ? pool.pool.find((x) => x.id === owners[0]) : undefined;
  return (
    <li data-speaker={s.from[0]} data-undecided={open || undefined} className={box ? BOX : "py-2"}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1 font-bold text-navy break-words">{name}</span>
        <span className="text-sm text-ink-soft">{rowsSaid(s.rows)}</span>
        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
      </div>
      <Facts
        items={[
          genderSaid(s.gender),
          s.affiliation && `שיוך מוסדי: ${s.affiliation}`,
          s.phone && "יש טלפון",
          post && `יש טלפון (משורה ${post.row}, אחרי הבחירות)`,
          s.email && "יש מייל",
        ]}
      />
      {owner && <p className="text-sm text-bad">הטלפון משורה {post!.row} כבר במאגר אצל {owner.title ? `${owner.title} ` : ""}{owner.name} — לבדוק שזה אותו אדם.</p>}
      {s.nameWarning && <p className="text-sm text-bad">{s.nameWarning}</p>}
      <Editable
        fields={{ title: s.title, name: s.name, affiliation: s.affiliation }}
        edited={s.edited}
        titles={titles}
        escorts={escorts}
        lines={lines.filter((l) => s.lines.includes(l.id) && !skipped.has(l.row))}
        onLine={onLine}
        onEdit={onEdit}
        focusEdit={focusEdit}
      />
      <SpeakerDecision
        name={name}
        status={r.status}
        match={r.match}
        fill={{ title: s.title, gender: s.gender, affiliation: s.affiliation, topics: [], phone: s.phone ?? post?.value ?? null, email: s.email, notes: null }}
        pool={pool}
        choice={choice}
        onChoose={onChoose}
        blocked={choice?.action === "same" && open ? "המרצה ההוא/ההיא לא מיובא/ת (או עוד מחכה להחלטה) — בוחרים אחרת." : null}
      />
    </li>
  );
}

function LessonsList({ plans, categories, speakers, choices }: { plans: LessonPlan[]; categories: Category[]; speakers: TrackingSpeakerPreview[]; choices: Map<string, Choice> }) {
  const nameOf = (k: string) => {
    const s = speakers.find((x) => x.speaker.key === k)?.speaker;
    return s ? `${s.title ? `${s.title} ` : ""}${s.name}` : k;
  };
  const skippedSpeaker = (k: string) => {
    const s = speakers.find((x) => x.speaker.key === k);
    return !!s && actionOf(s.status, s.match, choices.get(k))?.action === "skip";
  };
  return (
    <ul aria-label="השיעורים" className="divide-y divide-sage/60 border-y border-sage/60">
      {plans.map((p) => {
        const gone = !p.skip && p.speakerKeys.every(skippedSpeaker);
        const status: RowStatus = p.skip || gone ? "skip" : "new";
        return (
          <li key={p.rows.join(",")} className="py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm text-ink-soft">{rowsSaid(p.rows)}</span>
              <span className="min-w-0 flex-1 font-bold text-navy break-words">{p.title ?? "בלי כותרת"}</span>
              <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>
            </div>
            {p.skip ? (
              <p className="text-sm text-ink-soft">{p.skip}</p>
            ) : (
              <>
                <p className="text-sm">
                  {dayLabel(p.day, p.start_min)} <bdi dir="ltr">{fmtRange(p.start_min, p.end_min)}</bdi>
                  {p.start_min >= 1440 && p.day < 4 && (
                    <>
                      {" "}
                      <Badge tone="accent">הצעה: לילה אחרי היום שנכתב</Badge>
                    </>
                  )}
                  {p.rangeSuggested && (
                    <>
                      {" "}
                      <Badge tone="accent">הצעה: {p.rangeSlots === 2 || p.rangeSlots == null ? "שתי משבצות" : `${p.rangeSlots} משבצות`}</Badge>
                    </>
                  )}{" "}
                  · {p.room === 0 ? ARCHIVE_ROOM : parallelRoomName(p.room)} · {p.speakerKeys.map((k) => nameOf(k) + (skippedSpeaker(k) ? " (דולג/ה)" : "")).join(" + ")}
                </p>
                <Facts
                  items={[
                    p.category_id != null ? categories.find((c) => c.id === p.category_id)?.name : "בלי קטגוריה",
                    p.audience,
                    p.print_when === "none" ? SOURCES_LABEL[p.sources_kind] : `${SOURCES_LABEL[p.sources_kind]}, ${PRINT_WHEN_LABEL[p.print_when]}`,
                    p.sources_note && `«${p.sources_note}»`,
                    p.pay_amount != null && `תשלום ${p.pay_amount} ₪`,
                  ]}
                />
                {gone && <p className="text-sm text-ink-soft">כל המרצים שלו דולגו — לא ייובא.</p>}
                {p.import_note && <p className="mt-0.5 rounded bg-sand-soft px-2 py-1 text-sm whitespace-pre-line break-words">{p.import_note}</p>}
              </>
            )}
            <Warnings items={p.warnings} />
          </li>
        );
      })}
    </ul>
  );
}

/** «שם המחזור בארכיון» in «צריך להחליט»: the field itself is beside the columns (it is asked before the check). */
export interface LabelItem {
  /** Its id: «לראשונה שמחכה להחלטה» and «כתיבת השם» go to it. */
  fieldId: string;
  text: string;
  /** What is wrong with it (it holds «ייבוא» back), or null. */
  problem: string | null;
}

export function TrackingReview({
  read,
  groups,
  decisions,
  onDecide,
  categories,
  topics,
  onTopic,
  sources,
  onSource,
  sourcesMapped,
  plans,
  speakers,
  pool,
  choices,
  resolved,
  onChoose,
  postPhones,
  titles,
  escorts,
  lines,
  skipped,
  onLine,
  onEdit,
  decide,
  counts,
  label,
}: {
  read: TrackingRead;
  groups: DoubleGroup[];
  decisions: Map<number, GroupDecision>;
  onDecide: (g: number, d: GroupDecision) => void;
  categories: Category[];
  topics: Map<string, number | null>;
  onTopic: (k: string, v: number | null) => void;
  sources: Map<string, SourcesRule>;
  onSource: (k: string, v: SourcesRule) => void;
  /** A column is read as «מקורות»: only then are its values shown (without one, every lesson's is the empty cell's). */
  sourcesMapped: boolean;
  /** null while a «כפולה» group waits. */
  plans: LessonPlan[] | null;
  speakers: TrackingSpeakerPreview[];
  pool: MatchContext;
  choices: Map<string, Choice>;
  /** Each speaker's action as the commit takes it (null: undecided). */
  resolved: Map<string, Resolved | null>;
  onChoose: (key: string, c: Choice | null) => void;
  /** A row's phone the admin's choices give a speaker (phonesAfterChoices) — what the payload will send. */
  postPhones: ReadonlyMap<string, { value: string; key: string | null; row: number }>;
  titles: readonly string[];
  escorts: readonly string[];
  /** The sheet's lines (a speaker's names beside or under another are turned in its «עריכה» too). */
  lines: ExtraLine[];
  /** Rows left out anyway: their lines wait for nothing, so a card's form does not offer them. */
  skipped: ReadonlySet<number>;
  onLine: (id: string, as: LineAs) => void;
  /** «עריכה» of a speaker (by its keys as read; null: back to what was read). */
  onEdit: (from: string[], e: SpeakerEdit | null) => void;
  /** «צריך להחליט»: the check's set — «g:<group>», «l:<line id>», «sp:<a card's first key as read>», «label». */
  decide: ReadonlySet<string>;
  counts: DecideCounts;
  label: LabelItem;
}) {
  // an «עריכה» saved changes the card's key (a new card), or merges it into another card's name: the card that had the
  // focus goes, and it goes on at the «עריכה» of the card that now holds its first key as read — in «צריך להחליט» or
  // in the fold, however it was saved (a screen reader's action is a click), but the page scrolls to it only from the
  // keyboard: a click or a tap leaves the page where it was
  const [focus, setFocus] = useState<{ key: string; scroll: boolean } | null>(null);
  // delivered once: the cards' effects run before this one, and a card that mounts again later takes nothing
  useEffect(() => {
    if (focus != null) setFocus(null);
  }, [focus]);
  // a card's form holds only the lines it is a speaker by, so any choice there takes the line (and the radio) out of the
  // card, often the card itself: the keyboard goes on at the same choice of the same line where it is listed («צריך
  // להחליט», or the fold «שמות נוספים בתאים» — opened for it), which stays (and the arrows go on from there). Only from
  // the keyboard: a radio focused out of sight would turn a mouse user's arrow keys into choices made unseen
  const [lineFocus, setLineFocus] = useState<{ id: string; as: LineAs } | null>(null);
  useEffect(() => {
    if (!lineFocus) return;
    const el = document.querySelector<HTMLInputElement>(`li[data-line="${lineFocus.id}"] input[value="${lineFocus.as}"]`);
    const fold = el?.closest("details");
    if (fold && !fold.open) fold.open = true;
    el?.focus();
  }, [lineFocus]);

  // a card is where its first key as read was: an «עריכה» that merges two cards keeps the one of the earlier row in place
  const inDecide = (s: TrackingSpeakerPreview) => decide.has(`sp:${s.speaker.from[0]}`);
  const open = (s: TrackingSpeakerPreview) => resolved.get(s.speaker.key) == null;
  const cards = speakers.filter(inDecide);
  const rest = speakers.filter((s) => !inDecide(s));
  const groupItems = groups.filter((g) => decide.has(`g:${g.id}`));
  const groupRest = groups.filter((g) => !decide.has(`g:${g.id}`));
  const lineItems = lines.filter((l) => decide.has(`l:${l.id}`));
  const lineRest = lines.filter((l) => !decide.has(`l:${l.id}`));
  const withLabel = decide.has("label");
  const kept = plans?.filter((p) => !p.skip).length ?? 0;
  const card = (r: TrackingSpeakerPreview, box: boolean) => {
    const s = r.speaker;
    return (
      <SpeakerCard
        key={s.key}
        r={r}
        pool={pool}
        choice={choices.get(s.key)}
        open={open(r)}
        onChoose={(x) => onChoose(s.key, x)}
        postPhones={postPhones}
        titles={titles}
        escorts={escorts}
        lines={lines}
        skipped={skipped}
        onLine={(id, as, byKeyboard) => {
          onLine(id, as);
          if (byKeyboard) setLineFocus({ id, as });
        }}
        onEdit={(e, byKeyboard) => {
          onEdit(s.from, e);
          setFocus({ key: s.from[0], scroll: byKeyboard });
        }}
        focusEdit={focus && s.from.includes(focus.key) ? (focus.scroll ? "scroll" : "still") : null}
        box={box}
      />
    );
  };
  const topicCount = topicsOf(read).length;
  const sourceCount = sourcesMapped ? sourcesValuesOf(read).length : 0;
  return (
    <>
      <DecideList counts={counts} empty={groupItems.length + lineItems.length + cards.length === 0 && !withLabel}>
        {groupItems.map((g) => (
          <GroupItem key={g.id} g={g} read={read} decision={decisions.get(g.id)} onDecide={(d) => onDecide(g.id, d)} />
        ))}
        {lineItems.map((l) => (
          <LineItem key={l.id} line={l} gone={skipped.has(l.row)} onChoose={(as) => onLine(l.id, as)} />
        ))}
        {cards.map((r) => card(r, true))}
        {withLabel && (
          <li data-undecided={!!label.problem || undefined} data-goto={label.fieldId} className={ITEM}>
            <p className="text-sm font-semibold">שם המחזור בארכיון</p>
            <p className={`text-sm break-words ${label.problem ? "text-bad" : "text-ink-soft"}`}>{label.problem ?? `«${label.text}»`}</p>
            <Button kind="quiet" onClick={() => document.getElementById(label.fieldId)?.focus()}>
              {label.text ? "שינוי השם" : "כתיבת השם"}
            </Button>
          </li>
        )}
      </DecideList>
      <Rest>
        {rest.length > 0 && (
          <SpeakersFold some={cards.length > 0} statuses={rest.map((r) => r.status)}>
            {rest.map((r) => card(r, false))}
          </SpeakersFold>
        )}
        <Fold title={plans ? `כל השיעורים (${plans.length})` : "כל השיעורים"} hint={plans ? `${kept === 1 ? "שיעור אחד לייבוא" : `${kept} לייבוא`} · ${plans.length - kept === 1 ? "מדולג אחד" : `${plans.length - kept} מדולגים`}` : "אחרי ההחלטה על «כפולה»"}>
          <p className="mb-2 text-sm text-ink-soft">
            שעה לפני 06:30 שייכת ללילה שאחרי היום שנכתב («שלישי 00:30» ← ליל שלישי–רביעי) <Badge tone="accent">הצעה</Badge>
          </p>
          {groupRest.length > 0 && (
            <ul aria-label="קבוצות כפולה" className="mb-2 space-y-2">
              {groupRest.map((g) => (
                <GroupItem key={g.id} g={g} read={read} decision={decisions.get(g.id)} onDecide={(d) => onDecide(g.id, d)} />
              ))}
            </ul>
          )}
          {plans ? <LessonsList plans={plans} categories={categories} speakers={speakers} choices={choices} /> : <p className="text-sm text-ink-soft">אחרי ההחלטה על כל קבוצות «כפולה» יופיעו כאן השיעורים.</p>}
        </Fold>
        {topicCount > 0 && (
          <Fold title={`נושא ← קטגוריה (${topicCount})`}>
            <TopicsList read={read} categories={categories} value={topics} onChange={onTopic} />
          </Fold>
        )}
        {sourceCount > 0 && (
          <Fold title={`מקורות (${sourceCount})`}>
            <SourcesList read={read} value={sources} onChange={onSource} />
          </Fold>
        )}
        {lineRest.length > 0 && <LinesFold lines={lineRest} skipped={skipped} onChoose={onLine} />}
      </Rest>
    </>
  );
}

// ------------------------------------------------------------------ a speaker cell's other names

/** «לא לייבא» says what is left out — only the line, the name, the brackets or the part: the speaker stays. */
const SKIP_LABEL: Record<LineKind, string> = {
  under: "לא לייבא את השורה",
  beside: "לא לייבא את השם הזה",
  bracket: "לא לייבא את הסוגריים (המרצה נשאר/ת)",
  tail: "לא לייבא את החלק הזה (המרצה נשאר/ת)",
};
const LINE_AS_LABEL: Record<LineAs, (l: ExtraLine) => string> = {
  speaker: () => "מרצה נוסף/ת",
  affiliation: (l) => `שיוך מוסדי של ${l.ofName}`,
  skip: (l) => SKIP_LABEL[l.kind],
};

/**
 * A line's three choices. byKeyboard: a key pressed in the group since the last pointer — the arrows' keydown comes before
 * the change they make (every engine; «:focus-visible» is not set on an arrow-focused radio in Safari).
 */
function LineChoice({
  line: l,
  onChoose,
  legend,
  disabled = false,
}: {
  line: ExtraLine;
  onChoose: (as: LineAs, byKeyboard: boolean) => void;
  legend: string;
  disabled?: boolean;
}) {
  const id = useId();
  const keyed = useRef(false);
  return (
    <fieldset
      className="mt-1 min-w-0"
      disabled={disabled}
      onKeyDown={() => (keyed.current = true)}
      onPointerDown={() => (keyed.current = false)}
    >
      <legend className="sr-only">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {(["speaker", "affiliation", "skip"] as const).map((as) => (
          <label key={as} className={`${CHOICE} ${l.as === as ? CHOICE_ON : CHOICE_OFF}`}>
            <input type="radio" name={`${id}-${l.id}`} value={as} checked={l.as === as} onChange={() => onChoose(as, keyed.current)} className="accent-navy" />
            {LINE_AS_LABEL[as](l)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * A speaker cell's other name (a line under the first, a name beside it, a bracket at the end of a name, what follows
 * «, », « - » or «והרב…»): «מרצה נוסף/ת», «שיוך מוסדי» or «לא לייבא» — the read proposes («הצעה») an institution's
 * affiliation, an escort's «לא לייבא» (the whole line one escort's name, or a word about one), and in the tracking sheet
 * a co-speaker for a name beside the first; any other waits for the admin — a line that only shares a word with an
 * escort's name too, said in red. A line of a row left out anyway (`gone`) waits for nothing.
 */
function LineItem({ line: l, gone = false, onChoose }: { line: ExtraLine; gone?: boolean; onChoose: (as: LineAs) => void }) {
  const open = l.as == null && !gone;
  return (
    <li data-line={l.id} data-undecided={open || undefined} className={ITEM}>
      <p className="text-sm break-words">
        <span className="text-ink-soft">שורה {l.row}:</span> <b>{l.ofName}</b> / <b>{l.text}</b>{" "}
        {gone ? (
          <span className="text-ink-soft">(השורה מדולגת — אין צורך להחליט)</span>
        ) : l.as == null ? (
          <>
            <Badge tone="bad">צריך לבחור</Badge> <span className={l.held ? "text-bad" : "text-ink-soft"}>({l.why})</span>
          </>
        ) : (
          !l.chosen && <Badge tone="accent">הצעה: {l.why}</Badge>
        )}
        {l.held && l.as != null && l.as !== "skip" && <span className="text-bad"> — {l.why}</span>}
      </p>
      <LineChoice line={l} onChoose={(as) => onChoose(as)} legend={`«${l.text}» — מה זה?`} disabled={gone} />
    </li>
  );
}

/** «שמות נוספים בתאים»: the lines already decided (proposed, or of a row left out). */
function LinesFold({ lines, skipped = new Set(), onChoose }: { lines: ExtraLine[]; skipped?: ReadonlySet<number>; onChoose: (id: string, as: LineAs) => void }) {
  return (
    <Fold title={`שמות נוספים בתאים (${lines.length})`}>
      <p className="mb-2 text-sm text-ink-soft">מה שהופרד משם המרצה (שורה מתחתיו, סוגריים, «, » או « - »): מרצה נוסף/ת, שיוך מוסדי או לא לייבא. השם נבדק בלעדיו.</p>
      <ul aria-label="שמות נוספים בתא המרצה" className="space-y-2">
        {lines.map((l) => (
          <LineItem key={l.id} line={l} gone={skipped.has(l.row)} onChoose={(as) => onChoose(l.id, as)} />
        ))}
      </ul>
    </Fold>
  );
}

// ------------------------------------------------------------------ (c) the escorts' file

/** The file's phrases about a speaker, read-only — the reason for the channel proposed; none of them is saved. */
function PhrasesShown({ phrases }: { phrases: ShownPhrase[] }) {
  if (phrases.length === 0) return null;
  return (
    <div className="mt-1 text-sm">
      <p className="text-ink-soft">בקובץ (לא נשמר):</p>
      <ul aria-label="הניסוחים בקובץ" className="ps-3 text-ink-soft">
        {phrases.map((p) => (
          <li key={p.text} className="break-words">
            «{p.text}»{p.channel && !p.money ? ` — ${CONTACT_PREF_LABEL[p.channel]}` : ""}
            {p.money && " — תשלום או הסעה (נגזרים מהשיעור)"}
            {p.escort && <span className="text-bad"> — יש כאן שם של מלווה («{p.escort}»)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Waits: an «עמום» whose answer saves something, with no choice yet — or a note to fix. */
const escortWaits = (r: EscortsRowPreview, a: EscortAnswer | undefined, chosen: boolean) =>
  (r.status === "ambiguous" && !!answerSaves(a) && !chosen) || (r.status !== "skip" && !!a?.channel && !!noteProblem(a.note));

/**
 * One speaker of the escorts' file: the file's phrases (shown), the channel — chosen from the list, the phrases'
 * «הצעה» first — and a note the admin may type (empty; never the file's words). Only those two are sent.
 */
function EscortCard({
  r,
  pool,
  names,
  choice,
  onChoose,
  answer: a,
  onAnswer,
  box,
}: {
  r: EscortsRowPreview;
  pool: MatchContext;
  names: readonly string[];
  choice: Choice | undefined;
  onChoose: (c: Choice | null) => void;
  answer: EscortAnswer | undefined;
  onAnswer: (a: EscortAnswer) => void;
  box: boolean;
}) {
  const id = useId();
  const channel = a?.channel ?? null;
  const note = a?.note ?? "";
  const saves = answerSaves(a);
  const problem = channel ? noteProblem(note) : null;
  const noteEscort = channel && note ? namedEscort(note, names) : null;
  const fills = r.target ? escortFills(r.target, pool.flags.get(r.target.id), a) : [];
  const set = (patch: Partial<EscortAnswer>) => onAnswer({ channel, note, ...patch });
  return (
    <li data-escort={r.key} data-undecided={escortWaits(r, a, choice != null) || undefined} className={box ? BOX : "py-2"}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1 font-bold text-navy break-words">{r.name || "—"}</span>
        <span className="text-sm text-ink-soft">{rowsSaid(r.rows)}</span>
        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
      </div>
      {r.reason && <p className="text-sm text-ink-soft">{r.reason}</p>}
      {r.status !== "skip" && (
        <>
          <PhrasesShown phrases={r.phrases} />
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor={`${id}-c`} className="mb-0.5 block text-sm font-semibold">
                ערוץ הקשר {channel != null && channel === r.suggested && <Badge tone="accent">הצעה</Badge>}
              </label>
              <select id={`${id}-c`} value={channel ?? ""} onChange={(e) => set({ channel: (e.target.value || null) as ImportChannel | null })} className={INPUT}>
                <option value="">לא לשמור ערוץ</option>
                {IMPORT_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-n`} className="mb-0.5 block text-sm font-semibold">
                הערה משלך (לא חובה)
              </label>
              <input
                id={`${id}-n`}
                value={note}
                maxLength={LIMITS.secretary_note}
                disabled={channel == null}
                placeholder={channel === "other" ? "איך פונים — במילים שלך" : ""}
                onChange={(e) => set({ note: e.target.value })}
                data-decide={!!problem || undefined}
                aria-describedby={problem || noteEscort ? `${id}-w` : undefined}
                className={INPUT}
              />
            </div>
          </div>
          {(problem || noteEscort) && (
            <p id={`${id}-w`} className="mt-0.5 text-sm text-bad">
              {problem ?? `יש בהערה שם של מלווה («${noteEscort}») — ההערה נשמרת כפי שנכתבה; כדאי למחוק אותו.`}
            </p>
          )}
          {!saves && <p className="mt-0.5 text-sm text-ink-soft">{channel === "other" ? "«אחר» בלי הערה — לא יישמר דבר." : "לא יישמר דבר למרצה הזה."}</p>}
          {saves && r.status === "match" && <p className="mt-0.5 text-sm text-ink-soft">{fills.length ? `יושלם (רק מה שחסר): ${fills.join(", ")}` : "אין מה להשלים — שום דבר לא נדרס."}</p>}
          {saves && r.status === "ambiguous" && r.match && (
            // the speaker chosen: what the answer will fill there (only what is missing) — as a match says it
            <SpeakerDecision name={r.name} status={r.status} match={r.match} fill={escortFill(a)} pool={pool} choice={choice} onChoose={onChoose} />
          )}
        </>
      )}
      <Warnings items={r.warnings} />
    </li>
  );
}

/** The escorts' file: the speakers that wait first, the rest (each with its channel, its «הצעה» chosen) in a fold. */
export function EscortsReview({
  rows,
  pool,
  names,
  choices,
  onChoose,
  answers,
  onAnswer,
  decide,
  counts,
}: {
  rows: EscortsRowPreview[];
  pool: MatchContext;
  /** The escorts' names (the file's column, the rosters): said beside a phrase or a note that holds one. */
  names: readonly string[];
  choices: Map<string, Choice>;
  onChoose: (key: string, c: Choice | null) => void;
  answers: Map<string, EscortAnswer>;
  onAnswer: (key: string, a: EscortAnswer) => void;
  /** «צריך להחליט»: the check's set — «esc:<key>». */
  decide: ReadonlySet<string>;
  counts: DecideCounts;
}) {
  const inDecide = (r: EscortsRowPreview) => decide.has(`esc:${r.key}`);
  const cards = rows.filter(inDecide);
  const rest = rows.filter((r) => !inDecide(r));
  const card = (r: EscortsRowPreview, box: boolean) => (
    <EscortCard
      key={`${r.key}-${r.rows[0]}`}
      r={r}
      pool={pool}
      names={names}
      choice={choices.get(r.key)}
      onChoose={(c) => onChoose(r.key, c)}
      answer={answers.get(r.key)}
      onAnswer={(a) => onAnswer(r.key, a)}
      box={box}
    />
  );
  return (
    <>
      <p className="mb-3 text-sm text-ink-soft">
        לכל מרצה נשמרים רק ערוץ הקשר שבוחרים (<Badge tone="accent">הצעה</Badge> לפי הקובץ) והערה משלך, ורק במה שעוד ריק — שום ניסוח מהקובץ.
      </p>
      <DecideList counts={counts} empty={cards.length === 0}>
        {cards.map((r) => card(r, true))}
      </DecideList>
      <Rest>
        {rest.length > 0 && (
          <SpeakersFold some={cards.length > 0} statuses={rest.map((r) => r.status)}>
            {rest.map((r) => card(r, false))}
          </SpeakersFold>
        )}
      </Rest>
    </>
  );
}
