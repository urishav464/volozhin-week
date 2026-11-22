// «עזרה» per role (the reset, phase 5): ONE guide, docs/GUIDE.he.md, filtered by its `##` headings — each heading is
// tagged with the personas it is for (GUIDE_SECTIONS), and every member reads their own: the title, their own intro
// first («לחניכים», «לצוות המחזור», «לצוות הלוגיסטי»), then their sections in the file's order. «כל המדריך»
// (`/help?all=1`) is the file whole. A `###` stays inside the `##` above it. A heading the map does not name is a
// test failure (guide.test.ts), never a section that silently disappears — a new or renamed section is tagged on purpose.
import type { Persona } from "../data/gate";

const EVERYONE: readonly Persona[] = ["staff", "trainee", "logistics"];

/** Each persona's own intro — the first section they read. */
export const GUIDE_INTRO: Record<Persona, string> = {
  trainee: "לחניכים",
  staff: "לצוות המחזור",
  logistics: "לצוות הלוגיסטי",
};

/** Every `##` heading of the guide, and whom it is for (the staff read every section but the other two intros). */
export const GUIDE_SECTIONS: Record<string, readonly Persona[]> = {
  [GUIDE_INTRO.trainee]: ["trainee"],
  [GUIDE_INTRO.staff]: ["staff"],
  [GUIDE_INTRO.logistics]: ["logistics"],
  "כניסה": EVERYONE,
  "הרשת": ["staff"],
  "ימים": ["staff"],
  "מרצים": ["staff", "trainee"],
  "אישורים": ["staff", "logistics"],
  "עמוד המרצה": ["staff", "trainee"],
  "שלבי השיעור": EVERYONE,
  "הודעת הסיכום": ["staff", "trainee"],
  "תוצרים": ["staff", "logistics"],
  "מקורות ומקראה": EVERYONE,
  "מצגות": EVERYONE,
  "קישורים בלי חשבון": ["staff", "logistics"],
  "אתר האורחים": ["staff", "trainee"],
  "מכריכה לכריכה": ["staff", "logistics"],
  "זמני זיכרון": ["staff", "logistics"],
  "לוגיסטיקה": ["staff", "logistics"],
  "תורנויות": ["staff", "logistics"],
  "ידע ואבני דרך": ["staff", "logistics"],
  "ייבוא": ["staff"],
  "אחרי השבוע": ["staff", "trainee"],
  "בלי אינטרנט": EVERYONE,
  "כשמשהו לא עובד": EVERYONE,
};

/** A `##` section: its heading's text and its lines, the heading line included. */
export interface GuideSection {
  heading: string;
  text: string;
}

/** The guide cut at its `##` lines: what comes before the first (the `#` title and its paragraph), and each section. */
export function guideSections(source: string): { head: string; sections: GuideSection[] } {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const head: string[] = [];
  const sections: { heading: string; lines: string[] }[] = [];
  for (const line of lines) {
    const h2 = /^##\s+(.*?)\s*$/.exec(line);
    if (h2 && !line.startsWith("###")) sections.push({ heading: h2[1], lines: [line] });
    else if (sections.length) sections[sections.length - 1].lines.push(line);
    else head.push(line);
  }
  return { head: head.join("\n").trim(), sections: sections.map((s) => ({ heading: s.heading, text: s.lines.join("\n").trim() })) };
}

/**
 * What `persona` reads: the title, their intro, then the sections tagged for them in the file's order. `all` (or no
 * persona — nobody signed in has no role), the whole file. A heading the map does not name is left out here — and
 * fails guide.test.ts.
 */
export function guidePartsFor(source: string, persona: Persona | null, all: boolean): { head: string; sections: GuideSection[] } {
  const parts = guideSections(source);
  if (all || persona == null) return parts;
  const intro = GUIDE_INTRO[persona];
  const mine = parts.sections.filter((s) => s.heading !== intro && (GUIDE_SECTIONS[s.heading] ?? []).includes(persona));
  const first = parts.sections.filter((s) => s.heading === intro);
  return { head: parts.head, sections: [...first, ...mine] };
}

/** The same, as one markdown-lite string. */
export function guideFor(source: string, persona: Persona | null, all: boolean): string {
  if (all || persona == null) return source;
  const { head, sections } = guidePartsFor(source, persona, false);
  return [head, ...sections.map((s) => s.text)].filter(Boolean).join("\n\n") + "\n";
}

/** `?all=1` asks for the whole guide. */
export function wantsWholeGuide(search: string): boolean {
  return new URLSearchParams(search).get("all") === "1";
}
