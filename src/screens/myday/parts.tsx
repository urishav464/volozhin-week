// The pieces «היום שלי» (a trainee's home) and «ימים» (the staff's day page, the reset, phase 3) share: a day's header,
// a slot's row with its one next step, the lessons of the day handled outside its pair, the speakers who can come, and
// the hand-overs offered to me. The logic is src/domain/myDay.ts (pure, tested); the steps link to the pages that do
// the work (src/domain/routes.ts).
import type { ReactNode } from "react";
import { Link } from "react-router";
import { MINE_GROUPS } from "../../domain/mine";
import type { MyDay, SlotCard } from "../../domain/myDay";
import { byGender, displayName } from "../../domain/names";
import { lessonPath, speakerPath, speakersPath } from "../../domain/routes";
import { nextLessonStep, readerFilesOf } from "../../domain/stages";
import { DAY_NAMES, dateOf, fmtRange, hebrewDate, shortDate } from "../../domain/time";
import type { Approach, Lesson } from "../../domain/types";
import { needText } from "../../grid/DayHeader";
import { GenderDot, ReconfirmDot, StageDots, TopicChip, topicsOf } from "../../grid/bits";
import type { GridModel } from "../../grid/model";
import { statusLabel } from "../../lib/labels";
import { DEFAULT_GENDER_TOLERANCE, unbalanced } from "../../rules/balance";

/** A link drawn as Ein Prat's pill (kit.tsx Button's look): the slot's one next step goes to another page. */
const PILL = "inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-full px-4 font-bold transition duration-150 ease-out";
const PILL_KIND = {
  primary: `${PILL} bg-navy text-white hover:bg-navy-800`,
  secondary: `${PILL} border border-navy bg-card text-navy hover:bg-accent-soft`,
  quiet: `${PILL} text-navy hover:bg-accent-soft`,
};
export function PillLink({ to, kind = "secondary", children, label }: { to: string; kind?: keyof typeof PILL_KIND; children: ReactNode; label?: string }) {
  return (
    <Link to={to} aria-label={label} className={PILL_KIND[kind]}>
      {children}
    </Link>
  );
}

/** A closed lesson's next step, in the speakers' groups' words (src/domain/mine.ts). */
const stepWords = (l: Lesson, week: GridModel["week"]): string | null => {
  const next = nextLessonStep(l, readerFilesOf(week, l.id));
  return next ? (MINE_GROUPS.find((g) => g.group === next)?.label ?? null) : null;
};

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
/** «מרצה אחת» · «3 מרצות», «מרצה אחד» · «4 מרצים» (a co-speaker counts a half: «1.5 מרצות»). */
const women = (x: number) => (x === 1 ? "מרצה אחת" : `${n(x)} מרצות`);
const men = (x: number) => (x === 1 ? "מרצה אחד" : `${n(x)} מרצים`);

/**
 * The day: its name and date, who owns it (`who` — the partner on «היום שלי», the pair on «ימים»), and its closed
 * lessons' balance (the grid header's one line, DayHeader.tsx); `weekTo` the whole week.
 */
export function DayHead({ model, d, who, weekTo }: { model: GridModel; d: MyDay; who: ReactNode; weekTo: string }) {
  const date = dateOf(model.week.edition.start_date, d.day);
  const b = model.days[d.day].balance;
  const off = unbalanced(b.closed, model.week.edition.settings.gender_tolerance ?? DEFAULT_GENDER_TOLERANCE);
  const tone = off || b.unreachable ? "bg-bad/10 text-bad" : b.need === "f" ? "bg-need-f text-pink-900" : b.need === "m" ? "bg-need-m text-sky-900" : "bg-ok/10 text-ok";
  return (
    <header className="rounded-2xl border border-line bg-card px-4 py-4 shadow-sm sm:px-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-display text-xl font-extrabold text-navy">יום {DAY_NAMES[d.day]}</p>
        <p className="text-ink-soft">{date ? `${shortDate(date)} · ${hebrewDate(date)}` : "תאריך TBD"}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {who}
        <span data-day-balance={off ? "off" : (b.need ?? "even")} className={`inline-flex flex-wrap items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold tabular-nums ${tone}`}>
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
        <Link to={weekTo} className="ms-auto inline-flex min-h-11 items-center font-bold text-navy underline-offset-4 hover:underline">
          לכל השבוע
        </Link>
      </div>
    </header>
  );
}

/**
 * One slot: its time, what is there, and its one next step. `showHandler` (staff): a lesson's handler named when it is
 * not me; `exception`: the lesson is handled outside the day's pair («חריג», highlighted).
 */
