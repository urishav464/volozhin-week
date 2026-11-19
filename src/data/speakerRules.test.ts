// The pool's cleaning rules, as the database's app.clean_* helpers apply them
// (tests/parity sends the same inputs through both).
import { describe, expect, it } from "vitest";
import { CommandError } from "./commands";
import {
  asText, cleanAvailabilityRanges, cleanBlock, cleanContactEmail, cleanLine, cleanPhone, cleanPublicBio, cleanTopics, DEFAULT_TITLES, LIMITS, pickContactPref, pickGender, pickTitle,
  titlesOf,
} from "./speakerRules";

const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : String(e);
  }
};

describe("speaker rules", () => {
  it("cleans one line: ASCII whitespace runs to one space, trimmed, empty is null, counted in code points", () => {
    expect(cleanLine("  א \t\n ב  ", 10)).toBe("א ב");
    expect(cleanLine(" \t ", 10)).toBeNull();
    expect(cleanLine(null, 10)).toBeNull();
    expect(cleanLine("a b", 10)).toBe("a b"); // only ASCII whitespace, as the database's class
    expect(cleanLine("😀😀", 2)).toBe("😀😀");
    expect(code(() => cleanLine("abc", 2))).toBe("bad_value");
  });

  it("keeps a block's lines, trimming only its ends", () => {
    expect(cleanBlock("  שורה\r\nשנייה  \n", 100)).toBe("שורה\nשנייה");
    expect(cleanBlock("\n\n", 100)).toBeNull();
  });

  it("takes titles, gender and the contact channel from their lists only — gender is never guessed", () => {
    expect(titlesOf({})).toBe(DEFAULT_TITLES);
    expect(titlesOf({ titles: [] })).toBe(DEFAULT_TITLES);
    expect(titlesOf({ titles: ["מורה"] })).toEqual(["מורה"]);
    expect(pickTitle(" ד״ר ", DEFAULT_TITLES)).toBe("ד״ר");
    expect(code(() => pickTitle('ד"ר', DEFAULT_TITLES))).toBe("bad_value");
    expect(pickTitle("", DEFAULT_TITLES)).toBeNull();
    expect(pickGender("")).toBeNull();
    expect(code(() => pickGender("F"))).toBe("bad_value");
    expect(pickContactPref("whatsapp")).toBe("whatsapp");
    expect(code(() => pickContactPref("fax"))).toBe("bad_value");
  });

  it("dedupes topics, keeping the first, and refuses more than ten or a non-list", () => {
    expect(cleanTopics([" תנ״ך ", "תנ״ך", "", "פילוסופיה"])).toEqual(["תנ״ך", "פילוסופיה"]);
    expect(cleanTopics(null)).toEqual([]);
    expect(code(() => cleanTopics("תנ״ך"))).toBe("bad_value");
    expect(code(() => cleanTopics([1]))).toBe("bad_value");
    expect(code(() => cleanTopics(Array.from({ length: 11 }, (_, i) => String(i))))).toBe("bad_value");
  });

  it("wants six digits in a phone and an @ with a dot after it in an address", () => {
    expect(cleanPhone(" 555 0100 99 ")).toBe("555 0100 99");
    expect(code(() => cleanPhone("12-34"))).toBe("bad_phone");
    expect(cleanContactEmail("Speaker@Example.org")).toBe("Speaker@Example.org");
    expect(code(() => cleanContactEmail("speaker@example"))).toBe("bad_contact_email");
    expect(code(() => cleanContactEmail("a b@example.org"))).toBe("bad_contact_email");
  });
});

