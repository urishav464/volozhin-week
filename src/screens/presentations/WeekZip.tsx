// «הורדת כל המצגות של השבוע» (v20) — the page's main act: the hall's computer is not signed in, so someone downloads the
// week's presentations in one zip (a folder per day with its files, סדר-היום.txt and links.txt; the week's decks once in
// «0-השבוע») and copies it over on a USB stick. Before: how many and how big; during: «מוריד N מתוך M» and «ביטול»;
// after: what came, and what did not — each with its folder, its name and «הורדה» under that name. Above
// PRESENTATION_ZIP_MAX the week comes in parts (the week's decks, then each day), under the same paths. This device
// remembers what it downloaded (each file's id and a fingerprint of its path): a file uploaded since is listed under
// «עלו מאז ההורדה», and a path changed since (a lesson moved, a room renamed) says «שיעור זז מאז ההורדה — מורידים שוב».
import { useEffect, useMemo, useRef, useState } from "react";
import type { DataPort } from "../../data/port";
import {
  dayFolder, dayZipPlan, decksZipPlan, markerTime, megabytes, PRESENTATION_ZIP_MAX, WEEK_FOLDER, weekZipPlan, type ZipEntry, type ZipMarker, zipLine, zipMarker, type ZipPlan,
  type ZipText,
} from "../../domain/presentations";
import { type Day, DAYS, DAY_NAMES } from "../../domain/time";
import type { Week } from "../../domain/types";
import { download, fileName, israelDay, ZIP_MIME } from "../../exports/download";
import { type ZipProgress, presentationsZip } from "../../exports/presentationsZip";
import { useMedia } from "../../lib/useMedia";
import { Button, useFocusRescue } from "../settings/kit";
import type { Notify } from "../speakers/parts";
import { EntryList } from "./HallPath";

export interface WeekZipProps {
  port: DataPort;
  week: Week;
  /** presentationEntries(week): every file's path in the zip. */
  entries: ReadonlyMap<number, string>;
  /** What this device remembers of its last download (null: none). */
  marker: ZipMarker | null;
  /** Since that download: files it did not hold, and files whose path changed. */
  since: { fresh: number[]; moved: number[] };
  /** The marker written: the page keeps it (and on this device, localStorage). */
  onDownloaded: (m: ZipMarker) => void;
  notify: Notify;
  clear: () => void;
}

/** One download: the whole week, or a part of it when the week is too big for one file. */
interface Job {
  key: string;
  /** The ASCII name's middle: «presentations-week», «presentations-day2». */
  what: string;
  plan: ZipPlan;
  texts: (failed: ReadonlySet<number>) => ZipText[];
  /** A part adds to what this device already had; the week replaces it. */
  part: boolean;
}

interface Part {
  key: string;
  label: string;
  folder: string;
  plan: ZipPlan;
  day: Day | null;
}

