// The import wizard's review and preview (src/screens/settings/ImportTab.tsx): the «כפולה» groups, topics →
// categories, the sources' words, the escorts' phrases, and the preview «חדש · תואם · עמום · מדולג» — a choice for
// every «עמום», and what a match would fill. Lists, one card per row, the same at every width.
import { useId } from "react";
import { fmtRange } from "../../domain/time";
import { dayLabel } from "../../reader/model";
import { PRINT_WHEN_LABEL, SOURCES_LABEL } from "../../domain/stages";
import type { Category, PrintWhen, SourcesKind } from "../../domain/types";
import { CONTACT_PREF_LABEL } from "../../lib/labels";
import type { CandidatePreview, MatchContext } from "../../import/candidates";
import type { EscortsPreview as EscortsRowPreview, Phrase } from "../../import/escorts";
import { actionOf, type Choice, fillPlan, type Resolved, type RowStatus, type SpeakerFill, type SpeakerMatch } from "../../import/match";
import { DESIGN_SOURCES, sourcesKey, type SourcesRule, SUGGESTED_SOURCES } from "../../import/sources";
import { ARCHIVE_ROOM, parallelRoomName } from "../../data/importRules";
import { scrubContacts } from "../../import/phone";
import type { DoubleGroup, GroupDecision, LessonPlan, TrackingRead, TrackingSpeakerPreview } from "../../import/tracking";
import { sourcesValuesOf, topicsOf } from "../../import/tracking";
import { Badge, INPUT, Panel } from "./kit";

export const STATUS: Record<RowStatus, { label: string; tone: "ok" | "accent" | "bad" | "muted" }> = {
  new: { label: "חדש", tone: "ok" },
  match: { label: "תואם", tone: "accent" },
  ambiguous: { label: "עמום", tone: "bad" },
  skip: { label: "מדולג", tone: "muted" },
};

/** «3 חדש · 2 תואם · 1 עמום · 4 מדולג». */
function Counts({ statuses }: { statuses: RowStatus[] }) {
  const n = (s: RowStatus) => statuses.filter((x) => x === s).length;
  return (
    <p className="mb-2 flex flex-wrap gap-1.5 text-sm" aria-label="סיכום">
      {(["new", "match", "ambiguous", "skip"] as const).map((s) => (
        <Badge key={s} tone={STATUS[s].tone}>
          {n(s)} {STATUS[s].label}
        </Badge>
      ))}
    </p>
  );
}

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
        <fieldset className="min-w-0 rounded-lg border border-line bg-paper p-2">
          <legend className="px-1 font-semibold">
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
                <input type="radio" name={`${id}-who`} checked={choice?.action === "same" && choice.ref === c.ref} onChange={() => onChoose({ action: "same", ref: c.ref })} className="accent-ink" />
                אותו/ה מרצה כמו {c.label}
                <span className="text-ink-soft">{c.via === "phone" ? "(אותו טלפון)" : `(דמיון ${c.similarity?.toFixed(2)})`}</span>
              </label>
            ))}
            {match.candidates.map((c) => (
              <label key={c.id} className="inline-flex min-h-11 cursor-pointer items-center gap-2">
                <input type="radio" name={`${id}-who`} checked={choice?.action === "merge" && choice.target === c.id} onChange={() => onChoose({ action: "merge", target: c.id })} className="accent-ink" />
                להשלים את {c.label}
                {c.similarity != null && <span className="text-ink-soft">(דמיון {c.similarity.toFixed(2)})</span>}
              </label>
            ))}
            {match.allowNew && (
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
                <input type="radio" name={`${id}-who`} checked={choice?.action === "new"} onChange={() => onChoose({ action: "new" })} className="accent-ink" />
                {name} — מרצה חדש/ה{sheet.some((c) => c.via === "phone") ? " (גם אם הטלפון משותף — למשל זוג או משרד)" : ""}
              </label>
            )}
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
              <input type="radio" name={`${id}-who`} checked={choice?.action === "skip"} onChange={() => onChoose({ action: "skip" })} className="accent-ink" />
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
          <input type="checkbox" checked={choice?.action === "skip"} onChange={(e) => onChoose(e.target.checked ? { action: "skip" } : null)} className="size-5 accent-ink" />
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

