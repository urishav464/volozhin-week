// The lesson page's «לאתר האורחים» (#guest, the reset, phase 5): a closed lesson's short description for guests
// (`public_note`, update_lesson — only that key is sent, so «פרטי השיעור»'s four are never written over), its speakers'
// approval to appear (PublicOkSwitch, on THAT speaker's approach) and what each lacks — the description and the photo
// are edited in one place, the speaker page's #guest — and a folded preview of the guests' card (CardBody, the guest
// site's own, from publicSchedule's row: what the link shows). Below the steps — never a step: the five dots and the six
// steps stay. LessonScreen draws it for a closed lesson outside an archive; its root is the PageSection `id="guest"`.
import { type FormEvent, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { CommandError } from "../../data/commands";
import type { DataPort } from "../../data/port";
import { cleanPublicNote, STAGE_LIMITS } from "../../data/stageRules";
import { guestLine, guestPhotoIds, guestPreview, guestRows, mayChangePublicOk } from "../../domain/guestSite";
import { byGender, displayName } from "../../domain/names";
import { speakerPath } from "../../domain/routes";
import { errorMessage } from "../../errors";
import { Chip } from "../../grid/bits";
import type { GridModel } from "../../grid/model";
import { CardBody } from "../public/GuestCard";
import { Button, INPUT, useFocusRescue } from "../settings/kit";
import { PageSection } from "../speakerPages/page";
import type { Notify } from "../speakers/parts";
import { PublicOkSwitch, publicOkDone, publicOkHint, useGuestPhotos } from "../speakers/PublicOk";
import { LINK_BUTTON, type StageCtx } from "../stages/parts";

export interface GuestLessonProps {
  port: DataPort;
  model: GridModel;
  /** The lesson page's own: the week, the (closed) lesson, who is looking, the commands, `act` (a command, then the week again). */
  ctx: StageCtx;
  notify: Notify;
  clear: () => void;
}

const NOTE_REFUSAL: Record<string, string> = {
  contact_in_text: "יש כאן טלפון או מייל. האורחים קוראים את התיאור — מסירים ומנסים שוב.",
  bad_value: `עד ${STAGE_LIMITS.public_note} תווים.`,
};

const refusalText = (code: string | null): string | null => (code == null ? null : (NOTE_REFUSAL[code] ?? (code === "stale" ? errorMessage("stale") : null)));

export function GuestLesson({ port, model, ctx }: GuestLessonProps) {
  const { week, lesson: l, actor } = ctx;
  const row = useMemo(() => guestRows(week).find((r) => r.lessonId === l.id) ?? null, [week, l.id]);
  if (!row) return null;
  // the hint once, under the list — only to a viewer who may change at least one of the boxes (as PublicOkSwitch's own)
  const marking = row.people.some((p) => {
    const a = p.approachId == null ? undefined : model.approachById.get(p.approachId);
    return a != null && mayChangePublicOk(actor, week.edition, a);
  });
  return (
    <div data-lesson-guest>
      <PageSection id="guest" title="לאתר האורחים" aside={<span data-guest-line>{guestLine(row)}</span>}>
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <NoteBox ctx={ctx} />
            <div className="min-w-0 space-y-2">
              <h4 className="font-bold text-navy">המרצים</h4>
              <ul className="space-y-2">
                {row.people.map((p) => {
                  const s = model.speakerById.get(p.speakerId);
                  if (!s) return null;
                  const a = p.approachId == null ? undefined : model.approachById.get(p.approachId);
                  return (
                    <li key={p.speakerId} data-guest-speaker={p.speakerId} className="space-y-1 rounded-xl border border-line bg-paper-light px-3 py-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link to={speakerPath(s.id, "guest")} className="inline-flex min-h-11 items-center font-bold text-navy underline-offset-4 hover:underline">
                          {displayName(s)}
                        </Link>
                        {p.role === "co" && <span className="text-sm text-ink-soft">{byGender(s.gender, "מרצה נוסף", "מרצה נוספת")}</span>}
                      </div>
                      {a ? (
                        <>
                          <PublicOkSwitch
                            speaker={s}
                            approach={a}
                            actor={actor}
                            edition={week.edition}
                            busy={ctx.busy === `public-ok:${a.id}`}
                            hint={false}
                            onSet={(ok) => ctx.act(`public-ok:${a.id}`, () => port.speakers.setPublicOk(week.edition.id, a.id, a.version, ok), publicOkDone(s, ok))}
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <Chip tone={p.bio ? "ok" : "plain"}>{p.bio ? "תיאור: יש" : "תיאור: חסר"}</Chip>
                            <Chip tone={p.photo ? "ok" : "plain"}>{p.photo ? "תמונה: יש" : "תמונה: חסרה"}</Chip>
                            <Link to={speakerPath(s.id, "guest")} className={LINK_BUTTON}>
                              לתיאור ולתמונה ‹
                            </Link>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-ink-soft">בלי פנייה במחזור: {byGender(s.gender, "מופיע", "מופיעה")} באתר רק בשם, בשורת השיעור</p>
                      )}
                    </li>
                  );
                })}
              </ul>
              {marking && <p className="max-w-prose text-xs text-ink-soft">{publicOkHint(row.people.length === 1 ? model.speakerById.get(row.people[0].speakerId)?.gender : null)}</p>}
            </div>
          </div>
          <Preview port={port} ctx={ctx} ids={guestPhotoIds([row])} />
        </div>
      </PageSection>
    </div>
  );
}

/** «תיאור קצר לשיעור (רשות)»: read, and for an editor (update_lesson: any editor) a form of its own. */
function NoteBox({ ctx }: { ctx: StageCtx }) {
  const { lesson: l, actor } = ctx;
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const rescue = useFocusRescue();
  const note = l.public_note?.trim() ? l.public_note : null;
  const max = STAGE_LIMITS.public_note;

  const open = (on: boolean) => {
    setProblem(null);
    setDraft(on ? (l.public_note ?? "") : null);
    rescue(() => (on ? area.current : editButton.current));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (draft == null) return;
    setProblem(null);
    let text: string | null;
    try {
      text = cleanPublicNote(draft);
    } catch (err) {
      const code = err instanceof CommandError ? err.code : null;
      setProblem(refusalText(code) ?? errorMessage(code));
      return;
    }
    if (text === (l.public_note ?? null)) return open(false);
    const ok = await ctx.act("guest-note", () => ctx.cmds.updateLesson(l.id, l.version, { public_note: text }), "התיאור לשיעור נשמר", (code) => {
      const t = refusalText(code);
      if (!t) return false;
      setProblem(t);
      return true;
    });
    if (ok) open(false);
  };

  return (
    <div className="min-w-0 space-y-2" data-note-state={note ? "y" : "-"}>
      <div className="flex min-h-11 flex-wrap items-center gap-2">
        <h4 className="font-bold text-navy">תיאור קצר לשיעור (רשות)</h4>
        {actor.canEdit && draft == null && (
          <Button ref={editButton} kind="quiet" className="ms-auto" onClick={() => open(true)}>
            עריכת התיאור
          </Button>
        )}
      </div>
      {draft == null ? (
        note ? <p className="max-w-prose whitespace-pre-line break-words leading-relaxed">{note}</p> : <p className="text-sm text-ink-soft">עוד אין תיאור לשיעור.</p>
      ) : (
        <form onSubmit={(e) => void submit(e)} aria-label="תיאור קצר לשיעור" className="space-y-2 rounded-xl bg-sand-soft p-3" noValidate>
          <label htmlFor={`${id}-note`} className="block text-sm font-bold text-ink">
            תיאור קצר לשיעור (רשות)
          </label>
          <textarea
            ref={area}
            id={`${id}-note`}
            rows={4}
            maxLength={max}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-describedby={`${id}-hint ${id}-count`}
            aria-invalid={problem ? true : undefined}
            className={`${INPUT} py-2 leading-relaxed`}
          />
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <p id={`${id}-hint`} className="min-w-0 flex-1 text-xs text-ink-soft">
              האורחים רואים אותו כשהם פותחים את השיעור. בלי טלפון ובלי מייל.
            </p>
            <span id={`${id}-count`} data-note-count className="shrink-0 text-xs tabular-nums text-ink-soft">
              <bdi dir="ltr">{`${draft.length}/${max}`}</bdi>
            </span>
          </div>
          {problem && (
            <p role="alert" className="text-sm font-semibold text-bad">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button kind="primary" type="submit" busy={ctx.busy === "guest-note"} busyLabel="שומר…">
              שמירה
            </Button>
            <Button onClick={() => open(false)}>ביטול</Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** «כך זה ייראה לאורחים», folded: the guests' card of this lesson — its approved speakers' photos read only once opened. */
function Preview({ port, ctx, ids }: { port: DataPort; ctx: StageCtx; ids: number[] }) {
  const [open, setOpen] = useState(false);
  const { photos, loading, failed } = useGuestPhotos(port, ids, open);
  const preview = open ? guestPreview(ctx.week, ctx.lesson.id, (sid) => photos.get(sid) ?? null) : null;
  const titleId = useId();
  return (
    <details className="group rounded-xl border border-line bg-paper-light px-3 py-0.5" data-guest-preview onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-[15px] font-bold text-navy hover:text-navy-800 [&::-webkit-details-marker]:hidden">
        <span>כך זה ייראה לאורחים</span>
        <span aria-hidden className="ms-auto shrink-0 text-navy motion-safe:transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="space-y-2 pb-3 pt-2">
        {loading && <p className="text-sm text-ink-soft">טוען את התמונות…</p>}
        {failed > 0 && <p className="text-sm text-ink-soft">חלק מהתמונות לא נטענו.</p>}
        {preview && (
          <div className="rounded-xl border border-line bg-card p-4 shadow-sm">
            {/* inside the page's «לאתר האורחים» (an h3): the card's title an h4, its people h5 */}
            <CardBody row={preview.row} people={preview.people} startDate={preview.startDate} titleId={titleId} level={4} />
          </div>
        )}
      </div>
    </details>
  );
}
