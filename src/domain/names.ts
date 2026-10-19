import type { Gender, Speaker } from "./types";

/** "ד״ר פלונית אלמונית" — the title is stored apart from the name. */
export function displayName(s: Pick<Speaker, "title" | "name">): string {
  return s.title ? `${s.title} ${s.name}` : s.name;
}

/** Pick the gendered form; unknown gender gets the slashed form («סירב/ה»). */
export function byGender(g: Gender | null | undefined, m: string, f: string, both = `${m}/${f.slice(m.length) || f}`): string {
  if (g === "m") return m;
  if (g === "f") return f;
  return both;
}
