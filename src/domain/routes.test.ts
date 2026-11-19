import { describe, expect, it } from "vitest";
import {
  afterPath, dayPath, lessonPath, newSpeakerPath, pageStepOf, parseAfterQuery, parseDay, parsePageStep, parseSlot, parseSpeakerSection, parseSpeakersQuery,
  speakerPath, speakersPath, type SpeakersQuery,
} from "./routes";

describe("the trainee's pages' addresses", () => {
  it("a lesson, at a step or not", () => {
    expect(lessonPath(7)).toBe("/lesson/7");
    expect(lessonPath(7, null)).toBe("/lesson/7");
    expect(lessonPath(7, "pay")).toBe("/lesson/7?step=pay");
  });

  it("a speaker, at a section or not; a new one with the name to check", () => {
    expect(speakerPath(7)).toBe("/speakers/7");
    expect(speakerPath(7, "call")).toBe("/speakers/7#call");
    expect(newSpeakerPath()).toBe("/speakers/new");
    expect(newSpeakerPath("  ")).toBe("/speakers/new");
    expect(newSpeakerPath(" מרצה לדוגמה ")).toBe(`/speakers/new?name=${encodeURIComponent("מרצה לדוגמה")}`);
  });

  it("the list's filters, only what is set, in one order", () => {
    expect(speakersPath()).toBe("/speakers");
    expect(speakersPath({})).toBe("/speakers");
    expect(speakersPath({ slot: { day: 0, start: 960, end: 1050 } })).toBe("/speakers?slot=0:960-1050");
    expect(speakersPath({ slot: { day: 0, start: 960, end: 1050, lesson: 34 }, day: 0 })).toBe("/speakers?slot=0:960-1050&lesson=34&day=0");
    expect(speakersPath({ sort: "name", s: "mine", g: "f", cat: 3, q: "תנ\"ך", day: 0, slot: { day: 0, start: 960, end: 1050 } })).toBe(
      `/speakers?slot=0:960-1050&day=0&q=${encodeURIComponent("תנ\"ך")}&cat=3&g=f&s=mine&sort=name`,
    );
    expect(speakersPath({ q: "   " })).toBe("/speakers");
    expect(speakersPath({ view: "team", s: "mine" })).toBe("/speakers?s=mine&view=team"); // the view written last
  });

  it("reads back what it wrote", () => {
    const cases: SpeakersQuery[] = [
      {},
      { q: "מרצה 07" },
      { slot: { day: 4, start: 1470, end: 1560 }, day: 4 },
      { slot: { day: 0, start: 1050, end: 1140, lesson: 34 } },
      { cat: 3, g: "m", s: "declined", sort: "status" },
      { q: "a&b=c#d", day: 2 },
      { view: "team" },
      { s: "mine", view: "team" },
    ];
    for (const q of cases) expect(parseSpeakersQuery(speakersPath(q).replace(/^\/speakers/, ""))).toEqual(q);
  });

  it("drops what is not a value of its filter", () => {
    expect(parseSpeakersQuery("?cat=0&g=x&s=everyone&day=5&sort=age&slot=0:960&q=&view=all")).toEqual({});
    expect(parseSpeakersQuery("cat=-1&day=1.5&slot=7:960-1050")).toEqual({});
    expect(parseSpeakersQuery("?cat=abc&day=")).toEqual({});
    expect(parseSpeakersQuery("?slot=0%3A960-1050")).toEqual({ slot: { day: 0, start: 960, end: 1050 } }); // URLSearchParams' own spelling
    // a draft's id: only with its slot, and only a whole number
    expect(parseSpeakersQuery("?lesson=34")).toEqual({});
    expect(parseSpeakersQuery("?slot=0:960-1050&lesson=0")).toEqual({ slot: { day: 0, start: 960, end: 1050 } });
    expect(parseSpeakersQuery("?slot=0:960-1050&lesson=3x")).toEqual({ slot: { day: 0, start: 960, end: 1050 } });
  });

  it("a slot is a day, then a start before its end inside the day's clock", () => {
    expect(parseSlot("0:960-1050")).toEqual({ day: 0, start: 960, end: 1050 });
    expect(parseSlot("1:1740-1830")).toEqual({ day: 1, start: 1740, end: 1830 });
    expect(parseSlot("1:1050-960")).toBeNull();
    expect(parseSlot("1:960-960")).toBeNull();
    expect(parseSlot("1:1800-1900")).toBeNull();
    expect(parseSlot("5:960-1050")).toBeNull();
    expect(parseSlot(null)).toBeNull();
  });

  it("the lesson page's step and the speaker page's section", () => {
    expect(parsePageStep("?step=msg")).toBe("msg");
    expect(parsePageStep("step=escort&x=1")).toBe("escort");
    expect(parsePageStep("?step=review")).toBeNull();
    expect(parsePageStep("")).toBeNull();
    expect(parseSpeakerSection("#placement")).toBe("placement");
    expect(parseSpeakerSection("availability")).toBe("availability");
    expect(parseSpeakerSection("#history")).toBeNull();
    expect(parseSpeakerSection("")).toBeNull();
  });

  it("a next step or a card's stage is a step of the lesson page", () => {
    expect(pageStepOf("payment")).toBe("pay");
    expect(pageStepOf("pay")).toBe("pay");
    expect(pageStepOf("reconfirm")).toBe("msg");
    expect(pageStepOf("send")).toBe("msg");
    expect(pageStepOf("msg")).toBe("msg");
    expect(pageStepOf("reader")).toBe("sources");
    expect(pageStepOf("sources")).toBe("sources");
    expect(pageStepOf("escort")).toBe("escort");
  });
});

describe("the staff's pages' addresses (the reset, phase 3)", () => {
  it("a day: «/day» for the default one, else its number — and back", () => {
    expect(dayPath()).toBe("/day");
    expect(dayPath(null)).toBe("/day");
    expect(dayPath(0)).toBe("/day/0");
    expect(dayPath(4)).toBe("/day/4");
    for (const d of [0, 1, 2, 3, 4] as const) expect(parseDay(dayPath(d).split("/")[2])).toBe(d);
  });

  it("a day is one of the five, never guessed", () => {
    for (const v of ["5", "-1", "01", "1.0", " 1", "x", "", null, undefined]) expect(parseDay(v), String(v)).toBeNull();
  });

  it("«אחרי השבוע»: every lesson, one lesson — only what is set", () => {
    expect(afterPath()).toBe("/after");
    expect(afterPath({ all: false })).toBe("/after");
    expect(afterPath({ all: true })).toBe("/after?all=1");
    expect(afterPath({ all: true, lesson: 7 })).toBe("/after?all=1&lesson=7");
    expect(afterPath({ lesson: 7 })).toBe("/after?lesson=7");
    for (const q of [{ all: true, lesson: 7 }, { all: false, lesson: 12 }, { all: true }]) {
      expect(parseAfterQuery(afterPath(q).replace(/^\/after/, ""))).toEqual({ all: !!q.all, lesson: q.lesson ?? null });
    }
    expect(parseAfterQuery("")).toEqual({ all: false, lesson: null });
    expect(parseAfterQuery("?all=yes&lesson=0")).toEqual({ all: false, lesson: null });
    expect(parseAfterQuery("all=1&lesson=7x")).toEqual({ all: true, lesson: null });
  });
});
