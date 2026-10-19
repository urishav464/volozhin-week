import { describe, expect, it } from "vitest";
import { addSpeaker, emptyWeek } from "../../testing/week";
import { EMPTY_FORM, fieldsOf, formOf, patchOf } from "./parts";

describe("the profile form", () => {
  it("an edit sends only what changed, so it never overwrites a field someone else just saved", () => {
    const s = addSpeaker(emptyWeek(), "f", "פלונית");
    Object.assign(s, { title: "ד״ר", affiliation: "מוסד לדוגמה", topics: ["תנ״ך"] });
    expect(patchOf(s, formOf(s))).toEqual({});
    expect(patchOf(s, { ...formOf(s), bio_short: "  תיאור  ", topics: ["תנ״ך", "שירה"] })).toEqual({ bio_short: "תיאור", topics: ["תנ״ך", "שירה"] });
    expect(patchOf(s, { ...formOf(s), title: "", gender: null, affiliation: " " })).toEqual({ title: null, gender: null, affiliation: null });
  });

  it("a new speaker's fields: empty is null, gender as chosen (never guessed)", () => {
    expect(fieldsOf({ ...EMPTY_FORM, name: "פלוני" })).toEqual({
      title: null, name: "פלוני", disambiguator: null, gender: null, affiliation: null, bio_short: null, topics: [], contact_pref: null,
    });
  });
});