// ------------------------------------------------------------------ (a) the candidates

export function CandidatesPreview({
  rows,
  pool,
  choices,
  resolved,
  onChoose,
}: {
  rows: CandidatePreview[];
  pool: MatchContext;
  choices: Map<string, Choice>;
  /** Each row's action as the commit takes it (null: undecided). */
  resolved: Map<number, Resolved | null>;
  onChoose: (key: string, c: Choice | null) => void;
}) {
  return (
    <Panel title="תצוגה מקדימה">
      <Counts statuses={rows.map((r) => r.status)} />
      <ul aria-label="תצוגה מקדימה" className="divide-y divide-line border-y border-line">
        {rows.map((r) => {
          const d = r.data;
          const name = d ? `${d.title ? `${d.title} ` : ""}${d.name}` : "—";
          const c = choices.get(String(r.row));
          const open = !!d && resolved.get(r.row) == null;
          return (
            <li key={r.row} data-row={r.row} data-undecided={open || undefined} className="py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm text-ink-soft">שורה {r.row}</span>
                <span className="min-w-0 flex-1 font-semibold break-words">{name}</span>
                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
              </div>
              {r.skip && <p className="text-sm text-ink-soft">{r.skip}</p>}
              {d && (
                <>
                  <Facts items={[genderSaid(d.gender), d.affiliation, d.topics.join(", "), d.phone && "יש טלפון", d.email && "יש מייל", d.notes && "יש הערות"]} />
                  <SpeakerDecision
                    name={name}
                    status={r.status}
                    match={r.match}
                    fill={d}
                    pool={pool}
                    choice={c}
                    onChoose={(x) => onChoose(String(r.row), x)}
                    blocked={c?.action === "same" && open ? `שורה ${c.ref} לא מיובאת (או עוד מחכה להחלטה) — בוחרים אחרת.` : null}
                  />
                </>
              )}
              <Warnings items={r.warnings} />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ------------------------------------------------------------------ (b) the tracking sheet

export function DoubleGroups({ groups, read, decisions, onDecide }: { groups: DoubleGroup[]; read: TrackingRead; decisions: Map<number, GroupDecision>; onDecide: (g: number, d: GroupDecision) => void }) {
  const id = useId();
  return (
    <Panel title="שורות «כפולה»" aside="המדריך/ה מכריע/ה לכל קבוצה">
      <ul aria-label="קבוצות כפולה" className="space-y-2">
        {groups.map((g) => {
          const rs = g.rows.map((n) => read.rows.find((r) => r.row === n)!);
          const one = g.rows.length === 1;
          return (
            <li key={g.id} data-undecided={!decisions.has(g.id) || undefined} className="rounded-lg border border-line bg-paper p-2.5">
              <p className="text-sm font-semibold">{rowsSaid(g.rows)}</p>
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
                    <label key={d} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 ${decisions.get(g.id) === d ? "border-ink bg-ink/5 font-semibold" : "border-line bg-card"}`}>
                      <input type="radio" name={`${id}-${g.id}`} checked={decisions.get(g.id) === d} onChange={() => onDecide(g.id, d)} className="accent-ink" />
                      {d === "parallel" ? (one ? "שיעור במשבצת אחת" : "מקבילים — כל שורה בחדר משלה") : one ? "שיעור כפול — שתי משבצות" : "שיעור אחד מאוחד"}
                    </label>
                  ))}
                </div>
              </fieldset>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function TopicsTable({ read, categories, value, onChange }: { read: TrackingRead; categories: Category[]; value: Map<string, number | null>; onChange: (k: string, v: number | null) => void }) {
  const id = useId();
  const topics = topicsOf(read);
  if (topics.length === 0) return null;
  return (
    <Panel title="נושא → קטגוריה" aside="קטגוריה באותו שם מוצעת; אחרת בלי קטגוריה">
      <ul aria-label="נושאים" className="grid gap-2 sm:grid-cols-2">
        {topics.map((t) => (
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
    </Panel>
  );
}

export function SourcesTable({ read, value, onChange }: { read: TrackingRead; value: Map<string, SourcesRule>; onChange: (k: string, v: SourcesRule) => void }) {
  const id = useId();
  const values = sourcesValuesOf(read);
  if (values.length === 0) return null;
  return (
    <Panel title="«מקורות (נשלח?)» → מקורות השיעור" aside="כל תרגום ניתן לשינוי">
      <ul aria-label="ערכי המקורות" className="space-y-2">
        {values.map((v) => {
          const rule = value.get(v.key) ?? { kind: "pending" as const, print: "none" as const };
          const k = sourcesKey(v.text);
          const origin = !k ? "תא ריק: טרם התקבלו" : DESIGN_SOURCES[k] ? null : SUGGESTED_SOURCES[k] ? "הצעה" : "לא מוכר — המילים נשמרות בהערת המקורות";
          // a phone or an e-mail in the words: taken out of the note (scrubContacts) — said before the commit
          const contact = scrubContacts(v.text).scrubbed;
          return (
            <li key={v.key} className="rounded-lg border border-line bg-paper p-2.5">
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
    </Panel>
  );
}

export function SpeakersPreview({
  rows,
  pool,
  choices,
  resolved,
  onChoose,
}: {
  rows: TrackingSpeakerPreview[];
  pool: MatchContext;
  choices: Map<string, Choice>;
  /** Each speaker's action as the commit takes it (null: undecided). */
  resolved: Map<string, Resolved | null>;
  onChoose: (key: string, c: Choice | null) => void;
}) {
  return (
    <Panel title="המרצים">
      <Counts statuses={rows.map((r) => r.status)} />
      <ul aria-label="המרצים בגיליון" className="divide-y divide-line border-y border-line">
        {rows.map((r) => {
          const s = r.speaker;
          const name = `${s.title ? `${s.title} ` : ""}${s.name}`;
          const c = choices.get(s.key);
          const open = resolved.get(s.key) == null;
          return (
            <li key={s.key} data-undecided={open || undefined} className="py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 flex-1 font-semibold break-words">{name}</span>
                <span className="text-sm text-ink-soft">{rowsSaid(s.rows)}</span>
                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
              </div>
              <Facts items={[genderSaid(s.gender), s.phone && "יש טלפון"]} />
              <SpeakerDecision
                name={name}
                status={r.status}
                match={r.match}
                fill={{ title: s.title, gender: s.gender, affiliation: null, topics: [], phone: s.phone, email: null, notes: null }}
                pool={pool}
                choice={c}
                onChoose={(x) => onChoose(s.key, x)}
                blocked={c?.action === "same" && open ? "המרצה ההוא/ההיא לא מיובא/ת (או עוד מחכה להחלטה) — בוחרים אחרת." : null}
              />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function LessonsPreview({ plans, categories, speakers, choices }: { plans: LessonPlan[]; categories: Category[]; speakers: TrackingSpeakerPreview[]; choices: Map<string, Choice> }) {
  const kept = plans.filter((p) => !p.skip);
  const nameOf = (k: string) => {
    const s = speakers.find((x) => x.speaker.key === k)?.speaker;
    return s ? `${s.title ? `${s.title} ` : ""}${s.name}` : k;
  };
  const skippedSpeaker = (k: string) => {
    const s = speakers.find((x) => x.speaker.key === k);
    return !!s && actionOf(s.status, s.match, choices.get(k))?.action === "skip";
  };
  return (
    <Panel title="השיעורים" aside={`${kept.length} לייבוא · ${plans.length - kept.length} מדולגים`}>
      <ul aria-label="השיעורים" className="divide-y divide-line border-y border-line">
        {plans.map((p) => {
          const gone = !p.skip && p.speakerKeys.every(skippedSpeaker);
          const status: RowStatus = p.skip || gone ? "skip" : "new";
          return (
            <li key={p.rows.join(",")} className="py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm text-ink-soft">{rowsSaid(p.rows)}</span>
                <span className="min-w-0 flex-1 font-semibold break-words">{p.title ?? "בלי כותרת"}</span>
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
                  {p.import_note && <p className="mt-0.5 rounded bg-line/40 px-2 py-1 text-sm whitespace-pre-line break-words">{p.import_note}</p>}
                </>
              )}
              <Warnings items={p.warnings} />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ------------------------------------------------------------------ (c) the escorts' file

export function PhrasesTable({ phrases, ticked, onToggle }: { phrases: Phrase[]; ticked: Set<string>; onToggle: (k: string) => void }) {
  const money = phrases.filter((p) => p.money);
  const rest = phrases.filter((p) => !p.money);
  return (
    <Panel title="ניסוחים" aside="נשמרים רק הניסוחים המסומנים — על ערוץ הקשר">
      <p className="mb-2 text-sm text-ink-soft">
        הסימון הראשון הוא <Badge tone="accent">הצעה</Badge>: ניסוח שמזכיר מזכירות, וואטסאפ, מייל או טלפון. ניסוחים על תשלום והסעה לא נשמרים — הם נגזרים מהשיעור.
      </p>
      <ul aria-label="ניסוחים" className="divide-y divide-line border-y border-line">
        {rest.map((p) => (
          <li key={p.key} className="py-1">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
              <input type="checkbox" checked={ticked.has(p.key)} onChange={() => onToggle(p.key)} className="size-5 accent-ink" />
              <span className="break-words">{p.text}</span>
              <span className="text-sm text-ink-soft">
                ({p.count}
                {p.channel ? ` · ${CONTACT_PREF_LABEL[p.channel]}` : ""})
              </span>
            </label>
          </li>
        ))}
      </ul>
      {money.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-sm font-semibold">תשלום והסעה — לא נשמרים</p>
          <ul aria-label="ניסוחים שלא נשמרים" className="text-sm text-ink-soft">
            {money.map((p) => (
              <li key={p.key} className="break-words">
                · {p.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

export function EscortsPreview({ rows, choices, onChoose }: { rows: EscortsRowPreview[]; choices: Map<string, Choice>; onChoose: (key: string, c: Choice | null) => void }) {
  return (
    <Panel title="תצוגה מקדימה">
      <Counts statuses={rows.map((r) => r.status)} />
      <ul aria-label="תצוגה מקדימה" className="divide-y divide-line border-y border-line">
        {rows.map((r) => (
          <li key={`${r.key}-${r.rows[0]}`} data-undecided={(r.status === "ambiguous" && !choices.has(r.key)) || undefined} className="py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 flex-1 font-semibold break-words">{r.name || "—"}</span>
              <span className="text-sm text-ink-soft">{rowsSaid(r.rows)}</span>
              <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
            </div>
            {r.reason && <p className="text-sm text-ink-soft">{r.reason}</p>}
            {r.status !== "skip" && (
              <>
                <Facts items={[r.contact_pref && `ערוץ: ${CONTACT_PREF_LABEL[r.contact_pref]}`, r.secretary_note && `«${r.secretary_note}»`]} />
                {r.status === "match" && <p className="text-sm text-ink-soft">{r.fills.length ? `יושלם (רק מה שחסר): ${r.fills.join(", ")}` : "אין מה להשלים — שום דבר לא נדרס."}</p>}
                {r.status === "ambiguous" && r.match && (
                  <SpeakerDecision name={r.name} status={r.status} match={r.match} fill={null} pool={null} choice={choices.get(r.key)} onChoose={(c) => onChoose(r.key, c)} />
                )}
              </>
            )}
            <Warnings items={r.warnings} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
