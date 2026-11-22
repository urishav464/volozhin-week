// «עזרה» per role (the reset, phase 5): one guide, filtered by its `##` headings — every heading tagged on purpose.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Persona } from "../data/gate";
import { GUIDE_INTRO, GUIDE_SECTIONS, guideFor, guidePartsFor, guideSections, wantsWholeGuide } from "./guide";
import { parseMarkdown } from "./markdown";

const guide = readFileSync(new URL("../../docs/GUIDE.he.md", import.meta.url), "utf8");
const h2s = (src: string) => src.split("\n").filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, "").trim());
const PERSONAS: Persona[] = ["staff", "trainee", "logistics"];
const headings = (p: Persona) => guidePartsFor(guide, p, false).sections.map((s) => s.heading);

describe("the guide's sections and whom each is for", () => {
  it("every `##` heading of docs/GUIDE.he.md is in the map, and the map names no heading the file lacks", () => {
    const inFile = h2s(guide);
    expect(inFile.filter((h) => !(h in GUIDE_SECTIONS))).toEqual([]);
    expect(Object.keys(GUIDE_SECTIONS).filter((h) => !inFile.includes(h))).toEqual([]);
    // once each: a heading is a section's key
    expect(new Set(inFile).size).toBe(inFile.length);
    // every section is for someone, and the staff read every one but the other two intros
    for (const [h, who] of Object.entries(GUIDE_SECTIONS)) {
      expect(who.length, h).toBeGreaterThan(0);
      if (h !== GUIDE_INTRO.trainee && h !== GUIDE_INTRO.logistics) expect(who, h).toContain("staff");
    }
  });

  it("each persona's intro is its own and comes first, then its sections in the file's order", () => {
    const order = h2s(guide);
    for (const p of PERSONAS) {
      const hs = headings(p);
      expect(hs[0]).toBe(GUIDE_INTRO[p]);
      // no one else's intro
      for (const q of PERSONAS) if (q !== p) expect(hs).not.toContain(GUIDE_INTRO[q]);
      const rest = hs.slice(1);
      expect(rest).toEqual([...rest].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
      expect(rest).toEqual(order.filter((h) => h !== GUIDE_INTRO[p] && GUIDE_SECTIONS[h].includes(p)));
    }
    expect(GUIDE_INTRO).toEqual({ trainee: "לחניכים", staff: "לצוות המחזור", logistics: "לצוות הלוגיסטי" });
  });

  it("a trainee reads their own: no import, no «פרטים למתקדמים», no grid, no duty roster, no logistics", () => {
    const text = guideFor(guide, "trainee", false);
    for (const h of ["ייבוא", "הרשת", "תורנויות", "לוגיסטיקה", "ימים", "אישורים"]) expect(headings("trainee")).not.toContain(h);
    expect(text).not.toContain("### פרטים למתקדמים");
    for (const h of ["כניסה", "מרצים", "עמוד המרצה", "שלבי השיעור", "הודעת הסיכום", "מקורות ומקראה", "מצגות", "אתר האורחים", "אחרי השבוע", "בלי אינטרנט", "כשמשהו לא עובד"]) {
      expect(headings("trainee")).toContain(h);
    }
    // the time range the trainee's intro writes stays (the e2e reads it left to right)
    expect(text).toContain("17:00–19:00");
  });

  it("logistics open on «לצוות הלוגיסטי» and read their screens; the staff read everything; every one the three shared", () => {
    expect(headings("logistics")).toEqual([
      "לצוות הלוגיסטי", "כניסה", "אישורים", "שלבי השיעור", "תוצרים", "מקורות ומקראה", "מצגות", "קישורים בלי חשבון",
      "מכריכה לכריכה", "זמני זיכרון", "לוגיסטיקה", "תורנויות", "ידע ואבני דרך", "בלי אינטרנט", "כשמשהו לא עובד",
    ]);
    expect(headings("staff")).toEqual(["לצוות המחזור", ...h2s(guide).filter((h) => !Object.values(GUIDE_INTRO).includes(h))]);
    for (const p of PERSONAS) for (const h of ["כניסה", "שלבי השיעור", "מקורות ומקראה", "מצגות", "בלי אינטרנט", "כשמשהו לא עובד"]) expect(headings(p)).toContain(h);
  });

  it("a `###` stays inside its `##`; the title and its paragraph lead every view", () => {
    const { head, sections } = guideSections(guide);
    expect(head.startsWith("# מדריך קצר לצוות")).toBe(true);
    expect(sections.find((s) => s.heading === "ייבוא")?.text).toContain("### פרטים למתקדמים");
    expect(sections.some((s) => s.heading === "פרטים למתקדמים")).toBe(false);
    for (const p of PERSONAS) expect(guideFor(guide, p, false).startsWith(head)).toBe(true);
    // the sections together are the file, nothing lost on the way
    expect([head, ...sections.map((s) => s.text)].join("\n\n").replace(/\s+/g, "")).toBe(guide.replace(/\s+/g, ""));
  });

  it("«כל המדריך» (`?all=1`), or no persona, is the file whole; a filtered view still parses as the guide does", () => {
    for (const p of PERSONAS) expect(guideFor(guide, p, true)).toBe(guide);
    expect(guideFor(guide, null, false)).toBe(guide);
    expect(guidePartsFor(guide, null, false).sections.map((s) => s.heading)).toEqual(h2s(guide));
    expect(wantsWholeGuide("?all=1")).toBe(true);
    expect(wantsWholeGuide("?as=trainee&all=1")).toBe(true);
    expect(wantsWholeGuide("")).toBe(false);
    expect(wantsWholeGuide("?all=0")).toBe(false);
    for (const p of PERSONAS) {
      const blocks = parseMarkdown(guideFor(guide, p, false));
      expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
      expect(blocks.filter((b) => b.kind === "heading" && b.level === 2).length).toBe(headings(p).length);
    }
  });

  it("a heading the map does not name is never shown filtered (and fails the first test)", () => {
    const extra = `${guide.trimEnd()}\n\n## פרק חדש\n\n- שורה.\n`;
    for (const p of PERSONAS) expect(guideFor(extra, p, false)).not.toContain("פרק חדש");
    expect(guideFor(extra, "staff", true)).toContain("## פרק חדש");
  });

  it("a pointer «(בפרק «X»)» names a section the same reader has — a filtered guide never sends anyone to a chapter it left out", () => {
    for (const p of PERSONAS) {
      const mine = new Set(headings(p));
      for (const s of guidePartsFor(guide, p, false).sections) {
        for (const m of s.text.matchAll(/בפרק «([^»]+)»/g)) expect(mine.has(m[1]), `${p}: «${s.heading}» → «${m[1]}»`).toBe(true);
      }
    }
  });

  it("«מצגות בלי שיעור» is the instructor's fold: «מצגות» (read by every role) says so, and where the others' own are", () => {
    const decks = guidePartsFor(guide, "trainee", false).sections.find((s) => s.heading === "מצגות")!.text;
    const line = decks.split("\n").find((l) => l.includes("«מצגות בלי שיעור»"))!;
    expect(line).toContain("המדריך/ה רואה ומסיר/ה");
    expect(line).toContain("בעמוד השיעור");
  });
});