export function WeekZip({ port, week, entries, marker, since, onDownloaded, notify, clear }: WeekZipProps) {
  // built on a computer: a mouse at any width or a wide screen (the reader's rule) — a phone may, but is told
  const computer = useMedia("(min-width: 1024px), (pointer: fine)");
  const [running, setRunning] = useState<{ key: string; progress: ZipProgress } | null>(null);
  const [failed, setFailed] = useState<number[] | null>(null);
  const job = useRef<AbortController | null>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  // «ביטול» leaves once the download ends: the focus goes back to the button that started it
  const rescue = useFocusRescue();
  useEffect(() => () => job.current?.abort(), []);
  // another edition: the last result was about another zip
  useEffect(() => setFailed(null), [week.edition.id]);
  const plan = useMemo(() => weekZipPlan(week), [week]);
  const tooBig = plan.bytes > PRESENTATION_ZIP_MAX;
  const parts = useMemo<Part[]>(() => {
    if (!tooBig) return [];
    const decks = decksZipPlan(week);
    return [
      ...(decks.entries.length > 0 ? [{ key: "decks", label: "המצגת של השבוע", folder: WEEK_FOLDER, plan: decks, day: null }] : []),
      ...DAYS.map((d) => ({ key: `day${d}`, label: `יום ${DAY_NAMES[d]}`, folder: dayFolder(d), plan: dayZipPlan(week, d), day: d })),
    ];
  }, [week, tooBig]);

  const run = async (j: Job) => {
    clear();
    setFailed(null);
    const at = new Date().toISOString();
    const ctrl = new AbortController();
    job.current = ctrl;
    setRunning({ key: j.key, progress: { done: 0, total: j.plan.entries.length } });
    try {
      const r = await presentationsZip(port.sources, week.edition.id, j.plan.entries, {
        signal: ctrl.signal,
        onProgress: (progress) => setRunning({ key: j.key, progress }),
        texts: j.texts,
      });
      // not one of the files came: no zip of the texts alone, no marker, and never «ירדו 0 מצגות»
      if (r.came.length === 0 && j.plan.entries.length > 0) {
        setFailed(r.failed.map((f) => f.id));
        notify("error", "אף מצגת לא ירדה. בודקים את החיבור ומנסים שוב.");
        return;
      }
      download(fileName(j.what, week.edition, israelDay(), "zip"), r.blob, ZIP_MIME);
      onDownloaded(zipMarker(at, r.came, j.part ? marker : null));
      const n = r.came.length;
      notify("ok", j.plan.entries.length === 0 ? (j.part ? "ירד סדר היום" : "ירד סדר היום של כל יום") : n === 1 ? "ירדה מצגת אחת" : `ירדו ${n} מצגות`);
      if (r.failed.length > 0) setFailed(r.failed.map((f) => f.id));
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") notify("ok", "ההורדה בוטלה.");
      else notify("error", "ההורדה לא הושלמה. בודקים את החיבור ומנסים שוב.");
    } finally {
      job.current = null;
      setRunning(null);
      rescue(() => buttons.current[j.key]);
    }
  };

  const weekJob: Job = { key: "week", what: "presentations-week", plan, texts: (bad) => weekZipPlan(week, bad).texts, part: false };
  const partJob = (p: Part): Job => ({
    key: p.key,
    what: p.day == null ? "presentations-week-decks" : `presentations-day${p.day + 1}`,
    plan: p.plan,
    texts: (bad) => (p.day == null ? [] : dayZipPlan(week, p.day, bad).texts),
    part: true,
  });
  const ids = (es: readonly ZipEntry[]) => es.map((e) => e.file.id);
  const pct = running && running.progress.total > 0 ? Math.round((running.progress.done / running.progress.total) * 100) : 0;
  const now = new Date().toISOString();

  const button = (j: Job, label: string) => (
    <Button
      ref={(el) => {
        buttons.current[j.key] = el;
      }}
      data-zip-download={j.key}
      kind={j.part ? "secondary" : "primary"}
      busy={running?.key === j.key}
      busyLabel="מוריד…"
      // one download at a time: the others say so and keep their place for the keyboard
      disabled={running != null && running.key !== j.key}
      keepFocus
      onClick={() => void run(j)}
    >
      {label}
    </Button>
  );

  return (
    <section data-week-zip data-total-bytes={plan.bytes} aria-labelledby="week-zip-title" className="rounded-xl border border-navy/30 bg-card p-4 shadow-sm sm:p-5">
      <h3 id="week-zip-title" className="mb-1 font-display text-lg font-bold text-navy">
        הורדה למחשב של האולם
      </h3>
      <p className="mb-3 text-sm text-ink-soft">
        מורידים כאן ומעתיקים בדיסק-און-קי. בקובץ תיקייה לכל יום, ובה המצגות, סדר היום (מה פותחים ומתי) והקישורים; המצגת של השבוע בתיקייה «
        <bdi>{WEEK_FOLDER}</bdi>». המלווה של כל שיעור רואה בדף שלו/ה באיזו תיקייה הקובץ, ובמה השם שלו מתחיל.
      </p>
      {tooBig ? (
        <div data-zip-parts className="space-y-2">
          <p role="alert" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-950">
            כל המצגות של השבוע יחד גדולות מדי לקובץ אחד ({megabytes(plan.bytes)}). מורידים בחלקים: כל חלק הוא תיקייה, ומעתיקים את כולן לאותו מקום.
          </p>
          <ul aria-label="חלקי ההורדה" className="divide-y divide-line">
            {parts.map((p) => (
              <li key={p.key} data-zip-part={p.key} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 basis-40 font-semibold">
                    {p.label} <span className="text-sm font-normal text-ink-soft">(<bdi>{p.folder}</bdi>)</span>
                  </span>
                  {p.plan.bytes <= PRESENTATION_ZIP_MAX && button(partJob(p), `הורדת ${p.label}`)}
                  <span className="text-sm text-ink-soft">{zipLine(p.plan, "day")}</span>
                </div>
                {p.plan.bytes > PRESENTATION_ZIP_MAX && (
                  <div className="space-y-1">
                    <p className="text-sm text-amber-950">גם החלק הזה גדול מדי לקובץ אחד. מורידים כל קובץ לבד, ומעתיקים לתיקייה שלו:</p>
                    <EntryList port={port} week={week} ids={ids(p.plan.entries)} entries={entries} label={`הקבצים של ${p.label}`} notify={notify} clear={clear} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {button(weekJob, "הורדת כל המצגות של השבוע")}
          <span className="text-sm text-ink-soft">{zipLine(plan)}</span>
        </div>
      )}
      {running && (
        <div className="mt-2 space-y-1" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm">
              מוריד {running.progress.done} מתוך {running.progress.total}
            </p>
            <Button kind="danger" onClick={() => job.current?.abort()}>
              ביטול
            </Button>
          </div>
          <div role="progressbar" aria-label="הורדת המצגות" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 rounded-full bg-sand-soft ring-1 ring-inset ring-line">
            <div className="h-2 rounded-full bg-navy transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {!computer && <p className="mt-2 text-sm text-amber-950">עדיף במחשב</p>}
      {failed && failed.length > 0 && (
        <div data-zip-failed className="mt-2 space-y-1 rounded-lg bg-bad/10 px-3 py-2">
          <p role="alert" className="text-sm text-bad">
            {failed.length === 1 ? "קובץ אחד לא ירד" : `${failed.length} קבצים לא ירדו`}. מורידים כל אחד כאן, ומעתיקים לתיקייה שלו:
          </p>
          <EntryList port={port} week={week} ids={failed} entries={entries} label="לא ירדו" notify={notify} clear={clear} />
        </div>
      )}
      {marker && (
        <div data-since-download className="mt-3 space-y-1 border-t border-line pt-2 text-sm">
          <p className="text-ink-soft">
            ההורדה האחרונה במכשיר הזה: <bdi dir="ltr">{markerTime(marker.at, now)}</bdi>
          </p>
          {since.moved.length > 0 && (
            <div data-moved-since role="status" className="rounded-lg bg-amber-50 p-2 text-amber-950">
              <p className="font-bold">שיעור זז מאז ההורדה — מורידים שוב</p>
              <p>שם של קובץ השתנה: שיעור עבר יום, שעה או חדר, או שחדר קיבל שם חדש. במחשב של האולם מחליפים את כל התיקיות בהורדה החדשה.</p>
            </div>
          )}
          {since.fresh.length > 0 && (
            <div data-new-since-list className="space-y-1">
              <p role="status" className="font-bold text-navy">
                עלו מאז ההורדה: {since.fresh.length}
              </p>
              <EntryList port={port} week={week} ids={since.fresh} entries={entries} label="עלו מאז ההורדה" notify={notify} clear={clear} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
