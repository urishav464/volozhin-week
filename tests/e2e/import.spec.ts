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

  test("the escorts' file: phrases about the channel ticked («הצעה»), payment and transport dropped, the escorts' names never read", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "קובץ המלווים" }).check();
    await page.getByRole("button", { name: "מילוי בנתונים לדוגמה" }).click();
    await expect(page.getByLabel("מלווה", { exact: true })).toBeDisabled(); // the escorts' names: never read
    await page.getByLabel("הערות", { exact: true }).selectOption("phrases");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    const phrases = page.getByRole("list", { name: "ניסוחים" });
    await expect(phrases.getByRole("checkbox", { name: /דרך המזכירה/ })).toBeChecked();
    await expect(phrases.getByRole("checkbox", { name: /רק בוואטסאפ/ })).toBeChecked();
    await expect(page.getByRole("list", { name: "ניסוחים שלא נשמרים" })).toContainText("תשלום בהעברה בנקאית");
    await expect(page.getByRole("list", { name: "ניסוחים שלא נשמרים" })).toContainText("הסעה מהתחנה");
    const preview = page.getByRole("list", { name: "תצוגה מקדימה" });
    await expect(preview.getByRole("listitem").filter({ hasText: "מרצה לא במאגר לדוגמה" })).toContainText("לא במאגר");
    await expect(preview).not.toContainText("חניך/ה לדוגמה");
    await phrases.getByRole("checkbox", { name: /רק בוואטסאפ/ }).uncheck();
    await expect(preview.getByRole("listitem").filter({ hasText: "מרצה 12" })).toContainText("אין ניסוח מסומן על ערוץ הקשר");
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(page.getByText("מרצה אחד/ת כבר במאגר · מרצה אחד/ת הושלם/ה בפרטים שהיו חסרים · מרצה אחד/ת קיבל/ה «איך פונים»")).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("סבב שני — the escorts' .docx with a title above its table: the header row found; «מלווה» never mappable; a phrase with an escort's name edited, then kept", async ({ page }, info) => {
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
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();

    const phrases = page.getByRole("list", { name: "ניסוחים" });
    await expect(phrases.getByRole("checkbox", { name: /דרך המזכירה/ })).toBeChecked();
    const named = phrases.getByRole("checkbox", { name: /המלווה חניך לבדיקה יתאם בוואטסאפ/ });
    await expect(named).not.toBeChecked(); // never ticked by itself
    await expect(named).toBeDisabled(); // nor at all, while the name is in it
    await expect(phrases).toContainText("יש כאן שם של מלווה («חניך לבדיקה»)");
    await noSidewaysScroll(page);
    // edited: the channel kept, the name gone
    await phrases.getByLabel("הנוסח שיישמר במקום «המלווה חניך לבדיקה יתאם בוואטסאפ»").fill("לתאם בוואטסאפ");
    await expect(named).toBeEnabled();
    await named.check();
    const preview = page.getByRole("list", { name: "תצוגה מקדימה" });
    const m12 = preview.getByRole("listitem").filter({ hasText: "מרצה 12" });
    await expect(m12).toContainText("ערוץ: WhatsApp");
    await expect(m12).toContainText("«לתאם בוואטסאפ»");
    await expect(preview).not.toContainText("לבדיקה");
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
    await expect(page.getByRole("list", { name: "ניסוחים" })).not.toContainText("לבדיקה");
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

  test("סבב שני — the tracking sheet: «זהות כפולה» is a title, whole; a line in brackets under a name is its affiliation; the phone after the choices", async ({ page }, info) => {
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
    // the second lines: «(ישיבת דוגמה)» the affiliation of the name above («הצעה: בסוגריים»); «קפא רחוקה» too, until turned
    const lines = page.getByRole("list", { name: "שורות נוספות בתא המרצה" });
    const brackets = lines.locator('li[data-line="2:2"]');
    await expect(brackets.getByRole("radio", { name: "שיוך מוסדי של אלפא דוגמני" })).toBeChecked();
    await expect(brackets).toContainText("הצעה: בסוגריים");
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
});
