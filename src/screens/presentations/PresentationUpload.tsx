// «העלאת מצגת» (the reset, phase 5): a lesson's presentation, or (lessonId null) the week's own on the cover path. Picked
// or dropped, checked in the browser first (checkPicked as a presentation: one of the five types — the week's never Word —
// at most 25 MB), then up to Storage and registered as kind «presentation» with no page count (never read: it is not
// the reader's, and pdf-lib is never loaded for it). Each file's progress, then the week again. Who may: the caller
// decides (a lesson: a content member or an admin on a closed lesson; the week: an admin) — the database decides again
// (app.source_refusal); logistics is never offered an input. A presentation leaves the lesson's sources as they are: on
// a lesson still «טרם התקבלו» the page says how to mark «מצגת».
import { type DragEvent, useId, useState } from "react";
import { Link } from "react-router";
import { CommandError } from "../../data/commands";
import type { DataPort } from "../../data/port";
import { checkPicked, PRESENTATION_ACCEPT, WEEK_PRESENTATION_ACCEPT } from "../../data/sourceRules";
import { lessonPath } from "../../domain/routes";
import type { Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import type { Notify } from "../speakers/parts";
import { LINK_BUTTON } from "../stages/parts";

/** What a presentation may be, under the button. */
export const PRESENTATION_HINT = "PowerPoint \u200f(pptx), \u200fPDF, תמונה או Word · עד 25MB · לא נכנסת למקראה";
export const WEEK_PRESENTATION_HINT = "PowerPoint \u200f(pptx), \u200fPDF או תמונה · עד 25MB · לא נכנסת למקראה";

interface Upload {
  key: string;
  name: string;
  progress: number;
  error?: string;
}

export interface PresentationUploadProps {
  port: DataPort;
  week: Week;
  /** null: the week's presentation. */
  lessonId: number | null;
  notify: Notify;
  clear: () => void;
  reload: () => Promise<void>;
  /** On the lesson page itself: the «טרם התקבלו» line has no link to it. */
  onLessonPage?: boolean;
}

export function PresentationUpload({ port, week, lessonId, notify, clear, reload, onLessonPage = false }: PresentationUploadProps) {
  const id = useId();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);
  const [pendingNote, setPendingNote] = useState(false);
  const busy = uploads.some((u) => u.progress < 1 && !u.error);
  const forWeek = lessonId == null;
  const lesson = lessonId == null ? null : week.lessons.find((l) => l.id === lessonId);
  const hint = forWeek ? WEEK_PRESENTATION_HINT : PRESENTATION_HINT;

  const send = async (files: File[]) => {
    clear();
    const list = files.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, progress: 0 }));
    setUploads((u) => [...u.filter((x) => !x.error && x.progress < 1), ...list]);
    const set = (key: string, patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    const wasPending = lesson?.sources_kind === "pending";
    let ok = 0;
    for (const [i, file] of files.entries()) {
      const key = list[i].key;
      try {
        checkPicked(file, forWeek, "presentation");
        await port.sources.upload(week.edition.id, lessonId, file, { kind: "presentation", pages: null, onProgress: (p) => set(key, { progress: Math.min(0.99, p) }) });
        set(key, { progress: 1 });
        ok++;
      } catch (e) {
        set(key, { error: errorMessage(e instanceof CommandError ? e.code : "upload_failed") });
      }
    }
    if (ok > 0) {
      notify("ok", ok === 1 ? "המצגת הועלתה" : `${ok} מצגות הועלו`);
      if (wasPending) setPendingNote(true);
      await reload();
      setUploads((u) => u.filter((x) => x.error));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (busy) return;
    const files = [...e.dataTransfer.files];
    if (files.length) void send(files);
  };

  const input = (
    <>
      <input
        id={`${id}-pick`}
        type="file"
        multiple
        accept={forWeek ? WEEK_PRESENTATION_ACCEPT : PRESENTATION_ACCEPT}
        className="peer sr-only"
        // never `disabled` while busy: the input holds the focus once the picker closes, and a disabled one drops it to
        // the page — aria-disabled, and no picker or new files until the upload ends (kit's Button does the same)
        aria-disabled={busy || undefined}
        aria-describedby={`${id}-hint`}
        onClick={(e) => {
          if (busy) e.preventDefault();
        }}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length && !busy) void send(files);
        }}
      />
      {/* the input is 1px and clipped: the focus ring is drawn on the label that looks like the button */}
      <label
        htmlFor={`${id}-pick`}
        className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border border-navy bg-card px-3 text-sm font-bold text-navy transition-colors duration-150 sm:px-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${busy ? "opacity-50" : "hover:bg-accent-soft"}`}
      >
        {forWeek ? "העלאת מצגת לשבוע" : "העלאת מצגת"}
      </label>
    </>
  );

  return (
    <div data-upload-presentation={lessonId ?? "week"} className="space-y-1">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed p-3 text-sm transition-colors ${over ? "border-navy bg-accent-soft" : "border-line bg-paper-light"}`}
      >
        {input}
        <span className="ms-2 text-ink-soft pointer-coarse:hidden">או לגרור לכאן</span>
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-soft">
          {hint}
        </p>
      </div>
      {uploads.length > 0 && (
        <ul aria-label="העלאות" className="space-y-1">
          {uploads.map((u) => (
            <li key={u.key} className="text-sm">
              <div className="flex items-center gap-2">
                <bdi className="min-w-0 flex-1 truncate">{u.name}</bdi>
                <span className="shrink-0 text-xs text-ink-soft">{u.error ? "נכשל" : u.progress >= 1 ? "הועלה" : `${Math.round(u.progress * 100)}%`}</span>
              </div>
              {!u.error && (
                <div role="progressbar" aria-label={`העלאה: ${u.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.progress * 100)} className="h-1.5 rounded-full bg-line">
                  <div className="h-1.5 rounded-full bg-navy transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                </div>
              )}
              {u.error && (
                <p role="alert" className="text-xs text-bad">
                  {u.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {pendingNote && lesson?.sources_kind === "pending" && (
        <div role="status" className="space-y-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-950">
          {/* on the lesson page the choice is right below, in the same step: «מה התקבל מהמרצה» (SourcesStage) */}
          <p>המקורות עדיין מסומנים «טרם התקבלו». אם יש רק מצגת, מסמנים «מצגת» {onLessonPage ? "למטה, ב«מה התקבל מהמרצה»" : "בעמוד השיעור"}.</p>
          {!onLessonPage && lesson && (
            <Link to={lessonPath(lesson.id, "sources")} className={LINK_BUTTON}>
              לעמוד השיעור ‹
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
