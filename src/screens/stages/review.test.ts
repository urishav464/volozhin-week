// reviewFormProps: who may write a lesson's «איך עבר» on the panel and on «אחרי השבוע» alike (ReviewStage.tsx) — an
// edition admin always, the handler once the lesson's day has passed (Israel), nobody else; logistics never.
import { describe, expect, it } from "vitest";
import type { LessonReview } from "../../data/reviews";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek } from "../../testing/week";
import type { Actor } from "../weekStore";
import { dateText, reviewFormProps } from "./ReviewStage";

const actor = (over: Partial<Actor>): Actor => ({ memberId: 2, role: "content", isAdmin: false, global: false, canEdit: true, ...over });
const review = (speaker_id: number | null): LessonReview => ({
  lesson_id: 0, speaker_id, went_well: "טוב", issues: null, invite_again: "yes", overran: false, rating: 4, written_by: 2, written_at: "2027-02-16T10:00:00Z", version: 1,
});

function fixture() {
  const w = emptyWeek(); // Sunday 2027-02-14
  const s = addSpeaker(w, "f");
  Object.assign(addApproach(w, s, "positive"), { owner_member_id: 2 });
  const l = closeWith(w, addLesson(w, 1, 960, 1050), s); // Monday: opens Tuesday the 16th
  return { w, s, l };
}

describe("reviewFormProps", () => {
  it("the handler writes from the day after the lesson; before it, only reads", () => {
    const { w, l } = fixture();
    expect(reviewFormProps(w, l, actor({}), 2, null, "2027-02-15T20:00:00Z")).toMatchObject({ mayWrite: false, handlerHere: true, win: { state: "before", opensOn: "2027-02-16" } });
    expect(reviewFormProps(w, l, actor({}), 2, null, "2027-02-16T08:00:00Z")).toMatchObject({ mayWrite: true, win: { state: "open" } });
  });

  it("an edition admin writes any lesson any time; another trainee and logistics never", () => {
    const { w, l } = fixture();
    const before = "2027-02-10T10:00:00Z";
    expect(reviewFormProps(w, l, actor({ memberId: 1, role: "admin", isAdmin: true }), 2, null, before)).toMatchObject({ mayWrite: true, isAdmin: true, handlerHere: false });
    expect(reviewFormProps(w, l, actor({ memberId: 3 }), 2, null, "2027-02-20T10:00:00Z").mayWrite).toBe(false);
    expect(reviewFormProps(w, l, actor({ memberId: 2, role: "logistics", canEdit: false }), 2, null, "2027-02-20T10:00:00Z").mayWrite).toBe(false);
    w.edition.start_date = null;
    expect(reviewFormProps(w, l, actor({}), 2, null, "2027-02-20T10:00:00Z")).toMatchObject({ mayWrite: false, win: { state: "tbd" } });
  });

  it("the words: the lead's gender, an imported archive, a review about the previous lead", () => {
    const { w, s, l } = fixture();
    const now = "2027-02-20T10:00:00Z";
    expect(reviewFormProps(w, l, actor({}), 2, null, now)).toMatchObject({ overranWord: "חרגה מהזמן", imported: false, speakerChanged: false });
    expect(reviewFormProps(w, l, actor({}), 2, review(s.id), now).speakerChanged).toBe(false);
    expect(reviewFormProps(w, l, actor({}), 2, review(s.id + 1), now).speakerChanged).toBe(true);
    expect(reviewFormProps(w, l, actor({}), 2, review(null), now).speakerChanged).toBe(false);
    w.edition.kind = "archive";
    expect(reviewFormProps(w, l, actor({}), 2, null, now).imported).toBe(true);
  });

  it("dates as the site writes them", () => {
    expect(dateText("2027-02-16")).toBe("16.2.2027");
  });
});
