import { describe, expect, it } from "vitest";
import { composeCallPoints, DEFAULT_CALL_TEMPLATE, slashed } from "./callPoints";

// The instructor's text exactly as given (26.10), «X» for the caller; trailing spaces at line ends dropped.
const INSTRUCTOR = `*נקודות להתייחסות בשיחת טלפון:*
*אני X מהמדרשה הגבוהה בעין פרת
*היא מעורבת דתיים חילונים לפני צבא
*אנחנו מרימים בפברואר שבוע וולוזין לזכר ישיבת וולוזין
*לומדים 5 ימים 24/7 ומחליפים מרצה כל שעה וחצי
*נשמח שתגיע ללמד שעה ורבע, תסכים?
*בדכ השבוע קורה בהתנדבות. זה בסדר מבחינתך? (אם לא להבין כמה רוצה ולומר שאדבר עם המנהלנית)
*מה נושא השיעור?
*נבקש שתתחיל להכין דף מקורות`;

const caller = { name: "חניך/ה לדוגמה", gender: null };

describe("the call points (v14)", () => {
  it("to a man: the instructor's text, letter for letter, the caller's name for X", () => {
    const c = composeCallPoints({ template: null, speakerGender: "m", caller });
    expect(c.text).toBe(INSTRUCTOR.replace("X", "חניך/ה לדוגמה"));
    expect(c.problems).toEqual([]);
    expect(c.custom).toBe(false);
  });

  it("to a woman: the three words that address her", () => {
    const c = composeCallPoints({ template: undefined, speakerGender: "f", caller });
    expect(c.text).toContain("*נשמח שתגיעי ללמד שעה ורבע, תסכימי?");
    expect(c.text).toContain("*נבקש שתתחילי להכין דף מקורות");
    expect(c.text).not.toContain("שתגיע ");
  });

  it("a gender not yet known reads both forms — and blocks nothing", () => {
    const c = composeCallPoints({ template: "", speakerGender: null, caller });
    expect(c.text).toContain("*נשמח שתגיע/י ללמד שעה ורבע, תסכים/י?");
    expect(c.text).toContain("*נבקש שתתחיל/י להכין דף מקורות");
    expect(c.problems).toEqual([]);
  });

  it("no name on the team list: «השם שלך», said under the points", () => {
    const c = composeCallPoints({ template: null, speakerGender: "m", caller: { name: "  ", gender: null } });
    expect(c.text).toContain("*אני השם שלך מהמדרשה");
    expect(c.problems).toEqual(["השם שלך לא רשום ברשימת הצוות."]);
  });

  it("the instructor's own saved text replaces the built-in one; {{אני:…}} follows the caller", () => {
    const c = composeCallPoints({ template: "שלום, {{אני:אני חניך|אני חניכה}} {{שמי}}. [[תוכל|תוכלי]]?", speakerGender: "f", caller: { name: "נועה", gender: "f" } });
    expect(c).toEqual({ text: "שלום, אני חניכה נועה. תוכלי?", problems: [], custom: true });
    expect(composeCallPoints({ template: "{{אני:מתקשר|מתקשרת}}", speakerGender: null, caller: { name: "א", gender: null } }).text).toBe("מתקשר/ת");
  });

  it("what cannot be filled in is listed, never blocking", () => {
    const c = composeCallPoints({ template: "{{פנייה}} [[תשלום:בתשלום|בהתנדבות]] [[אחד", speakerGender: "m", caller });
    expect(c.text.startsWith("{{פנייה}}")).toBe(true);
    expect(c.problems).toHaveLength(4); // the bracket left open (twice: unclosed, one form), the variable, the payment switch
  });

  it("slashes by what the feminine adds, or whole when it does not extend the masculine", () => {
    expect(slashed("שתגיע", "שתגיעי")).toBe("שתגיע/י");
    expect(slashed("תסכים", "תסכימי")).toBe("תסכים/י"); // a final mem
    expect(slashed("ענה", "ענתה")).toBe("ענה/ענתה");
    expect(slashed("כן", "כן")).toBe("כן/כן");
  });

  it("the built-in template keeps the instructor's wording around its variables", () => {
    for (const piece of ["שעה ורבע", "בדכ השבוע", "וולוזין", "24/7", "(אם לא להבין כמה רוצה ולומר שאדבר עם המנהלנית)"]) expect(DEFAULT_CALL_TEMPLATE).toContain(piece);
  });
});
