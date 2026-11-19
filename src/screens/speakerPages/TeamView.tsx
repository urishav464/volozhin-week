// «מרצים ← כל הצוות» (`/speakers?view=team`, the reset, phase 3 — it was «המרצים שלי ← כל הצוות»): who handles whom, at
// a glance (src/domain/mine.ts teamBoard, narrowed by the list's search — filters.ts filterTeam). A block per handler,
// in the team's order and in their colour of the grid's «אחריות» lens (the name beside it: the colour is never the only
// sign), each row a speaker with where they stand and a closed lesson's time, its name the link to the speaker's page;
// then, folded, «בלי אחראי/ת»: speakers in process whom nobody handles.
import { Link } from "react-router";
import { MINE_GROUPS, type MineRow } from "../../domain/mine";
import { byGender, displayName } from "../../domain/names";
import { speakerPath } from "../../domain/routes";
import { DAY_NAMES, fmtRange } from "../../domain/time";
import type { Week } from "../../domain/types";
import { Chip } from "../../grid/bits";
import { statusLabel, vettingLabel } from "../../lib/labels";
import { Fold } from "../settings/kit";
import type { TeamBoard } from "./filters";

const LABEL = new Map(MINE_GROUPS.map((g) => [g.group, g.label]));

export function TeamView({ week, board }: { week: Week; board: TeamBoard }) {
  const names = new Map(week.team.map((t) => [t.id, t.display_name]));
  const rows = (list: MineRow[]) => (
    <ul className="divide-y divide-sage/60">
      {list.map((r) => (
        <TeamItem key={`${r.approach.id}:${r.lesson?.id ?? ""}`} row={r} names={names} />
      ))}
    </ul>
  );

  return (
    <div className="space-y-3" data-team-view>
      <div className="grid gap-3 lg:grid-cols-2">
        {board.owners.map((o) => (
          <section
            key={o.id}
            aria-label={o.name}
            data-team-block={o.id}
            className="rounded-xl border border-line bg-card px-3 py-2 shadow-sm sm:px-5"
            style={{ borderInlineStartWidth: 6, borderInlineStartColor: o.color }}
          >
            <h3 className="flex min-h-11 items-center gap-2 font-display text-lg font-bold text-navy">
              <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />
              {o.name} <span className="text-sm font-normal text-ink-soft tabular-nums">{o.rows.length}</span>
            </h3>
            {o.rows.length === 0 ? <p className="pb-2 text-sm text-ink-soft">אין מרצים בטיפול.</p> : rows(o.rows)}
          </section>
        ))}
      </div>

      {board.unowned.length > 0 && (
        <div data-team-block="none" className="rounded-xl border border-line bg-card px-3 shadow-sm sm:px-5">
          <Fold title="בלי אחראי/ת" hint={board.unowned.length}>
            <p className="text-sm text-ink-soft">מרצים בתהליך השנה שאין מי שמטפל/ת בהם — לוקחים אותם, או מעבירים לחבר/ת צוות, בדף המרצה.</p>
            {rows(board.unowned)}
          </Fold>
        </div>
      )}
    </div>
  );
}

/** One compact row: the name (it opens the speaker's page), where they stand, and a closed lesson's time. */
function TeamItem({ row, names }: { row: MineRow; names: Map<number, string> }) {
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
      <Link to={speakerPath(s.id)} className="inline-flex min-h-11 items-center gap-1.5 text-start font-bold text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-navy">
        {displayName(s)}
      </Link>
      <Chip tone={tone}>{stage}</Chip>
      {lesson && (
        <span className="text-sm text-ink-soft">
          {DAY_NAMES[lesson.day]}{" "}
          <bdi dir="ltr" className="tabular-nums">
            {fmtRange(lesson.start_min, lesson.end_min)}
          </bdi>
        </span>
      )}
      {offeredTo && <span className="text-sm text-ink-soft">הוצע להעביר ל{offeredTo}</span>}
    </li>
  );
}
