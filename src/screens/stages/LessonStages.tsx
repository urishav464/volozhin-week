// A closed lesson's stages in the lesson panel (DESIGN «התא לפי שלב»): the five
// the card's dots stand for — תשלום/הסעה · הודעת סיכום · מלווה · מקורות ·
// מקראה — each a section that opens, and a red banner while the speaker must
// be told again. Every change is a WeekCommand (CONTRACT «From placement to
// arrival»), so the demo refuses exactly what the database refuses.
//
// Who may do what (the database decides; the screen only offers it):
//   the handler or an admin — the payment/transport request, «סומן כנשלח»;
//   any content member or admin — the escort, the sources;
//   a global admin — approve or reject a request;
//   logistics or an admin — «שולם», and the transport's details once approved.
import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router";
import type { DataPort } from "../../data/port";
import { PRINT_WHENS, readerKind, SOURCES_KINDS, STAGE_LIMITS } from "../../data/stageRules";
import { dutyNotes, escortLoad, SELF_INTRO_FROM, suggestSelfIntro } from "../../domain/escorts";
import { PRINT_WHEN_LABEL, readerFilesOf, SOURCES_LABEL, type StageKey, stagesOf } from "../../domain/stages";
import { DAY_NAMES, fmt, fmtRange } from "../../domain/time";
import { byGender } from "../../domain/names";
import type { Gender, PrintWhen, SourcesKind, SpeakerContacts, Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { ReconfirmDot } from "../../grid/bits";
import { escortClashes, ESCORT_MIN_GAP } from "../../rules/warnings";
import { Button, Field, INPUT, useRunner } from "../settings/kit";
import type { Notify } from "../speakers/parts";
import type { Actor } from "../weekStore";
import { MessageComposer } from "./MessageComposer";
import { type Act, Choice, EscortTicksLine, LINK_BUTTON, Problem, type StageCtx, StageSection } from "./parts";
import { PaymentStage } from "./PaymentStage";
import { SourceFiles } from "./SourceFiles";
import { ReviewSection } from "./ReviewStage";
import { MEMORIAL_SAID, readerManifest, STATUS_LABEL, unreadText, wordText } from "../../reader/model";

export interface LessonStagesProps {
  port: DataPort;
  week: Week;
  lessonId: number;
  actor: Actor;
  /** The section to open first (from «המרצים שלי», or the approvals queue). */
  focus?: StageKey | null;
  notify: Notify;
  clear: () => void;
  /** Re-reads the week after a command. */
  reload: () => Promise<void>;
}

export function LessonStages({ port, week, lessonId, actor, focus, notify, clear, reload }: LessonStagesProps) {
  const cmds = useMemo(() => port.commands(week.edition.id), [port, week.edition.id]);
  const { busy, run } = useRunner(notify, clear);
  const [open, setOpen] = useState<Set<StageKey>>(() => new Set(focus ? [focus] : []));
  const [reviewOpen, setReviewOpen] = useState(false);
  // From «המרצים שלי»: the section it was opened for comes into view.
  useEffect(() => {
    if (focus) requestAnimationFrame(() => document.getElementById(`stage-${focus}`)?.scrollIntoView({ block: "start" }));
  }, [focus]);

  const l = week.lessons.find((x) => x.id === lessonId);
  if (!l || l.state !== "closed") return null;

  const act: Act = async (key, fn, ok, onRefused) => {
    const done = await run(key, fn, ok, onRefused);
    await reload();
    return done;
  };
  const lead = week.lessonSpeakers.find((x) => x.lesson_id === l.id && x.role === "lead");
  const speaker = lead ? (week.speakers.find((s) => s.id === lead.speaker_id) ?? null) : null;
  const handler = speaker ? (week.approaches.find((a) => a.speaker_id === speaker.id)?.owner_member_id ?? null) : null;
  const mine = actor.canEdit && (actor.isAdmin || (handler != null && handler === actor.memberId));
  const ctx: StageCtx = { week, lesson: l, actor, cmds, busy, act, handler, mine };
  const stages = stagesOf(l, readerFilesOf(week, l.id));
  const toggle = (k: StageKey) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(k)) next.add(k);
      return next;
    });
  const show = (k: StageKey) => {
    setOpen((cur) => new Set(cur).add(k));
    requestAnimationFrame(() => document.getElementById(`stage-${k}`)?.scrollIntoView({ block: "start" }));
  };
  const body = (k: StageKey) => {
    switch (k) {
      case "pay":
        return <PaymentStage {...ctx} />;
      case "msg":
        return <MessageStage {...ctx} port={port} speakerId={speaker?.id ?? null} notify={notify} />;
      case "escort":
        return <EscortStage key={l.version} {...ctx} speakerGender={speaker?.gender ?? null} />;
      case "sources":
        return (
          <>
            <SourceFiles port={port} week={week} lesson={l} actor={actor} notify={notify} clear={clear} reload={reload} />
            <SourcesStage key={l.version} {...ctx} onReader={() => show("reader")} />
          </>
        );
      case "reader":
        return <ReaderStage {...ctx} onSources={() => show("sources")} />;
    }
  };

  return (
    <section aria-labelledby="stages-title" className="space-y-2">
      <h3 id="stages-title" className="text-xs font-semibold tracking-wide text-ink-soft">
        שלבים
      </h3>
      {l.needs_reconfirm && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-sm">
          <ReconfirmDot />
          <span className="min-w-0 flex-1">
            <b>לעדכן את המרצה:</b> השיעור השתנה אחרי שהודעת הסיכום נשלחה.
          </span>
          {!open.has("msg") && <Button onClick={() => show("msg")}>להודעה</Button>}
        </div>
      )}
      {week.edition.kind === "archive" && <ImportNote cmds={cmds} lessonId={l.id} />}
      {stages.map((s) => (
        <StageSection key={s.key} stage={s} open={open.has(s.key)} onToggle={() => toggle(s.key)}>
          {body(s.key)}
        </StageSection>
      ))}
      {/* after the week (milestone 6): opinions about the speaker — the edition's content members and admins only */}
      {actor.role !== "logistics" && l.kind === "lesson" && (
        <ReviewSection port={port} week={week} lesson={l} actor={actor} handler={handler} notify={notify} clear={clear} open={reviewOpen} onToggle={() => setReviewOpen((v) => !v)} />
      )}
    </section>
  );
}

