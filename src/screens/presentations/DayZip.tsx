// «הורדת כל המצגות של היום» (the reset, phase 5) — the page's main act: the hall's computer is not signed in, so every
// morning someone downloads the day's presentations in one zip (the week's decks first, then the day's in its order,
// with סדר-היום.txt and links.txt) and copies it over on a USB stick. Before: how many and how big; during: «מוריד N מתוך
// M» and «ביטול»; after: what came and what did not. This device remembers when it downloaded the day's zip (and the
// newest upload it held), so whatever is uploaded later is marked «חדש מאז ההורדה» and can be fetched on its own.
import { useEffect, useRef, useState } from "react";
import type { DataPort } from "../../data/port";
import { isPresentation } from "../../data/sourceRules";
import { dayZipPlan, megabytes, newestUpload, PRESENTATION_ZIP_MAX, type ZipMarker, zipLine } from "../../domain/presentations";
import { type Day, DAY_NAMES } from "../../domain/time";
import type { Week } from "../../domain/types";
import { download, fileName, israelDay, ZIP_MIME } from "../../exports/download";
import { type ZipProgress, presentationsZip } from "../../exports/presentationsZip";
import { useMedia } from "../../lib/useMedia";
import { Button, useFocusRescue } from "../settings/kit";
import type { Notify } from "../speakers/parts";

export interface DayZipProps {
  port: DataPort;
  week: Week;
  day: Day;
  roomId: number | null;
  notify: Notify;
  clear: () => void;
  /** The marker written: the page keeps it (and on this device, localStorage). */
  onDownloaded: (m: ZipMarker) => void;
  /** What this device remembers of the day's last zip, said under the button. */
  since: { at: string; newCount: number; room: string | null } | null;
}

