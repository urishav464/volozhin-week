// «מצגות» (/presentations; v20 — the week, not the day) — a team page: the week's download for the hall's computer
// (nobody signs in there — DECISIONS «הריסט, שלב 5», decision 1: no «now / next», no clock, no full screen; the lesson's
// escort opens the file, told by their page where it is), what this device downloaded last and what came since, the
// week's deck, «חסרות» (the lessons whose presentation is expected and not uploaded, each a link to its lesson page — a
// lesson's presentation is uploaded there), and — for an admin — the presentations left without a lesson. Every member of
// the edition opens it (may_read_source: the whole team reads the files); the header names it for the staff and
// logistics, a trainee comes by address or from the lesson page. An old address with `?day=` or `?room=` opens it as it
// is. Its one read is the week store's: read again every two minutes while the tab is visible and on «רענון»
// (source_files is not in Realtime, so another member's upload arrives only with the next load_week).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import {
  ORPHAN_LABEL, orphanPresentations, PRESENTATION_STATE_LABEL, presentationEntries, presentationRows, type PresentationRow, PRESENTATIONS_POLL_MS, readZipMarker, sinceDownload,
  writeZipMarker, type ZipMarker,
} from "../../domain/presentations";
import { lessonPath } from "../../domain/routes";
import { DAY_NAMES, fmtRange, nightLabel } from "../../domain/time";
import type { Week } from "../../domain/types";
import { weekProblem } from "../speakerPages/page";
import { Badge, Button, Fold, useFocusRescue } from "../settings/kit";
import { EditionSelect, type Notify, useToast } from "../speakers/parts";
import { actorIn, type Actor, useWeekStore } from "../weekStore";
import { PresentationFile } from "./PresentationFile";
import { WeekDeck } from "./WeekDeck";
import { WeekZip } from "./WeekZip";

/** This device's storage, or none (a private window, blocked site data): every read and write of it is guarded too. */
function deviceStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function PresentationsScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { reload } = store;
  // source_files is not in Realtime: the week again every two minutes while the tab is in view
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, PRESENTATIONS_POLL_MS);
    return () => clearInterval(t);
  }, [reload]);
  const problem = weekProblem(store);
  if (problem || !store.week) return problem;
  return <PresentationsPage port={port} week={store.week} actor={actorIn(me, store.week.edition)} reload={reload} />;
}

function PresentationsPage({ port, week, actor, reload }: { port: DataPort; week: Week; actor: Actor; reload: () => Promise<void> }) {
  const { notify, clear, node } = useToast();
  const editionId = week.edition.id;
  const rows = useMemo(() => presentationRows(week), [week]);
  const entries = useMemo(() => presentationEntries(week), [week]);

  const [marker, setMarker] = useState<ZipMarker | null>(() => readZipMarker(deviceStore(), editionId));
  useEffect(() => setMarker(readZipMarker(deviceStore(), editionId)), [editionId]);
  const downloaded = useCallback(
    (m: ZipMarker) => {
      writeZipMarker(deviceStore(), editionId, m);
      setMarker(m);
    },
    [editionId],
  );
  // what this device's last download did not hold, and what moved since
  const since = useMemo(() => sinceDownload(entries, marker), [entries, marker]);
  const fresh = useMemo(() => new Set(since.fresh), [since]);
  const missing = useMemo(() => rows.filter((r) => r.state === "missing"), [rows]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    clear();
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div data-presentations className="mx-auto max-w-6xl space-y-4 pb-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* tabIndex -1: where the focus goes when the last presentation without a lesson is removed (its fold goes with it) */}
        <h2 id="presentations-title" tabIndex={-1} className="font-display text-2xl font-extrabold text-navy outline-none">
          מצגות
        </h2>
        <EditionSelect />
        <Button data-refresh kind="quiet" className="ms-auto" busy={refreshing} busyLabel="מרענן…" onClick={() => void refresh()}>
          רענון
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <WeekZip port={port} week={week} entries={entries} marker={marker} since={since} onDownloaded={downloaded} notify={notify} clear={clear} />
        <WeekDeck port={port} week={week} actor={actor} notify={notify} clear={clear} reload={reload} newSince={fresh} entries={entries} />
      </div>

      <Missing rows={missing} />
      {actor.isAdmin && <Orphans port={port} week={week} actor={actor} notify={notify} clear={clear} reload={reload} />}
      {node}
    </div>
  );
}

