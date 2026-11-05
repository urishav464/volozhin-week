// A cell of the board, opened («מטבח · שני · בוקר»): the grid's Sheet (a side panel on a wide screen, a bottom sheet on
// a phone) with what the cell holds and what it could take — the groups on this duty («הסרה»); the free groups, the
// least loaded first (against the shifts their cohort is on campus), each with its size and a mark when it is on a duty
// right before or after this shift; the groups on another duty in this shift («העברה לכאן» — a group does one duty a
// shift); and, folded, the groups whose cohort is not marked on campus then — allowed, and warned about on the board.
// A shift the week no longer has (Sunday before the opening, Thursday after the close) only lets its groups go.
// Every act is a direct write (port.rota) and the rota read again; the focus goes to where the group went.
import { useEffect, useMemo, useRef, useState } from "react";
import type { RotaAssignment, RotaGroup, ShiftIndex } from "../../../data/rota";
import { loadsOf, needOf, presentAt, rotaShiftActive, rotaShiftsOf, slotIndex } from "../../../domain/rota";
import { rotaWarnings, cellWarnings, groupWarnings } from "../../../domain/rotaWarnings";
import { DAY_NAMES, type Day } from "../../../domain/time";
import { groupsInOrder } from "../../../exports/rota";
import { Meta, Section, Sheet, WarningList } from "../../../grid/Panels";
import { useMedia } from "../../../lib/useMedia";
import { GroupChip, ShiftLabel } from "../../rota/shared";
import { Badge, Button, Fold } from "../../settings/kit";
import { codeById, type RotaCtx } from "./parts";

export interface RotaCell {
  day: Day;
  shift: ShiftIndex;
  dutyId: number;
}

/** «מטבח · שני · בוקר» — the cell's name, its panel's title and its «שיבוץ» button's. */
export function cellTitle(dutyName: string, day: Day, shiftLabel: string): string {
  return `${dutyName} · ${DAY_NAMES[day]} · ${shiftLabel}`;
}

/** The marks a group's chip carries on the board: what is about that group in that shift (not the cell's counts). */
export const GROUP_MARKS = new Set(["absent", "outside_week", "back_to_back"]);

/**
 * Where the focus goes after an act: the group's button where the group went — a closed «לא בקמפוס» opened for it. When
 * the act leaves the focus nowhere (that button is not drawn: a shift the week no longer has offers no «שיבוץ»), the
 * next «הסרה» left in «בתורנות», else the sheet itself — never the page behind the dialog. A refused act keeps the focus
 * on its own button (busy keeps it).
 */
function useLanding() {
  const els = useRef(new Map<string, HTMLElement>());
  /** «בתורנות»'s list (or its empty line): always drawn, inside the sheet. */
  const here = useRef<HTMLElement | null>(null);
  const [to, setTo] = useState<{ key: string; n: number } | null>(null);
  useEffect(() => {
    if (!to) return;
    const el = els.current.get(to.key);
    const fold = el?.closest("details");
    if (fold && !fold.open) fold.open = true;
    el?.focus();
    if (el && document.activeElement === el) return;
    const sheet = here.current?.closest<HTMLElement>("[role=dialog]");
    if (!sheet || sheet.contains(document.activeElement)) return;
    (here.current?.querySelector<HTMLElement>("[data-remove]") ?? sheet).focus();
  }, [to]);
  return useMemo(
    () => ({
      here: (el: HTMLElement | null) => {
        here.current = el;
      },
      ref: (key: string) => (el: HTMLElement | null) => {
        if (el) els.current.set(key, el);
        else els.current.delete(key);
      },
      back: (key: string) => setTo((t) => ({ key, n: (t?.n ?? 0) + 1 })),
    }),
    [],
  );
}

