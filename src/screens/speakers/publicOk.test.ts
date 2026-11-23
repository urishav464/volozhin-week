// The words and the one rule of «מאושר/ת להופיע» (PublicOk.tsx) — the activity log's words in the toast, the speaker's
// gender where it is known and the slashed form where not, and who is never offered the box (a practice or demo week);
// and the switch as markup (no browser): who changes it, who reads it — and in a practice week, where nobody but a global
// admin MARKS, a mark already there is taken back as anywhere (set_public_ok asks app.may_edit_speaker for `true` only;
// tests/sql/v19.test.ts pins it — the review of phase 5).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GuestActor } from "../../domain/guestSite";
import type { Approach, Edition } from "../../domain/types";
import { approvedWord, practiceWeek, publicOkDone, publicOkHint, PublicOkSwitch } from "./PublicOk";

describe("«מאושר/ת להופיע באתר האורחים» (the reset, phase 5)", () => {
  it("the toast says what the activity log says, in the speaker's gender", () => {
    expect(publicOkDone({ title: "ד״ר", name: "מרצה 01", gender: "m" }, true)).toBe("ד״ר מרצה 01 אושר להופיע באתר האורחים");
    expect(publicOkDone({ title: null, name: "מרצה 16", gender: "f" }, false)).toBe("מרצה 16 הוסרה מאתר האורחים");
    expect(publicOkDone({ title: null, name: "מרצה 02", gender: null }, true)).toBe("מרצה 02 אושר/ה להופיע באתר האורחים");
    expect(publicOkDone({ title: null, name: "מרצה 02", gender: null }, false)).toBe("מרצה 02 הוסר/ה מאתר האורחים");
  });

  it("the hint and the state word", () => {
    expect(publicOkHint(null)).toBe("מסמנים רק אחרי שהמרצה הסכים/ה שהשם, התיאור והתמונה יופיעו באתר. ביטול מוריד אותם מהאתר מיד.");
    expect(publicOkHint("f")).toContain("שהמרצה הסכימה שהשם");
    expect([approvedWord("m"), approvedWord("f"), approvedWord(null)]).toEqual(["מאושר", "מאושרת", "מאושר/ת"]);
  });

  it("no box in a practice or demo week but for a global admin; a real edition — live or archived — follows the rules", () => {
    expect(practiceWeek({ global: false }, { kind: "practice" })).toBe(true);
    expect(practiceWeek({ global: false }, { kind: "demo" })).toBe(true);
    expect(practiceWeek({ global: true }, { kind: "demo" })).toBe(false);
    expect(practiceWeek({ global: false }, { kind: "real" })).toBe(false);
    expect(practiceWeek({ global: false }, { kind: "archive" })).toBe(false);
  });
});

const approach = (patch: Partial<Approach>): Approach => ({ id: 31, speaker_id: 7, owner_member_id: 2, status: "positive", avail_note: null, offered_to: null, version: 3, public_ok: false, ...patch });
const owner: GuestActor = { memberId: 2, isAdmin: false, global: false, canEdit: true };
const editionAdmin: GuestActor = { memberId: 1, isAdmin: true, global: false, canEdit: true };
const otherTrainee: GuestActor = { memberId: 4, isAdmin: false, global: false, canEdit: true };
const logistics: GuestActor = { memberId: 5, isAdmin: false, global: false, canEdit: false };
const real: Pick<Edition, "kind" | "status"> = { kind: "real", status: "active" };
const practice: Pick<Edition, "kind" | "status"> = { kind: "practice", status: "active" };

const html = (actor: GuestActor, edition: Pick<Edition, "kind" | "status">, a: Approach) =>
  renderToStaticMarkup(createElement(PublicOkSwitch, { speaker: { gender: "m" }, approach: a, actor, edition, busy: false, onSet: async () => undefined }));
const box = (out: string) => /<input[^>]*data-public-ok="31"[^>]*>/.exec(out)?.[0] ?? null;

describe("PublicOkSwitch", () => {
  it("a real week: the owner and the admin change it; another trainee and logistics read it, told who marks", () => {
    for (const who of [owner, editionAdmin]) {
      const out = html(who, real, approach({}));
      expect(box(out)).not.toMatch(/disabled=""/);
      expect(out).toContain("מסמנים רק אחרי שהמרצה הסכים");
    }
    for (const who of [otherTrainee, logistics]) {
      const out = html(who, real, approach({ public_ok: true }));
      expect(box(out)).toMatch(/disabled=""/);
      expect(box(out)).toMatch(/checked=""/);
      expect(out).toContain("מסמנים: מי שמטפל/ת במרצה, או הצוות.");
      expect(out).not.toContain("מסמנים רק אחרי");
    }
  });

  it("a practice week: no box to mark — but a mark already there keeps its box, to be taken back by its owner or an admin", () => {
    const unmarked = html(owner, practice, approach({}));
    expect(unmarked).toContain("data-public-ok-practice");
    expect(box(unmarked)).toBeNull();
    for (const who of [owner, editionAdmin]) {
      const out = html(who, practice, approach({ public_ok: true }));
      expect(out).not.toContain("data-public-ok-practice");
      expect(box(out)).toMatch(/checked=""/);
      expect(box(out)).not.toMatch(/disabled=""/);
    }
    const theirs = html(otherTrainee, practice, approach({ public_ok: true }));
    expect(box(theirs)).toMatch(/disabled=""/);
  });
});
