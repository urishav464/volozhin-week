// «הגדרות ← ייבוא» in a real browser (demo build, the demo user is the global admin), at 390 / 820 / 1440: a table
// pasted as text/html through a synthetic paste event (never inserted — a script and an onerror in it never run),
// mapped, checked against the pool, «עמום» decided, committed; an .xlsx built here with our own writer, uploaded,
// becoming an archive edition — and «אישור באצווה» of who taught in it; the escorts' file's phrases; a file that is
// not one. Nothing of the paste stays in the browser's storage. Synthetic people and numbers only.
import { expect, type Page, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { demoWeek } from "../../src/data/demoWeek";
import { toXlsx } from "../../src/exports/xlsx";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

/** A paste into the field as a browser makes one: a ClipboardEvent carrying text/html and text/plain. */
async function paste(page: Page, html: string, text: string) {
  await page.getByLabel("הדבקת טבלה").evaluate(
    (el, [h, t]) => {
      const dt = new DataTransfer();
      dt.setData("text/html", h);
      dt.setData("text/plain", t);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    [html, text] as const,
  );
}

/** A .docx made here: a title paragraph (when given) above a table — each line of a cell its own paragraph, as Word writes it. */
function docx(rows: string[][], title: string | null): Buffer {
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const para = (x: string) => `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t xml:space="preserve">${esc(x)}</w:t></w:r></w:p>`;
  const table = `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${c.split("\n").map(para).join("")}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
  const doc = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${title ? para(title) : ""}${table}</w:body></w:document>`;
  return Buffer.from(zipSync({ "word/document.xml": strToU8(doc) }));
}
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const CANDIDATES_HTML = `<html><head><style>td{color:red}</style><script>window.__pwned = 1</script></head><body>
<google-sheets-html-origin><table>
<tr><td>מרצה</td><td>מוסד</td><td>טווח ימים</td><td>העדפה</td><td>חניך/ה</td></tr>
<tr><td>הרב בדיקה אלף<img src="x" onerror="window.__pwned = 2"></td><td>מוסד לבדיקה</td><td>א-ב</td><td></td><td>חניך/ה לבדיקה</td></tr>
<tr><td>הרבנית בדיקה בית</td><td></td><td>נסגר</td><td></td><td></td></tr>
<tr><td>מרצה-07</td><td>מוסד אחר</td><td></td><td></td><td></td></tr>
<tr><td>מרצה 07ב</td><td></td><td></td><td></td><td></td></tr>
<tr><td></td><td>שורה בלי שם</td><td></td><td></td><td></td></tr>
<tr><td>בדיקה אלפ</td><td></td><td></td><td></td><td></td></tr>
</table></google-sheets-html-origin></body></html>`;

test.describe("demo build — the import of 5786", () => {
  test("candidates: a pasted table, mapped, checked, «עמום» decided, committed — and nothing of it kept", async ({ page }) => {
    await page.goto(`${demoUrl()}/settings/import`);
    await expect(page.getByRole("tab", { name: "ייבוא" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("radio", { name: "המועמדים (רשימת המרצים מהסיעור)" }).check();
    await paste(page, CANDIDATES_HTML, "plain text that must not be read");
    await expect(page.getByText(/6 שורות ו-5 עמודות מהדבקה/)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    await expect(page.getByLabel("הדבקת טבלה")).toHaveCount(0); // the paste field gave way to the table
    await noSidewaysScroll(page);

    // the mapping: «מרצה» and «טווח ימים» recognized; «מוסד» chosen; the trainee's column left unread
    await expect(page.getByLabel("מרצה", { exact: true })).toHaveValue("name");
    await expect(page.getByLabel("טווח ימים", { exact: true })).toHaveValue("status");
    await expect(page.getByLabel("חניך/ה", { exact: true })).toHaveValue("");
    await page.getByLabel("מוסד", { exact: true }).selectOption("affiliation");
    // a header that speaks of trainees: the candidates ask which column is theirs too (סבב חמישי) — «בדיקה» waits for it
    await expect(page.getByRole("button", { name: "בדיקה מול המאגר" })).toBeDisabled();
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("4");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();

    const preview = page.getByRole("list", { name: "תצוגה מקדימה" });
    const row = (n: number) => preview.locator(`li[data-row="${n}"]`);
    await expect(row(2)).toContainText("חדש");
    await expect(row(2)).toContainText("מגדר: זכר (הצעה, מהתואר)");
    await expect(row(3)).toContainText("מגדר: נקבה (הצעה, מהתואר)");
    await expect(row(4)).toContainText("תואם");
    await expect(row(4)).toContainText("כבר במאגר: מרצה 07");
    await expect(row(4)).toContainText("אין מה להשלים — שום דבר לא נדרס."); // its affiliation is there: never overwritten
    await expect(row(5)).toContainText("עמום");
    await expect(row(6)).toContainText("מדולג");
    await expect(row(6)).toContainText("אין שם");
    // the same person spelled otherwise, in the same table: «עמום» — never a second speaker without the admin seeing it
    await expect(row(7)).toContainText("עמום");
    await expect(row(7)).toContainText("באותה טבלה יש שורה עם שם דומה");
    await expect(page.getByText("2 מרצים «עמומים» מחכים להחלטה")).toBeVisible();
    await expect(page.getByRole("button", { name: "ייבוא", exact: true })).toBeDisabled();
    await noSidewaysScroll(page);

    // «לראשונה שמחכה להחלטה»: to the first undecided row, its first choice focused
    await page.getByRole("button", { name: "לראשונה שמחכה להחלטה" }).click();
    await expect(row(5).getByRole("radio").first()).toBeFocused();
    await row(5).getByRole("radio", { name: /להשלים את .*מרצה 07/ }).check();
    await expect(row(5)).toContainText("אין מה להשלים");
    await row(7).getByRole("radio", { name: /אותו\/ה מרצה כמו שורה 2/ }).check();
    await expect(page.getByText("מרצה אחד/ת «עמום/ה» מחכה להחלטה")).toHaveCount(0);
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(toast(page, "הייבוא נשמר")).toBeVisible();
    await expect(page.getByText("נוספו 2 מרצים למאגר (ממתינים לאישור) · 3 כבר במאגר")).toBeVisible();
    await expect(page.getByRole("list", { name: "תצוגה מקדימה" })).toHaveCount(0); // the rows went with the commit
    await noSidewaysScroll(page);

    // nothing of the paste in the browser's storage
    const stored = await page.evaluate(async () => {
      const dbs = (await indexedDB.databases?.()) ?? [];
      return JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, dbs: dbs.map((d) => d.name) });
    });
    for (const piece of ["בדיקה אלף", "טווח ימים", "מוסד לבדיקה", "חניך/ה לבדיקה", "plain text that must not be read"]) expect(stored).not.toContain(piece);

    // the new speakers wait for approval — two of them, «בדיקה אלפ» being «בדיקה אלף»
    await page.getByRole("banner").getByRole("link", { name: /אישורים/ }).click();
    const pending = page.getByRole("list", { name: "ממתינים לאישור" });
    await expect(pending.getByText("הרב בדיקה אלף")).toBeVisible();
    await expect(pending.getByText("הרבנית בדיקה בית")).toBeVisible();
    await expect(pending.getByText("בדיקה אלפ", { exact: true })).toHaveCount(0);
  });

  test("the tracking sheet: an .xlsx made here, «כפולה» decided, an archive edition — «אישור באצווה» of who taught in it", async ({ page }, info) => {
    const bytes = toXlsx([
      {
        name: "מעקב",
        headers: ["מרצה", "שיעור ב", "כותרת", "מקורות (נשלח?)", "הסעה/תשלום", "טלפון", "קיבל הודעת סיכום מ", "נושא"],
        rows: [
          ["הרב ארכיון אלף", "ראשון 8:30", "שיעור ארכיון א", "כן", "300", "000-000-0003", "חניך/ה לדוגמה 1", "תנ\"ך"],
          ["ארכיון בית", "ראשון 8:30", "שיעור ארכיון ב", "כן+סרטון", "הסעה הלוך וחזור", "", "", "פילוסופיה"],
          ["ארכיון גימל", "שני 10:00 כפולה", "שיעור ארכיון ג", "להדפיס לפני", "", "", "", ""],
          ["ארכיון דלת", "שני 10:00 כפולה", "שיעור ארכיון ד", "", "", "", "", ""],
          ["ארכיון הא", "שישי 8:30", "שיעור בשישי", "", "", "", "", ""],
          ["ארכיון וו", "שלישי 00:30", "שיעור לילה בארכיון", "", "", "", "", ""],
          ["ארכיון זין", "חמישי 02:00", "שיעור בלילה של חמישי", "", "", "", "", ""],
        ],
      },
    ]);
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "גיליון המעקב של אשתקד" }).check();
    await page.locator('input[type="file"]').setInputFiles({ name: "מעקב לדוגמה.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) });
    await expect(page.getByText(/7 שורות ו-8 עמודות מקובץ Excel \(מעקב לדוגמה\.xlsx\)/)).toBeVisible();
    for (const [h, v] of [["מרצה", "speaker"], ["שיעור ב", "when"], ["כותרת", "title"], ["מקורות (נשלח?)", "sources"], ["הסעה/תשלום", "transport"], ["טלפון", "phone"], ["קיבל הודעת סיכום מ", "confirmFrom"], ["נושא", "topic"]]) {
      await expect(page.getByLabel(h, { exact: true })).toHaveValue(v);
    }
    await page.getByLabel("שם המחזור בארכיון").fill("תשפ״ו לדוגמה");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();

    // «כפולה»: one group of two rows, decided before the lessons show
    const groups = page.getByRole("list", { name: "קבוצות כפולה" });
    await expect(groups.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("קבוצת «כפולה» אחת מחכה להחלטה")).toBeVisible();
    await groups.getByRole("radio", { name: "מקבילים — כל שורה בחדר משלה" }).check();
    const lessons = page.getByRole("list", { name: "השיעורים" });
    await expect(lessons.getByRole("listitem").filter({ hasText: "שיעור ארכיון ב" })).toContainText("מקביל 2");
    await expect(lessons.getByRole("listitem").filter({ hasText: "שיעור ארכיון א" })).toContainText("קיבל הודעת סיכום מ: חניך/ה לדוגמה 1");
    await expect(lessons.getByRole("listitem").filter({ hasText: "שיעור ארכיון א" })).toContainText("תשלום 300 ₪");
    await expect(lessons.getByRole("listitem").filter({ hasText: "שיעור בשישי" })).toContainText("יום מחוץ לשבוע");
    // the night rule shown as what it is: «הצעה», the night after the day written, as the rest of the app says it
    const night = lessons.getByRole("listitem").filter({ hasText: "שיעור לילה בארכיון" });
    await expect(night).toContainText("ליל שלישי–רביעי");
    await expect(night).toContainText("הצעה: לילה אחרי היום שנכתב");
    await expect(lessons.getByRole("listitem").filter({ hasText: "שיעור בלילה של חמישי" })).toContainText("נגמר בחמישי ב-19:00");
    await expect(lessons.getByRole("listitem").filter({ hasText: "שיעור ארכיון א" })).toContainText("בית מדרש");
    await expect(page.getByRole("list", { name: "נושאים" }).getByLabel(/תנ"ך/)).not.toHaveValue("");
    await noSidewaysScroll(page);

    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    // the label kept in its key's form (ASCII quote marks, as the app writes a year)
    await expect(page.getByText(/5 שיעורים במחזור «תשפ"ו לדוגמה»/)).toBeVisible();

    // the same year typed with other quote marks is the same archive: replacing it deletes its lessons — the confirm
    // says so, and its focus is on «ביטול»: Enter, Enter never replaces it
    await page.locator('input[type="file"]').setInputFiles({ name: "מעקב לדוגמה.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) });
    await page.getByLabel("שם המחזור בארכיון").fill("תשפ”ו  לדוגמה");
    await expect(page.getByText(/מחזור בשם הזה כבר בארכיון/)).toBeVisible();
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    await page.getByRole("list", { name: "קבוצות כפולה" }).getByRole("radio", { name: "מקבילים — כל שורה בחדר משלה" }).check();
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    const replace = page.getByRole("group", { name: "אישור" });
    await expect(replace).toContainText("יימחקו ויוחלפו");
    await expect(replace.getByRole("button", { name: "ביטול" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(replace).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ייבוא", exact: true })).toBeVisible(); // nothing was replaced
    await page.getByRole("button", { name: "ניקוי — טבלה אחרת" }).click();

    // the archive is an edition now: in «מחזור»
    await page.getByRole("tab", { name: "מחזור" }).click();
    await expect(page.getByText('תשפ"ו לדוגמה').first()).toBeVisible();

    // after the week (v12, both parts): an archive is purged without a date, and the purge clears what the sheet said
    // on its lessons — the transport words of one, who sent the summary on another
    const purge = page.locator("#purge-panel");
    await purge.getByLabel("מוחקים את המידע של").selectOption({ label: 'תשפ"ו לדוגמה (בארכיון)' });
    await expect(purge.locator("[data-purge-import-notes]")).toContainText("ההערות שהייבוא הביא מגיליון המעקב");
    await purge.getByLabel(/כדי למחוק, מקלידים את שם המחזור/).fill('תשפ"ו לדוגמה');
    await purge.getByRole("button", { name: 'מחיקת המידע האישי של תשפ"ו לדוגמה' }).click();
    await expect(purge.locator("[data-purge-report]")).toContainText("ההערות מגיליון המעקב של 2 שיעורים נמחקו");
    await expect(purge.locator("[data-purged]")).toContainText("נמחק ב-");

    // the approvals queue: one confirm approves the five who taught in it — and says who still lacks a gender
    await page.getByRole("banner").getByRole("link", { name: /אישורים/ }).click();
    const batch = page.getByRole("group", { name: 'אישור באצווה: מי שלימד/ה ב-תשפ"ו לדוגמה' });
    await expect(batch).toContainText("5 מרצים שממתינים לאישור לימדו שיעור");
    if (info.project.name === "desktop") {
      // «לימד/ה אצלנו» on the sheet shows the archive
      await page.getByRole("list", { name: "ממתינים לאישור" }).getByRole("button", { name: "ארכיון בית", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "ארכיון בית" })).toContainText('תשפ"ו לדוגמה');
      await page.keyboard.press("Escape");
    }
    await batch.getByRole("button", { name: 'אישור 5 מרצים שלימדו ב-תשפ"ו לדוגמה' }).click();
    await expect(batch).toContainText("ל-4 מהם חסר מגדר");
    await batch.getByRole("button", { name: "אישור 5 מרצים" }).click();
    await expect(toast(page, "5 מרצים אושרו")).toBeVisible();
    await expect(page.getByRole("list", { name: "ממתינים לאישור" }).getByText("ארכיון בית")).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test("the escorts' file: the column asked for; a channel chosen per speaker (the phrases' «הצעה»), a note of one's own — nothing of the file sent", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "קובץ המלווים" }).check();
    await page.getByRole("button", { name: "מילוי בנתונים לדוגמה" }).click();
    await expect(page.getByLabel("מלווה", { exact: true })).toBeDisabled(); // the escorts' names: never read
    await page.getByLabel("הערות", { exact: true }).selectOption("phrases");
    // always asked, never guessed (סבב רביעי): «בדיקה» waits for the answer
    await expect(page.getByRole("button", { name: "בדיקה מול המאגר" })).toBeDisabled();
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("1");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    const preview = page.getByRole("list", { name: "תצוגה מקדימה" });
    const card = (name: string) => preview.locator(":scope > li").filter({ hasText: name });
    await expect(card("מרצה 07")).toContainText("«דרך המזכירה»");
    await expect(card("מרצה 07")).toContainText("«תשלום בהעברה בנקאית» — תשלום או הסעה");
    await expect(card("מרצה 07").getByLabel(/ערוץ הקשר/)).toHaveValue("secretary");
    await expect(card("מרצה 07").getByText("הצעה", { exact: true })).toBeVisible();
    await expect(card("מרצה 12").getByLabel(/ערוץ הקשר/)).toHaveValue("whatsapp");
    await expect(card("מרצה 20").getByLabel(/ערוץ הקשר/)).toHaveValue(""); // only transport: no suggestion
    await expect(card("מרצה 20")).toContainText("לא יישמר דבר למרצה הזה.");
    await expect(card("מרצה לא במאגר לדוגמה")).toContainText("לא במאגר");
    await expect(preview).not.toContainText("חניך/ה לדוגמה");
    await noSidewaysScroll(page);
    // the note: empty — never the file's words; a phone typed into it holds «ייבוא» back
    const note07 = card("מרצה 07").getByLabel("הערה משלך (לא חובה)");
    await expect(note07).toHaveValue("");
    await note07.fill("בבוקר 000-000-0001");
    await expect(card("מרצה 07")).toContainText("בהערה יש טלפון או מייל");
    await expect(page.getByText("בהערה של מרצה אחד/ת יש מה לתקן")).toBeVisible();
    await expect(page.getByRole("button", { name: "ייבוא", exact: true })).toBeDisabled();
    await note07.fill("בבוקר");
    await card("מרצה 12").getByLabel(/ערוץ הקשר/).selectOption("");
    await expect(page.getByText("מרצה אחד/ת יושלם/תושלם.")).toBeVisible();
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(page.getByText("מרצה אחד/ת כבר במאגר · מרצה אחד/ת הושלם/ה בפרטים שהיו חסרים · מרצה אחד/ת קיבל/ה «איך פונים»")).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("סבב שני — the escorts' .docx with a title above its table: the header row found; «מלווה» never mappable; a phrase with an escort's name said so, and never sent", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "קובץ המלווים" }).check();
    const rows = [
      ["מרצה", "מלווה", "הערות"],
      ["מרצה 07", "חניכה לבדיקה", "דרך המזכירה"],
      ["מרצה 12", "חניך לבדיקה", "המלווה חניך לבדיקה יתאם בוואטסאפ"],
    ];
    await page.locator('input[type="file"]').setInputFiles({ name: "מלווים לבדיקה.docx", mimeType: DOCX, buffer: docx(rows, "מלווים — לבדיקה") });
    // the title paragraph is row 1: the header row is found below it, and the rows above are not read
    await expect(page.getByLabel("שורת הכותרות")).toHaveValue("1");
    await expect(page.getByText(/השורות שמעליה \(שורה 1: כותרת או הסבר\) לא נקראות/)).toBeVisible();
    await expect(page.getByLabel("מלווה", { exact: true })).toBeDisabled();
    // no header row at all: the escorts' column is still found by its header among the first rows — never mappable
    await page.getByLabel("שורת הכותרות").selectOption("");
    await expect(page.getByLabel("עמודה 2", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("עמודה 1", { exact: true })).toBeEnabled();
    await page.getByLabel("שורת הכותרות").selectOption("1");
    await page.getByLabel("הערות", { exact: true }).selectOption("phrases");
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("1");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();

    const preview = page.getByRole("list", { name: "תצוגה מקדימה" });
    const m12 = preview.locator(":scope > li").filter({ hasText: "מרצה 12" });
    // a word of the name is said beside the phrase (סבב שלישי) — a warning only: no phrase is sent (סבב רביעי)
    await expect(m12).toContainText("יש כאן שם של מלווה («חניך»)");
    await expect(m12.getByLabel(/ערוץ הקשר/)).toHaveValue("whatsapp");
    await expect(preview.locator(":scope > li").filter({ hasText: "מרצה 07" }).getByLabel(/ערוץ הקשר/)).toHaveValue("secretary");
    await noSidewaysScroll(page);
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(toast(page, "הייבוא נשמר")).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("סבב שני — no header row and no escorts' header: the wizard asks which column holds the escorts, and never reads it", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough");
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "קובץ המלווים" }).check();
    await page.getByLabel("הדבקת טבלה").fill("מרצה 07\tחניכה לבדיקה\tדרך המזכירה\nמרצה 12\tחניך לבדיקה\tרק בוואטסאפ");
    await page.getByRole("button", { name: "קריאת הטקסט שהוקלד" }).click();
    await expect(page.getByLabel("שורת הכותרות")).toHaveValue("");
    const ask = page.getByLabel("באיזו עמודה שמות המלווים?");
    await expect(ask).toBeVisible();
    await page.getByLabel("עמודה 1", { exact: true }).selectOption("speaker");
    await page.getByLabel("עמודה 3", { exact: true }).selectOption("phrases");
    await expect(page.getByRole("button", { name: "בדיקה מול המאגר" })).toBeDisabled();
    await ask.selectOption("1"); // «עמודה 2: חניכה לבדיקה · חניך לבדיקה»
    await expect(page.getByLabel("עמודה 2", { exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    await expect(page.getByRole("list", { name: "תצוגה מקדימה" })).not.toContainText("לבדיקה");
  });

  test("סבב שני — an .xlsx with a title row above its headers: the header row found, the title read as no speaker", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough");
    const bytes = toXlsx([
      {
        name: "מועמדים",
        headers: ["רשימת מועמדים לבדיקה — סיעור", "", ""],
        rows: [
          ["מרצה", "טלפון", "טווח ימים"],
          ["הרב קפא בדיקתי", "000-000-0031", "א-ב"],
          ["הרבנית למדא בדיקתית", "", "נסגר"],
        ],
      },
    ]);
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "המועמדים (רשימת המרצים מהסיעור)" }).check();
    await page.locator('input[type="file"]').setInputFiles({ name: "מועמדים לבדיקה.xlsx", mimeType: XLSX, buffer: Buffer.from(bytes) });
    await expect(page.getByLabel("שורת הכותרות")).toHaveValue("1");
    await expect(page.getByLabel("מרצה", { exact: true })).toHaveValue("name");
    await expect(page.getByLabel("טווח ימים", { exact: true })).toHaveValue("status");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    const preview = page.getByRole("list", { name: "תצוגה מקדימה" });
    await expect(preview.getByRole("listitem")).toHaveCount(2);
    await expect(preview.locator('li[data-row="3"]')).toContainText("הרב קפא בדיקתי");
    await expect(preview).not.toContainText("רשימת מועמדים");
  });

  test("סבב שני — the tracking sheet: «זהות כפולה» is a title, whole; a line with an institution under a name is its affiliation; the phone after the choices", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    const td = (x: string) => `<td>${x.split("\n").map((l) => `<p class=MsoNormal>${l}</p>`).join("")}</td>`;
    const tr = (...cells: string[]) => `<tr>${cells.map(td).join("")}</tr>`;
    const html = `<table class=MsoTableGrid>${tr("מרצה", "שיעור ב", "כותרת", "טלפון", "נושא")}${tr("הרב אלפא דוגמני\n(ישיבת דוגמה)", "ראשון 8:30", "כותרת אלף", "000-000-0011", "")}${tr(
      "זטא בדיקתי\nקפא רחוקה",
      "רביעי 10:00",
      "זהות כפולה",
      "000-000-0012",
      "תנ\"ך",
    )}</table>`;
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "גיליון המעקב של אשתקד" }).check();
    await paste(page, html, "");
    await page.getByLabel("שם המחזור בארכיון").fill("ארכיון סבב שני");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();

    // «זהות כפולה»: no «כפולה» group, the title whole
    await expect(page.getByRole("list", { name: "קבוצות כפולה" })).toHaveCount(0);
    const lessons = page.getByRole("list", { name: "השיעורים" });
    await expect(lessons.locator("li").filter({ hasText: "זהות כפולה" })).toContainText("רביעי");
    await expect(page.getByRole("heading", { name: "נושא ← קטגוריה" })).toBeVisible(); // the arrow as the rest of the app writes it
    // the second lines: «(ישיבת דוגמה)» the affiliation of the name above («הצעה: שם של מוסד» — only an institution's
    // word proposes one, סבב רביעי); «קפא רחוקה» — no institution's word — waits for the admin, and «ייבוא» with it
    const lines = page.getByRole("list", { name: "שמות נוספים בתא המרצה" });
    const brackets = lines.locator('li[data-line="2:2"]');
    await expect(brackets.getByRole("radio", { name: "שיוך מוסדי של אלפא דוגמני" })).toBeChecked();
    await expect(brackets).toContainText("הצעה: שם של מוסד");
    const waiting = lines.locator('li[data-line="3:2"]');
    await expect(waiting).toContainText("צריך לבחור");
    await expect(waiting.getByRole("radio")).toHaveCount(3);
    for (const radio of await waiting.getByRole("radio").all()) await expect(radio).not.toBeChecked();
    await expect(page.getByText("שם נוסף אחד בתא של מרצה מחכה להחלטה (מרצה נוסף/ת, שיוך מוסדי או לא לייבא)")).toBeVisible();
    await expect(page.getByRole("button", { name: "ייבוא", exact: true })).toBeDisabled();
    const speakers = page.getByRole("list", { name: "המרצים בגיליון" });
    await expect(speakers.getByRole("listitem").filter({ hasText: "הרב אלפא דוגמני" })).toContainText("שיוך מוסדי: ישיבת דוגמה");
    await expect(speakers).not.toContainText("(ישיבת דוגמה)");
    await expect(lessons).not.toContainText("הטלפון לא נשמר");
    await noSidewaysScroll(page);

    // «קפא רחוקה» is a speaker: two in the row — the phone waits; «קפא רחוקה» left out: the phone goes to the one left
    await lines.locator('li[data-line="3:2"]').getByRole("radio", { name: "מרצה נוסף/ת" }).check();
    const row3 = lessons.locator("li").filter({ hasText: "זהות כפולה" });
    await expect(row3).toContainText("הטלפון לא נשמר: יש בשורה יותר ממרצה אחד/ת");
    await speakers.getByRole("listitem").filter({ hasText: "קפא רחוקה" }).getByRole("checkbox", { name: "לא לייבא" }).check();
    await expect(row3).not.toContainText("הטלפון לא נשמר");
    // the phone the choices give is shown on its speaker before «ייבוא» (סבב שלישי) — the same the payload sends
    await expect(speakers.getByRole("listitem").filter({ hasText: "זטא בדיקתי" })).toContainText("יש טלפון (משורה 3, אחרי הבחירות)");
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(page.getByText(/2 קיבלו טלפון או מייל/)).toBeVisible();

    // «איך עבר» on an imported archive with no date: the instructor writes it — said plainly, never «TBD»
    if (info.project.name === "desktop") {
      await page.getByRole("banner").getByRole("link", { name: "השבוע" }).click();
      await page.getByLabel("מחזור", { exact: true }).selectOption({ label: "ארכיון סבב שני (ארכיון)" });
      await page.locator("[data-lesson-id]").filter({ hasText: "אלפא דוגמני" }).first().click();
      const review = page.getByRole("dialog", { name: "שיעור סגור" }).getByRole("region", { name: "איך עבר", exact: true });
      const head = review.getByRole("button", { name: /^איך עבר/ });
      await expect(head).toContainText("מחזור שיובא — המדריך/ה כותב/ת");
      await expect(head).not.toContainText("TBD");
      await head.click();
      await expect(review).toContainText("מחזור שיובא: את «איך עבר» של שנים קודמות כותב/ת המדריך/ה");
    }
  });

  test("סבב שלישי — a phone or an e-mail in the speaker's cell is never an affiliation; the phone after the choices is filled, and shown first", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    const td = (x: string) => `<td>${x.split("\n").map((l) => `<p class=MsoNormal>${l}</p>`).join("")}</td>`;
    const tr = (...cells: string[]) => `<tr>${cells.map(td).join("")}</tr>`;
    const html = `<table class=MsoTableGrid>${tr("מרצה", "שיעור ב", "כותרת", "טלפון")}${[
      tr("הרב בדיקה טלפוני\n000-000-0091", "ראשון 8:30", "שורה שנייה טלפון", ""),
      tr("ד\"ר בדיקה מיילית\nsomeone@example.org", "ראשון 10:00", "שורה שנייה מייל", ""),
      tr("רחל בדיקתית\nלאה ניסויית", "שני 8:30", "שתי מרצות בלי תואר", "000-000-0093"),
      tr("הרב בדיקה מוסדי\nישיבת הר לדוגמה", "שני 10:00", "מוסד בלי סוגריים", ""),
      tr("בדיקה בסוגריים\n(טל' 000-000-0095)", "שלישי 8:30", "טלפון בסוגריים", ""),
      tr("מרצה 15 + זיטה חדשה לגמרי", "שלישי 10:00", "שניים בשורה", "000-000-0097"),
    ].join("")}</table>`;
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "גיליון המעקב של אשתקד" }).check();
    await paste(page, html, "");
    await page.getByLabel("שם המחזור בארכיון").fill("ארכיון סבב שלישי");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();

    // the contacts are no lines: only the second name (waiting), the institution («הצעה: שם של מוסד») and the name beside
    // the first («הצעה: … מרצה נוסף/ת», סבב שישי) are asked about
    const lines = page.getByRole("list", { name: "שמות נוספים בתא המרצה" });
    await expect(lines.getByRole("listitem")).toHaveCount(3);
    await expect(lines.locator('li[data-line="7:2"]')).toContainText("הצעה: שם ליד השם — מרצה נוסף/ת");
    await expect(lines).not.toContainText("000-000");
    await expect(lines).not.toContainText("example.org");
    await expect(lines.locator('li[data-line="5:2"]')).toContainText("הצעה: שם של מוסד");
    const speakers = page.getByRole("list", { name: "המרצים בגיליון" });
    await expect(speakers).not.toContainText(/שיוך מוסדי: [^·\n]*(\d{3}-|@)/);
    await expect(speakers.getByRole("listitem").filter({ hasText: "הרב בדיקה טלפוני" })).toContainText("יש טלפון");
    await expect(speakers.getByRole("listitem").filter({ hasText: "ד״ר בדיקה מיילית" })).toContainText("יש מייל");
    await expect(speakers.getByRole("listitem").filter({ hasText: "בדיקה בסוגריים" })).toContainText("יש טלפון");
    const lessons = page.getByRole("list", { name: "השיעורים" });
    await expect(lessons.locator("li").filter({ hasText: "שורה שנייה טלפון" })).toContainText("הטלפון שבתא המרצה נלקח כטלפון של השורה");
    await noSidewaysScroll(page);

    // the co-speaker: a speaker of their own; the shared row's phone goes to «מרצה 15» once «זיטה» is left out — said on the card
    await lines.locator('li[data-line="4:2"]').getByRole("radio", { name: "מרצה נוסף/ת" }).check();
    const m15 = speakers.getByRole("listitem").filter({ hasText: "מרצה 15" });
    await expect(m15).not.toContainText("אחרי הבחירות");
    await speakers.getByRole("listitem").filter({ hasText: "זיטה חדשה לגמרי" }).getByRole("checkbox", { name: "לא לייבא" }).check();
    await expect(m15).toContainText("יש טלפון (משורה 7, אחרי הבחירות)");
    await expect(m15).toContainText("יושלם (רק מה שחסר): טלפון");
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(toast(page, "הייבוא נשמר")).toBeVisible();
    // the approvals queue: the new speakers, never a number or an address beside them
    await page.getByRole("banner").getByRole("link", { name: /אישורים/ }).first().click();
    await expect(page.locator("main")).toContainText("בדיקה טלפוני");
    await expect(page.locator("main")).not.toContainText("000-000");
    await expect(page.locator("main")).not.toContainText("someone@example.org");
  });

  test("סבב שלישי — the escorts' .docx titled «מלווים»: «מרצה» mappable; an escort's first name said beside the phrase; one speaker said in the singular", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "קובץ המלווים" }).check();
    const rows = [
      ["מרצה", "מלווה", "הערות"],
      ["מרצה 07", "שירה לבדיקה", "שירה תתקשר יום לפני דרך המזכירה"],
      ["מרצה 12", "נועם בדיקה 000-000-0001", "רק בוואטסאפ, 000-000-0002"],
    ];
    await page.locator('input[type="file"]').setInputFiles({ name: "מלווים.docx", mimeType: DOCX, buffer: docx(rows, "מלווים") });
    await expect(page.getByLabel("שורת הכותרות")).toHaveValue("1");
    await expect(page.getByLabel("מרצה", { exact: true })).toBeEnabled();
    await expect(page.getByLabel("מרצה", { exact: true })).toHaveValue("speaker");
    await expect(page.getByLabel("מלווה", { exact: true })).toBeDisabled();
    await page.getByLabel("הערות", { exact: true }).selectOption("phrases");
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("1");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    const preview = page.getByRole("list", { name: "תצוגה מקדימה" });
    const m07 = preview.locator(":scope > li").filter({ hasText: "מרצה 07" });
    const m12 = preview.locator(":scope > li").filter({ hasText: "מרצה 12" });
    await expect(m07).toContainText("יש כאן שם של מלווה («שירה»)");
    await expect(m07.getByLabel(/ערוץ הקשר/)).toHaveValue("secretary");
    await expect(m12).toContainText("«רק בוואטסאפ»");
    await expect(preview).not.toContainText("000-000"); // the number is out of the phrase before it is shown
    await expect(preview).not.toContainText("נועם");
    await expect(m12).toContainText("הוסר טלפון או מייל מהניסוחים שבקובץ");
    await m12.getByLabel(/ערוץ הקשר/).selectOption("");
    await expect(page.getByText("מרצה אחד/ת יושלם/תושלם.")).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("סבב רביעי — an escorts' header spelled «ליווי» is asked about anyway; the tracking sheet's «מלוה» too: a line naming the escort proposed «לא לייבא», a skipped row's line waits for nothing", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "קובץ המלווים" }).check();
    await page.getByLabel("הדבקת טבלה").fill("מרצה\tליווי\tהערות\nמרצה 07\tשירה בדקני\tשירה תתקשר דרך המזכירה");
    await page.getByRole("button", { name: "קריאת הטקסט שהוקלד" }).click();
    await expect(page.getByLabel("שורת הכותרות")).toHaveValue("0");
    await expect(page.getByLabel("ליווי", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("באיזו עמודה שמות המלווים?")).toBeVisible();
    await page.getByLabel("הערות", { exact: true }).selectOption("phrases");
    await expect(page.getByRole("button", { name: "בדיקה מול המאגר" })).toBeDisabled();
    await page.getByRole("button", { name: "ניקוי — טבלה אחרת" }).click();

    const td = (x: string) => `<td>${x.split("\n").map((l) => `<p class=MsoNormal>${l}</p>`).join("")}</td>`;
    const tr = (...cells: string[]) => `<tr>${cells.map(td).join("")}</tr>`;
    const html = `<table class=MsoTableGrid>${tr("מרצה", "שיעור ב", "כותרת", "מלוה")}${[
      tr("מרצה 07\n(מלווה: שירה בדקני)", "ראשון 8:30", "כותרת אלף", "שירה בדקני"),
      tr("הרב חדש בדיקתי\nנועם ניסיוני", "ראשון 10:00", "כותרת בית", "נועם ניסיוני"),
      tr("דוגמה שלישית\nשם אחר לגמרי", "שישי 8:30", "כותרת גימל", ""),
    ].join("")}</table>`;
    await page.getByRole("radio", { name: "גיליון המעקב של אשתקד" }).check();
    await paste(page, html, "");
    await page.getByLabel("שם המחזור בארכיון").fill("ארכיון סבב רביעי");
    await expect(page.getByLabel("מלוה", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "בדיקה מול המאגר" })).toBeDisabled(); // asked first
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("3");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();

    const lines = page.getByRole("list", { name: "שמות נוספים בתא המרצה" });
    await expect(lines.locator('li[data-line="2:2"]').getByRole("radio", { name: "לא לייבא את השורה" })).toBeChecked();
    await expect(lines.locator('li[data-line="2:2"]')).toContainText("הצעה: שם מעמודת המלווים («שירה»)");
    await expect(lines.locator('li[data-line="3:2"]').getByRole("radio", { name: "לא לייבא את השורה" })).toBeChecked();
    await expect(lines.locator('li[data-line="4:2"]')).toContainText("השורה מדולגת — אין צורך להחליט");
    await expect(page.getByText(/בתא של מרצה מחכה להחלטה|בתאי המרצים מחכים להחלטה/)).toHaveCount(0); // the save panel waits for no line
    const speakers = page.getByRole("list", { name: "המרצים בגיליון" });
    await expect(speakers).not.toContainText("שירה");
    await expect(speakers).not.toContainText("נועם");
    await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: "השיעורים", exact: true }) })).toContainText("2 לייבוא · מדולג אחד");
    await noSidewaysScroll(page);
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(page.getByText(/2 שיעורים במחזור «ארכיון סבב רביעי»/)).toBeVisible();
  });

  test("סבב רביעי — the candidates: a second line in the name's cell is asked about, never glued to the name", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough");
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "המועמדים (רשימת המרצים מהסיעור)" }).check();
    const td = (x: string) => `<td>${x.split("\n").join("<br>")}</td>`;
    await paste(page, `<table><tr>${td("מרצה")}</tr><tr>${td("הרב זין בדיקתי\nהרבנית חית בדיקתית")}</tr><tr>${td("ד\"ר גימל בדיקתי\nאוניברסיטת בדיקה")}</tr></table>`, "");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    const lines = page.getByRole("list", { name: "שמות נוספים בתא המרצה" });
    await expect(lines.locator('li[data-line="2:2"]')).toContainText("צריך לבחור");
    await expect(lines.locator('li[data-line="3:2"]').getByRole("radio", { name: "שיוך מוסדי של גימל בדיקתי" })).toBeChecked();
    await expect(page.getByText("שם נוסף אחד בתא של מרצה מחכה להחלטה (מרצה נוסף/ת, שיוך מוסדי או לא לייבא)")).toBeVisible();
    await expect(page.getByRole("button", { name: "ייבוא", exact: true })).toBeDisabled();
    const preview = page.getByRole("list", { name: "תצוגה מקדימה" });
    await expect(preview).not.toContainText("זין בדיקתי הרבנית");
    await lines.locator('li[data-line="2:2"]').getByRole("radio", { name: "מרצה נוסף/ת" }).check();
    await expect(preview.locator('li[data-ref="2:2"]')).toContainText("הרבנית חית בדיקתית");
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(page.getByText("נוספו 3 מרצים למאגר (ממתינים לאישור)")).toBeVisible();
  });

  test("סבב חמישי — a bracket on the name's own line, a name beside it that names an escort: lines to decide; «מרצה 07 (מכון לדוגמה)» is מרצה 07", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    const td = (x: string) => `<td>${x.split("\n").map((l) => `<p class=MsoNormal>${l}</p>`).join("")}</td>`;
    const tr = (...cells: string[]) => `<tr>${cells.map(td).join("")}</tr>`;
    const html = `<table class=MsoTableGrid>${tr("מרצה", "שיעור ב", "כותרת", "מלווה")}${[
      tr("מרצה 07 (מכון לדוגמה)", "ראשון 8:30", "כותרת אלף", ""),
      tr("מרצה 12 (מלווה: שירה בדקני)", "ראשון 10:00", "כותרת בית", "שירה בדקני"),
      tr("מרצה 03 + נועם ניסיוני", "ראשון 11:30", "כותרת גימל", "נועם ניסיוני"),
      tr("הרב חדש בדיקתי (ירושלים)", "שני 8:30", "עיון בתהלים 119:1-176", ""),
    ].join("")}</table>`;
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "גיליון המעקב של אשתקד" }).check();
    await paste(page, html, "");
    await page.getByLabel("שם המחזור בארכיון").fill("ארכיון סבב חמישי");
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("3");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();

    const lines = page.getByRole("list", { name: "שמות נוספים בתא המרצה" });
    await expect(lines.locator('li[data-line="2:1.1"]').getByRole("radio", { name: "שיוך מוסדי של מרצה 07" })).toBeChecked();
    await expect(lines.locator('li[data-line="3:1.1"]').getByRole("radio", { name: "לא לייבא את הסוגריים (המרצה נשאר/ת)" })).toBeChecked();
    await expect(lines.locator('li[data-line="3:1.1"]')).toContainText("הצעה: שם מעמודת המלווים («שירה»)");
    await expect(lines.locator('li[data-line="4:2"]').getByRole("radio", { name: "לא לייבא את השם הזה" })).toBeChecked();
    await expect(lines.locator('li[data-line="5:1.1"]')).toContainText("צריך לבחור");
    await expect(page.getByRole("button", { name: "ייבוא", exact: true })).toBeDisabled();
    // the names as the pool has them: מרצה 07 is the pool's, never a second «מרצה 07 (מכון לדוגמה)»
    const speakers = page.getByRole("list", { name: "המרצים בגיליון" });
    await expect(speakers.getByRole("listitem").filter({ hasText: "מרצה 07" })).toContainText("כבר במאגר: מרצה 07");
    await expect(speakers).not.toContainText("(מכון לדוגמה)");
    await expect(speakers).not.toContainText("שירה");
    await expect(speakers).not.toContainText("נועם");
    // a verse in a title is text: whole, and no «הוסר טלפון»
    const lessons = page.getByRole("list", { name: "השיעורים" });
    await expect(lessons).toContainText("עיון בתהלים 119:1-176");
    await expect(lessons).not.toContainText("הוסר טלפון");
    await noSidewaysScroll(page);
    await lines.locator('li[data-line="5:1.1"]').getByRole("radio", { name: "לא לייבא את הסוגריים (המרצה נשאר/ת)" }).check();
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(page.getByText(/4 שיעורים במחזור «ארכיון סבב חמישי»/)).toBeVisible();
  });

  test("סבב חמישי — the escorts' file: a speaker «עמום» completed from the pool says what will be filled", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "קובץ המלווים" }).check();
    await page.getByLabel("הדבקת טבלה").fill("מרצה\tמלווה\tהערות\nמרצה 007\tשירה בדקני\tדרך המזכירה");
    await page.getByRole("button", { name: "קריאת הטקסט שהוקלד" }).click();
    await page.getByLabel("הערות", { exact: true }).selectOption("phrases");
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("1");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    const card = page.getByRole("list", { name: "תצוגה מקדימה" }).locator(":scope > li").filter({ hasText: "מרצה 007" });
    await expect(card).toContainText("עמום");
    await card.getByRole("radio", { name: /להשלים את .*מרצה 07/ }).check();
    await expect(card).toContainText("יושלם (רק מה שחסר): ערוץ קשר");
    await expect(card).not.toContainText("אין מה להשלים");
    await noSidewaysScroll(page);
  });

  test("סבב שישי — «עריכה»: a glued name corrected, matched again to the pool; a tail after « - » split by itself; a contact in an edit refused", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "המועמדים (רשימת המרצים מהסיעור)" }).check();
    const td = (x: string) => `<td>${x}</td>`;
    await paste(page, `<table><tr>${td("מרצה")}</tr><tr>${td("הרב מרצה 07-ישיבת בדיקה")}</tr><tr>${td("הרב מרצה 12 - ישיבת הר בדיקה")}</tr><tr>${td("ד\"ר מרצה 03, הרבנית חדשה בדיקתית")}</tr></table>`, "");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    const preview = page.getByRole("list", { name: "תצוגה מקדימה" });
    // a tail after « - » is a line of the name by itself — the name the pool's, the tail its affiliation («הצעה»)
    const lines = page.getByRole("list", { name: "שמות נוספים בתא המרצה" });
    await expect(lines.locator('li[data-line="3:1.1"]').getByRole("radio", { name: "שיוך מוסדי של מרצה 12" })).toBeChecked();
    await expect(preview.locator('li[data-ref="3"]')).toContainText(/כבר במאגר: (\S+ )?מרצה 12/);
    await expect(lines.locator('li[data-line="4:1.1"]')).toContainText("צריך לבחור");
    await expect(lines.locator('li[data-line="4:1.1"]').getByRole("radio", { name: "לא לייבא את החלק הזה (המרצה נשאר/ת)" })).toBeVisible();
    await expect(page.getByText(/כל שורה או סוגריים אחרים מחכים להחלטה/)).toBeVisible();
    // a bare hyphen is never a split: the glued name is «חדש» — «עריכה» corrects it
    const glued = preview.locator('li[data-ref="2"]');
    await expect(glued).toContainText("מרצה 07-ישיבת בדיקה");
    await expect(glued).toContainText("חדש");
    await glued.getByRole("button", { name: "עריכה" }).click();
    const form = glued.getByRole("group", { name: "עריכה" });
    await expect(form.getByLabel("תואר")).toHaveValue("הרב");
    await form.getByLabel("שם", { exact: true }).fill("מרצה 07 000-000-0001");
    await expect(form).toContainText("יש כאן טלפון או מייל");
    await expect(form.getByRole("button", { name: "שמירת העריכה" })).toBeDisabled();
    await form.getByLabel("שם", { exact: true }).fill("מרצה 07");
    await form.getByLabel("שיוך מוסדי").fill("ישיבת בדיקה");
    await noSidewaysScroll(page);
    await form.getByRole("button", { name: "שמירת העריכה" }).click();
    await expect(glued).toContainText("נערך ידנית");
    await expect(glued).toContainText("תואם");
    await expect(glued).toContainText("כבר במאגר: מרצה 07");
    await expect(glued).toContainText("יושלם (רק מה שחסר): תואר: הרב"); // the pool's מרצה 07 has its gender and an affiliation already
    // taken back: what was read, again
    await glued.getByRole("button", { name: "ביטול העריכה" }).click();
    await expect(glued).toContainText("חדש");
    await expect(glued).not.toContainText("נערך ידנית");
    await noSidewaysScroll(page);
  });

  test("סבב שישי — the tracking sheet: «עריכה» of a speaker card, and which names beside another are speakers", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough");
    const td = (x: string) => `<td>${x}</td>`;
    const tr = (...cells: string[]) => `<tr>${cells.map(td).join("")}</tr>`;
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "גיליון המעקב של אשתקד" }).check();
    await paste(page, `<table>${tr("מרצה", "שיעור ב", "כותרת")}${tr("מרצה 07-מכון לדוגמה", "ראשון 8:30", "כותרת אלף")}${tr("מרצה 12 / ישיבת הגולן", "ראשון 10:00", "כותרת בית")}${tr("מרצה 03 + גימל בדיקתית", "ראשון 11:30", "כותרת גימל")}</table>`, "");
    await page.getByLabel("שם המחזור בארכיון").fill("ארכיון סבב שישי");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    const lines = page.getByRole("list", { name: "שמות נוספים בתא המרצה" });
    await expect(lines.locator('li[data-line="3:2"]').getByRole("radio", { name: "שיוך מוסדי של מרצה 12" })).toBeChecked(); // never a speaker «ישיבת הגולן»
    const speakers = page.getByRole("list", { name: "המרצים בגיליון" });
    await expect(speakers).not.toContainText("ישיבת הגולן —");
    const card = (name: string) => speakers.locator(":scope > li").filter({ hasText: name });
    // the name beside «מרצה 03» is a co-speaker («הצעה»); its card's «עריכה» says what it is
    await card("גימל בדיקתית").getByRole("button", { name: "עריכה" }).click();
    // (the card goes with the choice: it is no speaker now)
    await card("גימל בדיקתית").getByRole("group", { name: "עריכה" }).getByRole("radio", { name: "לא לייבא את השם הזה" }).click();
    await expect(card("גימל בדיקתית")).toHaveCount(0);
    await expect(lines.locator('li[data-line="4:2"]').getByRole("radio", { name: "לא לייבא את השם הזה" })).toBeChecked();
    // the glued one corrected: the pool's מרצה 07, with its affiliation
    await card("מרצה 07-מכון לדוגמה").getByRole("button", { name: "עריכה" }).click();
    const form = card("מרצה 07-מכון לדוגמה").getByRole("group", { name: "עריכה" });
    await form.getByLabel("שם", { exact: true }).fill("מרצה 07");
    await form.getByLabel("שיוך מוסדי").fill("מכון לדוגמה");
    await form.getByRole("button", { name: "שמירת העריכה" }).click();
    await expect(card("מרצה 07")).toContainText("נערך ידנית");
    await expect(card("מרצה 07")).toContainText("כבר במאגר: מרצה 07");
    await expect(card("מרצה 07")).toContainText("שיוך מוסדי: מכון לדוגמה");
    await expect(page.getByRole("list", { name: "השיעורים" }).locator("li").filter({ hasText: "כותרת אלף" })).toContainText("מרצה 07");
    await noSidewaysScroll(page);
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(page.getByText(/3 שיעורים במחזור «ארכיון סבב שישי»/)).toBeVisible();
  });

  test("סבב שישי — the escorts' file: «הרב מרצה 05 (ישיבת בדיקה)» is the pool's מרצה 05; «רק בוואטסאפ, לא להתקשר בשבת» proposes WhatsApp", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "one width is enough");
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "קובץ המלווים" }).check();
    await page.getByLabel("הדבקת טבלה").fill("מרצה\tמלווה\tהערות\nהרב מרצה 05 (ישיבת בדיקה)\tשירה בדקני\tרק בוואטסאפ, לא להתקשר בשבת\nמרצה 12 - מלווה: שירה\t\tדרך המזכירה");
    await page.getByRole("button", { name: "קריאת הטקסט שהוקלד" }).click();
    await page.getByLabel("הערות", { exact: true }).selectOption("phrases");
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("1");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    const card = (name: string) => page.getByRole("list", { name: "תצוגה מקדימה" }).locator(":scope > li").filter({ hasText: name });
    await expect(card("מרצה 05")).toContainText("תואם");
    await expect(card("מרצה 05")).not.toContainText("ישיבת בדיקה");
    await expect(card("מרצה 05").getByLabel("ערוץ הקשר")).toHaveValue("whatsapp");
    await expect(card("מרצה 12")).toContainText("תואם");
    await expect(card("מרצה 12").getByLabel("ערוץ הקשר")).toHaveValue("secretary");
    await noSidewaysScroll(page);
  });

  test("a file that is not an Office file is refused in Hebrew; nothing is read", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "one width is enough");
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "המועמדים (רשימת המרצים מהסיעור)" }).check();
    await page.locator('input[type="file"]').setInputFiles({ name: "לא באמת.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("not a zip at all") });
    await expect(page.getByRole("alert")).toContainText("לא הצלחנו לקרוא את הקובץ");
    await expect(page.getByLabel("הדבקת טבלה")).toBeVisible();
    // the upload's focus ring: the 1px input is clipped, so the label that looks like the button draws it
    await page.getByLabel("הדבקת טבלה").focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).type)).toBe("file");
    const ring = await page.locator("label", { hasText: "העלאת קובץ xlsx או docx" }).evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(ring).toBe("solid");
    await noSidewaysScroll(page);
  });
});

