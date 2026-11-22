// «מצגות» (/presentations, the reset, phase 5) — a team page: upload, check and download the day's presentations; each
// morning someone downloads «כל המצגות של היום» and copies them to the hall's computer (nobody signs in there —
// DECISIONS «הריסט, שלב 5», decision 1: no «now / next», no clock, no full screen). Every member of the edition opens it
// (may_read_source: the whole team reads the files); the header names it for the staff and logistics, a trainee comes by
// address or from the lesson page. Day tabs (`?day=`), room chips (`?room=`, and remembered on this device), the day's
// zip with what this device downloaded last, the week's deck, the day's rows, and — for an admin — the presentations
// left without a lesson. Its one read is the week store's: read again every two minutes while the tab is visible and on
// «רענון» (source_files is not in Realtime, so another member's upload arrives only with the next load_week).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import {
  dayRows, markerTime, newSinceDownload, ORPHAN_LABEL, orphanPresentations, presentationRows, presentationsDay, PRESENTATIONS_POLL_MS, readRoom, readZipMarker, weekPresentations,
  writeRoom, writeZipMarker, type ZipMarker,
} from "../../domain/presentations";
import { parsePresentationsQuery, presentationsPath } from "../../domain/routes";
import { type Day, DAYS, DAY_NAMES, fmtRange } from "../../domain/time";
import type { Week } from "../../domain/types";
import { weekProblem } from "../speakerPages/page";
import { Button, Fold, useFocusRescue } from "../settings/kit";
import { EditionSelect, type Notify, useToast } from "../speakers/parts";
import { actorIn, type Actor, useWeekStore } from "../weekStore";
import { DayList } from "./DayList";
import { DayZip } from "./DayZip";
import { PresentationFile } from "./PresentationFile";
import { PRESENTATION_HINT } from "./PresentationUpload";
import { WeekDeck } from "./WeekDeck";

