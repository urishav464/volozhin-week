// A group's book order (BookOrder.tsx) as markup: v19's «הצעה: N» — signed up + leaders (suggestedCopies) — beside the
// field, and «למלא», which only fills it (nothing is saved before «שמירה»; the e2e clicks it on the wire).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { KkData, KkGroup } from "../../data/kk";
import type { DataPort } from "../../data/port";
import { BookOrder } from "./BookOrder";

const g: KkGroup = { id: 1, title: "ספר לדוגמה", author: null, place: null, capacity: 20, open: true };
const kk = (copies?: number): KkData => ({ groups: [g], leaders: [], signups: [], orders: copies == null ? [] : [{ group_id: 1, copies, ordered_at: null } as KkData["orders"][number]] });
const render = (data: KkData, editable = true) =>
  renderToStaticMarkup(createElement(BookOrder, { g, kk: data, signed: 12, leaders: 2, editable, busy: null, act: async () => true, port: {} as DataPort }));

/** The «למלא» button's opening tag. */
const fill = (html: string) => html.match(/<button[^>]*data-fill-copies[^>]*>/)?.[0] ?? "";

describe("the book order's suggestion", () => {
  it("«הצעה: 14» for 12 signed up and 2 leaders, with «למלא» — active while the field holds something else", () => {
    const out = render(kk());
    expect(out).toContain('data-copies-suggestion="14"');
    expect(out).toContain("הצעה: 14");
    expect(out).toContain("נרשמו 12 · מעבירים 2");
    expect(out).toMatch(/<button[^>]*data-fill-copies[^>]*aria-label="למלא את ההצעה: 14 עותקים"[^>]*>למלא<\/button>/);
    expect(fill(out)).not.toContain('aria-disabled="true"');
  });

  it("already the suggestion: «למלא» has nothing to do; read-only: no suggestion at all", () => {
    expect(fill(render(kk(14)))).toContain('aria-disabled="true"');
    const read = render(kk(9), false);
    expect(read).not.toContain("הצעה");
    expect(read).toContain("ספרים: 9 עותקים");
  });
});