export function CellPicker({ ctx, cell, onClose }: { ctx: RotaCtx; cell: RotaCell; onClose: () => void }) {
  const { port, week, data, busy, act } = ctx;
  const wide = useMedia("(min-width: 1024px)");
  const focus = useLanding();
  const e = week.edition;
  const { day, shift, dutyId } = cell;
  const duty = data.duties.find((d) => d.id === dutyId);
  if (!duty) return null;
  const label = rotaShiftsOf(e).labels[shift];
  const title = cellTitle(duty.name, day, label);
  const active = rotaShiftActive(e, day, shift);
  const need = needOf(duty, shift);
  const warnings = rotaWarnings(data, e);
  const loads = loadsOf(data, data.assignments, e);
  const inShift = data.assignments.filter((a) => a.day === day && a.shift === shift);
  const order = groupsInOrder(data);
  const rank = new Map(order.map((g, i) => [g.id, i]));
  const byGroup = (a: RotaAssignment, b: RotaAssignment) => (rank.get(a.group_id) ?? 0) - (rank.get(b.group_id) ?? 0);
  const here = inShift.filter((a) => a.duty_id === dutyId).sort(byGroup);
  const elsewhere = inShift.filter((a) => a.duty_id !== dutyId).sort(byGroup);
  const taken = new Set(inShift.map((a) => a.group_id));
  const at = slotIndex(day, shift);
  const nextTo = (g: RotaGroup) => data.assignments.some((a) => a.group_id === g.id && Math.abs(slotIndex(a.day, a.shift) - at) === 1);
  const free = order.filter((g) => !taken.has(g.id));
  // the least loaded first, against the shifts its cohort is on campus (compared exactly); one next to this shift last
  const byLoad = (a: RotaGroup, b: RotaGroup) => {
    const la = loads.get(a.id)!;
    const lb = loads.get(b.id)!;
    return Number(nextTo(a)) - Number(nextTo(b)) || la.shifts * Math.max(lb.present, 1) - lb.shifts * Math.max(la.present, 1) || (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
  };
  const onCampus = free.filter((g) => presentAt(data, g.cohort_id, day, shift)).sort(byLoad);
  const away = free.filter((g) => !presentAt(data, g.cohort_id, day, shift)).sort(byLoad);
  const people = here.reduce((s, a) => s + (data.groups.find((g) => g.id === a.group_id)?.size ?? 0), 0);
  const groupOf = (id: number) => data.groups.find((g) => g.id === id);
  const dutyName = (id: number) => data.duties.find((d) => d.id === id)?.name ?? "?";

  const assign = async (g: RotaGroup) => {
    const code = codeById(data, g.id);
    await act(`assign-${g.id}`, () => port.rota.assign(e.id, { day, shift, duty_id: dutyId, group_id: g.id }), `${code} שובצה ל«${duty.name}»`);
    focus.back(`remove-${g.id}`);
  };
  const remove = async (a: RotaAssignment) => {
    const code = codeById(data, a.group_id);
    await act(`remove-${a.id}`, () => port.rota.unassign(a.id), `${code} הוסרה מ«${duty.name}»`);
    focus.back(`assign-${a.group_id}`);
  };
  const move = async (a: RotaAssignment) => {
    const code = codeById(data, a.group_id);
    await act(`move-${a.id}`, () => port.rota.moveAssignment(a.id, dutyId), `${code} הועברה ל«${duty.name}»`);
    focus.back(`remove-${a.group_id}`);
  };

  const candidate = (g: RotaGroup) => {
    const l = loads.get(g.id)!;
    const code = codeById(data, g.id);
    return (
      <li key={g.id} data-candidate={code} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
        <GroupChip code={code} size={g.size} />
        <span className="text-sm text-ink-soft">
          {l.shifts === 1 ? "משמרת אחת" : `${l.shifts} משמרות`}
          {l.present > 0 ? ` מתוך ${l.present} בקמפוס` : ""}
        </span>
        {nextTo(g) && <Badge tone="muted">משמרת צמודה</Badge>}
        <Button className="ms-auto" ref={focus.ref(`assign-${g.id}`)} busy={busy === `assign-${g.id}`} onClick={() => void assign(g)} aria-label={`שיבוץ: ${code}`}>
          שיבוץ
        </Button>
      </li>
    );
  };

  return (
    <Sheet
      title={title}
      wide={wide}
      onClose={onClose}
      subtitle={
        <>
          <Meta>
            <ShiftLabel edition={e} shift={shift} day={day} />
          </Meta>
          <Meta tone={need == null ? "warn" : "plain"}>{need == null ? "לא נקבע כמה קבוצות צריך" : need === 1 ? "צריך קבוצה אחת" : `צריך ${need} קבוצות`}</Meta>
          {duty.min_people != null && (
            <Meta>
              {people} אנשים, המינימום {duty.min_people}
            </Meta>
          )}
        </>
      }
    >
      {cellWarnings(warnings, day, shift, dutyId).length > 0 && <WarningList items={cellWarnings(warnings, day, shift, dutyId)} />}
      <Section title="בתורנות" count={need != null ? `${here.length} מתוך ${need}` : here.length}>
        {here.length === 0 ? (
          <p ref={focus.here} className="text-sm text-ink-soft">
            עוד אין קבוצה בתורנות הזו.
          </p>
        ) : (
          <ul ref={focus.here} aria-label="בתורנות" className="divide-y divide-sage/60">
            {here.map((a) => {
              const code = codeById(data, a.group_id);
              const marks = groupWarnings(warnings, a).filter((w) => GROUP_MARKS.has(w.kind));
              return (
                <li key={a.id} data-assigned={code} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
                  <GroupChip code={code} size={groupOf(a.group_id)?.size ?? null} suggested={a.source === "suggested"} warn={marks.length > 0} title={marks.map((w) => w.message).join("\n") || undefined} />
                  {marks.length > 0 && <span className="min-w-0 flex-1 basis-40 text-xs text-amber-900">{marks.map((w) => w.message).join(" · ")}</span>}
                  <Button kind="quiet" className="ms-auto" data-remove ref={focus.ref(`remove-${a.group_id}`)} busy={busy === `remove-${a.id}`} onClick={() => void remove(a)} aria-label={`הסרה: ${code}`}>
                    הסרה
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {active ? (
        <>
          <Section title="קבוצות פנויות" count={onCampus.length}>
            {onCampus.length === 0 ? (
              <p className="text-sm text-ink-soft">אין קבוצה פנויה שהמכינה שלה בקמפוס במשמרת הזו.</p>
            ) : (
              <ul aria-label="קבוצות פנויות" className="divide-y divide-sage/60">
                {onCampus.map(candidate)}
              </ul>
            )}
          </Section>
          {elsewhere.length > 0 && (
            <Section title="בתורנות אחרת במשמרת הזו" count={elsewhere.length}>
              <ul aria-label="בתורנות אחרת במשמרת הזו" className="divide-y divide-sage/60">
                {elsewhere.map((a) => {
                  const code = codeById(data, a.group_id);
                  return (
                    <li key={a.id} data-elsewhere={code} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
                      <GroupChip code={code} size={groupOf(a.group_id)?.size ?? null} suggested={a.source === "suggested"} />
                      <span className="text-sm text-ink-soft">ב«{dutyName(a.duty_id)}»</span>
                      <Button className="ms-auto" busy={busy === `move-${a.id}`} onClick={() => void move(a)} aria-label={`העברה לכאן: ${code}`}>
                        העברה לכאן
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
          {away.length > 0 && (
            <Fold title="לא בקמפוס" hint={away.length} defaultOpen={onCampus.length === 0}>
              <p className="mb-1 text-sm text-ink-soft">המכינות של הקבוצות האלה לא סומנו בקמפוס במשמרת הזו. אפשר לשבץ אותן בכל זאת — השיבוץ יקבל אזהרה בלוח.</p>
              <ul aria-label="לא בקמפוס" className="divide-y divide-sage/60">
                {away.map(candidate)}
              </ul>
            </Fold>
          )}
        </>
      ) : (
        <p className="text-sm text-ink-soft">המשמרת הזו כבר לא חלק מהשבוע (לפני הפתיחה ביום ראשון, או אחרי הסיום ביום חמישי). אפשר רק להסיר ממנה קבוצות.</p>
      )}
    </Sheet>
  );
}
