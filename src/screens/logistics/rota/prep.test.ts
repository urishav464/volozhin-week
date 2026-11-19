// prepMoves (src/screens/logistics/rota/prep.ts): «למעלה» / «למטה» inside one of the two Saturday-night lists, which
// share the edition's numbering — only the rows whose number changes are written, never a number of the other list.
import { describe, expect, it } from "vitest";
import { prepMoves } from "./prep";

const list = (...sorts: number[]) => sorts.map((sort, i) => ({ id: i + 1, sort }));

describe("prepMoves", () => {
  it("the moved row and its neighbour take each other's numbers — the list's own, wherever the other list's are", () => {
    // the shopping list's numbers among the tasks': 3, 7, 8
    expect(prepMoves(list(3, 7, 8), 2, -1)).toEqual([
      { id: 2, sort: 3 },
      { id: 1, sort: 7 },
    ]);
    expect(prepMoves(list(3, 7, 8), 2, 1)).toEqual([
      { id: 3, sort: 7 },
      { id: 2, sort: 8 },
    ]);
  });

  it("nothing at either end, or for a row not in the list", () => {
    expect(prepMoves(list(1, 2), 1, -1)).toEqual([]);
    expect(prepMoves(list(1, 2), 2, 1)).toEqual([]);
    expect(prepMoves(list(1, 2), 9, 1)).toEqual([]);
    expect(prepMoves([], 1, 1)).toEqual([]);
  });

  it("two rows with one number (a list from before): numbered again from its first number, only the changed rows written", () => {
    // ids 1–4 at 5, 5, 6, 7 — row 3 up: 1, 3, 2, 4 at 5, 6, 7, 8 (rows 1 and 3 keep theirs)
    expect(prepMoves(list(5, 5, 6, 7), 3, -1)).toEqual([
      { id: 2, sort: 7 },
      { id: 4, sort: 8 },
    ]);
  });
});
