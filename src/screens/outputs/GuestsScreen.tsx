// «תוצרים ← אתר האורחים» (/export/guests, the reset, phase 5 — the edition's admins): what every closed lesson still lacks
// for the guests' schedule (guestRows — the lesson's description; per speaker the approval to appear, a description, a
// photo), each gap a link to where it is filled (the lesson page's or the speaker page's #guest), and a mark taken back
// in place. Filters live in the address (guestsPath / parseGuestsQuery). Opening the page reads the week only; the
// preview — «תצוגה מקדימה לאורחים», publicSchedule (≡ schedule_view, held by tests/parity) drawn by the guest site's own
// Schedule — reads the approved speakers' photos on demand, four at a time, and forgets them when it closes.
import { useId, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { publicSchedule } from "../../exports/publicSchedule";
import { filterGuests, type GuestPerson, type GuestRow, guestPhotoIds, guestRows, guestSummary, mayUnmarkPublic } from "../../domain/guestSite";
import { byGender, displayName } from "../../domain/names";
import { type GuestsQuery, guestsPath, lessonPath, parseGuestsQuery, speakerPath } from "../../domain/routes";
import { DAYS, DAY_NAMES, type Day, dateOf, fmtRange, shortDate } from "../../domain/time";
import type { Approach, Speaker } from "../../domain/types";
import { buildModel, type GridModel } from "../../grid/model";
import { ownerColors } from "../../grid/owners";
import { useMedia } from "../../lib/useMedia";
import { Schedule } from "../public/SchedulePage";
import { Button, INPUT, TABLE_HEAD, TABLE_ROW, TABLE_TH, useFocusRescue, useRunner } from "../settings/kit";
import { EditionSelect, useToast } from "../speakers/parts";
import { approvedWord, practiceWeek, publicOkDone, useGuestPhotos } from "../speakers/PublicOk";
import { actorIn, type Actor, useWeekStore } from "../weekStore";
import { OutputsTabs } from "./parts";

// 44×44 at least: «חסר» alone in a table cell is narrower than that
const GAP_LINK = "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2 font-bold text-bad underline underline-offset-4 hover:bg-accent-soft";

export function GuestsScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const { notify, clear, node } = useToast();
  const { busy, run } = useRunner(notify, clear);
  const wide = useMedia("(min-width: 1024px)");
  const location = useLocation();
  const navigate = useNavigate();
  const rescue = useFocusRescue();
  const id = useId();
  const [previewOn, setPreviewOn] = useState(false);
  const actor = actorIn(me, week?.edition);
  const model = useMemo(() => (week ? buildModel(week) : null), [week]);
  const rows = useMemo(() => (week ? guestRows(week) : []), [week]);
  const photoIds = useMemo(() => guestPhotoIds(rows), [rows]);
  const { photos, loading, failed } = useGuestPhotos(port, photoIds, previewOn && actor.isAdmin);

  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week || !model) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const header = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="font-display text-2xl font-extrabold text-navy">אתר האורחים</h2>
      <EditionSelect />
      <OutputsTabs admin={actor.isAdmin} />
    </div>
  );
  if (!actor.isAdmin) {
    return (
      <div data-guests-page className="mx-auto max-w-5xl space-y-4">
        {header}
        <p className="rounded-xl border border-line bg-card p-4 text-ink-soft shadow-sm">אתר האורחים שמור למדריך/ה של המחזור הזה.</p>
      </div>
    );
  }

  const q = parseGuestsQuery(location.search);
  const setQuery = (patch: Partial<GuestsQuery>) => {
    const next = { ...q, ...patch };
    for (const k of Object.keys(next) as (keyof GuestsQuery)[]) if (next[k] === undefined) delete next[k];
    navigate(guestsPath(next), { replace: true });
  };
  const shown = filterGuests(rows, { day: q.day ?? null, handler: q.h ?? null, missing: q.missing });
  const sum = guestSummary(rows);
  const handlers = ownerColors(week.team);
  const nameOf = (mid: number | null) => (mid == null ? "בלי אחראי/ת" : (model.memberName.get(mid) ?? "חבר/ת צוות"));

  /** Take a mark back in place (set_public_ok false): the person leaves the guests' site at once. */
  const unmark = async (lessonId: number, s: Speaker, a: Approach) => {
    const ok = await run(`unmark:${a.id}`, () => port.speakers.setPublicOk(week.edition.id, a.id, a.version, false), publicOkDone(s, false));
    await store.reload();
    // the button goes with the mark: the focus to what stands in its place — the «חסר» link of that speaker in that lesson
    if (ok) rescue(() => document.querySelector<HTMLElement>(`[data-guests-person="${lessonId}:${s.id}"] a, [data-guests-person="${lessonId}:${s.id}"] button`));
  };
  const cells: CellsCtx = { model, actor, busy, unmark };

  const filters = (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <div className="w-40" data-guests-filter="day">
        <label htmlFor={`${id}-day`} className="mb-1 block text-sm font-bold text-ink">
          יום
        </label>
        <select id={`${id}-day`} className={INPUT} value={q.day ?? ""} onChange={(e) => setQuery({ day: e.target.value === "" ? undefined : (Number(e.target.value) as Day) })}>
          <option value="">כל הימים</option>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              יום {DAY_NAMES[d]}
            </option>
          ))}
        </select>
      </div>
      <div className="w-48" data-guests-filter="handler">
        <label htmlFor={`${id}-handler`} className="mb-1 block text-sm font-bold text-ink">
          בטיפול
        </label>
        <select id={`${id}-handler`} className={INPUT} value={q.h ?? ""} onChange={(e) => setQuery({ h: e.target.value === "" ? undefined : Number(e.target.value) })}>
          <option value="">כולם</option>
          {handlers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          {q.h != null && !handlers.some((o) => o.id === q.h) && <option value={q.h}>{nameOf(q.h)}</option>}
        </select>
      </div>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-semibold text-ink" data-guests-filter="missing">
        <input type="checkbox" className="size-5 accent-navy" checked={!!q.missing} onChange={(e) => setQuery({ missing: e.target.checked || undefined })} />
        רק מה שחסר
      </label>
      <p className="ms-auto text-sm text-ink-soft" aria-live="polite">
        {shown.length === rows.length ? `${rows.length} שיעורים` : `${shown.length} מתוך ${rows.length} שיעורים`}
      </p>
    </div>
  );

  const dayTitle = (d: Day) => {
    const date = dateOf(week.edition.start_date, d);
    return `יום ${DAY_NAMES[d]}${date ? ` · ${shortDate(date)}` : ""}`;
  };
  const groups = byDay(shown);

  let body;
  if (rows.length === 0) {
    body = <p className="rounded-xl border border-line bg-card px-4 py-6 text-center text-ink-soft">עוד אין שיעורים סגורים במחזור הזה.</p>;
  } else if (shown.length === 0) {
    body = <p className="rounded-xl border border-line bg-card px-4 py-6 text-center text-ink-soft">אין שיעורים שמתאימים לסינון.</p>;
  } else if (wide) {
    body = (
      <div className="overflow-x-auto rounded-xl border border-line bg-card shadow-sm">
        <table className="w-full min-w-[60rem] border-collapse text-sm" aria-label="אתר האורחים לפי שיעור">
          <thead>
            <tr className={TABLE_HEAD}>
              {["מתי", "השיעור", "מרצה", "בטיפול", "תיאור לשיעור", "מאושר/ת", "תיאור המרצה", "תמונה"].map((h) => (
                <th key={h} scope="col" className={`${TABLE_TH} px-3 py-2`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.day}>
              <tr>
                <th scope="colgroup" colSpan={8} className="bg-sand-soft px-3 py-1.5 text-start font-display font-bold text-navy">
                  {dayTitle(g.day)}
                </th>
              </tr>
              {g.rows.flatMap((r) => {
                const people: (GuestPerson | null)[] = r.people.length ? r.people : [null];
                const span = people.length;
                return people.map((p, i) => (
                  <tr key={`${r.lessonId}:${p?.speakerId ?? 0}`} className={`${i === span - 1 ? TABLE_ROW : "border-b border-line/50"} align-middle`} data-guests-row={i === 0 ? r.lessonId : undefined}>
                    {i === 0 && (
                      <>
                        <td rowSpan={span} className="whitespace-nowrap px-3 py-1 align-top">
                          <bdi dir="ltr" className="inline-flex min-h-11 items-center font-bold tabular-nums text-navy">
                            {fmtRange(r.start_min, r.end_min)}
                          </bdi>
                        </td>
                        <td rowSpan={span} className="max-w-64 px-3 py-1 align-top">
                          <Link to={lessonPath(r.lessonId, null, "guest")} className="inline-flex min-h-11 min-w-11 items-center font-bold text-navy underline-offset-4 hover:underline">
                            {r.title ?? "כותרת: TBD"}
                          </Link>
                        </td>
                      </>
                    )}
                    <td className="max-w-56 px-3 py-1">{p ? <PersonName model={model} p={p} /> : <span className="text-ink-faint">—</span>}</td>
                    {i === 0 && (
                      <>
                        <td rowSpan={span} className="max-w-40 truncate px-3 py-1 align-top">
                          <span className="inline-flex min-h-11 items-center">{nameOf(r.handler)}</span>
                        </td>
                        <td rowSpan={span} className="px-2 py-1 align-top" data-guests-cell="note" data-has={r.note ? "y" : "-"}>
                          <NoteCell r={r} />
                        </td>
                      </>
                    )}
                    {p ? (
                      <PersonCells ctx={cells} r={r} p={p} as="td" />
                    ) : (
                      <td colSpan={3} className="px-3 py-1 text-ink-faint">
                        —
                      </td>
                    )}
                  </tr>
                ));
              })}
            </tbody>
          ))}
        </table>
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        {groups.map((g) => (
          <section key={g.day} aria-label={dayTitle(g.day)} className="space-y-2">
            <h3 className="font-display text-base font-bold text-navy">{dayTitle(g.day)}</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {g.rows.map((r) => {
                const lead = r.people.find((p) => p.role === "lead") ?? r.people[0];
                const leadSpeaker = lead ? model.speakerById.get(lead.speakerId) : undefined;
                return (
                  <li key={r.lessonId} data-guests-row={r.lessonId} className="min-w-0 rounded-xl border border-line bg-card px-3 py-2 shadow-sm">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <bdi dir="ltr" className="font-bold tabular-nums text-navy">
                        {fmtRange(r.start_min, r.end_min)}
                      </bdi>
                      <Link to={lessonPath(r.lessonId, null, "guest")} className="inline-flex min-h-11 min-w-11 items-center font-bold text-navy underline-offset-4 hover:underline">
                        {r.title ?? "כותרת: TBD"}
                      </Link>
                    </div>
                    <p className="text-sm text-ink-soft">
                      {leadSpeaker ? displayName(leadSpeaker) : "—"} · בטיפול: {nameOf(r.handler)}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      <li data-guests-cell="note" data-has={r.note ? "y" : "-"}>
                        <NoteCell r={r} label />
                      </li>
                      {r.people.map((p) => (
                        <li key={p.speakerId} className="border-t border-line/60 pt-1">
                          {r.people.length > 1 && <PersonName model={model} p={p} />}
                          <ul>
                            <PersonCells ctx={cells} r={r} p={p} as="li" />
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  const view = previewOn ? publicSchedule(week, (sid) => photos.get(sid) ?? null) : null;

  return (
    <div data-guests-page className="mx-auto max-w-6xl space-y-4 pb-20">
      {header}
      <p className="max-w-prose text-ink-soft">
        מה שהאורחים רואים בקישור הלו"ז: תיאור קצר לכל שיעור, ולכל מרצה שמאושר/ת להופיע — תיאור ותמונה. כל «חסר» מוביל למקום שבו ממלאים אותו.
      </p>
      {/* a practice week: only a global admin marks; a mark already there is on the link until it is taken back (the final review) */}
      {practiceWeek(actor, week.edition) && (
        <p data-guests-practice className="rounded-xl border border-line bg-sand-soft p-3 text-sm text-ink">
          {sum.ok === 0
            ? "במחזור תרגול לא מפרסמים מרצים לאורחים."
            : "במחזור תרגול רק מי שמנהל/ת את כל המחזורים מסמן/ת מרצים לאורחים. מרצה שכבר מסומן/ת מופיע/ה בקישור עד שמבטלים את הסימון («ביטול»)."}
        </p>
      )}
      {/* a phone: one count per line (a «·» would end a line); from 640px one line, the counts apart by «·» */}
      <p className="flex flex-col gap-1 rounded-xl border border-line bg-card px-4 py-3 text-ink shadow-sm sm:flex-row sm:flex-wrap sm:gap-x-2">
        <span data-guests-count="note">
          שיעורים עם תיאור <Count a={sum.withNote} of={sum.lessons} />
        </span>
        <span aria-hidden className="hidden sm:inline">
          ·
        </span>
        <span data-guests-count="ok">
          מרצים מאושרים להופיע <Count a={sum.ok} of={sum.people} />
        </span>
        <span aria-hidden className="hidden sm:inline">
          ·
        </span>
        <span data-guests-count="bio">
          עם תיאור לאורחים <Count a={sum.okWithBio} of={sum.ok} />
        </span>
        <span aria-hidden className="hidden sm:inline">
          ·
        </span>
        <span data-guests-count="photo">
          עם תמונה <Count a={sum.okWithPhoto} of={sum.ok} />
        </span>
      </p>
      {filters}
      {body}

      <section aria-label="תצוגה מקדימה לאורחים" className="space-y-3 rounded-xl border border-line bg-card p-4 shadow-sm">
        <Button kind={previewOn ? "secondary" : "primary"} aria-expanded={previewOn} aria-controls={`${id}-view`} onClick={() => setPreviewOn((v) => !v)}>
          תצוגה מקדימה לאורחים
        </Button>
        <p className="text-sm text-ink-soft">
          כך נראה קישור הלו"ז עכשיו. את הקישור שולחים ב
          <Link to="/settings/links" className="font-bold text-navy underline underline-offset-4">
            «הגדרות ← קישורים»
          </Link>
          .
        </p>
        <div id={`${id}-view`} hidden={!previewOn}>
          {view && (
            <div data-guests-preview className="space-y-2">
              {loading && <p className="text-sm text-ink-soft">טוען את התמונות…</p>}
              {failed > 0 && <p className="text-sm text-ink-soft">חלק מהתמונות לא נטענו.</p>}
              <div className="rounded-xl border border-line bg-paper p-3 sm:p-4">
                <Schedule view={view} preview />
              </div>
            </div>
          )}
        </div>
      </section>
      {node}
    </div>
  );
}

function Count({ a, of }: { a: number; of: number }) {
  return (
    <bdi dir="ltr" className="font-bold tabular-nums text-navy">
      {`${a}/${of}`}
    </bdi>
  );
}

function byDay(rows: readonly GuestRow[]): { day: Day; rows: GuestRow[] }[] {
  const out: { day: Day; rows: GuestRow[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.day === r.day) last.rows.push(r);
    else out.push({ day: r.day, rows: [r] });
  }
  return out;
}

function PersonName({ model, p }: { model: GridModel; p: GuestPerson }) {
  const s = model.speakerById.get(p.speakerId);
  if (!s) return <span className="text-ink-faint">—</span>;
  return (
    <span className="inline-flex min-h-11 min-w-0 flex-wrap items-center gap-x-1.5">
      <Link to={speakerPath(s.id, "guest")} className="inline-flex min-h-11 min-w-11 items-center font-semibold text-navy underline-offset-4 hover:underline">
        {displayName(s)}
      </Link>
      {p.role === "co" && <span className="text-xs text-ink-soft">{byGender(s.gender, "מרצה נוסף", "מרצה נוספת")}</span>}
    </span>
  );
}

/** The lesson's description: «יש», or a link to fill it. `label`: a card's line names what it is. */
function NoteCell({ r, label }: { r: GuestRow; label?: boolean }) {
  const what = label ? "תיאור לשיעור: " : "";
  return r.note ? (
    <span className="inline-flex min-h-11 items-center px-2 text-ink">{`${what}יש`}</span>
  ) : (
    <Link to={lessonPath(r.lessonId, null, "guest")} className={GAP_LINK} aria-label={label ? undefined : `תיאור לשיעור: חסר`}>
      {`${what}חסר`}
    </Link>
  );
}

interface CellsCtx {
  model: GridModel;
  actor: Actor;
  busy: string | null;
  unmark: (lessonId: number, s: Speaker, a: Approach) => Promise<void>;
}

/**
 * One speaker's three items — approved to appear, a description, a photo — as table cells or a card's lines. Without an
 * approach this edition: «בלי פנייה» (shown by name only, in the row). A gap links to where it is filled; an approval
 * can be taken back here.
 */
function PersonCells({ ctx, r, p, as: Tag }: { ctx: CellsCtx; r: GuestRow; p: GuestPerson; as: "td" | "li" }) {
  const s = ctx.model.speakerById.get(p.speakerId);
  const a = p.approachId == null ? undefined : ctx.model.approachById.get(p.approachId);
  const label = Tag === "li";
  const cls = Tag === "td" ? "px-2 py-1" : "";
  const name = s ? displayName(s) : "";
  if (!s || !a) {
    // a co-speaker the import brought, with no approach this edition: in the row by name only — nothing to fill
    if (label) {
      return (
        <li data-guests-cell="ok" data-has="none" className="inline-flex min-h-11 items-center px-2 text-ink-soft">
          בלי פנייה במחזור: {byGender(s?.gender, "מופיע", "מופיעה")} באתר רק בשם
        </li>
      );
    }
    return (
      <>
        <td className={cls} data-guests-cell="ok" data-has="none">
          <span className="inline-flex min-h-11 items-center px-2 text-ink-soft">בלי פנייה</span>
        </td>
        <td className={`${cls} text-ink-faint`} data-guests-cell="bio" data-has="none">
          —
        </td>
        <td className={`${cls} text-ink-faint`} data-guests-cell="photo" data-has="none">
          —
        </td>
      </>
    );
  }
  const gap = (to: string, text: string, aria: string) => (
    <Link to={to} className={GAP_LINK} aria-label={label ? undefined : `${aria} — ${name}`}>
      {text}
    </Link>
  );
  const okWord = approvedWord(s.gender);
  const may = mayUnmarkPublic(ctx.actor, a);
  return (
    <>
      <Tag className={cls} data-guests-cell="ok" data-has={p.ok ? "y" : "-"} data-guests-person={`${r.lessonId}:${s.id}`}>
        {p.ok ? (
          <span className="inline-flex min-h-11 flex-wrap items-center gap-1 px-2">
            <span className="text-ink">{label ? `אישור להופיע: ${okWord}` : okWord}</span>
            {may && (
              <Button kind="quiet" className="text-sm" data-guests-unmark={a.id} aria-label={`ביטול האישור של ${name}`} busy={ctx.busy === `unmark:${a.id}`} onClick={() => void ctx.unmark(r.lessonId, s, a)}>
                ביטול
              </Button>
            )}
          </span>
        ) : (
          gap(lessonPath(r.lessonId, null, "guest"), label ? "אישור להופיע: חסר" : "חסר", "אישור להופיע: חסר")
        )}
      </Tag>
      <Tag className={cls} data-guests-cell="bio" data-has={p.bio ? "y" : "-"}>
        {p.bio ? <span className="inline-flex min-h-11 items-center px-2 text-ink">{label ? "תיאור המרצה: יש" : "יש"}</span> : gap(speakerPath(s.id, "guest"), label ? "תיאור המרצה: חסר" : "חסר", "תיאור המרצה: חסר")}
      </Tag>
      <Tag className={cls} data-guests-cell="photo" data-has={p.photo ? "y" : "-"}>
        {p.photo ? <span className="inline-flex min-h-11 items-center px-2 text-ink">{label ? "תמונה: יש" : "יש"}</span> : gap(speakerPath(s.id, "guest"), label ? "תמונה: חסרה" : "חסר", "תמונה: חסרה")}
      </Tag>
    </>
  );
}