describe("availability by ranges (v18): what set_availability_ranges takes", () => {
  const r = (day: number, start: number, end: number, kind: unknown = "can") => ({ day, start, end, kind });
  const bad = (days: unknown, ranges: unknown, rest?: unknown) => code(() => cleanAvailabilityRanges(days, ranges, rest));

  it("keeps the ranges as given, the days ascending, the rest — no ranges and no rest are an empty list and null", () => {
    expect(cleanAvailabilityRanges([3, 1], [r(3, 600, 690), r(1, 0, 1830, "cannot")], "cannot")).toEqual({
      days: [1, 3],
      ranges: [{ day: 3, start: 600, end: 690, kind: "can" }, { day: 1, start: 0, end: 1830, kind: "cannot" }],
      rest: "cannot",
    });
    expect(cleanAvailabilityRanges([0], null, null)).toEqual({ days: [0], ranges: [], rest: null });
    expect(cleanAvailabilityRanges([4, 3, 2, 1, 0], undefined, undefined)).toEqual({ days: [0, 1, 2, 3, 4], ranges: [], rest: null });
    // a key given as undefined is not there (JSON drops it): the four keys are all that count
    expect(cleanAvailabilityRanges([2], [{ ...r(2, 510, 600), note: undefined }], "can").ranges).toEqual([{ day: 2, start: 510, end: 600, kind: "can" }]);
  });

  it("refuses the days: none, more than five, a repeat, one outside 0–4, a fraction, a string, not a list", () => {
    expect(bad([], [])).toBe("bad_value");
    expect(bad(null, [])).toBe("bad_value");
    expect(bad([0, 1, 2, 3, 4, 0], [])).toBe("bad_value");
    expect(bad([1, 1], [])).toBe("bad_value");
    expect(bad([5], [])).toBe("bad_value");
    expect(bad([-1], [])).toBe("bad_value");
    expect(bad([1.5], [])).toBe("bad_value");
    expect(bad(["1"], [])).toBe("bad_value");
    expect(bad([null], [])).toBe("bad_value");
    expect(bad(1, [])).toBe("bad_value");
  });

  it("refuses the ranges: not a list, more than forty, not an object, a key missing or extra, a day not listed, minutes that are not whole or out of 0–1830, start not before end, a kind", () => {
    expect(bad([1], {})).toBe("bad_value");
    expect(bad([1], "510-600")).toBe("bad_value");
    expect(LIMITS.avail_ranges).toBe(40);
    expect(bad([1], Array.from({ length: 40 }, () => r(1, 510, 600)))).toBe("ok");
    expect(bad([1], Array.from({ length: 41 }, () => r(1, 510, 600)))).toBe("bad_value");
    expect(bad([1], [null])).toBe("bad_value");
    expect(bad([1], [[1, 510, 600, "can"]])).toBe("bad_value");
    expect(bad([1], ["can"])).toBe("bad_value");
    expect(bad([1], [{ day: 1, start: 510, end: 600 }])).toBe("bad_value"); // no kind
    expect(bad([1], [{ day: 1, start: 510, kind: "can" }])).toBe("bad_value"); // no end
    expect(bad([1], [{ ...r(1, 510, 600), kind: undefined }])).toBe("bad_value"); // undefined is absent
    expect(bad([1], [{ ...r(1, 510, 600), note: "הערה לדוגמה" }])).toBe("bad_value"); // never a note
    expect(bad([1], [r(2, 510, 600)])).toBe("bad_value"); // a day of the grid, but not one of this call's
    expect(bad([1], [r(7, 510, 600)])).toBe("bad_value");
    expect(bad([1], [{ ...r(1, 510, 600), day: "1" }])).toBe("bad_value");
    expect(bad([1], [{ ...r(1, 510, 600), day: null }])).toBe("bad_value");
    expect(bad([1], [r(1, 510.5, 600)])).toBe("bad_value");
    expect(bad([1], [r(1, -5, 600)])).toBe("bad_value");
    expect(bad([1], [r(1, 510, 1831)])).toBe("bad_value");
    expect(bad([1], [{ ...r(1, 510, 600), start: "510" }])).toBe("bad_value");
    expect(bad([1], [{ ...r(1, 510, 600), end: null }])).toBe("bad_value");
    expect(bad([1], [r(1, 600, 600)])).toBe("bad_value");
    expect(bad([1], [r(1, 690, 600)])).toBe("bad_value");
    expect(bad([1], [r(1, 510, 600, "maybe")])).toBe("bad_value");
    expect(bad([1], [r(1, 510, 600, null)])).toBe("bad_value");
    expect(bad([1], [r(1, 510, 600), r(1, 600, 590)])).toBe("bad_value"); // one bad range refuses them all
  });

  it("refuses a rest that is not can, cannot or nothing", () => {
    expect(bad([1], [], "maybe")).toBe("bad_value");
    expect(bad([1], [], true)).toBe("bad_value");
    expect(bad([1], [], "")).toBe("bad_value");
    expect(bad([1], [], "can")).toBe("ok");
  });
});

describe("v19: a speaker's words for the guests (public_bio)", () => {
  it("a block of up to 600 — its edges trimmed, CRLF made LF — never a phone or an e-mail; read as `->>` reads a JSON value", () => {
    expect(LIMITS.public_bio).toBe(600);
    expect(cleanPublicBio("  תיאור לדוגמה,\r\nבשתי שורות  ")).toBe("תיאור לדוגמה,\nבשתי שורות");
    expect(cleanPublicBio("   ")).toBeNull();
    expect(cleanPublicBio(null)).toBeNull();
    expect(cleanPublicBio("א".repeat(600))).toBe("א".repeat(600));
    expect(code(() => cleanPublicBio("א".repeat(601)))).toBe("bad_value");
    expect(code(() => cleanPublicBio("לפרטים: someone@example.org"))).toBe("contact_in_text");
    expect(code(() => cleanPublicBio("לפרטים: 000-000-0081"))).toBe("contact_in_text");
    expect(code(() => cleanPublicBio(`${"א".repeat(601)} someone@example.org`))).toBe("bad_value"); // the length first
    expect(cleanPublicBio(1948)).toBe("1948"); // a number written out, as `->>` does
    expect([asText(null), asText(true), asText({ a: 1 }), asText("x")]).toEqual([null, "true", '{"a":1}', "x"]);
  });
});