export function DayZip({ port, week, day, roomId, notify, clear, onDownloaded, since }: DayZipProps) {
  // built on a computer: a mouse at any width or a wide screen (the reader's rule) — a phone may, but is told
  const computer = useMedia("(min-width: 1024px), (pointer: fine)");
  const [progress, setProgress] = useState<ZipProgress | null>(null);
  const [failed, setFailed] = useState<string[] | null>(null);
  const job = useRef<AbortController | null>(null);
  const main = useRef<HTMLButtonElement>(null);
  // «ביטול» leaves once the download ends: the focus goes back to the main button
  const rescue = useFocusRescue();
  useEffect(() => () => job.current?.abort(), []);
  // another day or room: the last result was about another zip
  useEffect(() => setFailed(null), [day, roomId, week.edition.id]);
  const plan = dayZipPlan(week, day, roomId);
  const tooBig = plan.bytes > PRESENTATION_ZIP_MAX;
  // a room chip chosen (maybe remembered on this device from another day): the card says the zip is that room's
  const roomName = roomId == null ? null : (week.rooms.find((r) => r.id === roomId)?.name ?? null);
  const decks = plan.entries.filter((e) => e.file.lesson_id == null).length; // the week's, on the cover path

  const run = async () => {
    clear();
    setFailed(null);
    const at = new Date().toISOString();
    // the server's clock: whatever is uploaded after the week this plan is read from is newer than its newest upload
    const upTo = newestUpload((week.sourceFiles ?? []).filter(isPresentation));
    const ctrl = new AbortController();
    job.current = ctrl;
    setProgress({ done: 0, total: plan.entries.length });
    try {
      const r = await presentationsZip(port.sources, week.edition.id, plan.entries, {
        signal: ctrl.signal,
        onProgress: setProgress,
        texts: (bad) => dayZipPlan(week, day, roomId, bad).texts,
      });
      // not one of the day's files came: no zip of the two texts alone, and never «ירדו 0 מצגות»
      if (r.got === 0 && plan.entries.length > 0) {
        setFailed(r.failed.map((f) => f.name));
        notify("error", "אף מצגת לא ירדה. בודקים את החיבור ומנסים שוב.");
        return;
      }
      const what = `presentations-day${day + 1}${roomId != null ? `-room${roomId}` : ""}`;
      download(fileName(what, week.edition, israelDay(), "zip"), r.blob, ZIP_MIME);
      if (r.got > 0 || plan.entries.length === 0) onDownloaded({ at, upTo, room: roomId });
      notify("ok", plan.entries.length === 0 ? "ירד סדר היום" : r.got === 1 ? "ירדה מצגת אחת" : `ירדו ${r.got} מצגות`);
      if (r.failed.length > 0) setFailed(r.failed.map((f) => f.name));
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") notify("ok", "ההורדה בוטלה.");
      else notify("error", "ההורדה לא הושלמה. בודקים את החיבור ומנסים שוב.");
    } finally {
      job.current = null;
      setProgress(null);
      rescue(() => main.current);
    }
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <section data-day-zip data-total-bytes={plan.bytes} aria-labelledby="day-zip-title" className="rounded-xl border border-navy/30 bg-card p-4 shadow-sm sm:p-5">
      <h3 id="day-zip-title" className="mb-1 font-display text-lg font-bold text-navy">
        המצגות של יום {DAY_NAMES[day]}
        {roomName && (
          <>
            {" · "}
            <bdi>{roomName}</bdi>
          </>
        )}
      </h3>
      <p className="mb-3 text-sm text-ink-soft">למחשב של האולם: מורידים כאן, ומעתיקים בדיסק-און-קי. בקובץ גם סדר היום (מה פותחים ומתי) והקישורים.</p>
      {tooBig ? (
        <p role="alert" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-950">
          כל המצגות של היום יחד גדולות מדי לקובץ אחד ({megabytes(plan.bytes)}). מורידים אחת-אחת מהרשימה.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button ref={main} kind="primary" busy={!!progress} busyLabel="מוריד…" onClick={() => void run()}>
              {roomName ? (
                <>
                  הורדת המצגות של <bdi>{roomName}</bdi>
                </>
              ) : (
                "הורדת כל המצגות של היום"
              )}
            </Button>
            {progress && (
              <Button kind="danger" onClick={() => job.current?.abort()}>
                ביטול
              </Button>
            )}
            <span className="text-sm text-ink-soft">{zipLine(plan)}</span>
          </div>
          {roomName && (
            <p data-zip-room className="text-sm text-ink-soft">
              בקובץ רק <bdi>{roomName}</bdi>
              {decks > 0 ? " והמצגת של השבוע" : ""}. לכל החדרים בוחרים «כל החדרים».
            </p>
          )}
          {!computer && <p className="text-sm text-amber-950">עדיף במחשב</p>}
          {progress && (
            <div className="space-y-1" aria-live="polite">
              <p className="text-sm">
                מוריד {progress.done} מתוך {progress.total}
              </p>
              <div role="progressbar" aria-label="הורדת המצגות" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 rounded-full bg-sand-soft ring-1 ring-inset ring-line">
                <div className="h-2 rounded-full bg-navy transition-[width]" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
        </div>
      )}
      {failed && failed.length > 0 && (
        <p role="alert" className="mt-2 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
          לא ירדו:{" "}
          {failed.map((n, i) => (
            <span key={i}>
              {i > 0 && ", "}
              <bdi>{n}</bdi>
            </span>
          ))}
          . מורידים אותן אחת-אחת מהרשימה.
        </p>
      )}
      {since && (
        <div data-since-download className="mt-3 space-y-1 border-t border-line pt-2 text-sm">
          <p className="text-ink-soft">
            ההורדה האחרונה במכשיר הזה: <bdi dir="ltr">{since.at}</bdi>
            {since.room && (
              <>
                {" "}
                (רק <bdi>{since.room}</bdi>)
              </>
            )}
          </p>
          {since.newCount > 0 && (
            <p role="status" className="font-bold text-navy">
              עלו מאז ההורדה ב-<bdi dir="ltr">{since.at}</bdi>: {since.newCount}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
