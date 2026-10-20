// «איך עבר» — the lesson panel's sixth section, after the five stages (milestone 6):
// what went well, what did not, «להזמין שוב?», an overrun, a rating 1–5 (none of
// them alone required, one of them said). The handler writes once the lesson's
// day has passed in Israel (src/domain/reviews.ts: reviewWindow); an admin of the
// edition at any time; logistics never sees the section (an opinion about a
// person). Read when the panel opens and after a save — never part of the Week,
// never in Realtime (CONTRACT «After the week»). The card's five dots stay as
// they are: this section is the panel's only.
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import type { DataPort } from "../../data/port";
import type { LessonReview, ReviewFields } from "../../data/reviews";
import { byGender } from "../../domain/names";
import { INVITE_LABEL, type InviteAgain, REVIEW_TEXT_MAX, reviewLine, reviewWindow } from "../../domain/reviews";
import type { Lesson, Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Button, Field, INPUT, useRunner } from "../settings/kit";
import type { Notify } from "../speakers/parts";
import type { Actor } from "../weekStore";
import { Choice, memberName, Problem, StageSection, whenText } from "./parts";

/** «15.2.2027» — an Israel date as the site writes dates. */
function dateText(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}.${m}.${y}`;
}

const NO_ANSWER = "";
const NO_RATING = "";

export function ReviewSection({
  port, week, lesson: l, actor, handler, notify, clear, open, onToggle,
}: {
  port: DataPort;
  week: Week;
  lesson: Lesson;
  actor: Actor;
  handler: number | null;
  notify: Notify;
  clear: () => void;
  open: boolean;
  onToggle: () => void;
}) {
  const [review, setReview] = useState<LessonReview | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const all = await port.reviews.ofEdition(week.edition.id);
      setReview(all.find((r) => r.lesson_id === l.id) ?? null);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [port, week.edition.id, l.id]);
  useEffect(() => void load(), [load]);

  const win = reviewWindow(week.edition, l, new Date().toISOString());
  const lead = week.lessonSpeakers.find((x) => x.lesson_id === l.id && x.role === "lead");
  const speaker = lead ? week.speakers.find((s) => s.id === lead.speaker_id) : undefined;
  const overranWord = byGender(speaker?.gender, "חרג מהזמן", "חרגה מהזמן", "חרג/ה מהזמן");
  const mayWrite = actor.canEdit && (actor.isAdmin || (handler != null && handler === actor.memberId && win.state === "open"));

  // an imported archive (last year's, from its tracking sheet): no one there handled a speaker in this app — its
  // reviews are the instructor's to write, with or without a date
  const imported = week.edition.kind === "archive";
  const state = review ? "done" : win.state === "open" ? "open" : "na";
  const note =
    review === undefined
      ? failed
        ? "לא נטען"
        : "טוען…"
      : review
        ? reviewLine(review, overranWord)
        : imported
          ? "מחזור שיובא — המדריך/ה כותב/ת"
          : win.state === "open"
            ? "עוד לא נכתב"
            : win.state === "before"
              ? `נפתח ב-${dateText(win.opensOn)}`
              : "נפתח אחרי השבוע (תאריך השבוע עוד TBD)";

  return (
    <StageSection stage={{ key: "review", label: "איך עבר", state, note }} open={open} onToggle={onToggle}>
      {failed ? (
        <div className="space-y-2">
          <Problem>לא הצלחנו לטעון את «איך עבר».</Problem>
          <Button onClick={() => void load()}>לנסות שוב</Button>
        </div>
      ) : review === undefined ? (
        <p className="text-sm text-ink-soft">טוען…</p>
      ) : (
        <ReviewBody
          key={`${review?.version ?? 0}`}
          port={port}
          week={week}
          lesson={l}
          review={review}
          mayWrite={mayWrite}
          win={win}
          isAdmin={actor.isAdmin}
          imported={imported}
          handlerHere={handler != null && handler === actor.memberId}
          overranWord={overranWord}
          speakerChanged={!!review && review.speaker_id != null && review.speaker_id !== (lead?.speaker_id ?? null)}
          notify={notify}
          clear={clear}
          reload={load}
        />
      )}
    </StageSection>
  );
}

function ReviewBody({
  port, week, lesson: l, review, mayWrite, win, isAdmin, imported, handlerHere, overranWord, speakerChanged, notify, clear, reload,
}: {
  port: DataPort;
  week: Week;
  lesson: Lesson;
  review: LessonReview | null;
  mayWrite: boolean;
  win: ReturnType<typeof reviewWindow>;
  isAdmin: boolean;
  /** An imported archive: the instructor writes its reviews. */
  imported: boolean;
  handlerHere: boolean;
  overranWord: string;
  speakerChanged: boolean;
  notify: Notify;
  clear: () => void;
  reload: () => Promise<void>;
}) {
  const id = useId();
  const { busy, run } = useRunner(notify, clear);
  const [wentWell, setWentWell] = useState(review?.went_well ?? "");
  const [issues, setIssues] = useState(review?.issues ?? "");
  const [invite, setInvite] = useState<InviteAgain | typeof NO_ANSWER>(review?.invite_again ?? NO_ANSWER);
  const [overran, setOverran] = useState(review?.overran ?? false);
  const [rating, setRating] = useState<string>(review?.rating != null ? String(review.rating) : NO_RATING);
  const [problem, setProblem] = useState<string | null>(null);
  const fields: ReviewFields = {
    went_well: wentWell.trim() || null,
    issues: issues.trim() || null,
    invite_again: invite === NO_ANSWER ? null : invite,
    overran,
    rating: rating === NO_RATING ? null : Number(rating),
  };
  const empty = !fields.went_well && !fields.issues && !fields.invite_again && !fields.overran && fields.rating == null;
  const dirty =
    !review ||
    fields.went_well !== review.went_well || fields.issues !== review.issues || fields.invite_again !== review.invite_again ||
    fields.overran !== review.overran || fields.rating !== review.rating;

  const written = review && (
    <p className="text-xs text-ink-soft">
      נכתב ע״י {memberName(week, review.written_by) ?? "חבר/ת צוות"}, {whenText(review.written_at)}
      {speakerChanged && " · על המרצה הקודם/ת של השיעור"}
    </p>
  );

  if (!mayWrite) {
    const why = imported
      ? "מחזור שיובא: את «איך עבר» של שנים קודמות כותב/ת המדריך/ה."
      : !handlerHere && !isAdmin
        ? "כותבים מי שמטפל/ת במרצה והמדריך/ה."
        : win.state === "before"
          ? `אפשר לכתוב מ-${dateText(win.opensOn)}, היום שאחרי השיעור (לפי שעון ישראל). המדריך/ה יכול/ה תמיד.`
          : win.state === "tbd"
            ? "אפשר לכתוב אחרי יום השיעור, כשתאריך השבוע ידוע. עד אז רק המדריך/ה."
            : null;
    return (
      <div className="space-y-2 text-sm">
        {review ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-ink-soft">מה עבד</dt>
            <dd className="whitespace-pre-line break-words">{review.went_well ?? "—"}</dd>
            <dt className="text-ink-soft">מה פחות</dt>
            <dd className="whitespace-pre-line break-words">{review.issues ?? "—"}</dd>
            <dt className="text-ink-soft">להזמין שוב?</dt>
            <dd>{review.invite_again ? INVITE_LABEL[review.invite_again] : "לא נאמר"}</dd>
            <dt className="text-ink-soft">ציון</dt>
            <dd>{review.rating != null ? `${review.rating}/5` : "—"}</dd>
            {review.overran && (
              <>
                <dt className="text-ink-soft">זמן</dt>
                <dd>{overranWord}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-ink-soft">עוד לא נכתב.</p>
        )}
        {written}
        {why && <p className="text-xs text-ink-soft">{why}</p>}
      </div>
    );
  }

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    await run("review", () => port.reviews.save(week.edition.id, l.id, review?.version ?? 0, fields), "«איך עבר» נשמר", (code) => {
      if (code === "stale") void reload();
      if (!code || !["review_empty", "review_closed", "bad_value", "stale"].includes(code)) return false;
      setProblem(errorMessage(code));
      return true;
    });
    await reload();
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="איך עבר" className="space-y-3" noValidate>
      <p className="text-xs text-ink-soft">
        {imported
          ? "מחזור שיובא: את «איך עבר» של שנים קודמות כותב/ת המדריך/ה. לצוות התוכן ולמדריך/ה בלבד — בלי מספרי טלפון."
          : isAdmin && win.state !== "open"
            ? "המדריך/ה יכול/ה לכתוב בכל זמן. מי שמטפל/ת במרצה — מהיום שאחרי השיעור."
          : "לצוות התוכן ולמדריך/ה בלבד: לא לצוות הלוגיסטי, לא בקישורים ולא בייצוא למעצבת. בלי מספרי טלפון."}
      </p>
      <Field id={`${id}-well`} label="מה עבד (לא חובה)">
        <textarea id={`${id}-well`} rows={3} value={wentWell} maxLength={REVIEW_TEXT_MAX} onChange={(e) => setWentWell(e.target.value)} className={`${INPUT} py-2`} />
      </Field>
      <Field id={`${id}-issues`} label="מה פחות (לא חובה)">
        <textarea id={`${id}-issues`} rows={3} value={issues} maxLength={REVIEW_TEXT_MAX} onChange={(e) => setIssues(e.target.value)} className={`${INPUT} py-2`} />
      </Field>
      <Choice
        name={`${id}-invite`}
        legend="להזמין שוב?"
        value={invite}
        options={[["yes", INVITE_LABEL.yes], ["no", INVITE_LABEL.no], ["maybe", INVITE_LABEL.maybe], [NO_ANSWER, "לא נאמר"]] as const}
        onChange={setInvite}
      />
      <label className="flex min-h-11 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={overran} onChange={(e) => setOverran(e.target.checked)} className="size-5 accent-ink" />
        {overranWord}
      </label>
      <Choice
        name={`${id}-rating`}
        legend="ציון (לא חובה)"
        value={rating}
        options={[["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], [NO_RATING, "בלי ציון"]] as const}
        onChange={setRating}
      />
      {written}
      {problem && <Problem>{problem}</Problem>}
      <Button kind="primary" type="submit" disabled={!dirty || empty} busy={busy === "review"} busyLabel="שומר…">
        שמירה
      </Button>
      {empty && <p className="text-xs text-ink-soft">כדי לשמור צריך לכתוב או לבחור משהו אחד לפחות.</p>}
    </form>
  );
}
