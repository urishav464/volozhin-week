// The summary message engine, rule by rule. The templates here are test
// fixtures («נוסח לדוגמה»), never the product's wording: the real template is
// the instructor's, pasted in «הגדרות ← תבניות».
import { describe, expect, it } from "vitest";
import { mailtoHref, whatsappTextHref } from "./contactLinks";
import {
  amountText, composeConfirmation, confirmSubject, durationWords, hebrewDateLong, type MessageInput, messageDate, parseTemplate, teachMinutes, weekdayOf,
} from "./message";

const FULL =
  "נוסח לדוגמה ל{{פנייה}}: [[מוזמן|מוזמנת]] ל«{{כותרת}}», יום {{יום}} {{תאריך}}, {{שעה}} ({{משך}}), {{מקום}}. [[תשלום:סכום {{תשלום}} ש״ח|בהתנדבות]]. {{אני:כתב|כתבה}}";

function input(over: Partial<MessageInput> = {}, lesson: Partial<MessageInput["lesson"]> = {}): MessageInput {
  return {
    template: FULL,
    lesson: { state: "closed", day: 0, start_min: 1200, end_min: 1290, title: "שיעור לדוגמה", teach_min: null, pay_amount: 1500, approval: "approved", ...lesson },
    speaker: { title: "ד״ר", name: "מרצה לדוגמה", gender: "f" },
    sender: { gender: "m" },
    room: "בית מדרש",
    startDate: "2027-02-14",
    ...over,
  };
}

const codes = (i: MessageInput) => composeConfirmation(i).problems.map((p) => p.code);

describe("the words and numbers a message is made of", () => {
  it("{{משך}}: the four the design names, and minutes otherwise", () => {
    expect(durationWords(75)).toBe("שעה ורבע");
    expect(durationWords(90)).toBe("שעה וחצי");
    expect(durationWords(60)).toBe("שעה");
    expect(durationWords(45)).toBe("שלושת רבעי שעה");
    expect(durationWords(30)).toBe("30 דקות");
    expect(durationWords(120)).toBe("120 דקות");
    expect(durationWords(50)).toBe("50 דקות");
  });

  it("teaching time: the lesson's own, else min(75, the slot), or the edition's lesson_minutes", () => {
    expect(teachMinutes({ start_min: 1200, end_min: 1290, teach_min: null })).toBe(75);
    expect(teachMinutes({ start_min: 870, end_min: 930, teach_min: null })).toBe(60);
    expect(teachMinutes({ start_min: 930, end_min: 960, teach_min: null })).toBe(30);
    expect(teachMinutes({ start_min: 1200, end_min: 1290, teach_min: 90 })).toBe(90);
    expect(teachMinutes({ start_min: 1200, end_min: 1290, teach_min: null }, 80)).toBe(80);
    expect(teachMinutes({ start_min: 1470, end_min: 1740, teach_min: null }, null)).toBe(75);
  });

  it("{{יום}} is the calendar's: the night after a day column belongs to the next date", () => {
    expect(weekdayOf(0, 510)).toBe("ראשון");
    expect(weekdayOf(0, 1350)).toBe("ראשון"); // 22:30
    expect(weekdayOf(0, 1470)).toBe("שני"); // 00:30
    expect(weekdayOf(3, 1650)).toBe("חמישי");
    expect(weekdayOf(4, 1050)).toBe("חמישי");
  });

  it("{{תאריך}}: Gregorian, then the Hebrew date from Intl with Hebrew numerals; null while TBD", () => {
    expect(messageDate("2027-02-14", 0, 510)).toBe("14.2.2027 (ז׳ באדר א׳ תשפ״ז)");
    expect(messageDate("2027-02-14", 0, 1470)).toBe("15.2.2027 (ח׳ באדר א׳ תשפ״ז)");
    expect(messageDate("2027-02-14", 1, 1200)).toBe("15.2.2027 (ח׳ באדר א׳ תשפ״ז)");
    expect(messageDate("2027-02-21", 4, 1050)).toBe("25.2.2027 (י״ח באדר א׳ תשפ״ז)");
    expect(messageDate(null, 0, 510)).toBeNull();
    expect(hebrewDateLong(new Date(Date.UTC(2026, 9, 19)))).toBe("ח׳ בחשוון תשפ״ז"); // 1 Tishrei 5787 was 12.9.2026
  });

  it("{{תשלום}}: digits with a thousands separator, nothing more", () => {
    expect(amountText(500)).toBe("500");
    expect(amountText(1500)).toBe("1,500");
  });

  it("the mail's subject is the week's name and the edition's label", () => {
    expect(confirmSubject("תשפ\"ז")).toBe("שבוע וולוז'ין תשפ\"ז");
    expect(confirmSubject(null)).toBe("שבוע וולוז'ין");
  });
});

