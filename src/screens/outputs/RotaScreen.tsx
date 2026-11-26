// «תוצרים ← תורנויות» (/print/rota, every member of the edition; milestone 7, schema v16): every page of the duty
// roster, to print or download — the board, a schedule per group (all or one: one A4 landscape page each, GroupSheet),
// a page per day, the kitchen's, the heads, the staff's shifts, מוצ"ש–ראשון (the tasks, and the shopping list on a page of
// its own — v19), the food, who is on campus, the loads. v20: the food page is FoodSheet (a row per day × meal, then per cohort) and the
// staff's shifts StaffSheet (the day × grid-rows schedule, never a transport) — src/screens/outputs/rota/.
// Each is a builder of src/exports/rota.ts: the screen, the paper and the files are one list. «הורדת xlsx (כל
// הגיליונות)» writes all of them, a sheet each; «הורדת CSV» the page on screen. Made in this browser, nothing uploaded.
// The heads' phones are personal data: «כולל טלפונים של ראשי הקבוצות» only for an edition's logistics and admins in a
// real edition not archived (maySeeRotaContacts ≡ app.may_see_rota_contacts), off by default, off again in another
// edition; while off there is no contacts call at all, and no phone on screen, on paper or in a file.
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import type { DataPort } from "../../data/port";
import type { RotaData } from "../../data/rota";
import type { Me } from "../../data/types";
import { DAY_NAMES, type Day } from "../../domain/time";
import type { Week } from "../../domain/types";
import { csvBytes } from "../../exports/csv";
import { CSV_MIME, download, fileName, israelDay } from "../../exports/download";
import {
  campusTable, daySheet, groupSchedule, groupScheduleInputs, groupWeek, type HeadPhones, headsTable, kitchenDutyId, kitchenSheet, loadsTable, prepTable,
  rotaBoardTable, rotaWorkbook, shoppingTable, stackTables,
} from "../../exports/rota";
import type { Table } from "../../exports/table";
import { israelDate } from "../../exports/tracking";
import { toXlsx, XLSX_MIME } from "../../exports/xlsx";
import { ROTA_DAYS } from "../../domain/rota";
import { Button } from "../settings/kit";
import { EditionSelect, useToast } from "../speakers/parts";
import { HeadPhonesToggle, isEmptyRota, maySeeRotaContacts, RotaLoadFailed, useHeadPhones, useRota } from "../rota/shared";
import { actorIn, useWeekStore } from "../weekStore";
import { GroupSheet } from "./GroupSheet";
import { FoodSheet, foodTables } from "./rota/FoodSheet";
import { StaffSheet, staffTables } from "./rota/StaffSheet";
import { TableView } from "./rota/TableView";
import { OutputsTabs, PrintSetup, SELECT } from "./parts";

export type RotaView = "board" | "groups" | "day" | "kitchen" | "heads" | "staff" | "prep" | "food" | "campus" | "loads";

export const ROTA_VIEWS: readonly [RotaView, string][] = [
  ["board", "לוח התורנויות"],
  ["groups", "לו״ז לכל קבוצה"],
  ["day", "דף לכל יום"],
  ["kitchen", "לו״ז מטבח"],
  ["heads", "ראשי קבוצות"],
  ["staff", "משמרות צוות"],
  ["prep", "מוצ״ש–ראשון"],
  ["food", "כמויות אוכל"],
  ["campus", "מי בקמפוס"],
  ["loads", "עומס"],
];

/** On a phone, how many leading cells make a row's card heading («בוקר 06:30–14:30 · מטבח»). */
const CARD_KEYS: Partial<Record<RotaView, number>> = { board: 2, day: 2, kitchen: 2, staff: 2, campus: 2 };

/** Printed across the page: the wide ones. */
const LANDSCAPE: Record<RotaView, boolean> = { board: true, groups: true, day: true, kitchen: true, heads: false, staff: true, prep: false, food: true, campus: true, loads: true };

/** The views a head's phone may appear in (with «כולל טלפונים» on). */
const WITH_PHONES: ReadonlySet<RotaView> = new Set(["day", "heads"]);

const isView = (v: string | null): v is RotaView => ROTA_VIEWS.some(([k]) => k === v);

