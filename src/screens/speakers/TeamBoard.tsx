// «כל הצוות» (/mine/team): who handles whom, at a glance (src/domain/mine.ts teamBoard). For the global admin first
// «מחכה לאישור שלך» — the speakers who agreed and wait for the approval, and the payment/transport requests (what the
// header's badge counts) — with the way to the approvals queue. Then a block per handler, in the team's order and in
// their colour of the «אחריות» lens (the name beside it: the colour is never the only sign), each row a speaker with
// where they stand, opening their sheet; then, folded, «בלי אחראי/ת»: speakers in process whom nobody handles.
import { useMemo } from "react";
import { Link } from "react-router";
import { agreedPending, MINE_GROUPS, type MineRow, pendingPayments, teamBoard } from "../../domain/mine";
import { byGender, displayName } from "../../domain/names";
import { requestText } from "../../domain/stages";
import { DAY_NAMES, fmtRange } from "../../domain/time";
import type { Week } from "../../domain/types";
import { statusLabel, vettingLabel } from "../../lib/labels";
import { Chip } from "../../grid/bits";
import { Fold } from "../settings/kit";

const LABEL = new Map(MINE_GROUPS.map((g) => [g.group, g.label]));

export function TeamBoard({ week, global, onOpen }: { week: Week; global: boolean; onOpen: (speakerId: number) => void }) {
  const board = useMemo(() => teamBoard(week), [week]);
  const agreed = global ? agreedPending(week) : [];
  const payments = global ? pendingPayments(week) : [];
  const waiting = agreed.length + payments.length;
  const names = new Map(week.team.map((t) => [t.id, t.display_name]));
  const rows = (list: MineRow[]) => (
    <ul className="divide-y divide-line/70">
      {list.map((r) => (
        <TeamItem key={`${r.approach.id}:${r.lesson?.id ?? ""}`} row={r} names={names} onOpen={() => onOpen(r.speaker.id)} />
      ))}
    </ul>
  );

  return (
    <div className="space-y-4">
      {waiting > 0 && (
        <section aria-label="מחכה לאישור שלך" className="rounded-xl border border-amber-300 bg-amber-50/60 p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="font-display text-lg font-semibold">
              מחכה לאישור שלך <span className="text-sm font-normal text-ink-soft tabular-nums">{waiting}</span>
            </h3>
            <Link to="/approvals" className="ms-auto inline-flex min-h-11 items-center rounded-lg bg-ink px-3 text-sm font-semibold text-paper hover:bg-ink/90">
              לאישורים
            </Link>
          </div>
          <ul className="mt-1 space-y-1 text-sm">
            {agreed.map((s) => (
              <li key={`s${s.id}`}>
                <b>{displayName(s)}</b> · {statusLabel("positive", s.gender)}, {byGender(s.gender, "ממתין", "ממתינה")} לאישור לפני סגירת השעה
              </li>
            ))}
            {payments.map(({ lesson: l, speaker }) => (
              <li key={`p${l.id}`}>
                <b>{speaker ? displayName(speaker) : "שיעור"}</b> · {DAY_NAMES[l.day]} <bdi>{fmtRange(l.start_min, l.end_min)}</bdi>
                {requestText(l) && ` · ${requestText(l)}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {board.owners.map((o) => (
        <section key={o.id} aria-label={o.name} className="rounded-xl border border-line bg-card px-3 py-2 shadow-sm sm:px-4">
          <h3 className="flex min-h-11 items-center gap-2 font-display text-lg font-semibold">
            <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />
            {o.name} <span className="text-sm font-normal text-ink-soft tabular-nums">{o.rows.length}</span>
          </h3>
          {o.rows.length === 0 ? <p className="pb-2 text-sm text-ink-soft">עוד אין מרצים בטיפול.</p> : rows(o.rows)}
        </section>
      ))}

      {board.unowned.length > 0 && (
        <div className="rounded-xl border border-line bg-card px-3 shadow-sm sm:px-4">
          <Fold title="בלי אחראי/ת" hint={board.unowned.length}>
            <p className="text-sm text-ink-soft">
              מרצים בתהליך השנה שאין מי שמטפל/ת בהם: הוחזרו למאגר, או שמי שטיפל/ה בהם כבר לא בצוות. לוקחים אותם ב«אני מטפל/ת» בכרטיס.
            </p>
            {rows(board.unowned)}
          </Fold>
        </div>
      )}
    </div>
  );
}

/** One compact row: the name (it opens the sheet), where they stand, and a closed lesson's time. */
function TeamItem({ row, names, onOpen }: { row: MineRow; names: Map<number, string>; onOpen: () => void }) {
  const { speaker: s, approach: a, group, lesson } = row;
  // the group's word, but one person's where the group's is plural
  const stage =
    group === "agreed"
      ? s.vetted === "rejected"
        ? vettingLabel("rejected", s.gender)
        : `${byGender(s.gender, "ממתין", "ממתינה")} לאישור`
      : group === "declined"
        ? statusLabel("declined", s.gender)
        : LABEL.get(group);
  const tone = group === "agreed" ? (s.vetted === "rejected" ? "bad" : "warn") : group === "closed" ? "ok" : "plain";
  const offeredTo = a.offered_to != null ? (names.get(a.offered_to) ?? "חבר/ת צוות") : null;
  return (
    <li data-speaker-id={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5">
      <button type="button" onClick={onOpen} className="inline-flex min-h-11 items-center gap-1.5 text-start font-semibold underline decoration-ink-faint underline-offset-4 hover:decoration-ink">
        {displayName(s)}
        <span aria-hidden className="inline-block text-ink-soft">
          ‹
        </span>
      </button>
      <Chip tone={tone}>{stage}</Chip>
      {lesson && (
        <span className="text-sm text-ink-soft">
          {DAY_NAMES[lesson.day]} <bdi>{fmtRange(lesson.start_min, lesson.end_min)}</bdi>
        </span>
      )}
      {offeredTo && <span className="text-sm text-ink-soft">הוצע להעביר ל{offeredTo}</span>}
    </li>
  );
}
