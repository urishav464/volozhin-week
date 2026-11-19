// «היום שלי» — a trainee's home (the reset, phase 2; `/` for a trainee, `/myday` for staff to preview). The day (or
// days, a tab each) an edition admin gave me with a partner: its header (date, partner, the closed lessons' balance),
// its slots in time order each with ONE next step, the lessons of the day someone else handles («חדש» since I last
// looked, and «ראיתי» — the notification the owner asked for), and the speakers who said they can come to a free slot.
// Nothing else: no lens, no warnings, no topic axis. The logic is src/domain/myDay.ts (pure, tested); the steps link
// to the pages that do the work (src/domain/routes.ts).
import { type KeyboardEvent, type ReactNode, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { MINE_GROUPS } from "../../domain/mine";
import { hasFresh, type MyDay, myDay, ownedDays, type SlotCard } from "../../domain/myDay";
import { byGender, displayName } from "../../domain/names";
import { lessonPath, speakerPath, speakersPath } from "../../domain/routes";
import { nextLessonStep, readerFilesOf } from "../../domain/stages";
import { DAYS, DAY_NAMES, type Day, dateOf, fmtRange, hebrewDate, shortDate } from "../../domain/time";
import type { Lesson } from "../../domain/types";
import { buildModel, type GridModel } from "../../grid/model";
import { needText } from "../../grid/DayHeader";
import { GenderDot, ReconfirmDot, StageDots, TopicChip, topicsOf } from "../../grid/bits";
import { statusLabel } from "../../lib/labels";
import { todayColumn } from "../../offline/view";
import { DEFAULT_GENDER_TOLERANCE, unbalanced } from "../../rules/balance";
import { Button, useRunner } from "../settings/kit";
import { EditionSelect, useToast } from "../speakers/parts";
import { actorIn, useWeekStore } from "../weekStore";

/** A link drawn as Ein Prat's pill (kit.tsx Button's look): the slot's one next step goes to another page. */
const PILL = "inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-full px-4 font-bold transition duration-150 ease-out";
const PILL_KIND = {
  primary: `${PILL} bg-navy text-white hover:bg-navy-800`,
  secondary: `${PILL} border border-navy bg-card text-navy hover:bg-accent-soft`,
  quiet: `${PILL} text-navy hover:bg-accent-soft`,
};
function PillLink({ to, kind = "secondary", children, label }: { to: string; kind?: keyof typeof PILL_KIND; children: ReactNode; label?: string }) {
  return (
    <Link to={to} aria-label={label} className={PILL_KIND[kind]}>
      {children}
    </Link>
  );
}

/** A closed lesson's next step, in «המרצים שלי»'s words (its groups are named by the steps). */
const stepWords = (l: Lesson, week: GridModel["week"]): string | null => {
  const next = nextLessonStep(l, readerFilesOf(week, l.id));
  return next ? (MINE_GROUPS.find((g) => g.group === next)?.label ?? null) : null;
};

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
/** «מרצה אחת» · «3 מרצות», «מרצה אחד» · «4 מרצים» (a co-speaker counts a half: «1.5 מרצות»). */
const women = (x: number) => (x === 1 ? "מרצה אחת" : `${n(x)} מרצות`);
const men = (x: number) => (x === 1 ? "מרצה אחד" : `${n(x)} מרצים`);

export function MyDayScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const { notify, clear, node } = useToast();
  const { busy, run } = useRunner(notify, clear);
  const [params, setParams] = useSearchParams();
  const tabRefs = useRef(new Map<Day, HTMLButtonElement>());
  const actor = actorIn(me, week?.edition);
  const model = useMemo(() => (week ? buildModel(week) : null), [week]);

  // a home: the week screen's own notice (a trainee is never the one who opens an edition)
  if (store.problem === "none") {
    return (
      <div className="mx-auto mt-8 max-w-lg rounded-xl border border-line bg-card p-5 shadow-sm">
        <h2 className="mb-2 font-display text-xl font-extrabold text-navy">עוד לא נפתח מחזור</h2>
        <p className="text-ink-soft">המדריך/ה עוד לא פתח/ה את המחזור של השנה.</p>
      </div>
    );
  }
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון את השבוע. כדאי לרענן את הדף.</p>;
  if (!week || !model) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const mine = ownedDays(week, actor.memberId);
  // staff who own no day preview every day as its first owner sees it (`/myday`); a trainee sees only their own
  const preview = mine.length === 0 && actor.isAdmin;
  const days: Day[] = preview ? [...DAYS] : mine;

  if (days.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Title />
        <section data-myday-empty className="rounded-2xl border border-line bg-card p-6 shadow-sm sm:p-8">
          <p className="text-lg text-ink">עוד לא נקבע לך יום. אנשי הצוות קובעים זאת בהגדרות.</p>
          <p className="mt-2 text-ink-soft">בינתיים אפשר לעבור על המרצים במאגר.</p>
          <div className="mt-4">
            <PillLink to="/speakers" kind="primary">
              מרצים
            </PillLink>
          </div>
        </section>
      </div>
    );
  }

  const asked = Number(params.get("day"));
  const today = todayColumn(week.edition.start_date, new Date().toISOString());
  const day: Day = days.find((d) => d === asked && params.has("day")) ?? days.find((d) => d === today) ?? days[0];
  const owners = week.dayOwners.filter((o) => o.day === day).map((o) => o.member_id).sort((a, b) => a - b);
  const viewer = preview ? (owners[0] ?? actor.memberId) : actor.memberId;
  const d = myDay(model, day, viewer);
  const nameOf = (id: number) => model.memberName.get(id) ?? "חבר/ת צוות";
  const isOwner = d.owners.includes(actor.memberId);

  const choose = (to: Day) => {
    clear();
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("day", String(to));
      return next;
    }, { replace: true });
    tabRefs.current.get(to)?.focus();
  };
  // arrow keys move between the tabs (right to left: ← is the next one), Home/End to the ends
  const onKey = (e: KeyboardEvent) => {
    const i = days.indexOf(day);
    const next = { ArrowLeft: i + 1, ArrowRight: i - 1, Home: 0, End: days.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    choose(days[(next + days.length) % days.length]);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Title />
        <EditionSelect />
      </div>
      {preview && (
        <p className="rounded-xl border border-sand bg-sand-soft px-3 py-2 text-sm text-ink">
          תצוגה מקדימה: כך נראה «היום שלי» {owners.length > 0 ? `של ${nameOf(owners[0])}` : "ליום שעוד אין לו אחראים"}. שינוי האחראים: «הגדרות ← צוות ← ימים».
        </p>
      )}

      {days.length > 1 && (
        <div role="tablist" aria-label="הימים שלי" onKeyDown={onKey} className="flex gap-1 overflow-x-auto border-b border-line">
          {days.map((x) => {
            const selected = x === day;
            return (
              <button
                key={x}
                ref={(el) => {
                  if (el) tabRefs.current.set(x, el);
                }}
                type="button"
                role="tab"
                id={`myday-tab-${x}`}
                aria-selected={selected}
                aria-controls="myday-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(x)}
                className={`-mb-px min-h-11 shrink-0 rounded-t-lg border-b-[3px] px-4 font-bold transition-colors ${selected ? "border-navy text-navy" : "border-transparent text-ink-soft hover:bg-accent-soft hover:text-navy"}`}
              >
                יום {DAY_NAMES[x]}
              </button>
            );
          })}
        </div>
      )}

      <div role={days.length > 1 ? "tabpanel" : undefined} id="myday-panel" aria-labelledby={days.length > 1 ? `myday-tab-${day}` : undefined} className="space-y-6" data-myday={day}>
        <DayHead model={model} d={d} nameOf={nameOf} viewer={viewer} />

        <section aria-labelledby="myday-slots" className="space-y-2">
          <h3 id="myday-slots" className="font-display text-lg font-bold text-navy">
            המשבצות של היום
          </h3>
          <ol className="space-y-2">
            {d.slots.map((c) => (
              <SlotRow key={c.key} model={model} card={c} viewer={viewer} nameOf={nameOf} />
            ))}
          </ol>
        </section>

        {d.others.length > 0 && (
          <section aria-labelledby="myday-others" className="space-y-2 rounded-2xl border border-line bg-card p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h3 id="myday-others" tabIndex={-1} className="font-display text-lg font-bold text-navy outline-none">
                משבצות ביום שלכם שמטופלות על ידי אחרים
              </h3>
              {isOwner && !preview && hasFresh(d) && (
                <Button
                  className="ms-auto"
                  busy={busy === "seen"}
                  onClick={async () => {
                    if (!(await run("seen", () => port.commands(week.edition.id).markDaySeen(day), null))) return;
                    await store.reload();
                    // the button goes with the «חדש» marks: the focus stays with the list
                    document.getElementById("myday-others")?.focus();
                  }}
                >
                  ראיתי
                </Button>
              )}
            </div>
            <ul className="divide-y divide-line/70">
              {d.others.map((o) => {
                const lesson = week.lessons.find((l) => l.id === o.lessonId);
                const lead = model.leadOf.get(o.lessonId);
                const who = lesson?.state === "closed" ? (lead ? displayName(lead) : "שיעור") : "בתהליך";
                return (
                  <li key={o.lessonId} data-other-lesson={o.lessonId} data-fresh={o.fresh || undefined} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <bdi dir="ltr" className="w-24 shrink-0 font-bold tabular-nums text-navy">
                      {fmtRange(o.start, o.end)}
                    </bdi>
                    <span className="min-w-0 flex-1 basis-40">
                      <span className="block font-bold">{who}</span>
                      <span className="block text-sm text-ink-soft">בטיפול {o.handlers.map(nameOf).join(" ו")}</span>
                    </span>
                    {o.fresh && <span className="rounded-full bg-gold/30 px-2 text-xs font-bold leading-5 text-navy-900">חדש</span>}
                    <PillLink to={lessonPath(o.lessonId)} kind="quiet">
                      לשיעור
                    </PillLink>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <Speakers model={model} d={d} />
      </div>
      {node}
    </div>
  );
}

function Title() {
  return <h2 className="font-display text-2xl font-extrabold text-navy">היום שלי</h2>;
}

/** The day: its name and date, the partner, and its closed lessons' balance (the header's one line, DayHeader.tsx). */
function DayHead({ model, d, nameOf, viewer }: { model: GridModel; d: MyDay; nameOf: (id: number) => string; viewer: number }) {
  const date = dateOf(model.week.edition.start_date, d.day);
  const b = model.days[d.day].balance;
  const off = unbalanced(b.closed, model.week.edition.settings.gender_tolerance ?? DEFAULT_GENDER_TOLERANCE);
  const partners = d.owners.filter((o) => o !== viewer);
  const tone = off || b.unreachable ? "bg-bad/10 text-bad" : b.need === "f" ? "bg-need-f text-pink-900" : b.need === "m" ? "bg-need-m text-sky-900" : "bg-ok/10 text-ok";
  return (
    <header className="rounded-2xl border border-line bg-card px-4 py-4 shadow-sm sm:px-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-display text-xl font-extrabold text-navy">יום {DAY_NAMES[d.day]}</p>
        <p className="text-ink-soft">{date ? `${shortDate(date)} · ${hebrewDate(date)}` : "תאריך TBD"}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span data-partner className="text-ink">
          {partners.length > 0 ? `בזוג עם ${partners.map(nameOf).join(" ו")}` : "בלי בן/בת זוג"}
        </span>
        <span data-day-balance={off ? "off" : b.need ?? "even"} className={`inline-flex flex-wrap items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold tabular-nums ${tone}`}>
          <span>
            {women(b.closed.f)} · {men(b.closed.m)}
          </span>
          <span aria-hidden>·</span>
          <span>
            {off ? "לא מאוזן · " : ""}
            {needText(b.need, b.deficit)}
          </span>
        </span>
        <span className="text-ink-soft">בשיעורים שנסגרו</span>
        <Link to="/week" className="ms-auto inline-flex min-h-11 items-center font-bold text-navy underline-offset-4 hover:underline">
          לכל השבוע
        </Link>
      </div>
    </header>
  );
}

/** One slot: its time, what is there, and its one next step. */
function SlotRow({ model, card: c, viewer, nameOf }: { model: GridModel; card: SlotCard; viewer: number; nameOf: (id: number) => string }) {
  const { week } = model;
  const lesson = c.lessonId != null ? week.lessons.find((l) => l.id === c.lessonId) : undefined;
  const lead = c.leadId != null ? model.speakerById.get(c.leadId) : undefined;
  const theirs = c.step.kind === "theirs" ? c.step.handlers : null;
  const handledBy = theirs && theirs.length > 0 ? `בטיפול ${theirs.map(nameOf).join(" ו")}` : null;

  let body: ReactNode;
  if (c.state === "closed" && lesson) {
    body = (
      <>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <GenderDot gender={lead?.gender ?? null} />
          <span className="font-bold text-ink">{lead ? displayName(lead) : "שיעור"}</span>
          <StageDots lesson={lesson} week={week} />
          {lesson.needs_reconfirm && <ReconfirmDot />}
        </span>
        <span className="block truncate text-sm text-ink-soft">{lesson.title ?? "כותרת: TBD"}</span>
      </>
    );
  } else if (c.candidates.length > 0) {
    body = (
      <ul className="space-y-0.5" aria-label="מועמדים">
        {c.candidates.map((x) => {
          const s = model.speakerById.get(x.speakerId);
          return (
            <li key={x.pitchId} className="flex flex-wrap items-center gap-x-2 text-sm">
              <GenderDot gender={s?.gender ?? null} />
              <span className="font-bold text-ink">{s ? displayName(s) : "מרצה"}</span>
              <span className="text-ink-soft">{statusLabel(x.status, s?.gender ?? null)}</span>
              {x.handler !== viewer && <span className="text-ink-faint">· {x.handler != null ? `בטיפול ${nameOf(x.handler)}` : "בלי אחראי/ת"}</span>}
            </li>
          );
        })}
      </ul>
    );
  } else {
    body = (
      <span className="text-ink-soft">
        פנוי
        {c.label && <span className="text-ink-faint"> · {c.label}</span>}
      </span>
    );
  }

  let action: ReactNode;
  let hint: ReactNode = null;
  switch (c.step.kind) {
    case "choose":
      action = (
        <PillLink to={c.step.to} kind="primary">
          לבחור מרצה
        </PillLink>
      );
      break;
    case "speaker":
      action = (
        <PillLink to={c.step.to} kind="primary">
          {c.step.group === "to_call" || c.step.group === "retry" || c.step.group === "awaiting" ? "לשיחה" : "לכרטיס המרצה"}
        </PillLink>
      );
      if (c.step.group === "agreed") hint = `${byGender(model.speakerById.get(c.step.speakerId)?.gender ?? null, "ממתין", "ממתינה")} לאישור המדריך/ה`;
      break;
    case "lesson":
      if (c.step.step === "close") {
        action = (
          <PillLink to={c.step.to} kind="primary">
            לסגירה
          </PillLink>
        );
      } else if (c.step.step) {
        hint = lesson ? stepWords(lesson, week) : null;
        action = (
          <PillLink to={c.step.to} kind="primary">
            לשיעור
          </PillLink>
        );
      } else {
        hint = <span className="font-semibold text-ok">הכול מוכן</span>;
        action = (
          <PillLink to={c.step.to} kind="quiet">
            לשיעור
          </PillLink>
        );
      }
      break;
    case "theirs":
      hint = handledBy ?? (c.state === "draft" ? "מועמד/ת בלי אחראי/ת" : "בלי אחראי/ת");
      action = c.step.to ? (
        <PillLink to={c.step.to} kind="quiet">
          לשיעור
        </PillLink>
      ) : null;
      break;
  }

  return (
    <li
      data-slot-card={c.key}
      data-state={c.state}
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 shadow-sm sm:flex-nowrap ${c.state === "free" ? "border-dashed border-ink-faint/50 bg-card/60" : "border-line bg-card"}`}
    >
      <bdi dir="ltr" className="w-24 shrink-0 font-bold tabular-nums text-navy">
        {fmtRange(c.start, c.end)}
      </bdi>
      <div className="min-w-0 flex-1 basis-48">{body}</div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
        {hint && <span className="text-sm text-ink-soft">{hint}</span>}
        {action}
      </div>
    </li>
  );
}

/** «מרצים שיכולים ביום שלכם»: mine first, then nobody's — each to its page, at «איפה אפשר לשבץ». */
function Speakers({ model, d }: { model: GridModel; d: MyDay }) {
  return (
    <section aria-labelledby="myday-speakers" className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3">
        <h3 id="myday-speakers" className="font-display text-lg font-bold text-navy">
          מרצים שיכולים ביום שלכם
        </h3>
        <Link to={speakersPath({ day: d.day })} className="ms-auto inline-flex min-h-11 items-center text-sm font-bold text-navy underline-offset-4 hover:underline">
          כל המרצים שמתאימים ליום
        </Link>
      </div>
      {d.speakers.length === 0 ? (
        <p className="text-ink-soft">עוד אין מרצה שאמר/ה שיכול/ה במשבצת פנויה ביום הזה.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {d.speakers.map((x) => {
            const s = model.speakerById.get(x.speakerId);
            if (!s) return null;
            return (
              <li key={x.speakerId} data-day-speaker={x.speakerId}>
                <Link to={speakerPath(s.id, "placement")} className="block h-full rounded-xl border border-line bg-card px-4 py-3 shadow-sm transition-shadow hover:border-navy/40 hover:shadow-md">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <GenderDot gender={s.gender} />
                    <span className="font-bold text-navy">{displayName(s)}</span>
                    {x.mine && <span className="rounded-full bg-accent-soft px-2 text-xs font-bold leading-5 text-navy">שלי</span>}
                  </span>
                  {s.topics.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {topicsOf(s.topics, model.week.categories).map((t) => (
                        <TopicChip key={t.name} name={t.name} category={t.category} />
                      ))}
                    </span>
                  )}
                  <span className="mt-1 block text-sm text-ink-soft">
                    {byGender(s.gender, "יכול", "יכולה")}:{" "}
                    {x.fits.map((f, i) => (
                      <span key={f.start}>
                        {i > 0 && " · "}
                        <bdi dir="ltr" className="tabular-nums">
                          {fmtRange(f.start, f.end)}
                        </bdi>
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
