// «לפי ימים»: every topic against every day — how many closed lessons it has where,
// as numbers, so «which day still has no X» reads off at once (a filled cell in the
// topic's colour, an empty one white; over the day's limit, a red ring and its words).
import { DAYS, DAY_LETTERS, DAY_NAMES } from "../domain/time";
import { DEFAULT_MAX_CATEGORY_PER_DAY } from "../rules/warnings";
import { type GridModel, weekTopics } from "./model";

export function TopicMatrix({ model }: { model: GridModel }) {
  const settings = model.week.edition.settings;
  const max = settings.max_category_per_day ?? DEFAULT_MAX_CATEGORY_PER_DAY;
  const over = settings.max_category_per_day == null ? ` (יותר מ-${max}, הצעה)` : ` (יותר מ-${max})`;
  return (
    <table aria-label="הנושאים לפי ימים" className="border-separate border-spacing-[3px] text-xs">
      <caption className="sr-only">שיעורים סגורים בכל נושא, לפי ימים</caption>
      <thead>
        <tr>
          <td />
          {DAYS.map((d) => (
            <th key={d} scope="col" className="w-9 font-semibold text-ink-soft">
              <span aria-hidden>{DAY_LETTERS[d]}</span>
              <span className="sr-only">{DAY_NAMES[d]}</span>
            </th>
          ))}
          <th scope="col" className="ps-2 font-semibold text-ink-soft">
            בשבוע
          </th>
        </tr>
      </thead>
      <tbody>
        {weekTopics(model).map(({ category: c, count }) => (
          <tr key={c.id}>
            <th scope="row" className="max-w-[8.5rem] pe-2 text-start font-normal leading-tight text-ink-soft">
              <span aria-hidden className="me-1 inline-block h-3 w-1.5 rounded-sm align-[-1px]" style={{ backgroundColor: c.color }} />
              {c.name}
            </th>
            {DAYS.map((d) => {
              const k = model.days[d].load.get(c.id) ?? 0;
              return (
                <td
                  key={d}
                  className={`h-6 w-9 rounded text-center font-bold tabular-nums ${k ? "text-white" : "border border-line bg-card"} ${k > max ? "ring-2 ring-bad ring-offset-1" : ""}`}
                  style={k ? { backgroundColor: c.color } : undefined}
                >
                  {k || <span className="sr-only">0</span>}
                  {k > max && <span className="sr-only">{over}</span>}
                </td>
              );
            })}
            <td className="ps-2 text-center font-semibold tabular-nums text-ink">{count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
