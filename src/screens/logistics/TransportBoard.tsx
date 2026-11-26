// «לוגיסטיקה ← הסעות» — the transport board (the reset, phase 3), for logistics and the admins: ONE transports read
// (cmds.transports(): the requests that wait and the approved ones, each with its pickup_min — personal data, never in
// the Week) and the edition's staff shifts (useRota: port.rota.load, no phones), re-read when a board lesson's version
// or decision changes and after every write. One day at a time (`?day=`): a time axis from a tablet up (BoardAxis —
// aria-hidden) and its text twin, the list, which is the phone's whole board. A request is decided right here by whoever
// public.decide_payments lets (mayDecide; one approval decides the payment and the transport together); an approved
// transport gets its driver and «סודר» through set_transport_driver only (DriverForm). Beside the day's staff shifts (v19)
// the cohorts whose staff can drive, those on campus that day first — names only (lanes.ts driveCohorts). The pickup is the handler's:
// read-only here, written on the lesson page («לדף השיעור»). The addresses and the drivers' phones only behind «כולל
// כתובות וטלפונים». Print and the files keep the approved transports only (transportRows / transportTable).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { LessonTransport, TransportDriverPatch } from "../../data/commands";
import { mayDecide } from "../../domain/approvals";
import { lessonPath } from "../../domain/routes";
import { shekels } from "../../domain/stages";
import { DAY_NAMES, DAYS, type Day, fmt, fmtRange } from "../../domain/time";
import { transportRows, transportTable } from "../../exports/logistics";
import { teachingWhen } from "../../exports/tracking";
import { Chip } from "../../grid/bits";
import { useRota } from "../rota/shared";
import { Button, useFocusBack, useFocusRescue, useRunner } from "../settings/kit";
import { Decide } from "../stages/PaymentStage";
import { mayArrangeDriver } from "../lesson/StaffTransport";
import { type Act, LINK_BUTTON, memberName } from "../stages/parts";
import { BoardAxis } from "./BoardAxis";
import { ARRANGED_NOTE, DriverForm } from "./DriverForm";
import { AXIS, boardCounts, boardDayParam, type BoardState, defaultBoardDay, type DriveCohort, lanesPerDay, onBoard, pickupText, type ShiftLane, type TransportLane, transportLanes } from "./lanes";
import { Bar, PaperTable, PersonalToggle, type TabProps } from "./parts";

/** Where a transport stands, in words (the axis draws it in colour). */
export const BOARD_STATE: Record<BoardState, { text: string; tone: "warn" | "info" | "ok" }> = {
  pending: { text: "ממתין לאישור", tone: "warn" },
  approved: { text: "אושר — עוד לא סודר", tone: "info" },
  arranged: { text: "סודר", tone: "ok" },
};

/** An approved transport while the read failed: whether it was arranged is the read's to say. */
export const APPROVED_UNKNOWN = { text: "אושר", tone: "info" } as const;
export const NOT_LOADED = "לא נטען";

export const PICKUP_ON_LESSON_PAGE = "את כתובת ושעת האיסוף כותבים בדף השיעור.";
export const DETAILS_HIDDEN = "פרטי ההסעה לא גלויים לך.";
export const UNKNOWN_PICKUP = "שעת איסוף לא ידועה";

const rowId = (lessonId: number) => `board-row-${lessonId}`;

