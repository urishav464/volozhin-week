// The pool's cleaning rules, as the database's app.clean_* helpers apply them
// (tests/parity sends the same inputs through both).
import { describe, expect, it } from "vitest";
import { CommandError } from "./commands";
import { cleanBlock, cleanContactEmail, cleanLine, cleanPhone, cleanTopics, DEFAULT_TITLES, pickContactPref, pickGender, pickTitle, titlesOf } from "./speakerRules";

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
