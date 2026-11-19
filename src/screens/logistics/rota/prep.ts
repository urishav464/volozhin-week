// What «מוצ״ש» computes before it writes (pure, unit-tested): the order of one of its two lists after «למעלה» /
// «למטה». The tasks and the shopping list share the edition's numbering (`sort`, one sequence for both kinds since
// v19), so a move inside one list must not renumber it from 1 over the other's numbers: the moved row and its
// neighbour change places by taking each other's numbers — only those two are written. Rows from before a list had
// distinct numbers (two rows with one `sort`) are numbered again from the list's first number, in the new order,
// and only the rows whose number changed are written.
import type { RotaPrepTask } from "../../../data/rota";

/** The writes that move row `id` of `list` (one kind, in order) by one place; [] at either end or when it is not there. */
export function prepMoves(list: readonly Pick<RotaPrepTask, "id" | "sort">[], id: number, by: -1 | 1): { id: number; sort: number }[] {
  const i = list.findIndex((x) => x.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return [];
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  const sorts = list.map((x) => x.sort);
  const distinct = sorts.every((v, k) => k === 0 || v > sorts[k - 1]!);
  const first = Math.min(...sorts);
  const at = (k: number) => (distinct ? sorts[k]! : first + k);
  return next.map((x, k) => ({ id: x.id, sort: at(k) })).filter((x, k) => next[k]!.sort !== x.sort);
}
