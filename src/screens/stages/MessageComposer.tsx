// The summary message to the speaker (DESIGN «תוצרים» 3): the instructor's
// template filled in for this lesson by src/domain/message.ts — a preview, and
// while anything is unresolved (no template, a TBD, a gender, a request still
// waiting) the list of what is missing instead of the buttons. Then: «העתקה»,
// WhatsApp (to the speaker's number only for whom may see it, else a chat to
// pick), mail, and «סומן כנשלח». Nothing is sent from the site. Used in the
// lesson panel and in the speaker sheet.
import { useRef } from "react";
import { Link } from "react-router";
import { mailtoHref, waHref, whatsappTextHref } from "../../domain/contactLinks";
import { composeConfirmation, confirmSubject } from "../../domain/message";
import type { Lesson, Speaker, SpeakerContacts, Week } from "../../domain/types";
import { ReconfirmDot } from "../../grid/bits";
import { Button } from "../settings/kit";
import type { Notify } from "../speakers/parts";
import type { Actor } from "../weekStore";
import { LINK_BUTTON, memberName, whenText } from "./parts";

export interface ComposerProps {
  week: Week;
  lesson: Lesson;
  /** The lead speaker. */
  speaker: Speaker | null;
  actor: Actor;
  /** The lesson's handler (members.id). */
  handler: number | null;
  /** The handler or an admin: may copy, open and mark it sent. */
  mine: boolean;
  /** The speaker's contacts when the caller may see them; null when not theirs to see; undefined while loading. */
  contacts: SpeakerContacts | null | undefined;
  busy: boolean;
  /** «סומן כנשלח» (mark_confirm_sent). */
  onSent: () => void;
  notify: Notify;
}

export function MessageComposer({ week, lesson: l, speaker, actor, handler, mine, contacts, busy, onSent, notify }: ComposerProps) {
  const preview = useRef<HTMLDivElement>(null);
  const sender = week.team.find((t) => t.id === actor.memberId) ?? null;
  const c = composeConfirmation({
    template: week.edition.settings.confirm_template,
    lesson: l,
    speaker,
    sender: sender ? { gender: sender.gender } : null,
    room: week.rooms.find((r) => r.id === l.room_id)?.name ?? null,
    startDate: week.edition.start_date,
    lessonMinutes: week.edition.settings.lesson_minutes,
  });
  const emptyTemplate = c.problems.some((p) => p.code === "template_empty");
  const noSenderGender = c.problems.some((p) => p.code === "sender_gender");
  // The sender's gender is fixed by whoever may: an admin, in «הפרטים שלי»; anyone else asks the instructor (set_my_profile is an admin's).
  const problemText = (p: (typeof c.problems)[number]) =>
    p.code !== "sender_gender"
      ? p.message
      : actor.isAdmin
        ? "חסר המגדר שלך ברשימת הצוות, והנוסח משתנה לפי מגדר השולח/ת ({{אני:…|…}})."
        : "המגדר שלך לא רשום ברשימת הצוות, והנוסח משתנה לפי מגדר השולח/ת. המדריך/ה מוסיף/ה אותו בהגדרות ← צוות (עריכה ליד השם שלך).";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(c.text);
      notify("ok", "ההודעה הועתקה");
    } catch {
      // No clipboard (an old browser, a permission): select the text, so it can be copied by hand.
      const el = preview.current;
      const sel = window.getSelection();
      if (el && sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      notify("error", "לא הצלחנו להעתיק. הטקסט מסומן: אפשר להעתיק אותו ידנית.");
    }
  };

  return (
    <div className="space-y-3">
      {/* not yet sent: the stage's own row says so */}
      {l.confirm_sent_at && (
        <p className="text-sm">
          נשלחה · <bdi>{whenText(l.confirm_sent_at)}</bdi>
          {l.confirm_sent_by != null && <> · {memberName(week, l.confirm_sent_by)}</>}
        </p>
      )}
      {l.needs_reconfirm && (
        <p className="flex items-start gap-2 rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-sm">
          <ReconfirmDot className="mt-1" />
          <span>
            <b>לעדכן את המרצה:</b> השיעור השתנה אחרי שההודעה נשלחה. שולחים את ההודעה המעודכנת, ומסמנים שוב «סומן כנשלח».
          </span>
        </p>
      )}

      {c.problems.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-semibold">עוד אי אפשר לשלוח:</p>
          <ul aria-label="מה חסר כדי לשלוח" className="list-disc space-y-0.5 ps-5">
            {c.problems.map((p, i) => (
              <li key={i}>{problemText(p)}</li>
            ))}
          </ul>
          {actor.isAdmin && (emptyTemplate || noSenderGender) && (
            <div className="mt-2 flex flex-wrap gap-x-4">
              {emptyTemplate && (
                <Link to="/settings/templates" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
                  לנוסח, בהגדרות ‹
                </Link>
              )}
              {noSenderGender && (
                <Link to="/settings/team" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
                  למגדר שלי, בהגדרות ‹
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {c.text && (
        <section aria-label="תצוגה מקדימה של ההודעה" className="space-y-1">
          <p className="text-xs font-semibold text-ink-soft">{c.ok ? "ההודעה" : "תצוגה מקדימה (עם מה שחסר)"}</p>
          <div ref={preview} className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-card p-3 text-sm leading-relaxed">
            {c.text}
          </div>
        </section>
      )}

      {c.ok && mine && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void copy()}>העתקה</Button>
            <a href={whatsappTextHref(c.text, contacts?.phone)} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
              WhatsApp
            </a>
            <a href={mailtoHref(contacts?.email, confirmSubject(week.edition.label), c.text)} className={LINK_BUTTON}>
              מייל
            </a>
          </div>
          {/* a word only when WhatsApp opens without the speaker (the guide says the site itself sends nothing) */}
          {contacts === undefined ? (
            <p className="text-xs text-ink-soft">טוען את פרטי הקשר…</p>
          ) : (
            !waHref(contacts?.phone) && <p className="text-xs text-ink-soft">WhatsApp ייפתח בלי נמען: בוחרים את המרצה ברשימת השיחות.</p>
          )}
          <div className="border-t border-line pt-3">
            <Button kind="primary" busy={busy} onClick={onSent}>
              סומן כנשלח
            </Button>
          </div>
        </>
      )}
      {!mine && (
        <p className="text-xs text-ink-soft">
          את ההודעה שולחים מי שמטפל/ת במרצה{handler != null && memberName(week, handler) ? ` (${memberName(week, handler)})` : ""}, או המדריך/ה.
        </p>
      )}
    </div>
  );
}
