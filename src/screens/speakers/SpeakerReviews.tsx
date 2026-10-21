// «איך עבר בשנים קודמות» in the speaker sheet (milestone 6): the reviews written
// about the speaker in past years — and in this year, for its own team — as
// public.speaker_reviews returns them: «להזמין שוב?», the rating, the words.
// Opinions about a person: shown to a global admin, and to the admins and
// content members of a live real edition (app.may_read_reviews) — never to
// logistics, a practice or demo week's team, or last year's team. Never who wrote it.
import { useEffect, useState } from "react";
import type { DataPort } from "../../data/port";
import type { SpeakerReview } from "../../data/reviews";
import { byGender } from "../../domain/names";
import { reviewLine } from "../../domain/reviews";
import { DAY_NAMES, type Day, fmtRange } from "../../domain/time";
import type { Edition, Speaker } from "../../domain/types";
import type { Actor } from "../weekStore";
import { Section } from "./parts";

/** May this member read reviews across the years, as the database decides it (app.may_read_reviews)? From the edition on screen. */
export function mayReadReviews(actor: Actor, edition: Edition): boolean {
  if (actor.global) return true;
  return (actor.role === "admin" || actor.role === "content") && edition.kind === "real" && edition.status !== "archived";
}

export function SpeakerReviews({ port, s, actor, edition }: { port: DataPort; s: Speaker; actor: Actor; edition: Edition }) {
  const allowed = mayReadReviews(actor, edition);
  const [list, setList] = useState<SpeakerReview[] | null | "failed">(null);
  useEffect(() => {
    if (!allowed) return;
    let live = true;
    setList(null);
    port.reviews.ofSpeaker(s.id).then(
      (r) => live && setList(r),
      () => live && setList("failed"),
    );
    return () => {
      live = false;
    };
  }, [port, s.id, allowed]);
  if (!allowed) return null;
  const overran = byGender(s.gender, "חרג מהזמן", "חרגה מהזמן", "חרג/ה מהזמן");
  return (
    <Section title="איך עבר" label="איך עבר בשנים קודמות">
      {list === null ? (
        <p className="text-sm text-ink-soft">טוען…</p>
      ) : list === "failed" ? (
        <p className="text-sm text-ink-soft">לא נטען.</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-ink-soft">עוד אין «איך עבר» על {byGender(s.gender, "המרצה הזה", "המרצה הזו", "המרצה")}.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {list.map((r) => (
            <li key={`${r.edition_id}:${r.lesson_id}`} className="rounded-md bg-card px-2 py-1.5">
              <p>
                <b>{r.edition_label}</b> · {DAY_NAMES[r.day as Day]} <bdi>{fmtRange(r.start_min, r.end_min)}</bdi> · {r.title ?? "ללא כותרת"}
              </p>
              <p className="font-semibold">{reviewLine(r, overran)}</p>
              {r.went_well && <p className="whitespace-pre-line break-words">מה עבד: {r.went_well}</p>}
              {r.issues && <p className="whitespace-pre-line break-words">מה פחות: {r.issues}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-ink-soft">
        גלוי למדריך/ה ולצוות התוכן של המחזור — לא לצוות הלוגיסטי, לא בקישורים ולא בייצוא למעצבת. «איך עבר» של כל מחזור נכלל בסיכום המחזור שלו ובארכיון.
      </p>
    </Section>
  );
}