export function RotaScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const actor = actorIn(me, week?.edition);
  const editionId = week?.edition.id ?? null;
  const rota = useRota(port, editionId);
  const allowed = week != null && maySeeRotaContacts(actor, week.edition);
  const heads = useHeadPhones(port, editionId, allowed);
  const [params, setParams] = useSearchParams();
  const { notify, node } = useToast();
  const view: RotaView = isView(params.get("view")) ? (params.get("view") as RotaView) : "board";
  const pick = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v == null) n.delete(k);
        else n.set(k, v);
        return n;
      },
      { replace: true },
    );
  const groups = useMemo(() => (week && rota.data ? groupScheduleInputs(week, rota.data) : []), [week, rota.data]);

  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const label = week.edition.label;
  const viewLabel = ROTA_VIEWS.find(([k]) => k === view)![1];
  const printed = `הודפס ב-${israelDate(new Date().toISOString())}`;
  const data = rota.data;
  const phones: HeadPhones = heads.phones; // only while on, offered here, and answered
  const header = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
      <h2 className="font-display text-2xl font-extrabold text-navy">תורנויות</h2>
      <EditionSelect />
      <OutputsTabs admin={actor.isAdmin} />
    </div>
  );
  if (!data) {
    return (
      <div className="mx-auto max-w-[110rem] space-y-4 pb-20">
        {header}
        {rota.failed ? <RotaLoadFailed code={rota.failed} onRetry={() => void rota.reload()} /> : <p className="text-ink-soft">טוען…</p>}
      </div>
    );
  }

  const groupParam = params.get("group");
  const oneGroup = groups.find((g) => String(g.groupId) === groupParam) ?? null;
  const dayParam = params.get("day");
  const oneDay = dayParam != null && /^[0-4]$/.test(dayParam) ? (Number(dayParam) as Day) : null;
  const kitchenDefault = kitchenDutyId(data) ?? data.duties[0]?.id ?? null;
  const dutyParam = Number(params.get("duty"));
  const duty = data.duties.some((d) => d.id === dutyParam) ? dutyParam : kitchenDefault;

  // the page on screen, as tables (the groups' are drawn by GroupSheet; their CSV is their table)
  const tables: Table[] = tablesOf(view, week, data, phones, { group: oneGroup?.groupId ?? null, day: oneDay, duty, groups });
  const csvTable = tables.length === 1 ? tables[0] : stackTables(`${viewLabel} · ${label}`, tables);
  const empty = tables.every((t) => t.rows.length === 0);
  const csvPhones = phones != null && WITH_PHONES.has(view);
  const save = (kind: "xlsx" | "csv") => {
    const withPhones = kind === "xlsx" ? phones != null : csvPhones;
    const name = fileName(`rota${kind === "csv" ? `-${view}` : ""}${withPhones ? "-with-phones" : ""}`, week.edition, israelDay(), kind);
    if (kind === "xlsx") download(name, toXlsx(rotaWorkbook({ week, data, phones, kitchenDuty: duty })), XLSX_MIME);
    else download(name, csvBytes(csvTable), CSV_MIME);
    notify("ok", withPhones ? "הקובץ ירד. יש בו טלפונים של ראשי הקבוצות: לא לשתף, ולמחוק כשמסיימים." : "הקובץ ירד.");
  };

  return (
    <div className="mx-auto max-w-[110rem] space-y-4 pb-20">
      <PrintSetup landscape={LANDSCAPE[view]} title={`${viewLabel} · שבוע וולוז'ין ${label}`}>
        <p className="text-sm">
          {printed}
          {csvPhones ? " · כולל טלפונים של ראשי הקבוצות: מידע אישי" : ""}
          {view === "food" ? " · חניכים בלבד" : ""}
        </p>
      </PrintSetup>
      {header}

      {isEmptyRota(data) ? (
        <p className="rounded-xl border border-line bg-card p-4 text-ink-soft shadow-sm print:hidden">
          עוד אין תורנויות במחזור הזה.{" "}
          {actor.isAdmin || actor.role === "logistics" ? (
            <Link to="/logistics/rota" className="font-bold text-navy underline">
              מגדירים אותן ב«לוגיסטיקה ← תורנויות»
            </Link>
          ) : (
            "הצוות הלוגיסטי מגדיר/ה אותן ב«לוגיסטיקה ← תורנויות»."
          )}
        </p>
      ) : (
        <>
          <div data-rota-print className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-xl border border-line bg-card p-3 shadow-sm print:hidden">
            <div className="flex min-w-0 flex-col">
              <label htmlFor="rota-view" className="text-sm font-bold text-ink">
                מה להדפיס
              </label>
              <select id="rota-view" value={view} onChange={(e) => pick("view", e.target.value)} className={SELECT}>
                {ROTA_VIEWS.map(([k, text]) => (
                  <option key={k} value={k}>
                    {text}
                  </option>
                ))}
              </select>
            </div>
            {view === "groups" && (
              <div className="flex min-w-0 flex-col">
                <label htmlFor="rota-group" className="text-sm font-bold text-ink">
                  קבוצה
                </label>
                <select id="rota-group" value={oneGroup ? String(oneGroup.groupId) : ""} onChange={(e) => pick("group", e.target.value || null)} className={SELECT}>
                  <option value="">כל הקבוצות ({groups.length})</option>
                  {groups.map((g) => (
                    <option key={g.groupId} value={g.groupId}>
                      {g.input.group.code}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {view === "day" && (
              <div className="flex min-w-0 flex-col">
                <label htmlFor="rota-day" className="text-sm font-bold text-ink">
                  יום
                </label>
                <select id="rota-day" value={oneDay ?? ""} onChange={(e) => pick("day", e.target.value || null)} className={SELECT}>
                  <option value="">כל הימים (דף לכל יום)</option>
                  {ROTA_DAYS.map((d) => (
                    <option key={d} value={d}>
                      {DAY_NAMES[d]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {view === "kitchen" && data.duties.length > 1 && (
              <div className="flex min-w-0 flex-col">
                <label htmlFor="rota-duty" className="text-sm font-bold text-ink">
                  התורנות
                </label>
                <select id="rota-duty" value={duty ?? ""} onChange={(e) => pick("duty", e.target.value)} className={SELECT}>
                  {data.duties.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <HeadPhonesToggle allowed={allowed} on={heads.on} setOn={heads.setOn} failed={heads.failed} />
            <div className="flex flex-wrap gap-2 sm:ms-auto">
              <Button onClick={() => window.print()} disabled={empty}>
                הדפסה
              </Button>
              <Button onClick={() => save("xlsx")}>הורדת xlsx (כל הגיליונות)</Button>
              <Button onClick={() => save("csv")} disabled={empty}>
                הורדת CSV
              </Button>
            </div>
          </div>
          {heads.on && !WITH_PHONES.has(view) && <p className="text-sm text-ink-soft print:hidden">הטלפונים מופיעים בדף לכל יום, ברשימת ראשי הקבוצות ובקובץ ה-xlsx.</p>}
          {view === "food" && <p className="text-sm text-ink-soft print:hidden">חניכים בלבד: הצוות והאורחים לא נספרים. מכינה שעוד לא ידוע כמה חניכים יש בה — TBD, וכך גם כל סכום שהיא חלק ממנו.</p>}
          {view === "kitchen" && duty == null && <p className="text-sm text-ink-soft print:hidden">עוד אין תורנויות.</p>}

          <div data-rota-view={view} className="space-y-4">
            {view === "groups" ? (
              (oneGroup ? [oneGroup] : groups).map((g, i) => <GroupSheet key={g.groupId} week={groupWeek(g.input)} first={i === 0} printed={printed} />)
            ) : view === "food" ? (
              <FoodSheet week={week} data={data} />
            ) : view === "staff" ? (
              <StaffSheet week={week} data={data} />
            ) : (
              tables.map((t, i) => (
                  <section key={t.name} aria-label={t.name} className={i > 0 ? "print:break-before-page" : ""}>
                    {tables.length > 1 && <h3 className="mb-1 font-display text-lg font-bold text-navy print:break-after-avoid">{t.name}</h3>}
                    <TableView table={t} keys={CARD_KEYS[view] ?? 1} />
                  </section>
                ))
            )}
            {view === "groups" && groups.length === 0 && <p className="rounded-xl border border-line bg-card p-4 text-ink-soft shadow-sm">עוד אין קבוצות.</p>}
          </div>
        </>
      )}
      {node}
    </div>
  );
}

/** The current page's tables (for the groups: their schedules — what their CSV writes). */
function tablesOf(
  view: RotaView,
  week: Week,
  data: RotaData,
  phones: HeadPhones,
  o: { group: number | null; day: Day | null; duty: number | null; groups: ReturnType<typeof groupScheduleInputs> },
): Table[] {
  const e = week.edition;
  switch (view) {
    case "board":
      return [rotaBoardTable(data, e)];
    case "groups":
      return o.groups.filter((g) => o.group == null || g.groupId === o.group).map((g) => groupSchedule(g.input));
    case "day":
      return (o.day == null ? ROTA_DAYS : [o.day]).map((d) => daySheet(data, e, d, phones));
    case "kitchen":
      return o.duty == null ? [] : [kitchenSheet(data, e, week.rows, o.duty)];
    case "heads":
      return [headsTable(data, phones)];
    case "staff":
      return staffTables(week, data);
    case "prep":
      return [prepTable(data), shoppingTable(data)];
    case "food":
      return foodTables(week, data);
    case "campus":
      return [campusTable(data, e)];
    case "loads":
      return [loadsTable(data, e)];
  }
}