test.describe("mock build — on the wire", () => {
  test("the pool's names (never a contact), one import_lookup, one import_commit with the reviewed rows only — the member's own token", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.kind = "real";
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "admin@example.org", display_name: "מדריך/ה לדוגמה", global_admin: true, memberships: [{ edition_id: null, role: "admin", member_id: 1 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.tables.set("speakers", week.speakers);
    sb.tables.set("categories", week.categories);
    sb.answers.set("import_lookup", { phones: [], contacts: [] });
    sb.answers.set("import_commit", { created: 1, merged: 0, filled: 0, contacts: 1, notes: 1, lessons: 0, replaced: 0, edition_id: null, speakers: [{ row: 2, speaker_id: 99, created: true }] });
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;

    await page.goto(`${mockUrl()}/settings/import`);
    await page.getByRole("radio", { name: "המועמדים (רשימת המרצים מהסיעור)" }).check();
    const html = "<table><tr><td>מרצה</td><td>טלפון</td><td>חניך/ה</td><td>טווח ימים</td></tr><tr><td>הרב מרצה בדיקת חיבור</td><td>000-000-0004</td><td>חניך/ה שלא נקרא/ת</td><td>נסגר</td></tr></table>";
    await paste(page, html, "");
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("2"); // a trainees' header: asked (סבב חמישי)
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    await expect(page.getByRole("list", { name: "תצוגה מקדימה" }).getByRole("listitem")).toHaveCount(1);
    expect(sb.rpc.get("import_lookup")).toEqual([{ p_speakers: [], p_phone_keys: ["0000000004"] }]);
    const pool = sb.calls.filter((c) => c.path === "/rest/v1/speakers");
    expect(pool).toHaveLength(1);
    expect(pool[0].query.get("select")).not.toMatch(/phone|email|secretary|notes/);
    expect(sb.calls.some((c) => c.path.includes("speaker_contacts"))).toBe(false);

    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(page.getByText("נוסף/ה מרצה אחד/ת למאגר (ממתין/ה לאישור)")).toBeVisible();
    const sent = sb.rpc.get("import_commit")!;
    expect(sent).toEqual([
      {
        p_kind: "candidates",
        p_payload: {
          source: "brainstorm-5786", titles_from: 7,
          rows: [{ row: 2, action: "new", speaker_id: null, title: "הרב", name: "מרצה בדיקת חיבור", gender: "m", affiliation: null, topics: [], phone: "0000000004", email: null, notes: "טווח ימים: נסגר" }],
        },
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain("חניך/ה שלא נקרא/ת"); // an unmapped column never travels
    for (const fn of ["import_lookup", "import_commit"]) {
      expect(sb.calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`).every((c) => c.auth === `Bearer ${session.access_token}`)).toBe(true);
    }
  });

  test("סבב שישי — «עריכה» on the wire: the edited name matched to the pool, its affiliation and title in import_commit; one more import_lookup for the speaker it now is", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.kind = "real";
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "admin@example.org", display_name: "מדריך/ה לדוגמה", global_admin: true, memberships: [{ edition_id: null, role: "admin", member_id: 1 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.tables.set("speakers", week.speakers);
    sb.answers.set("import_lookup", { phones: [], contacts: [] });
    sb.answers.set("import_commit", { created: 0, merged: 1, filled: 1, contacts: 0, notes: 0, lessons: 0, replaced: 0, edition_id: null, speakers: [{ row: 2, speaker_id: 7, created: false }] });
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;
    const target = week.speakers.find((x) => x.name === "מרצה 07")!;

    await page.goto(`${mockUrl()}/settings/import`);
    await page.getByRole("radio", { name: "המועמדים (רשימת המרצים מהסיעור)" }).check();
    await paste(page, "<table><tr><td>מרצה</td></tr><tr><td>הרב מרצה 07-ישיבת בדיקה</td></tr></table>", "");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    const card = page.getByRole("list", { name: "תצוגה מקדימה" }).locator('li[data-ref="2"]');
    await expect(card).toContainText("חדש");
    expect(sb.rpc.get("import_lookup")).toHaveLength(1);
    await card.getByRole("button", { name: "עריכה" }).click();
    const form = card.getByRole("group", { name: "עריכה" });
    await form.getByLabel("שם", { exact: true }).fill("מרצה 07");
    await form.getByLabel("שיוך מוסדי").fill("ישיבת בדיקה");
    await form.getByRole("button", { name: "שמירת העריכה" }).click();
    await expect(card).toContainText("כבר במאגר: מרצה 07");
    // what the match would fill is asked about the speaker it now is (its contacts' booleans, never their values)
    await expect.poll(() => sb.rpc.get("import_lookup")?.length).toBe(2);
    expect(sb.rpc.get("import_lookup")![1]).toEqual({ p_speakers: [target.id], p_phone_keys: [] });
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(toast(page, "הייבוא נשמר")).toBeVisible();
    expect(sb.rpc.get("import_commit")).toEqual([
      {
        p_kind: "candidates",
        p_payload: {
          source: "brainstorm-5786", titles_from: 7,
          rows: [{ row: 2, action: "merge", speaker_id: target.id, title: "הרב", name: "מרצה 07", gender: "m", affiliation: "ישיבת בדיקה", topics: [], phone: null, email: null, notes: null }],
        },
      },
    ]);
  });

  test("סבב רביעי — the escorts' file on the wire: import_commit carries only {row, speaker_id, channel, note} — not one word of the file", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.kind = "real";
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "admin@example.org", display_name: "מדריך/ה לדוגמה", global_admin: true, memberships: [{ edition_id: null, role: "admin", member_id: 1 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.tables.set("speakers", week.speakers);
    sb.answers.set("import_lookup", { phones: [], contacts: [] });
    sb.answers.set("import_commit", { created: 0, merged: 2, filled: 2, contacts: 1, notes: 0, lessons: 0, replaced: 0, edition_id: null, speakers: [] });
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;

    await page.goto(`${mockUrl()}/settings/import`);
    await page.getByRole("radio", { name: "קובץ המלווים" }).check();
    const rows = [
      ["מרצה", "ליווי", "הערות"],
      ["מרצה 07", "שירה בדקני (ונועם ניסיוני)", "שירה תתקשר יום לפני דרך המזכירה"],
      ["מרצה 12", "אורי ניסיון (אוריק)", "וכשאוריק מתאם — רק בוואטסאפ, 000-000-0002"],
    ];
    await page.locator('input[type="file"]').setInputFiles({ name: "מלווים.docx", mimeType: DOCX, buffer: docx(rows, null) });
    await page.getByLabel("הערות", { exact: true }).selectOption("phrases");
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("1");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    const preview = page.getByRole("list", { name: "תצוגה מקדימה" });
    await preview.locator(":scope > li").filter({ hasText: "מרצה 07" }).getByLabel("הערה משלך (לא חובה)").fill("רק בבוקר");
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(toast(page, "הייבוא נשמר")).toBeVisible();
    const sent = sb.rpc.get("import_commit")!;
    const ids = Object.fromEntries(week.speakers.filter((x) => ["מרצה 07", "מרצה 12"].includes(x.name)).map((x) => [x.name, x.id]));
    expect(sent).toEqual([
      {
        p_kind: "escorts",
        p_payload: {
          rows: [
            { row: 2, speaker_id: ids["מרצה 07"], channel: "secretary", note: "רק בבוקר" },
            { row: 3, speaker_id: ids["מרצה 12"], channel: "whatsapp", note: null },
          ],
        },
      },
    ]);
    expect(JSON.stringify(sent).replace("רק בבוקר", "")).not.toMatch(/[א-ת]/);
  });
});
