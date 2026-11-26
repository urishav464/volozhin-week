import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, plainText, timeRuns } from "./markdown";

describe("markdown-lite", () => {
  it("reads paragraphs, line breaks, bullet and numbered lists, headings and bold", () => {
    const blocks = parseMarkdown("# כותרת\n\nפסקה **מודגשת** אחת\nשורה שנייה\n\n- פריט א\n* פריט **ב**\n\n1. ראשון\n2) שני\n\n## משנה");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, line: [{ text: "כותרת", bold: false }] },
      {
        kind: "paragraph",
        lines: [
          [{ text: "פסקה ", bold: false }, { text: "מודגשת", bold: true }, { text: " אחת", bold: false }],
          [{ text: "שורה שנייה", bold: false }],
        ],
      },
      { kind: "bullets", items: [[{ text: "פריט א", bold: false }], [{ text: "פריט ", bold: false }, { text: "ב", bold: true }]] },
      { kind: "numbers", items: [[{ text: "ראשון", bold: false }], [{ text: "שני", bold: false }]] },
      { kind: "heading", level: 2, line: [{ text: "משנה", bold: false }] },
    ]);
  });

  it("keeps HTML, links and scripts as plain text — nothing becomes markup", () => {
    const evil = '<script>alert(1)</script> <img src=x onerror="alert(2)"> [קישור](javascript:alert(3)) <b>x</b>';
    const blocks = parseMarkdown(evil);
    expect(blocks).toEqual([{ kind: "paragraph", lines: [[{ text: evil, bold: false }]] }]);
    expect(parseInline("**<i>x</i>**")).toEqual([{ text: "<i>x</i>", bold: true }]);
  });

  it("leaves an unclosed ** as typed, and a list item's next line inside the item", () => {
    expect(parseInline("a **b")).toEqual([{ text: "a **b", bold: false }]);
    expect(parseMarkdown("- פריט\n  המשך\nעוד")).toEqual([
      { kind: "bullets", items: [[{ text: "פריט", bold: false }, { text: " ", bold: false }, { text: "המשך", bold: false }, { text: " ", bold: false }, { text: "עוד", bold: false }]] },
    ]);
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown(null)).toEqual([]);
    expect(plainText(parseMarkdown("# א\n\nב **ג**"))).toBe("א\n\nב ג");
  });

  it("cuts a time range out of Hebrew text, to be drawn left to right (17:00 before 19:00)", () => {
    expect(timeRuns("למשל «רק בשעות…» 17:00–19:00), ועוד")).toEqual([
      { text: "למשל «רק בשעות…» ", range: false },
      { text: "17:00–19:00", range: true },
      { text: "), ועוד", range: false },
    ]);
    expect(timeRuns("בוקר 06:30–14:30, אחר צהריים 14:30 – 22:30")).toEqual([
      { text: "בוקר ", range: false },
      { text: "06:30–14:30", range: true },
      { text: ", אחר צהריים ", range: false },
      { text: "14:30 – 22:30", range: true },
    ]);
    // a lone time, a verse, a date: text
    expect(timeRuns("בשעה 17:00, בראשית 1:1-3, 20.10")).toEqual([{ text: "בשעה 17:00, בראשית 1:1-3, 20.10", range: false }]);
    expect(timeRuns("")).toEqual([{ text: "", range: false }]);
    // every range the guide writes is one
    const guide = readFileSync(new URL("../../docs/GUIDE.he.md", import.meta.url), "utf8");
    expect(guide.match(/\d{1,2}:\d{2}\s?[–-]\s?\d{1,2}:\d{2}/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("reads the user guide (docs/GUIDE.he.md): a title, sections, and nothing it cannot draw", () => {
    const guide = readFileSync(new URL("../../docs/GUIDE.he.md", import.meta.url), "utf8");
    const blocks = parseMarkdown(guide);
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    expect(blocks.filter((b) => b.kind === "heading" && b.level === 2).length).toBeGreaterThanOrEqual(6);
    // no markup the renderer would show raw
    expect(guide).not.toMatch(/\]\(|<[a-z]/i);
  });

  it("«עזרה» says who sees a transport's details as the database decides it (v18, app.may_see_transport)", () => {
    const guide = readFileSync(new URL("../../docs/GUIDE.he.md", import.meta.url), "utf8");
    const line = guide.split("\n").find((l) => l.includes("פרטי ההסעה (כתובת איסוף"));
    expect(line).toBeDefined();
    // the edition's admins on every lesson, logistics from the request on — not «only after the approval»
    expect(line).toContain("למי שמנהל/ת את המחזור");
    expect(line).toContain("ולצוות הלוגיסטי מרגע שהתבקשה הסעה");
    expect(line).not.toContain("ולצוות הלוגיסטי אחרי האישור");
  });

  it("«עזרה» after the reset's phase 3: one approval by the staff or logistics, the transport board's driver, no «המרצים שלי»", () => {
    const guide = readFileSync(new URL("../../docs/GUIDE.he.md", import.meta.url), "utf8");
    const pay = guide.split("\n").find((l) => l.startsWith("- **תשלום והסעה:**"));
    expect(pay).toContain("צוות המחזור או הצוות הלוגיסטי");
    expect(pay).toContain("אישור אחד מספיק");
    expect(pay).not.toContain("המדריך/ה מאשר/ת");
    // the header as each persona sees it (since phase 5 in each persona's own intro), and the pages that replaced the
    // old sheet and «המרצים שלי»
    const header = intro(guide, "לצוות המחזור").find((l) => l.startsWith("- **בראש המסך:**"));
    expect(header).toContain("השבוע · ימים · מרצים · אישורים · לוגיסטיקה");
    expect(guide).not.toContain("המרצים שלי");
    for (const h of ["## ימים", "## מרצים", "## אישורים", "## עמוד המרצה", "## אחרי השבוע"]) expect(guide).toContain(`\n${h}\n`);
    // the driver is the board's, and «סודר» is what the escort's page shows
    expect(guide).toContain("כשמסמנים «סודר», דף המלווה מציג את השם והטלפון של הנהג/ת.");
  });

  it("«עזרה» says what «מרצים ← שלי» and the transport board show, as the screens do", () => {
    const guide = readFileSync(new URL("../../docs/GUIDE.he.md", import.meta.url), "utf8");
    // «שלי» is poolSection's: a speaker with a closed lesson is under «נסגרו»; a row says where the call stands (statusLabel)
    const mine = guide.split("\n").find((l) => l.startsWith("- **«מרצים»**") && l.includes("«שלי»"));
    expect(mine).toContain("שעוד לא נסגר להם שיעור");
    expect(mine).toContain("«נסגרו»");
    expect(mine).toContain("איפה השיחה עומדת");
    expect(mine).not.toContain("הצעד הבא");
    // the board's axis is drawn from 768px (a tablet), and its return is the teaching's end (app.teach_end)
    // (phase 4 renamed the tab «הסעות וצוות»)
    const board = guide.split("\n").find((l) => l.startsWith("- **הסעות וצוות — לוח ההסעות:**"));
    expect(board).toContain("בטאבלט ובמחשב — ציר זמן");
    expect(board).toContain("בסוף זמן הלימוד");
  });

  it("«עזרה» after the reset's phase 4: the logistics home, the cohorts' flags, Saturday night's two lists, the reader, the books' «הצעה»", () => {
    const guide = readFileSync(new URL("../../docs/GUIDE.he.md", import.meta.url), "utf8");
    const lines = guide.split("\n");
    const line = (start: string) => lines.find((l) => l.startsWith(start)) ?? "";
    // the header as logistics sees it (nav.ts navFor): «בית» first, the week to read — in their intro since phase 5
    const header = intro(guide, "לצוות הלוגיסטי").find((l) => l.startsWith("- **בראש המסך:**"));
    expect(header).toContain("בית · אישורים · השבוע · תוצרים · מצגות · זמני זיכרון · מכריכה לכריכה · ידע · עזרה.");
    // the strip (LogisticsScreen.tsx LOGISTICS_TABS) and the home's three groups (tasks.ts GROUP_TITLE), always all there
    expect(line("- **«לוגיסטיקה»**")).toContain("בית · הסעות וצוות · תשלומים · ספרים · הדפסות · תורנויות");
    const home = line("- **«בית» — מה נשאר לעשות:**");
    for (const g of ["**בהתחלה:**", "**כשהתוכן מוכן:**", "**קרוב לשבוע:**", "תמיד שלושתן", "«תאריך השבוע עוד לא נקבע»"]) expect(home).toContain(g);
    // the four chips (TASK_STATE_LABEL), and the two «לא ידוע» lines (NOT_LOADED, NOT_HERE)
    const states = line("- **כל משימה**");
    for (const w of ["«הושלם»", "«לטיפול»", "«עוד לא התחיל»", "«לא ידוע»", "«לא נטען»", "«לא זמין במחזור הזה»"]) expect(states).toContain(w);
    // the cohorts' flags (Setup.tsx) — v20: «עוזרת» is the duties it helps in (rota_cohort_duties), «יכול להסיע» stays —
    // and the board's cohorts that can drive (TransportBoard.tsx)
    const helps = line("- **באילו תורנויות מכינה עוזרת:**");
    expect(helps).toContain("«לא עוזרת בתורנויות»");
    expect(helps).toContain("נספרת רק בכמויות האוכל");
    expect(line("- **«הצוות שלה יכול להסיע»:**")).toContain("בלוח ההסעות");
    expect(line("- **הסעות וצוות — לוח ההסעות:**")).toContain("«מכינות שהצוות שלהן יכול להסיע»");
    // Saturday night: two lists, «נקנה», the quantity after a tab (PrepTasks.tsx); both carry over with the quantities
    const prep = line('- **מוצ"ש–ראשון: שתי רשימות.**');
    for (const w of ["**«משימות»:**", "**«רשימת קניות»:**", "«נקנה»", "«הדבקת רשימת קניות»", "אחרי טאב"]) expect(prep).toContain(w);
    expect(line("- **לשנה הבאה**")).toContain("עם הכמויות");
    // the reader is every member's; logistics builds it and marks «נשלח לדפוס» (ReaderScreen.tsx, sent.ts)
    expect(line("- **«מקראה»** נמצאת ב«תוצרים»")).toContain("לכל הצוות");
    expect(line("- **הצוות הלוגיסטי** בונה ומוריד את המקראה")).toContain("בלי השער, הכותרות הרצות, ההעלאה וההסרה");
    const sent = line("- **«נשלח לדפוס»:**");
    for (const w of ["«סימון שנשלחה לדפוס»", "«שליחה מחדש»", "«ביטול הסימון»", "«נוספו N קבצים אחרי השליחה — אולי צריך לשלוח שוב»"]) expect(sent).toContain(w);
    // the books' suggestion fills the field only (BookOrder.tsx): no line says any more that nothing is suggested
    expect(guide).not.toContain("והמערכת לא ממלאת מספר");
    for (const l of [line("- **ספרים:** כמה עותקים להזמין"), line("- **ספרים:** שורה לכל ספר")]) {
      expect(l).toContain("«הצעה: N»");
      expect(l).toContain("«שמירה»");
    }
  });

  it("«עזרה» after the reset's phase 5: each persona's header in its intro (nav.ts navFor and splitNav), «עוד», the panel's summary, the two new sections", () => {
    const guide = readFileSync(new URL("../../docs/GUIDE.he.md", import.meta.url), "utf8");
    const head = (who: string) => intro(guide, who).find((l) => l.startsWith("- **בראש המסך:**")) ?? "";
    // the whole header from 1024px, and the row below it — «עוד» for the staff and logistics, none for a trainee
    expect(head("לצוות המחזור")).toContain("השבוע · ימים · מרצים · אישורים · לוגיסטיקה · תוצרים · מצגות · זמני זיכרון · מכריכה לכריכה · ידע · הגדרות · עזרה.");
    expect(head("לצוות המחזור")).toContain("בשורה רק «השבוע · ימים · מרצים · אישורים», וכל השאר מאחורי «עוד»");
    expect(head("לצוות הלוגיסטי")).toContain("בשורה רק «בית · אישורים · השבוע · תוצרים», וכל השאר מאחורי «עוד»");
    expect(head("לחניכים")).toContain("«היום שלי» · «מרצים» · «השבוע» · «עזרה»");
    expect(head("לחניכים")).not.toContain("«עוד»");
    // the old one-line list of every persona's header is gone from «כניסה»
    expect(guide).not.toContain("- בראש המסך יש את האזורים, וכל אחד/ת");
    // ≤ 8 bullets in each new intro
    for (const who of ["לצוות המחזור", "לצוות הלוגיסטי"]) expect(intro(guide, who).filter((l) => l.startsWith("- ")).length).toBeLessThanOrEqual(8);
    // the grid's panel is a summary: its stages are the lesson page's — nowhere a stage or «איך עבר» «בלוח»
    const grid = intro(guide, "הרשת").join("\n");
    expect(grid).toContain("**בשיעור סגור הלוח הוא סיכום:**");
    expect(grid).not.toContain("הסגירה ושלבי השיעור");
    expect(guide).not.toContain("וגם בלוח השיעור ברשת");
    expect(guide).not.toContain("אותו טופס גם בלוח של כל שיעור סגור ברשת");
    expect(guide).not.toContain("כששומרים את פרטי ההסעה בלוח השיעור");
    // «מצגות»: the zip for the hall (v20: the week's), its two text files, what came since; «אתר האורחים»: who fills what
    const decks = intro(guide, "מצגות").join("\n");
    for (const w of ["«הורדת כל המצגות של השבוע»", "בדיסק-און-קי", "«סדר-היום.txt»", "«links.txt»", "«עלו מאז ההורדה»", "«מצגת צפויה — עוד לא הועלתה»", "כל שתי דקות"]) expect(decks).toContain(w);
    const guests = intro(guide, "אתר האורחים").join("\n");
    for (const w of ["«עוד פרטים»", "«מאושר/ת להופיע»", "«תיאור לאורחים»", "«תיאור קצר לשיעור (רשות)»", "«תוצרים ← אתר האורחים»", "בלי תיאורים ובלי תמונות", "ביטול מוריד אותם מהאתר מיד"]) expect(guests).toContain(w);
  });
});

describe("«עזרה» in v20", () => {
  it("says what the cohorts, the staff's schedule, the driver's suggestions, the week's zip and the escort's line do, as the screens do", () => {
    const guide = readFileSync(new URL("../../docs/GUIDE.he.md", import.meta.url), "utf8");
    const rota = intro(guide, "תורנויות").join("\n");
    // the cohort's numbers and the guard's rule (rota_diets_exceed), the split («הצעה»), the duties' order (DUTY_ORDER_HINT)
    for (const w of ["**«חניכים»**", "**«צמחוני/טבעוני»**", "**«ללא גלוטן»**", "**«מהם גם וגם»**", "**«חלוקה לקבוצות»:**", "«חלוקה מחדש»", "מסומנת «הצעה»", "הסדר כאן הוא הסדר בלוח ובדפים. כשאין מספיק קבוצות, התורנות שלמעלה מתמלאת קודם.", "«כל המכינות העוזרות עוזרות בה»", "**איש/אשת קשר מהצוות (משבץ/ת):**"]) expect(rota).toContain(w);
    // the free-typed diets and the shift's lead are gone (rota_cohorts.diets, rota_staff_shifts.kind dropped)
    expect(guide).not.toContain("התוויות כפי שכותבים אותן");
    expect(guide).not.toContain("משמרת בלי אחראי/ת");
    expect(guide).not.toContain("ומי האחראי/ת");
    expect(rota).toContain("אין «אחראי/ת משמרת»");
    // the staff's schedule (StaffShifts.tsx): day × the grid's rows, «+», the transports on the logistics side only
    for (const w of ["**משמרות צוות — לו\"ז:**", "**«+»**", "«להאריך עד סוף שורה»", "«מחוץ לשורות הלו״ז»", "**ההסעות בלו\"ז הצוות:**"]) expect(rota).toContain(w);
    const logistics = intro(guide, "לוגיסטיקה").join("\n");
    for (const w of ["«במשמרת בשעת האיסוף»", "«אחריות של מכינה»", "«צוות מכינת X — איש/אשת קשר: Y»", "**הדפסה וקבצים — «הסעות וצוות»:**"]) expect(logistics).toContain(w);
    // the week's zip (weekZipPlan) and the escort's line (escortPresentationLine)
    const decks = intro(guide, "מצגות").join("\n");
    for (const w of ["«0-השבוע»", "«1-ראשון» עד «5-חמישי»", "«שיעור זז מאז ההורדה — מורידים שוב»"]) expect(decks).toContain(w);
    expect(guide).not.toContain("«הורדת כל המצגות של היום»");
    const links = intro(guide, "קישורים בלי חשבון").join("\n");
    expect(links).toContain("המלווה גם פותח/ת את המצגת באולם");
    expect(links).toContain("שם הקובץ עצמו והקישור לא מופיעים בדף");
  });
});

/** A `##` section's lines, its heading excluded (empty when the guide has no such heading). */
function intro(guide: string, heading: string): string[] {
  const lines = guide.split("\n");
  const at = lines.indexOf(`## ${heading}`);
  if (at < 0) return [];
  const end = lines.findIndex((l, i) => i > at && /^##\s/.test(l));
  return lines.slice(at + 1, end < 0 ? undefined : end);
}