describe("composeConfirmation", () => {
  it("fills every variable — and adds no word of its own", () => {
    const c = composeConfirmation(input());
    expect(c.problems).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c.text).toBe("נוסח לדוגמה לד״ר מרצה לדוגמה: מוזמנת ל«שיעור לדוגמה», יום ראשון 14.2.2027 (ז׳ באדר א׳ תשפ״ז), 20:00–21:15 (שעה ורבע), בית מדרש. סכום 1,500 ש״ח. כתב");
    const plain = "נוסח לדוגמה בלי משתנים, כמו שהוא.\nשורה שנייה";
    expect(composeConfirmation(input({ template: plain }))).toEqual({ ok: true, text: plain, problems: [] });
  });

  it("takes the speaker's gender for [[זכר|נקבה]] and the sender's for {{אני:…}}", () => {
    expect(composeConfirmation(input({ speaker: { title: "הרב", name: "מרצה לדוגמה", gender: "m" }, sender: { gender: "f" } })).text).toMatch(/^נוסח לדוגמה להרב מרצה לדוגמה: מוזמן ל.*כתבה$/);
    expect(composeConfirmation(input({ speaker: { title: null, name: "מרצה לדוגמה", gender: "f" } })).text).toMatch(/^נוסח לדוגמה למרצה לדוגמה: מוזמנת/);
  });

  it("an unknown gender blocks only where the template asks for one", () => {
    const speaker = { title: null, name: "מרצה לדוגמה", gender: null };
    const s = composeConfirmation(input({ speaker }));
    expect(s.ok).toBe(false);
    expect(s.problems.map((p) => p.code)).toEqual(["speaker_gender"]);
    expect(s.text).toContain("«מוזמן/מוזמנת»");
    expect(codes(input({ speaker, template: "נוסח לדוגמה {{פנייה}}" }))).toEqual([]);

    const t = composeConfirmation(input({ sender: { gender: null } }));
    expect(t.problems.map((p) => p.code)).toEqual(["sender_gender"]);
    expect(t.text.endsWith("«כתב/כתבה»")).toBe(true);
    expect(codes(input({ sender: null }))).toEqual(["sender_gender"]);
    expect(codes(input({ sender: { gender: null }, template: "נוסח לדוגמה {{פנייה}}" }))).toEqual([]);
  });

  it("a TBD blocks: no title, no date — once each, marked in the preview", () => {
    const c = composeConfirmation(input({ startDate: null, template: `${FULL} {{כותרת}} {{תאריך}}` }, { title: null }));
    expect(c.ok).toBe(false);
    expect(c.problems.map((p) => p.code)).toEqual(["title_tbd", "date_tbd"]);
    expect(c.text).toContain("ל««TBD: כותרת»»");
    expect(c.text).toContain("«TBD: תאריך»");
    // a template that never says the date does not wait for it
    expect(codes(input({ startDate: null, template: "נוסח לדוגמה {{פנייה}} {{יום}} {{שעה}}" }))).toEqual([]);
  });

  it("an empty template blocks with one problem and no text — it is never filled in for the instructor", () => {
    for (const template of [null, undefined, "", "  \n\t "]) {
      expect(composeConfirmation(input({ template }))).toEqual({
        ok: false,
        text: "",
        problems: [{ code: "template_empty", message: expect.stringContaining("תבניות") }],
      });
    }
  });

  it("a payment or transport waiting for the instructor — or rejected — blocks, whatever the template says", () => {
    expect(codes(input({}, { approval: "pending" }))).toEqual(["approval_pending"]);
    expect(codes(input({ template: "נוסח לדוגמה" }, { approval: "pending", pay_amount: null }))).toEqual(["approval_pending"]);
    expect(codes(input({}, { approval: "rejected" }))).toEqual(["approval_rejected"]);
    expect(codes(input({}, { approval: "none", pay_amount: null }))).toEqual([]);
  });

  it("a lesson that is not closed, or has no speaker, is not sent", () => {
    expect(codes(input({}, { state: "draft" }))).toEqual(["not_closed"]);
    expect(codes(input({ speaker: null }))).toEqual(["no_speaker", "speaker_gender"]);
    expect(codes(input({ room: null }))).toEqual(["room_missing"]);
  });

  it("a volunteer: the template's own wording, or a block when it has none", () => {
    const free = input({}, { pay_amount: null, approval: "none" });
    expect(composeConfirmation(free).text).toContain(", בית מדרש. בהתנדבות. כתב");
    expect(composeConfirmation(free).ok).toBe(true);
    const bare = composeConfirmation(input({ template: "נוסח לדוגמה: {{תשלום}} ש״ח" }, { pay_amount: null, approval: "none" }));
    expect(bare.problems.map((p) => p.code)).toEqual(["no_amount"]);
    expect(bare.text).toBe("נוסח לדוגמה: «TBD: תשלום» ש״ח");
    // an approved amount fills the paid branch; an empty volunteer branch is the template's choice
    expect(composeConfirmation(input({ template: "א[[תשלום:{{תשלום}}|]]ב" }, { pay_amount: null, approval: "none" })).text).toBe("אב");
    expect(composeConfirmation(input({ template: "א[[תשלום:{{תשלום}}|]]ב" }, { pay_amount: 250 })).text).toBe("א250ב");
  });

  it("forgives spaces around «תשלום:» and «אני:» — a payment switch is never read as a gender pair", () => {
    expect(composeConfirmation(input({ template: "[[ תשלום : סכום {{תשלום}}|בהתנדבות]] {{ אני : כתב|כתבה }}" })).text).toBe("סכום 1,500 כתב");
    expect(composeConfirmation(input({ template: "[[ תשלום : סכום {{תשלום}}|בהתנדבות]]" }, { pay_amount: null, approval: "none" })).text).toBe("בהתנדבות");
  });

  it("brackets nest: a gendered word inside the payment's wording", () => {
    const template = "[[תשלום:[[הוא יקבל|היא תקבל]] {{תשלום}}|[[מתנדב|מתנדבת]]]]";
    expect(composeConfirmation(input({ template })).text).toBe("היא תקבל 1,500");
    expect(composeConfirmation(input({ template, speaker: { title: null, name: "x", gender: "m" } }, { pay_amount: null, approval: "none" })).text).toBe("מתנדב");
  });

  it("an unknown variable blocks and names itself and the ones there are", () => {
    const c = composeConfirmation(input({ template: "נוסח לדוגמה {{שם}} {{ יום }}" }));
    expect(c.problems).toEqual([{ code: "unknown_variable", message: expect.stringMatching(/^משתנה לא מוכר בנוסח: \{\{שם\}\}\. המשתנים שאפשר: \{\{פנייה\}\} .*\{\{תשלום\}\}\.$/) }]);
    expect(c.text).toBe("נוסח לדוגמה «TBD: שם» ראשון"); // spaces inside the braces are fine
  });

  it("an unknown variable blocks in a branch the lesson does not take, too — the preview's defaults never hide a typo", () => {
    const female = { speaker: { title: null, name: "מרצה לדוגמה", gender: "f" as const } };
    for (const [template, over, lesson] of [
      ["[[{{פניהה}} מוזמן|מוזמנת]]", female, {}], // the masculine form, for a woman
      ["[[מוזמן|{{פניהה}} מוזמנת]]", { speaker: { title: null, name: "x", gender: "m" as const } }, {}], // the feminine form, for a man
      ["[[תשלום:{{סכוםם}} ש״ח|בהתנדבות]]", female, { pay_amount: null, approval: "none" as const }], // the paid wording, for a volunteer
      ["[[תשלום:{{תשלום}} ש״ח|{{התנדבות}}]]", female, {}], // the volunteer wording, for a paid lesson
      ["[[תשלום:[[{{פניהה}}|א]]|ב]]", female, { pay_amount: null, approval: "none" as const }], // nested, two branches deep
    ] as const) {
      const c = composeConfirmation(input(over, lesson));
      expect(c.ok, template).toBe(true); // the default template is fine …
      const t = composeConfirmation(input({ ...over, template }, lesson));
      expect(t.ok, template).toBe(false); // … this one names a variable there is not
      expect(t.problems.map((p) => p.code), template).toEqual(["unknown_variable"]);
    }
    expect(composeConfirmation(input({ template: "[[{{שם}}|{{שם}}]] {{שם}}" })).problems).toHaveLength(1); // named once
  });

  it("with no template, the lesson's own blockers are listed too — pasting the wording never reveals a second one", () => {
    expect(codes(input({ template: "" }, { approval: "pending" }))).toEqual(["template_empty", "approval_pending"]);
    expect(codes(input({ template: null, speaker: null }, { approval: "rejected" }))).toEqual(["template_empty", "no_speaker", "approval_rejected"]);
    expect(composeConfirmation(input({ template: "" }, { state: "draft" })).text).toBe("");
  });

  it("a broken bracket blocks, saying where", () => {
    for (const template of ["{{פנייה", "[[מוזמן|מוזמנת", "[[א|ב|ג]]", "[[לבד]]", "א]]ב", "א}}ב", "{{אני:כתב}}", "{{פנייה [[א|ב]] }}", "[[תשלום:רק אחת]]"]) {
      const c = composeConfirmation(input({ template }));
      expect(c.ok, template).toBe(false);
      expect(c.problems.map((p) => p.code), template).toContain("syntax");
    }
    expect(parseTemplate("{{פנייה}} [[א|ב]] [[תשלום:{{תשלום}}|ג]] {{אני:ד|ה}}").errors).toEqual([]);
    expect(parseTemplate("[[א|ב").errors).toEqual(["«[[» בלי «]]»: [[א|ב"]);
  });

  it("keeps the template's lines (CRLF → LF), and a single bracket or brace is just text", () => {
    expect(composeConfirmation(input({ template: "שורה\r\nשנייה {כן} [לא] א|ב" })).text).toBe("שורה\nשנייה {כן} [לא] א|ב");
  });
});

describe("sending", () => {
  it("WhatsApp: to the number when it is the caller's to see, else to a chat they pick", () => {
    expect(whatsappTextHref("שלום לך\nשורה", "01-234-567")).toBe(`https://wa.me/9721234567?text=${encodeURIComponent("שלום לך\nשורה")}`);
    expect(whatsappTextHref("שלום", null)).toBe(`https://wa.me/?text=${encodeURIComponent("שלום")}`);
    expect(whatsappTextHref("שלום", "טלפון לדוגמה")).toBe(`https://wa.me/?text=${encodeURIComponent("שלום")}`);
  });

  it("mail: a subject and the body with CRLF lines; no address when there is none to see", () => {
    expect(mailtoHref("speaker01@example.org", "נושא", "א\nב")).toBe(`mailto:speaker01@example.org?subject=${encodeURIComponent("נושא")}&body=${encodeURIComponent("א\r\nב")}`);
    expect(mailtoHref(null, "נושא", "א")).toBe(`mailto:?subject=${encodeURIComponent("נושא")}&body=${encodeURIComponent("א")}`);
  });
});
