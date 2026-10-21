// «איך עבר» across the years on the engine (Engine.speakerReviews ≡ public.speaker_reviews): a live edition's own
// reviews are its own team's — another live real edition's never reach a content member here; a past year's do.
import { describe, expect, it } from "vitest";
import { demoWeek } from "./demoWeek";
import { emptyShared, Engine } from "./engine";
import type { Week } from "../domain/types";

describe("Engine.speakerReviews", () => {
  it("a review on another live real edition is hidden from this edition's content member; a past year's is read; a global admin reads both", () => {
    const here = demoWeek();
    here.edition = { ...here.edition, kind: "real", status: "active" };
    const other: Week = { ...structuredClone(demoWeek()), edition: { ...here.edition, id: here.edition.id + 1, label: "מחזור אחר (לדוגמה)", kind: "real", status: "active" } };
    const past: Week = { ...structuredClone(demoWeek()), edition: { ...here.edition, id: here.edition.id + 2, label: "שנה קודמת (לדוגמה)", kind: "real", status: "archived" } };
    const lesson = (w: Week) => w.lessons.find((l) => l.state === "closed" && l.kind === "lesson")!;
    const speaker = here.lessonSpeakers.find((x) => x.lesson_id === lesson(here).id)!.speaker_id;
    const shared = emptyShared();
    const review = (w: Week, went_well: string) => ({
      edition_id: w.edition.id, lesson_id: lesson(w).id, speaker_id: speaker, went_well, issues: null, invite_again: "yes" as const, overran: false, rating: 4,
      written_by: 1, written_at: "2026-10-20T10:00:00.000Z", version: 1,
    });
    shared.reviews.push(review(other, "במחזור האחר"), review(past, "בשנה הקודמת"));
    const read = (actor: ConstructorParameters<typeof Engine>[1]) => new Engine(here, actor, undefined, shared, () => [other, past]).speakerReviews(speaker).map((r) => r.went_well);
    expect(read({ memberId: 2, role: "content" })).toEqual(["בשנה הקודמת"]);
    expect(read({ memberId: 1, role: "admin", global: true }).sort()).toEqual(["במחזור האחר", "בשנה הקודמת"].sort());
  });
});