/** This device's storage, or none (a private window, blocked site data): every read and write of it is guarded too. */
function deviceStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const CHIP = "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-bold transition-colors duration-150";
const CHIP_ON = "border-navy bg-navy text-white shadow-sm";
const CHIP_OFF = "border-line bg-card text-navy hover:border-navy/50 hover:bg-accent-soft";

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
  const location = useLocation();
  const navigate = useNavigate();
  const hintId = useId();
  const editionId = week.edition.id;
  const q = parsePresentationsQuery(location.search);
  const day: Day = q.day ?? presentationsDay(week.edition.start_date, new Date().toISOString());
  const known = (id: number | null | undefined) => (id != null && week.rooms.some((r) => r.id === id) ? id : null);
  // the address first, else what this device chose last
  const roomId = q.room != null ? known(q.room) : known(readRoom(deviceStore(), editionId));
  // the room this device remembers goes into the address, so a link copied from here opens the same list
  useEffect(() => {
    if (q.room == null && roomId != null) navigate(presentationsPath({ day: q.day, room: roomId }), { replace: true });
  }, [q.room, q.day, roomId, navigate]);

  const rows = useMemo(() => presentationRows(week), [week]);
  const ofDay = useMemo(() => dayRows(rows, day, null), [rows, day]);
  const shown = useMemo(() => dayRows(rows, day, roomId), [rows, day, roomId]);
  const rooms = useMemo(() => {
    const on = new Set(ofDay.map((r) => r.roomId));
    if (roomId != null) on.add(roomId);
    return [...week.rooms].filter((r) => on.has(r.id)).sort((a, b) => a.sort - b.sort || a.id - b.id);
  }, [week.rooms, ofDay, roomId]);

  const [marker, setMarker] = useState<ZipMarker | null>(() => readZipMarker(deviceStore(), editionId, day));
  useEffect(() => setMarker(readZipMarker(deviceStore(), editionId, day)), [editionId, day]);
  const downloaded = useCallback(
    (m: ZipMarker) => {
      writeZipMarker(deviceStore(), editionId, day, m);
      setMarker(m);
    },
    [editionId, day],
  );
  // «חדש מאז ההורדה»: the files the last zip was for — its room's (or every room's) and the week's decks
  const newSince = useMemo(() => {
    const scope = marker?.room == null ? ofDay : ofDay.filter((r) => r.roomId === marker.room);
    return newSinceDownload([...weekPresentations(week), ...scope.flatMap((r) => r.files)], marker);
  }, [week, ofDay, marker]);
  const now = new Date().toISOString();
  const since = marker ? { at: markerTime(marker.at, now), newCount: newSince.size, room: marker.room == null ? null : (week.rooms.find((r) => r.id === marker.room)?.name ?? null) } : null;

  const chooseRoom = (id: number | null) => {
    clear();
    writeRoom(deviceStore(), editionId, id);
    navigate(presentationsPath({ day, room: id ?? undefined }), { replace: true });
  };

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

  const mayUpload = actor.canEdit && shown.some((r) => r.kind === "lesson");
  return (
    <div data-presentations className="mx-auto max-w-6xl space-y-4 pb-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-2xl font-extrabold text-navy">מצגות</h2>
        <EditionSelect />
        <Button data-refresh kind="quiet" className="ms-auto" busy={refreshing} busyLabel="מרענן…" onClick={() => void refresh()}>
          רענון
        </Button>
      </div>

      <nav aria-label="ימי השבוע" className="flex flex-wrap gap-1">
        {DAYS.map((d) => (
          <Link
            key={d}
            replace
            to={presentationsPath({ day: d, room: roomId ?? undefined })}
            data-day-tab={d}
            aria-current={d === day ? "page" : undefined}
            onClick={clear}
            className={`${CHIP} min-w-16 justify-center ${d === day ? CHIP_ON : CHIP_OFF}`}
          >
            {DAY_NAMES[d]}
          </Link>
        ))}
      </nav>

      {rooms.length > 1 || roomId != null ? (
        <div role="group" aria-label="חדר" className="flex flex-wrap gap-1">
          <button type="button" data-room="all" aria-pressed={roomId == null} onClick={() => chooseRoom(null)} className={`${CHIP} ${roomId == null ? CHIP_ON : CHIP_OFF}`}>
            כל החדרים
          </button>
          {rooms.map((r) => (
            <button key={r.id} type="button" data-room={r.id} aria-pressed={roomId === r.id} onClick={() => chooseRoom(r.id)} className={`${CHIP} ${roomId === r.id ? CHIP_ON : CHIP_OFF}`}>
              <bdi>{r.name}</bdi>
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <DayZip port={port} week={week} day={day} roomId={roomId} notify={notify} clear={clear} onDownloaded={downloaded} since={since} />
        <WeekDeck port={port} week={week} actor={actor} notify={notify} clear={clear} reload={reload} newSince={newSince} />
      </div>

      <section aria-labelledby="day-list-title" className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* tabIndex -1: where the focus goes when the last presentation without a lesson is removed (its fold goes with it) */}
          <h3 id="day-list-title" tabIndex={-1} className="font-display text-lg font-bold text-navy outline-none">
            יום {DAY_NAMES[day]}
          </h3>
          {mayUpload && (
            <p id={hintId} className="text-xs text-ink-soft">
              {PRESENTATION_HINT}
            </p>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="rounded-xl border border-line bg-card p-4 text-ink-soft">{ofDay.length === 0 ? "אין שיעורים סגורים ביום הזה." : "אין שיעורים סגורים בחדר הזה ביום הזה."}</p>
        ) : (
          <DayList port={port} week={week} rows={shown} actor={actor} notify={notify} clear={clear} reload={reload} newSince={newSince} hintId={hintId} />
        )}
      </section>

      {actor.isAdmin && <Orphans port={port} week={week} actor={actor} notify={notify} clear={clear} reload={reload} />}
      {node}
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
        <p className="text-sm text-ink-soft">מצגות של שיעור שנפתח מחדש, בוטל או נמחק, או של מרצה קודם. הן לא בהורדה של היום. מי שהעלה/תה אותן, או המדריך/ה, מסירים אותן.</p>
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
              // the last one removed takes the fold away: the day's list heading, which stays, takes the focus
              onRemoved={() => rescue(() => root.current ?? document.getElementById("day-list-title"))}
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
