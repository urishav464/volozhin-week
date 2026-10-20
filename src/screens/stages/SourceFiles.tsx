// A lesson's files (milestone 5ב-1), in the lesson panel's «מקורות»: pick or
// drop PDF, Word or a picture (≤ 25 MB), watch each go up, then the list —
// the name it had, its size, its pages (read in the browser as the reader
// reads it, src/reader/pages.ts: a PDF or a picture it cannot read is kept,
// «לא נקרא … צריך קובץ אחר»; a Word file «צריך PDF»), who uploaded it,
// «פתיחה» (a signed URL, minutes long) and «הסרה» (the uploader or an
// admin); «או לגרור לכאן» only where a mouse can drag. A previous speaker's
// files are listed apart, «מהמרצה הקודם», for removal. The whole team sees the
// list (logistics print from it); the edition's content members and admins
// upload to a closed lesson — the database decides (app.source_refusal), the
// screen only offers.
import { type DragEvent, type ReactNode, useId, useRef, useState } from "react";
import { CommandError } from "../../data/commands";
import type { DataPort } from "../../data/port";
import { checkPicked, DOCX, fromPreviousSpeaker, SOURCE_ACCEPT, sizeText } from "../../data/sourceRules";
import type { Lesson, SourceFile, Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { readerPages } from "../../reader/pages";
import { Button, Confirm } from "../settings/kit";
import type { Notify } from "../speakers/parts";
import type { Actor } from "../weekStore";
import { archivedEdition, memberName, whenText } from "./parts";

interface Upload {
  key: string;
  name: string;
  progress: number;
  error?: string;
}

/**
 * «PDF · 3 עמודים», «Word · צריך PDF», «תמונה · עמוד אחד» — and a PDF or a picture the browser could not read on
 * upload (no page count: the reader leaves it out, src/reader/model.ts readableFile) «… · לא נקרא — …; צריך קובץ אחר».
 */
export function fileKind(f: Pick<SourceFile, "mime" | "page_count">): string {
  if (f.mime === DOCX) return "Word · צריך PDF";
  const pdf = f.mime === "application/pdf";
  if (f.page_count == null) return pdf ? "PDF · לא נקרא — מוגן או פגום; צריך קובץ אחר" : "תמונה · לא נקרא — פגום או בפורמט אחר; צריך קובץ אחר";
  return pdf ? `PDF · ${f.page_count === 1 ? "עמוד אחד" : `${f.page_count} עמודים`}` : "תמונה · עמוד אחד";
}

/** May the actor remove this file (app.may_delete_source / remove_source_file): an admin; else its uploader, outside an archive. */
export function mayRemove(actor: Actor, week: Week, f: SourceFile): boolean {
  if (actor.isAdmin) return true;
  if (archivedEdition(week)) return false;
  return f.uploaded_by != null && f.uploaded_by === actor.memberId;
}

export interface SourceFilesProps {
  port: DataPort;
  week: Week;
  lesson: Lesson;
  actor: Actor;
  notify: Notify;
  clear: () => void;
  reload: () => Promise<void>;
}

/**
 * One file in a list: its name, what it is, who and when, «פתיחה» and «הסרה». `pick`: a control that chooses the file
 * (the reader's cover) — its label is the name too, so tapping the name chooses it.
 */
export function FileRow({
  port, week, file: f, actor, notify, reload, previous = false, before, pick,
}: Omit<SourceFilesProps, "lesson" | "clear"> & { file: SourceFile; previous?: boolean; before?: ReactNode; pick?: ReactNode }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<"open" | "remove" | null>(null);
  const open = async () => {
    setBusy("open");
    try {
      const url = (await port.sources.urls(week.edition.id, [f.storage_path])).get(f.storage_path);
      if (!url) throw new CommandError("read_failed");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      notify("error", errorMessage(e instanceof CommandError ? e.code : "read_failed"));
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy("remove");
    try {
      await port.sources.remove(week.edition.id, f);
      notify("ok", "הקובץ הוסר");
      await reload();
    } catch (e) {
      notify("error", errorMessage(e instanceof CommandError ? e.code : null));
    } finally {
      setBusy(null);
      setAsking(false);
    }
  };
  return (
    <li data-source-file={f.id} className={`space-y-1 py-2 ${previous ? "text-ink-soft" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {before}
        {pick ? (
          <label className="inline-flex min-h-11 min-w-0 flex-1 basis-40 cursor-pointer items-center gap-2 has-[:disabled]:cursor-default">
            {pick}
            <span className="min-w-0 break-words font-semibold">
              <bdi>{f.display_name}</bdi>
            </span>
          </label>
        ) : (
          <span className="min-w-0 flex-1 basis-40 break-words font-semibold">
            <bdi>{f.display_name}</bdi>
          </span>
        )}
        <Button busy={busy === "open"} busyLabel="פותח…" onClick={() => void open()}>
          פתיחה
        </Button>
        {mayRemove(actor, week, f) && !asking && (
          <Button kind="danger" onClick={() => setAsking(true)}>
            הסרה
          </Button>
        )}
      </div>
      <p className="text-xs text-ink-soft">
        {[...fileKind(f).split(" · "), sizeText(f.size_bytes)].map((part, i) => (
          <span key={i}>
            {i > 0 && " · "}
            <bdi>{part}</bdi>
          </span>
        ))}
        {memberName(week, f.uploaded_by) && ` · העלה/תה: ${memberName(week, f.uploaded_by)}`}
        {f.uploaded_at && ` · ${whenText(f.uploaded_at)}`}
      </p>
      {asking && (
        <Confirm
          text={<>להסיר את <bdi>{f.display_name}</bdi>? הקובץ נמחק מהשרת, ואי אפשר להחזיר אותו (אפשר להעלות שוב).</>}
          confirm="כן, להסיר"
          busy={busy === "remove"}
          onConfirm={() => void remove()}
          onCancel={() => setAsking(false)}
        />
      )}
    </li>
  );
}

/** The lesson's files and, when the actor may, the upload. */
export function SourceFiles({ port, week, lesson: l, actor, notify, clear, reload }: SourceFilesProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);
  const lead = l.state === "closed" ? (week.lessonSpeakers.find((x) => x.lesson_id === l.id && x.role === "lead")?.speaker_id ?? null) : null;
  const all = (week.sourceFiles ?? []).filter((f) => f.lesson_id === l.id).sort((a, b) => a.id - b.id);
  const current = all.filter((f) => !fromPreviousSpeaker(f, lead));
  const previous = all.filter((f) => fromPreviousSpeaker(f, lead));
  const mayUpload = actor.canEdit && l.state === "closed" && l.kind === "lesson";
  const busy = uploads.some((u) => u.progress < 1 && !u.error);

  const send = async (files: File[]) => {
    clear();
    const list = files.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, progress: 0 }));
    setUploads((u) => [...u.filter((x) => !x.error && x.progress < 1), ...list]);
    const set = (key: string, patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    let ok = 0;
    for (const [i, file] of files.entries()) {
      const key = list[i].key;
      try {
        const mime = checkPicked(file, false);
        const pages = await readerPages(file, mime);
        await port.sources.upload(week.edition.id, l.id, file, { pages, onProgress: (p) => set(key, { progress: Math.min(0.99, p) }) });
        set(key, { progress: 1 });
        ok++;
      } catch (e) {
        set(key, { error: errorMessage(e instanceof CommandError ? e.code : "upload_failed") });
      }
    }
    if (ok > 0) {
      notify("ok", ok === 1 ? "הקובץ הועלה" : `${ok} קבצים הועלו`);
      await reload();
      setUploads((u) => u.filter((x) => x.error));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!mayUpload || busy) return;
    const files = [...e.dataTransfer.files];
    if (files.length) void send(files);
  };

  return (
    <div className="space-y-2" aria-label="קבצי המקורות" role="group">
      <p className="text-sm font-semibold">הקבצים</p>
      {current.length === 0 ? (
        <p className="text-sm text-ink-soft">{l.state === "closed" ? "עוד לא הועלו קבצים לשיעור הזה." : "אין קבצים של המרצה הנוכחי/ת."}</p>
      ) : (
        <ul aria-label="קבצים שהועלו" className="divide-y divide-line">
          {current.map((f) => (
            <FileRow key={f.id} port={port} week={week} file={f} actor={actor} notify={notify} reload={reload} />
          ))}
        </ul>
      )}
      {mayUpload && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={`rounded-lg border-2 border-dashed p-3 text-sm ${over ? "border-ink bg-ink/5" : "border-line"}`}
        >
          <input
            ref={input}
            id={`${id}-pick`}
            type="file"
            multiple
            accept={SOURCE_ACCEPT}
            className="peer sr-only"
            disabled={busy}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) void send(files);
            }}
          />
          {/* the input is 1px and clipped: the focus ring is drawn on the label that looks like the button */}
          <label
            htmlFor={`${id}-pick`}
            className={`inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-ink px-3 font-semibold text-paper peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${busy ? "opacity-50" : "hover:bg-ink/90"}`}
          >
            העלאת קבצים
          </label>
          <span className="ms-2 text-ink-soft pointer-coarse:hidden">או לגרור לכאן</span>
          <p className="mt-1 text-xs text-ink-soft">
            PDF, ‏Word ‏(docx) או תמונה (PNG/JPG), עד 25MB לקובץ. Word נשמר, אבל למקראה צריך PDF. רק דפי המקורות — בלי קבצים עם טלפונים או פרטים אישיים.
          </p>
        </div>
      )}
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
                  <div className="h-1.5 rounded-full bg-ink transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                </div>
              )}
              {u.error && <p role="alert" className="text-xs text-bad">{u.error}</p>}
            </li>
          ))}
        </ul>
      )}
      {previous.length > 0 && <PreviousFiles port={port} week={week} files={previous} actor={actor} notify={notify} reload={reload} />}
    </div>
  );
}

/** Files that came for a speaker who is not this lesson's lead any more (reopen_lesson keeps them): for removal, never in the reader. */
export function PreviousFiles({ port, week, files, actor, notify, reload }: Omit<SourceFilesProps, "lesson" | "clear"> & { files: SourceFile[] }) {
  return (
    <div className="rounded-lg bg-amber-50 p-2">
      <p className="text-sm font-semibold text-amber-900">מהמרצה הקודם</p>
      <p className="text-xs text-amber-900">השיעור נפתח מחדש אחרי שהקבצים האלה הועלו. הם לא נכנסים למקראה. מי שהעלה/תה אותם, או המדריך/ה, מסירים אותם.</p>
      <ul aria-label="קבצים מהמרצה הקודם" className="divide-y divide-amber-200">
        {files.map((f) => (
          <FileRow key={f.id} port={port} week={week} file={f} actor={actor} notify={notify} reload={reload} previous />
        ))}
      </ul>
    </div>
  );
}

/** A draft's files (its speaker left — reopen_lesson keeps them): the section the lesson panel shows for removal, or nothing. */
export function DraftFiles({ port, week, lesson: l, actor, notify, reload }: Omit<SourceFilesProps, "clear">) {
  const files = (week.sourceFiles ?? []).filter((f) => f.lesson_id === l.id).sort((a, b) => a.id - b.id);
  if (files.length === 0) return null;
  return (
    <section aria-label="הקבצים של המשבצת" className="space-y-2">
      <PreviousFiles port={port} week={week} files={files} actor={actor} notify={notify} reload={reload} />
    </section>
  );
}
