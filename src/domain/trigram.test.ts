// pg_trgm in the browser. tests/sql/speakers.test.ts compares it with the
// extension itself on a sample; these pin the parts of the algorithm.
import { describe, expect, it } from "vitest";
import { similarity, trigrams } from "./trigram";

describe("trigrams", () => {
  it("pads each word with two spaces before and one after, lower-case, each trigram once", () => {
    expect([...trigrams("Ab")]).toEqual(["  a", " ab", "ab "]);
    expect([...trigrams("א")]).toEqual(["  א", " א "]);
    expect(trigrams("ab ab").size).toBe(3);
  });

  it("splits words on anything but letters and digits", () => {
    expect(trigrams("בן-ציון")).toEqual(trigrams("בן ציון"));
    expect(trigrams("x/y")).toEqual(trigrams("x y"));
    expect(trigrams("12a")).toEqual(new Set(["  1", " 12", "12a", "2a "]));
    expect(trigrams("!?").size).toBe(0);
  });
});

describe("similarity", () => {
  it("is shared / (a + b − shared), as a 4-byte float", () => {
    expect(similarity("שרה כהן", "כהן")).toBe(0.5);
    expect(similarity("פלונית אלמונית", "פלונית אלמוני")).toBe(Math.fround(12 / 13)); // 12 trigrams and 13, all 12 shared
    expect(similarity("פלונית אלמונית", "אלמונית פלונית")).toBe(1);
  });

  it("is 0 when either side has no trigram", () => {
    expect(similarity("", "x")).toBe(0);
    expect(similarity("-", "-")).toBe(0);
  });
});