// ------------------------------------------------------------------ last year's sheet

/**
 * What last year's tracking sheet said about an imported lesson that has no field of its own (v12, the import of
 * 5786): read one lesson at a time, under the transport details' rule — for an archive, a global admin's only. Its
 * transport words are personal data: never in the Week, Realtime or the offline copy; the purge deletes them.
 */
function ImportNote({ cmds, lessonId }: { cmds: StageCtx["cmds"]; lessonId: number }) {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    cmds.importNote(lessonId).then(
      (n) => live && setNote(n),
      () => live && setNote(null),
    );
    return () => {
      live = false;
    };
  }, [cmds, lessonId]);
  if (!note) return null;
  return (
    <section aria-label="מגיליון המעקב של אשתקד" className="rounded-lg border border-line bg-paper p-2.5">
      <h4 className="mb-1 text-sm font-semibold">מגיליון המעקב של אשתקד</h4>
      <p className="text-sm whitespace-pre-line break-words">{note}</p>
      <p className="mt-1 text-xs text-ink-soft">כמו פרטי ההסעה: רק אדמין כללי/ת רואה, ונמחק במחיקת המידע האישי של המחזור.</p>
    </section>
  );
}

// ------------------------------------------------------------------ the message

/** The composer, with the lead speaker's contacts (only when the caller may see them) for WhatsApp and mail. */
function MessageStage({ port, speakerId, notify, ...ctx }: StageCtx & { port: DataPort; speakerId: number | null; notify: Notify }) {
  const { week, lesson: l, actor, cmds, busy, act, handler, mine } = ctx;
  const [contacts, setContacts] = useState<SpeakerContacts | null | undefined>(undefined);
  useEffect(() => {
    if (speakerId == null || !mine) return void setContacts(null);
    let live = true;
    port.speakers.contacts(speakerId).then(
      (c) => live && setContacts(c),
      () => live && setContacts(null),
    );
    return () => {
      live = false;
    };
  }, [port, speakerId, mine]);
  const speaker = week.speakers.find((s) => s.id === speakerId) ?? null;
  return (
    <MessageComposer
      week={week}
      lesson={l}
      speaker={speaker}
      actor={actor}
      handler={handler}
      mine={mine}
      contacts={contacts}
      busy={busy === "sent"}
      notify={notify}
      onSent={() => void act("sent", () => cmds.markConfirmSent(l.id, l.version), "סומן שההודעה נשלחה")}
    />
  );
}

// ------------------------------------------------------------------ the escort

/** «2 שיעורים», «שיעור אחד», «עוד לא מלווה». */
const loadText = (n: number) => (n === 0 ? "עוד לא מלווה" : n === 1 ? "שיעור אחד" : `${n} שיעורים`);

