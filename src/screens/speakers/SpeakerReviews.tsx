// «לימד/ה אצלנו» in the speaker sheet: the closed lessons of past editions
// (public.speaker_history), each once, and under it — for whoever may read them —
// its «איך עבר» (milestone 6) as public.speaker_reviews returns them: «להזמין
// שוב?», the rating, the words; a review with no line of its own (this year's,
// for its own team) is a line at the end.
// Opinions about a person: shown to a global admin, and to the admins and
// content members of a live real edition (app.may_read_reviews) — never to
// logistics, a practice or demo week's team, or last year's team. Never who wrote it.
import { type ReactNode, useEffect, useState } from "react";
import type { DataPort } from "../../data/port";
import type { SpeakerReview } from "../../data/reviews";
import type { HistoryLesson } from "../../data/speakers";
import { byGender } from "../../domain/names";
import { reviewLine } from "../../domain/reviews";
import { DAY_NAMES, type Day, fmtRange } from "../../domain/time";
import type { Category, Edition, Speaker } from "../../domain/types";
import { TopicChip } from "../../grid/bits";
import { Section } from "../../grid/Panels";
import type { Actor } from "../weekStore";

/** May this member read reviews across the years, as the database decides it (app.may_read_reviews)? From the edition on screen. */
export function mayReadReviews(actor: Actor, edition: Edition): boolean {
  if (actor.global) return true;
  return (actor.role === "admin" || actor.role === "content") && edition.kind === "real" && edition.status !== "archived";
}

/** The speaker's reviews: undefined when the member may not read them (nothing is asked), null while they load. */
function useSpeakerReviews(port: DataPort, speakerId: number, allowed: boolean): SpeakerReview[] | null | "failed" | undefined {
  const [list, setList] = useState<SpeakerReview[] | null | "failed">(null);
  useEffect(() => {
    if (!allowed) return;
    let live = true;
    setList(null);
    port.reviews.ofSpeaker(speakerId).then(
      (r) => live && setList(r),
      () => live && setList("failed"),
    );
    return () => {
      live = false;
    };
  }, [port, speakerId, allowed]);
  return allowed ? list : undefined;
}

/** A lesson and its review meet on the edition, the day and the hour (display only). */
const slotKey = (x: { edition_id: number; day: number; start_min: number }) => `${x.edition_id}:${x.day}:${x.start_min}`;

const lessonsCount = (n: number) => (n === 1 ? "שיעור אחד" : `${n} שיעורים`);

export function TaughtHere({
  port,
  s,
  actor,
  edition,
  categories,
  history,
  failed,
}: {
  port: DataPort;
  s: Speaker;
  actor: Actor;
  edition: Edition;
  /** The week's topics: a past lesson's topic wears its colour when it is one of them. */
  categories: readonly Category[];
  history: HistoryLesson[] | null;
  failed: boolean;
}) {
  const reviews = useSpeakerReviews(port, s.id, mayReadReviews(actor, edition));
  const title = byGender(s.gender, "לימד אצלנו", "לימדה אצלנו");
  if (history == null) {
    return (
      <Section title={title} label="שיעורים במחזורים">
        <p className="text-sm text-ink-soft">{failed ? "לא נטען." : "טוען…"}</p>
      </Section>
    );
  }
  const read = Array.isArray(reviews) ? reviews : [];
  const reviewOf = new Map(read.map((r) => [slotKey(r), r]));
  const taught = new Set(history.map(slotKey));
  const alone = read.filter((r) => !taught.has(slotKey(r)));
  const topic = (name: string) => categories.find((c) => c.active && c.name === name);
  const overran = byGender(s.gender, "חרג מהזמן", "חרגה מהזמן", "חרג/ה מהזמן");
  const status =
    reviews === null ? <p className="text-sm text-ink-soft">«איך עבר» נטען…</p> : reviews === "failed" ? <p className="text-sm text-ink-soft">«איך עבר» לא נטען.</p> : null;

  if (history.length + alone.length === 0) {
    return (
      <section aria-label="שיעורים במחזורים" className="space-y-1">
        <p className="text-sm text-ink-soft">עוד לא {title}.</p>
        {reviews === "failed" && status}
      </section>
    );
  }
  const list = (
    <ul className="space-y-1.5 text-sm">
      {history.map((h, i) => {
        const r = reviewOf.get(slotKey(h));
        return (
          <li key={`${h.edition_id}:${i}`} className="rounded-md bg-card px-2 py-1.5">
            <LessonLine label={h.edition_label} day={h.day} start={h.start_min} end={h.end_min} title={h.title}>
              {h.category && (
                <>
                  {" · "}
                  <TopicChip name={h.category} category={topic(h.category)} />
                </>
              )}
              {h.role === "co" && <span className="text-ink-soft"> · מרצה שותף/ה</span>}
            </LessonLine>
            {r && <ReviewLines r={r} overran={overran} />}
          </li>
        );
      })}
      {alone.map((r) => (
        <li key={`${r.edition_id}:${r.lesson_id}`} className="rounded-md bg-card px-2 py-1.5">
          <LessonLine label={r.edition_label} day={r.day as Day} start={r.start_min} end={r.end_min} title={r.title} />
          <ReviewLines r={r} overran={overran} />
        </li>
      ))}
    </ul>
  );
  return (
    <Section title={title} count={lessonsCount(history.length + alone.length)} label="שיעורים במחזורים">
      {reviews === undefined ? (
        list
      ) : (
        // the reviews are read with their lessons: one region names both, for those who may read them
        <section aria-label="איך עבר בשנים קודמות" className="space-y-1.5">
          {list}
          {status}
        </section>
      )}
    </Section>
  );
}

function LessonLine({ label, day, start, end, title, children }: { label: string; day: Day; start: number; end: number; title: string | null; children?: ReactNode }) {
  return (
    <p>
      <b>{label}</b> · {DAY_NAMES[day]} <bdi>{fmtRange(start, end)}</bdi> · {title ?? "ללא כותרת"}
      {children}
    </p>
  );
}

/** One review, under its lesson: the verdict in bold, then what worked and what less. */
function ReviewLines({ r, overran }: { r: SpeakerReview; overran: string }) {
  return (
    <div className="mt-1 border-s-2 border-line ps-2">
      <p className="font-semibold">{reviewLine(r, overran)}</p>
      {r.went_well && <p className="whitespace-pre-line break-words">מה עבד: {r.went_well}</p>}
      {r.issues && <p className="whitespace-pre-line break-words">מה פחות: {r.issues}</p>}
    </div>
  );
}
