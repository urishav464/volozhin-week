// The Hebrew year as an edition label («תשפ"ז»): the year number from Intl's
// Hebrew calendar, written in letters. Intl gives the number only (5787) — no
// browser formats Hebrew numerals — so the letters are ours. Straight quotes,
// like the labels typed in the SQL Editor ('תשפ"ז').

const UNITS = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
const HUNDREDS = ["", "ק", "ר", "ש"];

/** 5787 → תשפ"ז, 5715 → תשט"ו, 5800 → ת"ת, 5400 → ת'. The thousands are dropped, as on every poster. */
export function hebrewNumeral(year: number): string {
  let n = year % 1000;
  let letters = "";
  while (n >= 400) {
    letters += "ת";
    n -= 400;
  }
  letters += HUNDREDS[Math.floor(n / 100)];
  n %= 100;
  // 15 and 16 are never written as parts of the Name.
  if (n === 15) letters += "טו";
  else if (n === 16) letters += "טז";
  else letters += TENS[Math.floor(n / 10)] + UNITS[n % 10];
  if (letters.length === 0) return "";
  if (letters.length === 1) return `${letters}'`;
  return `${letters.slice(0, -1)}"${letters.slice(-1)}`;
}

/** The Hebrew year a date falls in (Israel time), e.g. 5787 for 19.10.2026. null if the browser cannot tell. */
export function hebrewYear(d: Date): number | null {
  try {
    const part = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", { year: "numeric", timeZone: "Asia/Jerusalem" })
      .formatToParts(d)
      .find((p) => p.type === "year");
    const n = Number(part?.value.replace(/\D/g, ""));
    return Number.isFinite(n) && n > 5000 ? n : null;
  } catch {
    return null;
  }
}

/** A suggested label for a new edition: this Hebrew year («תשפ"ז»), or "" when unknown. Always editable. */
export function hebrewYearLabel(d: Date = new Date()): string {
  const y = hebrewYear(d);
  return y == null ? "" : hebrewNumeral(y);
}