function gapText(gap: number): string {
  if (gap < 0) return "באותה שעה";
  if (gap === 0) return "צמוד, בלי הפסקה";
  return `${gap} דקות ביניהם`;
}

/** The escort from the edition's roster (with each trainee's load), self-introduction, a note, and the duty notes they will read. */
function EscortStage({ week, lesson: l, actor, cmds, busy, act, speakerGender }: StageCtx & { speakerGender: Gender | null }) {
  const id = useId();
  const load = useMemo(() => escortLoad(week), [week]);
  const roster = useMemo(() => [...week.roster].sort((a, b) => a.full_name.localeCompare(b.full_name, "he") || a.id - b.id), [week.roster]);
  // Nothing saved yet, and the lesson is at night: «הצגה עצמית» is pre-filled as a suggestion — stored only on «שמירה».
  const fresh = l.escort_roster_id == null && !l.self_intro && l.escort_note == null;
  const suggested = fresh && suggestSelfIntro(l);
  const [rosterId, setRosterId] = useState<number | null>(l.escort_roster_id);
  const [selfIntro, setSelfIntro] = useState(l.self_intro || suggested);
  const [note, setNote] = useState(l.escort_note ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const nameOf = (rid: number | null) => (rid == null ? null : (week.roster.find((r) => r.id === rid)?.full_name ?? "חניך/ה שנמחק/ה"));
  const clashes = rosterId != null ? escortClashes(week, l, rosterId) : [];
  const notes = dutyNotes({ kind: l.kind, self_intro: selfIntro, transport: l.transport, approval: l.approval }, week.edition.settings.duty_phrases);
  const noteValue = note.trim() || null;
  const dirty = rosterId !== l.escort_roster_id || selfIntro !== l.self_intro || noteValue !== l.escort_note;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    await act("escort", () => cmds.setEscort(l.id, l.version, { roster_id: rosterId, self_intro: selfIntro, escort_note: noteValue }), "המלווה נשמר/ה", (code) => {
      if (code !== "bad_escort" && code !== "bad_value") return false;
      setProblem(errorMessage(code));
      return true;
    });
  };

  const dutyList = (
    <div className="space-y-1">
      <p className="text-sm font-semibold">משהו שחשוב לדעת (ברשימת המלווים)</p>
      {notes.length === 0 && !noteValue ? (
        <p className="text-sm text-ink-soft">
          {(week.edition.settings.duty_phrases ?? []).length === 0
            ? "עוד אין ניסוחים: המדריך/ה מדביק/ה אותם בהגדרות, בלשונית «תבניות» (מקובץ המלווים של אשתקד)."
            : "אין ניסוח שחל על השיעור הזה."}
        </p>
      ) : (
        <ul aria-label="משהו שחשוב לדעת" className="list-disc space-y-0.5 ps-5 text-sm">
          {notes.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
          {noteValue && <li>{noteValue}</li>}
        </ul>
      )}
    </div>
  );

  // what the escort ticked through their link (the team only reads it)
  const ticks = l.escort_roster_id != null && (
    <div className="space-y-1">
      <p className="text-sm font-semibold">מה המלווה סימן/ה בקישור</p>
      <EscortTicksLine week={week} lessonId={l.id} />
    </div>
  );

  if (!actor.canEdit) {
    return (
      <>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-soft">מלווה</dt>
          <dd>{nameOf(l.escort_roster_id) ?? "אין"}</dd>
          <dt className="text-ink-soft">הצגה עצמית</dt>
          <dd>{l.self_intro ? "כן" : "לא"}</dd>
        </dl>
        {ticks}
        {dutyList}
      </>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="שיבוץ מלווה" className="space-y-3" noValidate>
      {roster.length === 0 ? (
        <p className="text-sm text-ink-soft">רשימת החניכים של המחזור ריקה. מוסיפים אותה בהגדרות, בלשונית «חניכים».</p>
      ) : (
        <Field id={`${id}-who`} label="מלווה מרשימת החניכים" hint="ליד כל שם: כמה שיעורים הוא/היא כבר מלווה.">
          <select id={`${id}-who`} value={rosterId ?? ""} onChange={(e) => setRosterId(e.target.value ? Number(e.target.value) : null)} className={INPUT} aria-describedby={`${id}-who-hint`}>
            <option value="">בלי מלווה</option>
            {/* an escort deleted from the roster meanwhile stays visible until changed */}
            {rosterId != null && !roster.some((r) => r.id === rosterId) && <option value={rosterId}>{nameOf(rosterId)}</option>}
            {roster.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name} · {loadText(load.get(r.id) ?? 0)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {clashes.length > 0 && (
        <ul aria-label="שיעורים קרובים של המלווה" className="space-y-1">
          {clashes.map(({ lesson: o, gap }) => (
            <li key={o.id} className="rounded-md bg-amber-50 px-2 py-1 text-sm text-amber-900">
              ⚠ {nameOf(rosterId)} כבר מלווה ב{DAY_NAMES[o.day]} <bdi>{fmtRange(o.start_min, o.end_min)}</bdi>: {gapText(gap)} (הצעה: לפחות {ESCORT_MIN_GAP} דקות)
            </li>
          ))}
        </ul>
      )}
      <div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={selfIntro} onChange={(e) => setSelfIntro(e.target.checked)} className="size-5 accent-ink" />
          הצגה עצמית: {byGender(speakerGender, "המרצה מציג את עצמו", "המרצה מציגה את עצמה", "המרצה מציג/ה את עצמו/ה")}
        </label>
        {suggested && selfIntro && !l.self_intro && (
          <p className="text-xs text-ink-soft">
            <b>הצעה:</b> השיעור מ-<bdi>{fmt(SELF_INTRO_FROM)}</bdi> ועד הבוקר, ולכן הסימון מוצע מראש. הוא נשמר רק ב«שמירה».
          </p>
        )}
      </div>
      <Field id={`${id}-note`} label="הערה למלווה (לא חובה)" hint="נכנסת ל«משהו שחשוב לדעת». בלי מספרי טלפון.">
        <textarea id={`${id}-note`} rows={2} value={note} maxLength={STAGE_LIMITS.escort_note} onChange={(e) => setNote(e.target.value)} className={`${INPUT} py-2`} aria-describedby={`${id}-note-hint`} />
      </Field>
      {dutyList}
      {ticks}
      {problem && <Problem>{problem}</Problem>}
      <Button kind="primary" type="submit" disabled={!dirty} busy={busy === "escort"} busyLabel="שומר…">
        שמירה
      </Button>
    </form>
  );
}

// ------------------------------------------------------------------ sources

/** What arrived for the lesson and when it is printed (the files themselves: SourceFiles, above it). */
function SourcesStage({ lesson: l, actor, cmds, busy, act, onReader }: StageCtx & { onReader: () => void }) {
  const id = useId();
  const [kind, setKind] = useState<SourcesKind>(l.sources_kind);
  const [print, setPrint] = useState<PrintWhen>(l.print_when);
  const [note, setNote] = useState(l.sources_note ?? "");
  const [url, setUrl] = useState(l.presentation_url ?? "");
  const [inReader, setInReader] = useState(l.in_reader);
  const [problem, setProblem] = useState<{ text: string; url: boolean } | null>(null);
  const printable = readerKind(kind);
  const showUrl = kind === "presentation" || kind === "sheet_presentation" || url.trim() !== "";
  const next = { sources_kind: kind, print_when: print, sources_note: note.trim() || null, presentation_url: url.trim() || null, in_reader: inReader && printable };
  const dirty =
    next.sources_kind !== l.sources_kind || next.print_when !== l.print_when || next.sources_note !== l.sources_note || next.presentation_url !== l.presentation_url || next.in_reader !== l.in_reader;
  const link = l.presentation_url && /^https?:\/\//i.test(l.presentation_url) ? l.presentation_url : null;

  if (!actor.canEdit) {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-soft">מה התקבל</dt>
        <dd>{SOURCES_LABEL[l.sources_kind]}</dd>
        <dt className="text-ink-soft">הדפסה</dt>
        <dd>{PRINT_WHEN_LABEL[l.print_when]}</dd>
        {l.sources_note && (
          <>
            <dt className="text-ink-soft">הערה</dt>
            <dd className="whitespace-pre-line break-words">{l.sources_note}</dd>
          </>
        )}
        {link && (
          <>
            <dt className="text-ink-soft">מצגת</dt>
            <dd className="min-w-0 break-all">
              <a href={link} target="_blank" rel="noopener noreferrer" className="underline">
                פתיחת המצגת
              </a>
            </dd>
          </>
        )}
      </dl>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    await act("sources", () => cmds.setSources(l.id, l.version, next), "המקורות נשמרו", (code) => {
      if (code !== "bad_url" && code !== "bad_value") return false;
      setProblem({ text: errorMessage(code), url: code === "bad_url" });
      return true;
    });
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="מקורות" className="space-y-3" noValidate>
      <Choice name={`${id}-kind`} legend="מה התקבל מהמרצה" value={kind} options={SOURCES_KINDS.map((k) => [k, SOURCES_LABEL[k]] as const)} onChange={setKind} />
      <Choice name={`${id}-print`} legend="הדפסה" value={print} options={PRINT_WHENS.map((p) => [p, PRINT_WHEN_LABEL[p]] as const)} onChange={setPrint} />
      {showUrl && (
        <Field id={`${id}-url`} label="קישור למצגת" hint="מתחיל ב-https://">
          <input
            id={`${id}-url`}
            type="url"
            dir="ltr"
            inputMode="url"
            value={url}
            maxLength={STAGE_LIMITS.url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={problem?.url ? true : undefined}
            aria-describedby={`${id}-url-hint`}
            className={INPUT}
            autoComplete="off"
          />
        </Field>
      )}
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4">
          פתיחת המצגת ‹
        </a>
      )}
      <Field id={`${id}-note`} label="הערה (לא חובה)">
        <textarea id={`${id}-note`} rows={2} value={note} maxLength={STAGE_LIMITS.sources_note} onChange={(e) => setNote(e.target.value)} className={`${INPUT} py-2`} />
      </Field>
      <div>
        <label className={`flex min-h-11 items-center gap-2 ${printable ? "cursor-pointer" : "text-ink-soft"}`}>
          <input type="checkbox" checked={inReader && printable} disabled={!printable} onChange={(e) => setInReader(e.target.checked)} className="size-5 accent-ink" />
          להכניס למקראה
        </label>
        {!printable && <p className="text-xs text-ink-soft">אין כאן מה להדפיס (טרם התקבלו, בלי מקורות, או מצגת בלבד).</p>}
      </div>
      <div className="space-y-1">
        <p className="text-xs text-ink-soft">
          כשמעלים קובץ ראשון, «טרם התקבלו» הופך ל«דף מקורות», והשיעור מסומן להיכנס למקראה (אם יש בו מה להדפיס).
        </p>
        <button type="button" onClick={onReader} className={LINK_BUTTON}>
          על המקראה
        </button>
      </div>
      {problem && <Problem>{problem.text}</Problem>}
      <Button kind="primary" type="submit" disabled={!dirty} busy={busy === "sources"} busyLabel="שומר…">
        שמירה
      </Button>
    </form>
  );
}

/** The reader's place: what the manifest says of this lesson (src/reader/model.ts), and the way to the reader. */
function ReaderStage({ week, lesson: l, actor, onSources }: StageCtx & { onSources: () => void }) {
  const row = useMemo(() => readerManifest(week).rows.find((r) => r.lesson.id === l.id), [week, l.id]);
  const status = row?.status ?? "missing";
  const said: Record<typeof status, string> = {
    included: `בתוך המקראה: ${row?.printable.length === 1 ? "קובץ אחד" : `${row?.printable.length} קבצים`}, ${row?.pages === 1 ? "עמוד אחד" : `${row?.pages} עמודים`}, אחרי הכותרת «${row?.header}».`,
    needs_pdf: "מסומן למקראה, אבל הקבצים הם Word: צריך להעלות PDF (Word לא נכנס למקראה שנבנית בדפדפן).",
    unreadable: "מסומן למקראה, אבל הקבצים שהועלו לא נקראו (מוגנים בסיסמה, פגומים או בפורמט אחר): צריך להעלות קובץ אחר.",
    missing: "מסומן למקראה, ועוד לא הועלה קובץ: חסר.",
    not_marked: "הקבצים הועלו, ועוד לא סומן שהשיעור נכנס למקראה.",
    pending: "המקורות עוד לא התקבלו.",
    presentation_only: "מצגת בלבד: לא נכנסת למקראה.",
    no_sources: "בלי מקורות: אין מה להדפיס במקראה.",
    ...MEMORIAL_SAID,
  };
  // what the reader leaves out beside it, in the manifest's words (Word is the whole story of «צריך PDF», as the unread files are of «צריך קובץ אחר»)
  const besides = [
    row && row.word.length > 0 && status === "included" && wordText(row.word.length),
    row && row.unread.length > 0 && status !== "unreadable" && unreadText(row.unread.length, status === "included"),
  ].filter(Boolean);
  return (
    <div className="space-y-2 text-sm">
      <p>
        <b>{STATUS_LABEL[status]}.</b> {said[status]}
        {besides.map((t) => ` ${t}.`).join("")}
      </p>
      <div className="flex flex-wrap gap-2">
        {actor.canEdit && <Button onClick={onSources}>למקורות ולקבצים</Button>}
        {actor.role !== "logistics" && (
          <Link to="/reader" className={LINK_BUTTON}>
            למקראה ‹
          </Link>
        )}
      </div>
    </div>
  );
}
