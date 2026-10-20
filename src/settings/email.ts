// A team member's Google address as public.members stores it: trimmed and
// lower-case (the table's CHECK insists), so app.my_email() can compare it
// without a case-folding operator. Accepts what people paste: "Name <a@b.c>",
// "mailto:a@b.c", stray spaces and invisible direction marks.
export function normalizeEmail(input: string): string | null {
  let s = input.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "").trim();
  const angle = s.match(/<([^<>]+)>/);
  if (angle) s = angle[1].trim();
  s = s.replace(/^mailto:/i, "").toLowerCase();
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/.test(s) ? s : null;
}