/** «חסרות»: the lessons marked as having a presentation that is not uploaded yet — each a link to its lesson page. */
function Missing({ rows }: { rows: PresentationRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div data-missing-presentations className="rounded-xl border border-line bg-card px-4 py-1 shadow-sm sm:px-5">
      <Fold title="חסרות" hint={`${rows.length}`}>
        <p className="text-sm text-ink-soft">שיעורים שסומן בהם שיש מצגת, והיא עוד לא הועלתה. מעלים אותה בעמוד השיעור, ב«מקורות ומצגת».</p>
        <ul aria-label="מצגות חסרות" className="divide-y divide-line">
          {rows.map((r) => {
            const night = nightLabel(r.day, r.start_min);
            return (
              <li key={r.lessonId} data-missing-row={r.lessonId} className="flex flex-col gap-1 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
                <span className="text-sm text-ink-soft">
                  יום {DAY_NAMES[r.day]} <bdi dir="ltr">{fmtRange(r.start_min, r.end_min)}</bdi>
                  {night && ` · ${night}`} · <bdi>{r.room}</bdi>
                </span>
                <Link to={lessonPath(r.lessonId, "sources", "presentations")} className="inline-flex min-h-11 min-w-0 items-center break-words text-start font-bold text-navy underline-offset-4 hover:underline">
                  <bdi>{[r.speaker, r.title].filter(Boolean).join(" · ")}</bdi>
                </Link>
                <span>
                  <Badge tone="bad">{PRESENTATION_STATE_LABEL.missing}</Badge>
                </span>
              </li>
            );
          })}
        </ul>
      </Fold>
    </div>
  );
}

/** «מצגות בלי שיעור» (admins): a reopened, cancelled or deleted lesson's, or a previous speaker's — for removal. */
function Orphans({ port, week, actor, notify, clear, reload }: { port: DataPort; week: Week; actor: Actor; notify: Notify; clear: () => void; reload: () => Promise<void> }) {
  const root = useRef<HTMLDivElement>(null);
  const rescue = useFocusRescue();
  const orphans = orphanPresentations(week);
  if (orphans.length === 0) return null;
  return (
    <div ref={root} tabIndex={-1} data-orphan-presentations className="rounded-xl border border-line bg-card px-4 py-1 shadow-sm outline-none sm:px-5">
      <Fold title="מצגות בלי שיעור" hint={`${orphans.length}`}>
        <p className="text-sm text-ink-soft">מצגות של שיעור שנפתח מחדש, בוטל או נמחק, או של מרצה קודם. הן לא בהורדה. מי שהעלה/תה אותן, או המדריך/ה, מסירים אותן.</p>
        <ul aria-label="מצגות בלי שיעור" className="divide-y divide-line">
          {orphans.map(({ file, lesson, reason }) => (
            <PresentationFile
              key={file.id}
              port={port}
              week={week}
              file={file}
              actor={actor}
              notify={notify}
              clear={clear}
              reload={reload}
              // the last one removed takes the fold away: the page's heading, which stays, takes the focus
              onRemoved={() => rescue(() => root.current ?? document.getElementById("presentations-title"))}
              before={
                <span className="text-sm text-ink-soft">
                  {ORPHAN_LABEL[reason]}
                  {lesson && (
                    <>
                      {" · "}
                      {DAY_NAMES[lesson.day]} <bdi dir="ltr">{fmtRange(lesson.start_min, lesson.end_min)}</bdi>
                    </>
                  )}
                  :
                </span>
              }
            />
          ))}
        </ul>
      </Fold>
    </div>
  );
}