export function SlotRow({
  model,
  card: c,
  viewer,
  nameOf,
  showHandler = false,
  exception = false,
}: {
  model: GridModel;
  card: SlotCard;
  viewer: number;
  nameOf: (id: number) => string;
  showHandler?: boolean;
  exception?: boolean;
}) {
  const { week } = model;
  const lesson = c.lessonId != null ? week.lessons.find((l) => l.id === c.lessonId) : undefined;
  const lead = c.leadId != null ? model.speakerById.get(c.leadId) : undefined;
  const theirs = c.step.kind === "theirs" ? c.step.handlers : null;
  const handledBy = theirs && theirs.length > 0 ? `בטיפול ${theirs.map(nameOf).join(" ו")}` : null;
  const closedHandler = c.state === "closed" ? (c.handlers[0] ?? null) : null;

  let body: ReactNode;
  if (c.state === "closed" && lesson) {
    body = (
      <>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <GenderDot gender={lead?.gender ?? null} />
          <span className="font-bold text-ink">{lead ? displayName(lead) : "שיעור"}</span>
          <StageDots lesson={lesson} week={week} />
          {lesson.needs_reconfirm && <ReconfirmDot />}
          {exception && <ExceptionChip />}
        </span>
        <span className="block truncate text-sm text-ink-soft">{lesson.title ?? "כותרת: TBD"}</span>
        {showHandler && closedHandler !== viewer && (
          <span data-slot-handler className="block text-sm text-ink-faint">
            {closedHandler != null ? `בטיפול ${nameOf(closedHandler)}` : "בלי אחראי/ת"}
          </span>
        )}
      </>
    );
  } else if (c.candidates.length > 0) {
    body = (
      <>
        {exception && (
          <span className="mb-0.5 block">
            <ExceptionChip />
          </span>
        )}
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
      </>
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
      // the speaker's vetting is the instructor's (the payment and the transport are not)
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
      data-exception={exception || undefined}
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 shadow-sm sm:flex-nowrap ${
        exception ? "border-gold bg-gold-soft/40 outline-2 -outline-offset-2 outline-dashed outline-gold" : c.state === "free" ? "border-dashed border-ink-faint/50 bg-card/60" : "border-line bg-card"
      }`}
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

/** «חריג»: a gold chip (the grid's «אחריות» lens says the same). */
export function ExceptionChip() {
  return <span className="rounded-full bg-gold/30 px-2 text-xs font-bold leading-5 text-navy-900">חריג</span>;
}

/**
 * The lessons of the day someone outside its pair handles: «חדש» marks (`fresh`, the owners' notice) and «ראיתי»
 * (`action`, an owner's) only where given. `id` is the heading's, which keeps the focus when the button goes.
 */
export function OthersSection({ model, d, nameOf, id, title, fresh, action }: { model: GridModel; d: MyDay; nameOf: (id: number) => string; id: string; title: string; fresh: boolean; action?: ReactNode }) {
  const { week } = model;
  return (
    <section aria-labelledby={id} data-others className="space-y-2 rounded-2xl border border-line bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id={id} tabIndex={-1} className="font-display text-lg font-bold text-navy outline-none">
          {title}
        </h3>
        {action}
      </div>
      <ul className="divide-y divide-line/70">
        {d.others.map((o) => {
          const lesson = week.lessons.find((l) => l.id === o.lessonId);
          const lead = model.leadOf.get(o.lessonId);
          const who = lesson?.state === "closed" ? (lead ? displayName(lead) : "שיעור") : "בתהליך";
          const isNew = fresh && o.fresh;
          return (
            <li key={o.lessonId} data-other-lesson={o.lessonId} data-fresh={isNew || undefined} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <bdi dir="ltr" className="w-24 shrink-0 font-bold tabular-nums text-navy">
                {fmtRange(o.start, o.end)}
              </bdi>
              <span className="min-w-0 flex-1 basis-40">
                <span className="block font-bold">{who}</span>
                <span className="block text-sm text-ink-soft">בטיפול {o.handlers.map(nameOf).join(" ו")}</span>
              </span>
              {isNew && <span className="rounded-full bg-gold/30 px-2 text-xs font-bold leading-5 text-navy-900">חדש</span>}
              <PillLink to={lessonPath(o.lessonId)} kind="quiet">
                לשיעור
              </PillLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** «מרצים שיכולים ביום»: mine first, then nobody's — each to its page, at «איפה אפשר לשבץ». */
export function DaySpeakers({ model, d, title }: { model: GridModel; d: MyDay; title: string }) {
  return (
    <section aria-labelledby="myday-speakers" className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3">
        <h3 id="myday-speakers" className="font-display text-lg font-bold text-navy">
          {title}
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

/** «הוצעו לך N מרצים:» — the hand-overs waiting for my answer, each to its page (where «לקבל / לסרב» lives). */
export function OffersLine({ model, offers }: { model: Pick<GridModel, "speakerById">; offers: readonly Approach[] }) {
  if (offers.length === 0) return null;
  return (
    <section data-offers aria-label="הוצעו לך" className="rounded-xl border border-gold bg-gold-soft/50 px-4 py-2 text-ink">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-bold">{offers.length === 1 ? "הוצע/ה לך מרצה אחד/ת:" : `הוצעו לך ${offers.length} מרצים:`}</span>
        {offers.map((a, i) => {
          const s = model.speakerById.get(a.speaker_id);
          return (
            <span key={a.id} className="inline-flex items-center">
              {i > 0 && <span aria-hidden className="pe-2">·</span>}
              <Link data-offer={a.speaker_id} to={speakerPath(a.speaker_id)} className="inline-flex min-h-11 items-center font-bold text-navy underline underline-offset-4 hover:text-navy-800">
                {s ? displayName(s) : "מרצה"}
              </Link>
            </span>
          );
        })}
      </p>
    </section>
  );
}