export function TransportBoard({ port, week, actor, notify, clear, label, reload }: TabProps & { reload: () => Promise<void> }) {
  const cmds = useMemo(() => port.commands(week.edition.id), [port, week.edition.id]);
  const [details, setDetails] = useState<LessonTransport[] | null>(null);
  const [failed, setFailed] = useState(false);
  // «כולל כתובות וטלפונים»: off by default; the board is keyed by the edition, so another edition starts it off again
  const [personal, setPersonal] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const rota = useRota(port, week.edition.id);
  const { busy, run } = useRunner(notify, clear);
  const focus = useFocusBack();
  const rescue = useFocusRescue();
  const [params, setParams] = useSearchParams();

  // the read again whenever a board lesson's version or decision changes (a request sent, decided, changed)
  const key = week.lessons
    .filter(onBoard)
    .map((l) => `${l.id}:${l.version}:${l.approval}`)
    .join(",");
  const load = useCallback(async () => {
    try {
      setDetails(await cmds.transports());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [cmds]);
  useEffect(() => void load(), [load, key]);

  const day: Day = boardDayParam(params.get("day")) ?? defaultBoardDay(week, new Date().toISOString());
  const setDay = (d: Day) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set("day", String(d));
        return next;
      },
      { replace: true },
    );
  const perDay = lanesPerDay(week);
  const lanes = useMemo(() => transportLanes(week, details, rota.data, day), [week, details, rota.data, day]);
  const counts = boardCounts(week, details);
  const total = DAYS.reduce<number>((n, d) => n + perDay[d], 0);
  const deciding = mayDecide(actor, week.edition);
  // set_transport_driver's people (app.require_logistics): logistics or an admin, an archive the admins' only — one
  // rule with the lesson page's «פרטי ההסעה»
  const mayDriver = mayArrangeDriver(actor, week);

  const rows = useMemo(() => transportRows(week, details), [week, details]);
  const table = () => transportTable(rows, week.edition.label, personal);

  /** A write, then the week and the read again (a stale answer: the runner says so, and both are fresh). */
  const act: Act = async (k, fn, ok, onRefused) => {
    const done = await run(k, fn, ok, onRefused);
    await Promise.all([reload(), load()]);
    return done;
  };
  const pick = (lessonId: number) => document.getElementById(rowId(lessonId))?.focus();

  // the read failed: what it alone says (who is arranged, the pickups) is not known — never «סודרו 0»
  const unknown = details == null && failed;
  const summary =
    details == null && !failed ? (
      "טוען…"
    ) : total === 0 ? (
      "אין הסעות שהתבקשו."
    ) : (
      <span data-board-counts>
        ממתינות לאישור {counts.pending} · אושרו {counts.approved}
        {!unknown && <> · סודרו {counts.arranged}</>}
      </span>
    );

  return (
    <>
      <PaperTable table={table()} title={`${label} · שבוע וולוז'ין ${week.edition.label}${personal ? " · כולל כתובות וטלפונים: מידע אישי" : ""}`} landscape />
      <Bar week={week} tab="transports" table={table} personal={personal} notify={notify} summary={summary}>
        <PersonalToggle on={personal} setOn={setPersonal} />
      </Bar>
      {failed && (
        <div role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm print:hidden">
          <p className="mb-2">לא הצלחנו לטעון את פרטי ההסעות.</p>
          <Button onClick={() => void load()}>לנסות שוב</Button>
        </div>
      )}
      <div className="space-y-1 text-sm text-ink-soft print:hidden">
        <p>
          {PICKUP_ON_LESSON_PAGE} {ARRANGED_NOTE}
        </p>
        {!deciding && counts.pending > 0 && <p>אישור תשלום והסעה פתוח רק במחזור האמיתי של השנה.</p>}
        <p>בהדפסה ובקבצים — רק ההסעות שאושרו.</p>
      </div>

      <div role="group" aria-label="ימים" className="flex flex-wrap gap-1.5 print:hidden">
        {DAYS.map((d) => (
          <button
            key={d}
            type="button"
            data-day-tab={d}
            aria-pressed={d === day}
            aria-label={`יום ${DAY_NAMES[d]}: ${perDay[d] === 1 ? "הסעה אחת" : `${perDay[d]} הסעות`}`}
            onClick={() => setDay(d)}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-bold transition-colors duration-150 ${d === day ? "border-navy bg-navy text-white shadow-sm" : "border-line bg-card text-navy hover:border-navy/50 hover:bg-accent-soft"}`}
          >
            {DAY_NAMES[d]}
            <span className={`rounded-full px-1.5 text-xs ${d === day ? "bg-white/20" : "bg-sand-soft text-ink-soft"}`}>{perDay[d]}</span>
          </button>
        ))}
      </div>

      <section aria-label={`יום ${DAY_NAMES[day]}`} data-board-day={day} className="space-y-3 print:hidden">
        <BoardAxis transports={lanes.transports} shifts={lanes.shifts} onPick={pick} />
        <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start lg:gap-4 lg:space-y-0">
          <div className="min-w-0 space-y-2">
            <h3 id="board-transports" tabIndex={-1} className="font-display text-lg font-bold text-navy outline-none">
              הסעות ביום {DAY_NAMES[day]}
            </h3>
            {lanes.transports.length === 0 ? (
              <p className="text-sm text-ink-soft">אין הסעות ביום הזה.</p>
            ) : (
              <ul aria-labelledby="board-transports" className="grid items-start gap-2 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {lanes.transports.map((t) => (
                  <TransportItem
                    key={t.lesson.id}
                    lane={t}
                    week={week}
                    loaded={details != null}
                    unknown={unknown}
                    personal={personal}
                    deciding={deciding}
                    mayDriver={mayDriver}
                    busy={busy}
                    act={act}
                    decide={cmds.decidePayments}
                    editing={editing === t.lesson.id}
                    onEdit={() => setEditing(t.lesson.id)}
                    editRef={focus.ref(`driver-${t.lesson.id}`)}
                    onDecided={() => rescue(() => document.getElementById(rowId(t.lesson.id)) ?? document.getElementById("board-transports"))}
                    onSave={async (patch, onRefused) => {
                      const ok = await run(`${t.lesson.id}|driver`, () => cmds.setTransportDriver(t.lesson.id, patch), "פרטי הנהג/ת נשמרו", onRefused);
                      await load();
                      // refused because the request changed meanwhile (back to «ממתין»): the form is gone, the row keeps the focus
                      if (!ok) rescue(() => document.getElementById(rowId(t.lesson.id)) ?? document.getElementById("board-transports"));
                      return ok;
                    }}
                    onClose={() => {
                      setEditing(null);
                      focus.back(`driver-${t.lesson.id}`);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
          <div className="min-w-0 space-y-4">
            <Shifts shifts={lanes.shifts} loading={rota.data == null && rota.failed == null} failed={rota.data == null && rota.failed != null} retry={() => void rota.reload()} />
            <DriveCohorts drivers={lanes.drivers} loading={rota.data == null && rota.failed == null} failed={rota.data == null && rota.failed != null} />
          </div>
        </div>
      </section>
    </>
  );
}

function TransportItem({
  lane: t,
  week,
  loaded,
  unknown,
  personal,
  deciding,
  mayDriver,
  busy,
  act,
  decide,
  editing,
  onEdit,
  editRef,
  onDecided,
  onSave,
  onClose,
}: {
  lane: TransportLane;
  week: TabProps["week"];
  loaded: boolean;
  /** The transports read failed: whether it is arranged, and the pickup, are not known. */
  unknown: boolean;
  personal: boolean;
  deciding: boolean;
  mayDriver: boolean;
  busy: string | null;
  act: Act;
  decide: Parameters<typeof Decide>[0]["decide"];
  editing: boolean;
  onEdit: () => void;
  editRef: (el: HTMLElement | null) => void;
  onDecided: () => void;
  onSave: (patch: TransportDriverPatch, onRefused: (code: string | null) => boolean) => Promise<boolean>;
  onClose: () => void;
}) {
  const l = t.lesson;
  const d = t.details;
  // an approved transport whose read failed: «אושר», never «עוד לא סודר» (it may well be)
  const state = unknown && t.state !== "pending" ? APPROVED_UNKNOWN : BOARD_STATE[t.state];
  const when = teachingWhen(l, week.edition.settings?.lesson_minutes);
  const handler = memberName(week, t.handler);
  const name = t.speaker || t.title;
  // this row's own busy key: «<lesson>|<what>» — the Decide box and the form read theirs only
  const prefix = `${l.id}|`;
  const mine = busy?.startsWith(prefix) ? busy.slice(prefix.length) : null;
  const rowAct: Act = async (k, fn, ok, onRefused) => {
    const done = await act(prefix + k, fn, ok, onRefused);
    onDecided();
    return done;
  };
  const p = pickupText(t);

  return (
    <li id={rowId(l.id)} tabIndex={-1} data-transport-row={l.id} data-state={t.state} className="space-y-2 rounded-xl border border-line bg-card p-3 shadow-sm outline-none focus:ring-2 focus:ring-navy">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="font-bold break-words text-navy">{t.speaker || "TBD"}</p>
          <p className="text-sm break-words text-ink-soft">
            <bdi dir="ltr">{when.time}</bdi> · {t.title}
          </p>
        </div>
        <Chip tone={state.tone}>{state.text}</Chip>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
        <dt className="text-ink-soft">הסעה</dt>
        <dd className="min-w-0">
          {t.roundTrip ? "הלוך ושוב" : "הלוך"}
          {t.returnAt != null && (
            <span data-return={t.returnAt}>
              {" "}
              · חזרה מ-<bdi dir="ltr">{fmt(t.returnAt)}</bdi>
            </span>
          )}
        </dd>
        <dt className="text-ink-soft">בטיפול</dt>
        <dd className="min-w-0 break-words">{handler ?? "בלי אחראי/ת"}</dd>
        <dt className="text-ink-soft">איסוף</dt>
        <dd className="min-w-0 break-words" data-pickup data-clamped={p.early || undefined}>
          {unknown ? (
            NOT_LOADED
          ) : !loaded ? (
            "טוען…"
          ) : d == null ? (
            DETAILS_HIDDEN
          ) : p.time ? (
            <>
              <bdi dir="ltr">{p.time}</bdi>
              {p.early && (
                <>
                  {" "}
                  (לפני <bdi dir="ltr">{fmt(AXIS.start)}</bdi>)
                </>
              )}
            </>
          ) : (
            (p.words ?? UNKNOWN_PICKUP)
          )}
        </dd>
        {personal && d && (
          <>
            <dt className="text-ink-soft">כתובת איסוף</dt>
            <dd className="min-w-0 break-words">{d.pickup_address || "—"}</dd>
          </>
        )}
        {t.state !== "pending" && d && (
          <>
            <dt className="text-ink-soft">נהג/ת</dt>
            <dd className="min-w-0 break-words" data-driver>
              {d.driver_name || "—"}
            </dd>
            {personal && (
              <>
                <dt className="text-ink-soft">טלפון הנהג/ת</dt>
                <dd className="min-w-0 break-all">{d.driver_phone ? <bdi>{d.driver_phone}</bdi> : "—"}</dd>
              </>
            )}
          </>
        )}
      </dl>

      {t.state === "pending" && deciding && (
        <div className="space-y-2">
          {l.pay_amount != null && (
            <p className="text-sm">
              אישור אחד מחליט גם על התשלום (<bdi>{shekels(l.pay_amount)}</bdi>) וגם על ההסעה.
            </p>
          )}
          <Decide key={l.version} lesson={l} busy={mine} act={rowAct} decide={decide} />
        </div>
      )}

      {t.state !== "pending" && mayDriver && d && (
        editing ? (
          <div className="rounded-lg border border-line bg-paper-light p-3">
            <DriverForm label={name} d={d} busy={mine === "driver"} onSave={onSave} onClose={onClose} />
          </div>
        ) : (
          <Button ref={editRef} onClick={onEdit} aria-label={`עריכת הנהג/ת: ${name}`}>
            עריכת הנהג/ת
          </Button>
        )
      )}

      <div className="flex flex-wrap gap-2">
        <Link to={lessonPath(l.id, "pay")} className={LINK_BUTTON} aria-label={`לדף השיעור: ${name}`}>
          לדף השיעור
        </Link>
      </div>
    </li>
  );
}

/** The day's staff shifts: who is on when, so whoever finds a driver sees who is free. No phones. */
function Shifts({ shifts, loading, failed, retry }: { shifts: ShiftLane[]; loading: boolean; failed: boolean; retry: () => void }) {
  return (
    <section aria-labelledby="board-shifts" className="min-w-0 space-y-2">
      <h3 id="board-shifts" className="font-display text-lg font-bold text-navy">
        משמרות צוות
      </h3>
      {failed ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>לא הצלחנו לטעון את משמרות הצוות.</p>
          <Button onClick={retry}>לנסות שוב</Button>
        </div>
      ) : loading ? (
        <p className="text-sm text-ink-soft">טוען…</p>
      ) : shifts.length === 0 ? (
        <p className="text-sm text-ink-soft">אין משמרות צוות ביום הזה.</p>
      ) : (
        <ul aria-labelledby="board-shifts" className="divide-y divide-sage/60 rounded-xl border border-line bg-card px-3 shadow-sm">
          {shifts.map((s) => (
            <li key={s.shift.id} data-shift={s.shift.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm">
              <bdi dir="ltr" className="font-semibold">
                {fmtRange(s.shift.start_min, s.shift.end_min)}
              </bdi>
              <span className="min-w-0 break-words">{s.who}</span>
              {s.shift.note && <span className="basis-full text-xs break-words text-ink-soft">{s.shift.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * v19: the cohorts whose staff can drive («הצוות שלה יכול להסיע», set in «תורנויות ← קבוצות ומכינות») — those on campus
 * that day first. Names only: the rota has no phone, and finding the driver stays a conversation. A failed rota read is
 * said once, by the shifts beside it.
 */
export function DriveCohorts({ drivers, loading, failed }: { drivers: DriveCohort[]; loading: boolean; failed: boolean }) {
  if (failed) return null;
  return (
    <section aria-labelledby="board-drive-cohorts" data-drive-cohorts className="min-w-0 space-y-2">
      <h3 id="board-drive-cohorts" className="font-display text-lg font-bold text-navy">
        מכינות שהצוות שלהן יכול להסיע
      </h3>
      {loading ? (
        <p className="text-sm text-ink-soft">טוען…</p>
      ) : drivers.length === 0 ? (
        <p className="text-sm text-ink-soft">אין מכינות שהצוות שלהן מסומן כיכול להסיע.</p>
      ) : (
        <ul aria-labelledby="board-drive-cohorts" className="divide-y divide-sage/60 rounded-xl border border-line bg-card px-3 shadow-sm">
          {drivers.map(({ cohort, present }) => (
            <li key={cohort.id} data-drive-cohort={cohort.id} data-present={present ? "y" : "-"} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm">
              <span className="min-w-0 flex-1 break-words font-semibold">{cohort.name}</span>
              <Chip tone={present ? "ok" : "plain"}>{present ? "בקמפוס ביום הזה" : "לא בקמפוס ביום הזה"}</Chip>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
