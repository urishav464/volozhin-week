// «הגדרות ← ייבוא» in a real browser (demo build, the demo user is the global admin), at 390 / 820 / 1440: a table
// pasted as text/html through a synthetic paste event (never inserted — a script and an onerror in it never run),
// its columns said in one line («שינוי העמודות» folded), checked against the pool by itself, «צריך להחליט» decided,
// committed; an .xlsx built here with our own writer, uploaded, becoming an archive edition — and «אישור באצווה» of who
// taught in it; the escorts' file's phrases, its question asked outside the fold; a file that is not one. Nothing of the
// paste stays in the browser's storage. Synthetic people and numbers only.
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

const KIND = { candidates: "רשימת מועמדים (מהסיעור)", tracking: "גיליון המעקב", escorts: "קובץ המלווים" } as const;
/** «מה מייבאים?»: the candidates are the main choice; last year's two files wait in the fold «קבצים של אשתקד». */
async function chooseKind(page: Page, kind: keyof typeof KIND) {
  if (kind !== "candidates") await unfold(page, "קבצים של אשתקד");
  await page.getByRole("radio", { name: KIND[kind] }).check();
}
/** A fold (<details>) by its summary's text, opened unless it is open already. */
async function unfold(page: Page, title: string | RegExp) {
  const summary = page.locator("summary").filter({ hasText: title }).first();
  await expect(summary).toBeVisible();
  if (!(await summary.evaluate((el) => (el.parentElement as HTMLDetailsElement).open))) await summary.click();
}
const SPEAKERS = /^(כל|שאר) המרצים/;
/** «מה ייכנס» — the panel the check's answer opens. */
const review = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "מה ייכנס", exact: true }) });
const summaryOf = (page: Page, where: "review" | "commit") => page.locator(`[data-summary="${where}"]`);
/** «שמירה» — the commit panel: its «לראשונה שמחכה להחלטה» (another is beside «צריך להחליט» when one waits outside it). */
const savePanel = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "שמירה", exact: true }) });
const toFirst = (page: Page) => savePanel(page).getByRole("button", { name: "לראשונה שמחכה להחלטה" });
/** Every card of one kind, wherever it is («צריך להחליט» or a fold), as one text — for what none of them may say. */
const textOf = async (page: Page, selector: string) => (await page.locator(selector).allTextContents()).join("\n");

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
  test("candidates: a pasted table, its columns said in one line, checked by itself, «צריך להחליט» decided, committed — and nothing of it kept", async ({ page }) => {
    await page.goto(`${demoUrl()}/settings/import`);
    await expect(page.getByRole("tab", { name: "ייבוא" })).toHaveAttribute("aria-selected", "true");
    // the candidates are the main choice; last year's two files are folded under it
    await expect(page.getByRole("radio", { name: KIND.tracking })).toHaveCount(0);
    await chooseKind(page, "candidates");
    await paste(page, CANDIDATES_HTML, "plain text that must not be read");
    await expect(page.getByText(/6 שורות ו-5 עמודות מהדבקה/)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    await expect(page.getByLabel("הדבקת טבלה")).toHaveCount(0); // the paste field gave way to the table
    await noSidewaysScroll(page);

    // the mapping: «מרצה» and «טווח ימים» recognized — said in one line, «שינוי העמודות» folded; «מוסד» chosen there;
    // the trainee's column left unread
    await expect(page.locator("[data-columns]")).toHaveText("זיהינו: שם המרצה ← «מרצה» · מצב ← «טווח ימים»");
    await unfold(page, "שינוי העמודות");
    await expect(page.getByLabel("מרצה", { exact: true })).toHaveValue("name");
    await expect(page.getByLabel("טווח ימים", { exact: true })).toHaveValue("status");
    await expect(page.getByLabel("חניך/ה", { exact: true })).toHaveValue("");
    await page.getByLabel("מוסד", { exact: true }).selectOption("affiliation");
    await expect(page.locator("[data-columns]")).toContainText("מוסד ← «מוסד»");
    // a header that speaks of trainees: the candidates ask which column is theirs too (סבב חמישי) — the check waits for it
    await expect(page.getByText("צריך לומר באיזו עמודה שמות המלווים (או שאין).")).toBeVisible();
    await expect(review(page)).toHaveCount(0);
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("4");

    // checked by itself: «מה ייכנס» — one sentence, what waits, and the rest folded
    const row = (n: number) => page.locator(`li[data-row="${n}"]`);
    // row 4 is the pool's מרצה 07 with nothing to fill: «כבר במאגר» (the result's words), never «יושלם»
    await expect(summaryOf(page, "review")).toHaveText("2 מרצים חדשים · מרצה אחד/ת כבר במאגר · 2 מחכים להחלטה");
    await expect(page.getByRole("status").filter({ hasText: "נבדק מול המאגר." })).toBeVisible();
    const decide = page.getByRole("list", { name: "צריך להחליט" });
    await expect(page.getByRole("heading", { name: "צריך להחליט (2)" })).toBeVisible();
    await expect(decide.locator(":scope > li")).toHaveCount(2); // only the two «עמום»
    await expect(decide.locator('li[data-row="5"]')).toBeVisible();
    await expect(decide.locator('li[data-row="7"]')).toBeVisible();
    await expect(row(2)).toBeHidden(); // the rest folded
    await unfold(page, SPEAKERS);
    await expect(page.getByRole("list", { name: "המרצים" }).locator(":scope > li")).toHaveCount(4);
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

    // «לראשונה שמחכה להחלטה»: to the first undecided row, its first choice focused — past the row's open «עריכה» form
    await row(5).getByRole("button", { name: /^עריכה — / }).click();
    await toFirst(page).click();
    await expect(row(5).getByRole("group", { name: /^מי זה\/זו\?/ }).getByRole("radio").first()).toBeFocused();
    await row(5).getByRole("group", { name: "עריכה" }).getByRole("button", { name: "ביטול", exact: true }).click();
    await row(5).getByRole("radio", { name: /להשלים את .*מרצה 07/ }).check();
    await expect(row(5)).toContainText("אין מה להשלים");
    await row(7).getByRole("radio", { name: /אותו\/ה מרצה כמו שורה 2/ }).check();
    await expect(page.getByText("מרצה אחד/ת «עמום/ה» מחכה להחלטה")).toHaveCount(0);
    // decided, they stay where they were — showing the choice — and nothing waits
    await expect(decide.locator(":scope > li")).toHaveCount(2);
    await expect(row(5).getByRole("radio", { name: /להשלים את .*מרצה 07/ })).toBeChecked();
    await expect(page.getByRole("heading", { name: "צריך להחליט (0)" })).toBeVisible();
    // row 5 merged into מרצה 07 fills nothing either: the sentence promises no completion — as the result then says
    await expect(summaryOf(page, "commit")).toHaveText("2 מרצים חדשים · מרצה אחד/ת כבר במאגר");
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(toast(page, "הייבוא נשמר")).toBeVisible();
    await expect(page.getByText("נוספו 2 מרצים למאגר (ממתינים לאישור) · 3 כבר במאגר")).toBeVisible();
    await expect(page.getByText(/הושלם\/ה בפרטים|הושלמו בפרטים/)).toHaveCount(0);
    await expect(page.locator("li[data-row]")).toHaveCount(0); // the rows went with the commit
    await expect(review(page)).toHaveCount(0);
    await noSidewaysScroll(page);

    // nothing of the paste in the browser's storage
    const stored = await page.evaluate(async () => {
      const dbs = (await indexedDB.databases?.()) ?? [];
      return JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, dbs: dbs.map((d) => d.name) });
    });
    for (const piece of ["בדיקה אלף", "טווח ימים", "מוסד לבדיקה", "חניך/ה לבדיקה", "plain text that must not be read"]) expect(stored).not.toContain(piece);

    // the new speakers wait for approval — two of them, «בדיקה אלפ» being «בדיקה אלף»
    await page.getByRole("banner").getByRole("link", { name: /אישורים/ }).click();
    await page.locator("summary", { hasText: "עוד ממתינים לאישור" }).click(); // v14: not agreed yet — folded
    const pending = page.getByRole("group", { name: "עוד ממתינים לאישור" });
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
    await chooseKind(page, "tracking");
    await page.locator('input[type="file"]').setInputFiles({ name: "מעקב לדוגמה.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) });
    await expect(page.getByText(/7 שורות ו-8 עמודות מקובץ Excel \(מעקב לדוגמה\.xlsx\)/)).toBeVisible();
    await expect(page.locator("[data-columns]")).toHaveText(
      "זיהינו: מרצה ← «מרצה» · יום ושעה ← «שיעור ב» · כותרת ← «כותרת» · מקורות ← «מקורות (נשלח?)» · הסעה/תשלום ← «הסעה/תשלום» · טלפון ← «טלפון» · קיבל הודעת סיכום מ ← «קיבל הודעת סיכום מ» · נושא ← «נושא»",
    );
    await unfold(page, "שינוי העמודות");
    for (const [h, v] of [["מרצה", "speaker"], ["שיעור ב", "when"], ["כותרת", "title"], ["מקורות (נשלח?)", "sources"], ["הסעה/תשלום", "transport"], ["טלפון", "phone"], ["קיבל הודעת סיכום מ", "confirmFrom"], ["נושא", "topic"]]) {
      await expect(page.getByLabel(h, { exact: true })).toHaveValue(v);
    }
    await page.getByLabel("שם המחזור בארכיון").fill("תשפ״ו לדוגמה");

    // «כפולה»: one group of two rows, in «צריך להחליט» — decided before the lessons show
    const decide = page.getByRole("list", { name: "צריך להחליט" });
    const groups = decide.locator("li[data-group]");
    await expect(groups).toHaveCount(1);
    await expect(page.getByText("קבוצת «כפולה» אחת מחכה להחלטה")).toBeVisible();
    await expect(summaryOf(page, "review")).toContainText("1 מחכה להחלטה");
    await groups.getByRole("radio", { name: "מקבילים — כל שורה בחדר משלה" }).check();
    await expect(summaryOf(page, "review")).toHaveText(/^5 שיעורים · /);
    await expect(summaryOf(page, "review")).not.toContainText("מחכה להחלטה");
    await unfold(page, "כל השיעורים");
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
    await unfold(page, "נושא ← קטגוריה");
    await expect(page.getByRole("list", { name: "נושאים" }).getByLabel(/תנ"ך/)).not.toHaveValue("");
    // a sources column is mapped: its values are shown (folded)
    await unfold(page, /^מקורות \(/);
    await expect(page.getByRole("list", { name: "ערכי המקורות" }).getByRole("listitem")).not.toHaveCount(0);
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
    await decide.locator("li[data-group]").getByRole("radio", { name: "מקבילים — כל שורה בחדר משלה" }).check();
    await expect(summaryOf(page, "commit")).toContainText("במקום השיעורים שכבר שם");
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
    // v14: who has not agreed yet waits under «עוד ממתינים לאישור», the archive's batch with them
    await page.locator("summary", { hasText: "עוד ממתינים לאישור" }).click();
    const rest = page.getByRole("group", { name: "עוד ממתינים לאישור" });
    const batch = page.getByRole("group", { name: 'אישור באצווה: מי שלימד/ה ב-תשפ"ו לדוגמה' });
    await expect(batch).toContainText("5 מרצים שממתינים לאישור לימדו שיעור");
    if (info.project.name === "desktop") {
      // «לימד/ה אצלנו» on the sheet shows the archive
      await rest.getByRole("button", { name: "ארכיון בית", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "ארכיון בית" })).toContainText('תשפ"ו לדוגמה');
      await page.keyboard.press("Escape");
    }
    await batch.getByRole("button", { name: 'אישור 5 מרצים שלימדו ב-תשפ"ו לדוגמה' }).click();
    await expect(batch).toContainText("ל-4 מהם חסר מגדר");
    await batch.getByRole("button", { name: "אישור 5 מרצים" }).click();
    await expect(toast(page, "5 מרצים אושרו")).toBeVisible();
    await expect(rest.getByText("ארכיון בית")).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test("the escorts' file: the column asked for; a channel chosen per speaker (the phrases' «הצעה»), a note of one's own — nothing of the file sent", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    await page.goto(`${demoUrl()}/settings/import`);
    await chooseKind(page, "escorts");
    await page.getByRole("button", { name: "מילוי בנתונים לדוגמה" }).click();
    // «הערות» is the phrases' by itself; the escorts' names: never read
    await expect(page.locator("[data-columns]")).toHaveText("זיהינו: מרצה ← «מרצה» · ניסוחים ← «הערות»");
    await unfold(page, "שינוי העמודות");
    await expect(page.getByLabel("מלווה", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("הערות", { exact: true })).toHaveValue("phrases");
    // always asked, never guessed (סבב רביעי): the check waits for the answer
    await expect(review(page)).toHaveCount(0);
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("1");
    const preview = review(page);
    await expect(preview).toContainText("שום ניסוח מהקובץ");
    const card = (name: string) => page.locator("li[data-escort]").filter({ hasText: name });
    await unfold(page, SPEAKERS);
    await expect(card("מרצה 07")).toContainText("«דרך המזכירה»");
    await expect(card("מרצה 07")).toContainText("«תשלום בהעברה בנקאית» — תשלום או הסעה");
    await expect(card("מרצה 07").getByLabel(/ערוץ הקשר/)).toHaveValue("secretary");
    await expect(card("מרצה 07").getByText("הצעה", { exact: true })).toBeVisible();
    await expect(summaryOf(page, "review")).toHaveText("2 מרצים יושלמו");
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
    // it began to wait after the check, where the admin is typing: left there — but counted, and said so
    await expect(page.getByRole("heading", { name: "צריך להחליט (1)" })).toBeVisible();
    await expect(preview).toContainText("עוד החלטה אחת מחכה, מחוץ לרשימה הזו.");
    await expect(preview).not.toContainText("אין מה להחליט.");
    // «לראשונה שמחכה להחלטה»: the note to fix, not the channel before it — its fold opened when it was closed
    const speakersFold = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: SPEAKERS }) });
    await speakersFold.locator("summary").click();
    await expect(speakersFold).not.toHaveAttribute("open");
    await toFirst(page).click();
    await expect(note07).toBeFocused();
    await expect(speakersFold).toHaveAttribute("open");
    await note07.fill("בבוקר");
    await card("מרצה 12").getByLabel(/ערוץ הקשר/).selectOption("");
    await expect(summaryOf(page, "commit")).toHaveText("מרצה אחד/ת יושלם/תושלם");
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(page.getByText("מרצה אחד/ת כבר במאגר · מרצה אחד/ת הושלם/ה בפרטים שהיו חסרים · מרצה אחד/ת קיבל/ה «איך פונים»")).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("סבב שני — the escorts' .docx with a title above its table: the header row found; «מלווה» never mappable; a phrase with an escort's name said so, and never sent", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    await page.goto(`${demoUrl()}/settings/import`);
    await chooseKind(page, "escorts");
    const rows = [
      ["מרצה", "מלווה", "הערות"],
      ["מרצה 07", "חניכה לבדיקה", "דרך המזכירה"],
      ["מרצה 12", "חניך לבדיקה", "המלווה חניך לבדיקה יתאם בוואטסאפ"],
    ];
    await page.locator('input[type="file"]').setInputFiles({ name: "מלווים לבדיקה.docx", mimeType: DOCX, buffer: docx(rows, "מלווים — לבדיקה") });
    // the title paragraph is row 1: the header row is found below it, and the rows above are not read
    await unfold(page, "שינוי העמודות");
    await expect(page.getByLabel("שורת הכותרות")).toHaveValue("1");
    await expect(page.getByText(/השורות שמעליה \(שורה 1: כותרת או הסבר\) לא נקראות/)).toBeVisible();
    await expect(page.getByLabel("מלווה", { exact: true })).toBeDisabled();
    // no header row at all: the escorts' column is still found by its header among the first rows — never mappable
    await page.getByLabel("שורת הכותרות").selectOption("");
    await expect(page.getByLabel("עמודה 2", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("עמודה 1", { exact: true })).toBeEnabled();
    await page.getByLabel("שורת הכותרות").selectOption("1");
    await expect(page.getByLabel("הערות", { exact: true })).toHaveValue("phrases"); // by itself again
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("1");

    await unfold(page, SPEAKERS);
    const m12 = page.locator("li[data-escort]").filter({ hasText: "מרצה 12" });
    // a word of the name is said beside the phrase (סבב שלישי) — a warning only: no phrase is sent (סבב רביעי)
    await expect(m12).toContainText("יש כאן שם של מלווה («חניך»)");
    await expect(m12.getByLabel(/ערוץ הקשר/)).toHaveValue("whatsapp");
    await expect(page.locator("li[data-escort]").filter({ hasText: "מרצה 07" }).getByLabel(/ערוץ הקשר/)).toHaveValue("secretary");
    await noSidewaysScroll(page);
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(toast(page, "הייבוא נשמר")).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("סבב שני — no header row and no escorts' header: the wizard asks which column holds the escorts, and never reads it", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough");
    await page.goto(`${demoUrl()}/settings/import`);
    await chooseKind(page, "escorts");
    await page.getByLabel("הדבקת טבלה").fill("מרצה 07\tחניכה לבדיקה\tדרך המזכירה\nמרצה 12\tחניך לבדיקה\tרק בוואטסאפ");
    await page.getByRole("button", { name: "קריאת הטקסט שהוקלד" }).click();
    // nothing found: «שינוי העמודות» is open by itself, and the line says what is missing
    await expect(page.getByLabel("שורת הכותרות")).toBeVisible();
    await expect(page.getByLabel("שורת הכותרות")).toHaveValue("");
    await expect(page.locator("[data-columns]")).toContainText("צריך לבחור את העמודה של «מרצה»");
    await expect(page.locator("[data-columns]")).toContainText("צריך לבחור את העמודה של «ניסוחים»");
    const ask = page.getByLabel("באיזו עמודה שמות המלווים?");
    await expect(ask).toBeVisible();
    await page.getByLabel("עמודה 1", { exact: true }).selectOption("speaker");
    await page.getByLabel("עמודה 3", { exact: true }).selectOption("phrases");
    await expect(page.locator("[data-columns]")).toHaveText("זיהינו: מרצה ← «עמודה 1» · ניסוחים ← «עמודה 3»");
    await expect(review(page)).toHaveCount(0);
    await ask.selectOption("1"); // «עמודה 2: חניכה לבדיקה · חניך לבדיקה»
    await expect(page.getByLabel("עמודה 2", { exact: true })).toBeDisabled();
    await expect(review(page)).toBeVisible();
    await expect(review(page)).not.toContainText("לבדיקה");
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
    await chooseKind(page, "candidates");
    await page.locator('input[type="file"]').setInputFiles({ name: "מועמדים לבדיקה.xlsx", mimeType: XLSX, buffer: Buffer.from(bytes) });
    await expect(page.locator("[data-columns]")).toHaveText("זיהינו: שם המרצה ← «מרצה» · טלפון ← «טלפון» · מצב ← «טווח ימים»");
    await unfold(page, "שינוי העמודות");
    await expect(page.getByLabel("שורת הכותרות")).toHaveValue("1");
    await expect(page.getByLabel("מרצה", { exact: true })).toHaveValue("name");
    await expect(page.getByLabel("טווח ימים", { exact: true })).toHaveValue("status");
    await expect(page.locator("li[data-row]")).toHaveCount(2);
    await expect(page.locator('li[data-row="3"]')).toContainText("הרב קפא בדיקתי");
    await expect(review(page)).not.toContainText("רשימת מועמדים");
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
    await chooseKind(page, "tracking");
    await paste(page, html, "");
    await page.getByLabel("שם המחזור בארכיון").fill("ארכיון סבב שני");

    // «זהות כפולה»: no «כפולה» group, the title whole
    await expect(review(page)).toBeVisible();
    await expect(page.locator("li[data-group]")).toHaveCount(0);
    await unfold(page, "כל השיעורים");
    const lessons = page.getByRole("list", { name: "השיעורים" });
    await expect(lessons.locator("li").filter({ hasText: "זהות כפולה" })).toContainText("רביעי");
    await expect(page.locator("summary").filter({ hasText: "נושא ← קטגוריה" })).toBeVisible(); // the arrow as the rest of the app writes it
    // no sources column: no «מקורות» fold (every lesson's would be the empty cell's)
    await expect(page.locator("summary").filter({ hasText: /^מקורות/ })).toHaveCount(0);
    // the second lines: «(ישיבת דוגמה)» the affiliation of the name above («הצעה: שם של מוסד» — only an institution's
    // word proposes one, סבב רביעי) — folded; «קפא רחוקה» — no institution's word — waits for the admin in «צריך
    // להחליט», and «ייבוא» with it
    await unfold(page, "שמות נוספים בתאים");
    const brackets = page.locator('li[data-line="2:2"]');
    await expect(brackets.getByRole("radio", { name: "שיוך מוסדי של אלפא דוגמני" })).toBeChecked();
    await expect(brackets).toContainText("הצעה: שם של מוסד");
    const waiting = page.getByRole("list", { name: "צריך להחליט" }).locator('li[data-line="3:2"]');
    await expect(waiting).toContainText("צריך לבחור");
    await expect(waiting.getByRole("radio")).toHaveCount(3);
    for (const radio of await waiting.getByRole("radio").all()) await expect(radio).not.toBeChecked();
    await expect(page.getByText("שם נוסף אחד בתא של מרצה מחכה להחלטה (מרצה נוסף/ת, שיוך מוסדי או לא לייבא)")).toBeVisible();
    await expect(page.getByRole("button", { name: "ייבוא", exact: true })).toBeDisabled();
    await unfold(page, SPEAKERS);
    const speaker = (name: string) => page.locator("li[data-speaker]").filter({ hasText: name });
    await expect(speaker("הרב אלפא דוגמני")).toContainText("שיוך מוסדי: ישיבת דוגמה");
    expect(await textOf(page, "li[data-speaker]")).not.toContain("(ישיבת דוגמה)");
    await expect(lessons).not.toContainText("הטלפון לא נשמר");
    await noSidewaysScroll(page);

    // «קפא רחוקה» is a speaker: two in the row — the phone waits; «קפא רחוקה» left out: the phone goes to the one left
    await waiting.getByRole("radio", { name: "מרצה נוסף/ת" }).check();
    await expect(waiting).toBeVisible(); // decided, it stays where it was
    const row3 = lessons.locator("li").filter({ hasText: "זהות כפולה" });
    await expect(row3).toContainText("הטלפון לא נשמר: יש בשורה יותר ממרצה אחד/ת");
    await speaker("קפא רחוקה").getByRole("checkbox", { name: "לא לייבא" }).check();
    await expect(row3).not.toContainText("הטלפון לא נשמר");
    // the phone the choices give is shown on its speaker before «ייבוא» (סבב שלישי) — the same the payload sends
    await expect(speaker("זטא בדיקתי")).toContainText("יש טלפון (משורה 3, אחרי הבחירות)");
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
    await chooseKind(page, "tracking");
    await paste(page, html, "");
    await page.getByLabel("שם המחזור בארכיון").fill("ארכיון סבב שלישי");

    // the contacts are no lines: only the second name (waiting), the institution («הצעה: שם של מוסד») and the name beside
    // the first («הצעה: … מרצה נוסף/ת», סבב שישי) are asked about
    await expect(review(page)).toBeVisible();
    const lines = page.locator("li[data-line]");
    await expect(lines).toHaveCount(3);
    await expect(page.locator('li[data-line="7:2"]')).toContainText("הצעה: שם ליד השם — מרצה נוסף/ת");
    expect(await textOf(page, "li[data-line]")).not.toContain("000-000");
    expect(await textOf(page, "li[data-line]")).not.toContain("example.org");
    await expect(page.locator('li[data-line="5:2"]')).toContainText("הצעה: שם של מוסד");
    await unfold(page, SPEAKERS);
    const speaker = (name: string) => page.locator("li[data-speaker]").filter({ hasText: name });
    expect(await textOf(page, "li[data-speaker]")).not.toMatch(/שיוך מוסדי: [^·\n]*(\d{3}-|@)/);
    await expect(speaker("הרב בדיקה טלפוני")).toContainText("יש טלפון");
    await expect(speaker("ד״ר בדיקה מיילית")).toContainText("יש מייל");
    await expect(speaker("בדיקה בסוגריים")).toContainText("יש טלפון");
    await unfold(page, "כל השיעורים");
    const lessons = page.getByRole("list", { name: "השיעורים" });
    await expect(lessons.locator("li").filter({ hasText: "שורה שנייה טלפון" })).toContainText("הטלפון שבתא המרצה נלקח כטלפון של השורה");
    await noSidewaysScroll(page);

    // the co-speaker: a speaker of their own; the shared row's phone goes to «מרצה 15» once «זיטה» is left out — said on the card
    await page.getByRole("list", { name: "צריך להחליט" }).locator('li[data-line="4:2"]').getByRole("radio", { name: "מרצה נוסף/ת" }).check();
    const m15 = speaker("מרצה 15");
    await expect(m15).not.toContainText("אחרי הבחירות");
    await speaker("זיטה חדשה לגמרי").getByRole("checkbox", { name: "לא לייבא" }).check();
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
    await chooseKind(page, "escorts");
    const rows = [
      ["מרצה", "מלווה", "הערות"],
      ["מרצה 07", "שירה לבדיקה", "שירה תתקשר יום לפני דרך המזכירה"],
      ["מרצה 12", "נועם בדיקה 000-000-0001", "רק בוואטסאפ, 000-000-0002"],
    ];
    await page.locator('input[type="file"]').setInputFiles({ name: "מלווים.docx", mimeType: DOCX, buffer: docx(rows, "מלווים") });
    await unfold(page, "שינוי העמודות");
    await expect(page.getByLabel("שורת הכותרות")).toHaveValue("1");
    await expect(page.getByLabel("מרצה", { exact: true })).toBeEnabled();
    await expect(page.getByLabel("מרצה", { exact: true })).toHaveValue("speaker");
    await expect(page.getByLabel("מלווה", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("הערות", { exact: true })).toHaveValue("phrases");
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("1");
    const preview = review(page);
    await unfold(page, SPEAKERS);
    const m07 = page.locator("li[data-escort]").filter({ hasText: "מרצה 07" });
    const m12 = page.locator("li[data-escort]").filter({ hasText: "מרצה 12" });
    await expect(m07).toContainText("יש כאן שם של מלווה («שירה»)");
    await expect(m07.getByLabel(/ערוץ הקשר/)).toHaveValue("secretary");
    await expect(m12).toContainText("«רק בוואטסאפ»");
    await expect(preview).not.toContainText("000-000"); // the number is out of the phrase before it is shown
    await expect(preview).not.toContainText("נועם");
    await expect(m12).toContainText("הוסר טלפון או מייל מהניסוחים שבקובץ");
    await m12.getByLabel(/ערוץ הקשר/).selectOption("");
    await expect(summaryOf(page, "commit")).toHaveText("מרצה אחד/ת יושלם/תושלם");
    await noSidewaysScroll(page);
  });

  test("סבב רביעי — an escorts' header spelled «ליווי» is asked about anyway; the tracking sheet's «מלוה» too: a line naming the escort proposed «לא לייבא», a skipped row's line waits for nothing", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    await page.goto(`${demoUrl()}/settings/import`);
    await chooseKind(page, "escorts");
    await page.getByLabel("הדבקת טבלה").fill("מרצה\tליווי\tהערות\nמרצה 07\tשירה בדקני\tשירה תתקשר דרך המזכירה");
    await page.getByRole("button", { name: "קריאת הטקסט שהוקלד" }).click();
    await unfold(page, "שינוי העמודות");
    await expect(page.getByLabel("שורת הכותרות")).toHaveValue("0");
    await expect(page.getByLabel("ליווי", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("באיזו עמודה שמות המלווים?")).toBeVisible();
    await expect(page.getByLabel("הערות", { exact: true })).toHaveValue("phrases");
    await expect(page.getByText("צריך לומר באיזו עמודה שמות המלווים (או שאין).")).toBeVisible();
    await page.waitForTimeout(800); // past the check's delay
    await expect(review(page)).toHaveCount(0);
    await page.getByRole("button", { name: "ניקוי — טבלה אחרת" }).click();

    const td = (x: string) => `<td>${x.split("\n").map((l) => `<p class=MsoNormal>${l}</p>`).join("")}</td>`;
    const tr = (...cells: string[]) => `<tr>${cells.map(td).join("")}</tr>`;
    const html = `<table class=MsoTableGrid>${tr("מרצה", "שיעור ב", "כותרת", "מלוה")}${[
      tr("מרצה 07\n(מלווה: שירה בדקני)", "ראשון 8:30", "כותרת אלף", "שירה בדקני"),
      tr("הרב חדש בדיקתי\nנועם ניסיוני", "ראשון 10:00", "כותרת בית", "נועם ניסיוני"),
      tr("דוגמה שלישית\nשם אחר לגמרי", "שישי 8:30", "כותרת גימל", ""),
    ].join("")}</table>`;
    await chooseKind(page, "tracking");
    await paste(page, html, "");
    await unfold(page, "שינוי העמודות");
    await expect(page.getByLabel("מלוה", { exact: true })).toBeDisabled();
    // asked first: well past the check's delay, still nothing checked
    await expect(page.getByText("צריך לומר באיזו עמודה שמות המלווים (או שאין).")).toBeVisible();
    await page.waitForTimeout(800);
    await expect(review(page)).toHaveCount(0);
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("3");

    // every line proposed (or of a row left out): none waits — all folded; only the archive's name, not written yet
    const decide = page.getByRole("list", { name: "צריך להחליט" });
    await expect(page.getByRole("heading", { name: "צריך להחליט (1)" })).toBeVisible();
    const name = decide.locator("li[data-goto]");
    await expect(name).toContainText("שם המחזור בארכיון");
    await expect(name).toContainText("צריך שם למחזור בארכיון");
    await toFirst(page).click();
    await expect(page.getByLabel("שם המחזור בארכיון")).toBeFocused();
    await page.getByLabel("שם המחזור בארכיון").fill("ארכיון סבב רביעי");
    await expect(name).toContainText("«ארכיון סבב רביעי»"); // decided, it stays where it was
    await expect(page.getByRole("heading", { name: "צריך להחליט (0)" })).toBeVisible();
    await unfold(page, "שמות נוספים בתאים");
    const lines = page.getByRole("list", { name: "שמות נוספים בתא המרצה" });
    await expect(lines.locator('li[data-line="2:2"]').getByRole("radio", { name: "לא לייבא את השורה" })).toBeChecked();
    await expect(lines.locator('li[data-line="2:2"]')).toContainText("הצעה: שם מעמודת המלווים («שירה»)");
    await expect(lines.locator('li[data-line="3:2"]').getByRole("radio", { name: "לא לייבא את השורה" })).toBeChecked();
    await expect(lines.locator('li[data-line="4:2"]')).toContainText("השורה מדולגת — אין צורך להחליט");
    await expect(page.getByText(/בתא של מרצה מחכה להחלטה|בתאי המרצים מחכים להחלטה/)).toHaveCount(0); // the save panel waits for no line
    expect(await textOf(page, "li[data-speaker]")).not.toContain("שירה");
    expect(await textOf(page, "li[data-speaker]")).not.toContain("נועם");
    await expect(page.locator("summary").filter({ hasText: "כל השיעורים" })).toContainText("2 לייבוא · מדולג אחד");
    await noSidewaysScroll(page);
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(page.getByText(/2 שיעורים במחזור «ארכיון סבב רביעי»/)).toBeVisible();
  });

  test("סבב רביעי — the candidates: a second line in the name's cell is asked about, never glued to the name", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough");
    await page.goto(`${demoUrl()}/settings/import`);
    await chooseKind(page, "candidates");
    const td = (x: string) => `<td>${x.split("\n").join("<br>")}</td>`;
    await paste(page, `<table><tr>${td("מרצה")}</tr><tr>${td("הרב זין בדיקתי\nהרבנית חית בדיקתית")}</tr><tr>${td("ד\"ר גימל בדיקתי\nאוניברסיטת בדיקה")}</tr></table>`, "");
    const decide = page.getByRole("list", { name: "צריך להחליט" });
    await expect(decide.locator('li[data-line="2:2"]')).toContainText("צריך לבחור");
    await unfold(page, "שמות נוספים בתאים");
    await expect(page.locator('li[data-line="3:2"]').getByRole("radio", { name: "שיוך מוסדי של גימל בדיקתי" })).toBeChecked();
    await expect(page.getByText("שם נוסף אחד בתא של מרצה מחכה להחלטה (מרצה נוסף/ת, שיוך מוסדי או לא לייבא)")).toBeVisible();
    await expect(page.getByRole("button", { name: "ייבוא", exact: true })).toBeDisabled();
    const preview = review(page);
    await expect(preview).not.toContainText("זין בדיקתי הרבנית");
    await decide.locator('li[data-line="2:2"]').getByRole("radio", { name: "מרצה נוסף/ת" }).check();
    await expect(page.locator('li[data-ref="2:2"]')).toContainText("הרבנית חית בדיקתית");
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
    await chooseKind(page, "tracking");
    await paste(page, html, "");
    await page.getByLabel("שם המחזור בארכיון").fill("ארכיון סבב חמישי");
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("3");

    await expect(review(page)).toBeVisible();
    await unfold(page, "שמות נוספים בתאים");
    const lines = page; // «צריך להחליט» or the fold: a line is found by its id
    await expect(lines.locator('li[data-line="2:1.1"]').getByRole("radio", { name: "שיוך מוסדי של מרצה 07" })).toBeChecked();
    await expect(lines.locator('li[data-line="3:1.1"]').getByRole("radio", { name: "לא לייבא את הסוגריים (המרצה נשאר/ת)" })).toBeChecked();
    await expect(lines.locator('li[data-line="3:1.1"]')).toContainText("הצעה: שם מעמודת המלווים («שירה»)");
    await expect(lines.locator('li[data-line="4:2"]').getByRole("radio", { name: "לא לייבא את השם הזה" })).toBeChecked();
    await expect(page.getByRole("list", { name: "צריך להחליט" }).locator('li[data-line="5:1.1"]')).toContainText("צריך לבחור");
    await expect(page.getByRole("button", { name: "ייבוא", exact: true })).toBeDisabled();
    // the names as the pool has them: מרצה 07 is the pool's, never a second «מרצה 07 (מכון לדוגמה)»
    await expect(page.locator("li[data-speaker]").filter({ hasText: "מרצה 07" })).toContainText("כבר במאגר: מרצה 07");
    const speakers = await textOf(page, "li[data-speaker]");
    for (const never of ["(מכון לדוגמה)", "שירה", "נועם"]) expect(speakers).not.toContain(never);
    // a verse in a title is text: whole, and no «הוסר טלפון»
    await unfold(page, "כל השיעורים");
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
    await chooseKind(page, "escorts");
    await page.getByLabel("הדבקת טבלה").fill("מרצה\tמלווה\tהערות\nמרצה 007\tשירה בדקני\tדרך המזכירה");
    await page.getByRole("button", { name: "קריאת הטקסט שהוקלד" }).click();
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("1");
    // «עמום» with a channel to save: in «צריך להחליט»
    const card = page.getByRole("list", { name: "צריך להחליט" }).locator("li[data-escort]").filter({ hasText: "מרצה 007" });
    await expect(card).toContainText("עמום");
    await expect(summaryOf(page, "review")).toHaveText("1 מחכה להחלטה");
    // «לראשונה שמחכה להחלטה»: «מי זה/זו?», not the note field before it
    await toFirst(page).click();
    await expect(card.getByRole("group", { name: /^מי זה\/זו\?/ }).getByRole("radio").first()).toBeFocused();
    await card.getByRole("radio", { name: /להשלים את .*מרצה 07/ }).check();
    await expect(card).toContainText("יושלם (רק מה שחסר): ערוץ קשר");
    await expect(card).not.toContainText("אין מה להשלים");
    await expect(summaryOf(page, "review")).toHaveText("מרצה אחד/ת יושלם/תושלם");
    await noSidewaysScroll(page);

    // no channel in the file's words: nothing to decide at the check — a channel chosen later makes it wait, where it is
    await page.getByRole("button", { name: "ניקוי — טבלה אחרת" }).click();
    await page.getByLabel("הדבקת טבלה").fill("מרצה\tמלווה\tהערות\nמרצה 007\tשירה בדקני\tבלה בלה");
    await page.getByRole("button", { name: "קריאת הטקסט שהוקלד" }).click();
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("1");
    await expect(review(page)).toContainText("אין מה להחליט.");
    await unfold(page, SPEAKERS);
    const later = page.locator("li[data-escort]").filter({ hasText: "מרצה 007" });
    await later.getByLabel(/ערוץ הקשר/).selectOption("secretary");
    await expect(summaryOf(page, "review")).toHaveText("1 מחכה להחלטה");
    await expect(page.getByRole("heading", { name: "צריך להחליט (1)" })).toBeVisible();
    await expect(review(page)).not.toContainText("אין מה להחליט.");
    await expect(review(page)).toContainText("עוד החלטה אחת מחכה, מחוץ לרשימה הזו.");
    await review(page).getByRole("button", { name: "לראשונה שמחכה להחלטה" }).click();
    await expect(later.getByRole("group", { name: /^מי זה\/זו\?/ }).getByRole("radio").first()).toBeFocused();
  });

  test("סבב שישי — «עריכה»: a glued name corrected, matched again to the pool; a tail after « - » split by itself; a contact in an edit refused", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    await page.goto(`${demoUrl()}/settings/import`);
    await chooseKind(page, "candidates");
    const td = (x: string) => `<td>${x}</td>`;
    await paste(page, `<table><tr>${td("מרצה")}</tr><tr>${td("הרב מרצה 07-ישיבת בדיקה")}</tr><tr>${td("הרב מרצה 12 - ישיבת הר בדיקה")}</tr><tr>${td("ד\"ר מרצה 03, הרבנית חדשה בדיקתית")}</tr><tr>${td("הרב מרצה 15 מלווה")}</tr></table>`, "");
    const preview = page; // «צריך להחליט» or the fold: a card is found by its ref
    await expect(review(page)).toBeVisible();
    await unfold(page, SPEAKERS);
    // a tail after « - » is a line of the name by itself — the name the pool's, the tail its affiliation («הצעה»)
    await unfold(page, "שמות נוספים בתאים");
    const lines = page;
    await expect(lines.locator('li[data-line="3:1.1"]').getByRole("radio", { name: "שיוך מוסדי של מרצה 12" })).toBeChecked();
    await expect(preview.locator('li[data-ref="3"]')).toContainText(/כבר במאגר: (\S+ )?מרצה 12/);
    await expect(page.getByRole("list", { name: "צריך להחליט" }).locator('li[data-line="4:1.1"]')).toContainText("צריך לבחור");
    await expect(lines.locator('li[data-line="4:1.1"]').getByRole("radio", { name: "לא לייבא את החלק הזה (המרצה נשאר/ת)" })).toBeVisible();
    // what a decided line is, in one line
    await expect(page.getByText(/מה שהופרד משם המרצה/)).toBeVisible();
    // a bare hyphen is never a split: the glued name is «חדש» — «עריכה» corrects it
    const glued = preview.locator('li[data-ref="2"]');
    await expect(glued).toContainText("מרצה 07-ישיבת בדיקה");
    await expect(glued).toContainText("חדש");
    // a name still holding an escort's word: said beside it in red
    await expect(preview.locator('li[data-ref="5"] p.text-bad')).toHaveText(/^בשם יש מילה על מלווה או חניך\/ה/);
    await glued.getByRole("button", { name: "עריכה" }).click();
    const form = glued.getByRole("group", { name: "עריכה" });
    await expect(form.getByLabel("שם", { exact: true })).toBeFocused(); // the keyboard goes on into the form
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
    await expect(glued.getByRole("button", { name: "עריכה — מרצה 07" })).toBeFocused(); // and back to the card's «עריכה»
    // taken back: what was read, again
    await glued.getByRole("button", { name: "ביטול העריכה" }).click();
    await expect(glued).toContainText("חדש");
    await expect(glued.getByRole("button", { name: "עריכה — מרצה 07-ישיבת בדיקה" })).toBeFocused();
    await expect(glued).not.toContainText("נערך ידנית");
    await noSidewaysScroll(page);
  });

  test("סבב שישי — the tracking sheet: «עריכה» of a speaker card, and which names beside another are speakers", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough");
    const td = (x: string) => `<td>${x}</td>`;
    const tr = (...cells: string[]) => `<tr>${cells.map(td).join("")}</tr>`;
    await page.goto(`${demoUrl()}/settings/import`);
    await chooseKind(page, "tracking");
    await paste(page, `<table>${tr("מרצה", "שיעור ב", "כותרת")}${tr("מרצה 07-מכון לדוגמה", "ראשון 8:30", "כותרת אלף")}${tr("מרצה 12 / ישיבת הגולן", "ראשון 10:00", "כותרת בית")}${tr("מרצה 03 + גימל בדיקתית", "ראשון 11:30", "כותרת גימל")}${tr("מרצה 12ב", "ראשון 14:30", "כותרת דלת")}${tr("מרצה 03ב", "ראשון 16:00", "כותרת הא")}${tr("מרצה 05 + גימל בדיקתית", "ראשון", "כותרת וו")}</table>`, "");
    await page.getByLabel("שם המחזור בארכיון").fill("ארכיון סבב שישי");
    await expect(review(page)).toBeVisible();
    // the lines (all proposed, or of a row left out) and the cards that need no choice are folded: open them
    await unfold(page, "שמות נוספים בתאים");
    await unfold(page, SPEAKERS);
    const lines = page; // a line is found by its id, a card by its name — in «צריך להחליט» or in a fold
    await expect(lines.locator('li[data-line="3:2"]').getByRole("radio", { name: "שיוך מוסדי של מרצה 12" })).toBeChecked(); // never a speaker «ישיבת הגולן»
    const speakers = review(page);
    expect(await textOf(page, "li[data-speaker]")).not.toContain("ישיבת הגולן —");
    const card = (name: string) => page.locator("li[data-speaker]").filter({ hasText: name });
    // the name beside «מרצה 03» is a co-speaker («הצעה»); its card's «עריכה» says what it is — that line alone: the one
    // beside «מרצה 05» is of a row left out anyway (no time), and waits for nothing here either
    await card("גימל בדיקתית").getByRole("button", { name: "עריכה" }).click();
    const gimel = card("גימל בדיקתית").getByRole("group", { name: "עריכה" });
    await expect(gimel.getByRole("radio", { name: "מרצה נוסף/ת" })).toHaveCount(1);
    await expect(lines.locator('li[data-line="7:2"]').getByRole("radio", { name: "מרצה נוסף/ת" })).toBeDisabled();
    // a title saved by the keyboard: the card keeps it
    await gimel.getByLabel("תואר").selectOption("הרבנית");
    await gimel.getByRole("button", { name: "שמירת העריכה" }).press("Enter");
    await expect(card("גימל בדיקתית").getByRole("button", { name: "עריכה — גימל בדיקתית" })).toBeFocused();
    // by the mouse, a choice in the form leaves the keyboard (and the page) where they were — a key pressed there before
    // the pointer does not make it the keyboard's
    await card("גימל בדיקתית").getByRole("button", { name: "עריכה — גימל בדיקתית" }).click();
    await card("גימל בדיקתית").getByRole("group", { name: "עריכה" }).getByRole("radio", { name: "מרצה נוסף/ת" }).focus();
    await page.keyboard.press("Shift");
    await card("גימל בדיקתית").getByRole("group", { name: "עריכה" }).getByRole("radio", { name: "שיוך מוסדי של מרצה 03" }).click();
    const line = lines.locator('li[data-line="4:2"]');
    await expect(line.getByRole("radio", { name: "שיוך מוסדי של מרצה 03" })).toBeChecked();
    await expect(line.getByRole("radio", { name: "שיוך מוסדי של מרצה 03" })).not.toBeFocused();
    await line.getByRole("radio", { name: "מרצה נוסף/ת" }).click(); // back: a speaker, and its card, again
    // by the keyboard: the arrows check each choice they pass — the card goes with the first that is no speaker, and the
    // keyboard goes on at the same choice of the line where it is listed («שמות נוספים בתאים»)
    await card("גימל בדיקתית").getByRole("button", { name: "עריכה — גימל בדיקתית" }).click();
    await card("גימל בדיקתית").getByRole("group", { name: "עריכה" }).getByRole("radio", { name: "מרצה נוסף/ת" }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(line.getByRole("radio", { name: "שיוך מוסדי של מרצה 03" })).toBeFocused();
    // back up: the card comes back, and the keyboard stays in the list (the saved title's hand-off was spent)
    await page.keyboard.press("ArrowUp");
    await expect(card("גימל בדיקתית")).toHaveCount(1);
    await expect(line.getByRole("radio", { name: "מרצה נוסף/ת" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(line.getByRole("radio", { name: "לא לייבא את השם הזה" })).toBeFocused();
    await expect(line.getByRole("radio", { name: "לא לייבא את השם הזה" })).toBeChecked();
    await expect(card("גימל בדיקתית")).toHaveCount(0); // it is no speaker now, and no affiliation
    // the glued one corrected: the pool's מרצה 07, with its affiliation
    await card("מרצה 07-מכון לדוגמה").getByRole("button", { name: "עריכה" }).click();
    const form = card("מרצה 07-מכון לדוגמה").getByRole("group", { name: "עריכה" });
    await form.getByLabel("שם", { exact: true }).fill("מרצה 07");
    await form.getByLabel("שיוך מוסדי").fill("מכון לדוגמה");
    await form.getByRole("button", { name: "שמירת העריכה" }).click();
    await expect(card("מרצה 07")).toContainText("נערך ידנית");
    await expect(card("מרצה 07").getByRole("button", { name: "עריכה — מרצה 07" })).toBeFocused(); // a new key, a new card: the focus handed to it
    await expect(card("מרצה 07")).toContainText("כבר במאגר: מרצה 07");
    await expect(card("מרצה 07")).toContainText("שיוך מוסדי: מכון לדוגמה");
    // a later card edited into an earlier one's name: the two are one, and the focus goes on at the card that stays —
    // however it was saved (a screen reader's action is a click), but the page scrolls to it only from the keyboard
    type Calls = { focusCalls: { label: string | null; still: boolean }[] };
    await page.evaluate(() => {
      const w = window as unknown as Calls;
      w.focusCalls = [];
      const focus = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function (this: HTMLElement, o?: FocusOptions) {
        w.focusCalls.push({ label: this.getAttribute("aria-label"), still: !!o?.preventScroll });
        return focus.call(this, o);
      };
    });
    const handedTo03 = () => page.evaluate(() => (window as unknown as Calls).focusCalls.filter((c) => c.label === "עריכה — מרצה 03"));
    await speakers.getByRole("button", { name: "עריכה — מרצה 03ב", exact: true }).click();
    let late = card("מרצה 03ב").getByRole("group", { name: "עריכה" });
    await late.getByLabel("שם", { exact: true }).fill("מרצה 03");
    await late.getByRole("button", { name: "שמירת העריכה" }).click();
    await expect(card("מרצה 03ב")).toHaveCount(0);
    await expect(card("מרצה 03")).toContainText("שורות 4, 6");
    await expect(speakers.getByRole("button", { name: "עריכה — מרצה 03", exact: true })).toBeFocused();
    expect(await handedTo03()).toEqual([{ label: "עריכה — מרצה 03", still: true }]); // by the mouse: the page stays
    // taken back, and saved by the keyboard: the page goes with the focus
    await card("מרצה 03").getByRole("button", { name: "ביטול העריכה" }).click();
    await expect(card("מרצה 03ב")).toHaveCount(1);
    await speakers.getByRole("button", { name: "עריכה — מרצה 03ב", exact: true }).click();
    late = card("מרצה 03ב").getByRole("group", { name: "עריכה" });
    await late.getByLabel("שם", { exact: true }).fill("מרצה 03");
    await page.evaluate(() => ((window as unknown as Calls).focusCalls = []));
    await late.getByRole("button", { name: "שמירת העריכה" }).press("Enter");
    await expect(card("מרצה 03ב")).toHaveCount(0);
    await expect(speakers.getByRole("button", { name: "עריכה — מרצה 03", exact: true })).toBeFocused();
    expect(await handedTo03()).toEqual([{ label: "עריכה — מרצה 03", still: false }]);
    // …at its form's name when its own «עריכה» is open (no «עריכה» button shown), and back to «עריכה» when that closes
    await speakers.getByRole("button", { name: "עריכה — מרצה 12", exact: true }).click();
    const open12 = speakers.getByRole("group", { name: "עריכה" });
    await speakers.getByRole("button", { name: "עריכה — מרצה 12ב", exact: true }).click();
    const late12 = card("מרצה 12ב").getByRole("group", { name: "עריכה" });
    await late12.getByLabel("שם", { exact: true }).fill("מרצה 12");
    await late12.getByRole("button", { name: "שמירת העריכה" }).press("Enter");
    await expect(card("מרצה 12ב")).toHaveCount(0);
    await expect(open12.getByLabel("שם", { exact: true })).toBeFocused();
    await open12.getByRole("button", { name: "ביטול", exact: true }).click();
    await expect(card("מרצה 12")).toContainText("שורות 3, 5");
    await expect(speakers.getByRole("button", { name: "עריכה — מרצה 12", exact: true })).toBeFocused();
    await unfold(page, "כל השיעורים");
    await expect(page.getByRole("list", { name: "השיעורים" }).locator("li").filter({ hasText: "כותרת אלף" })).toContainText("מרצה 07");
    await noSidewaysScroll(page);
    // the archive's name, written before the check, cleared now: counted in «צריך להחליט», said to wait outside it, and
    // «לראשונה שמחכה להחלטה» goes to its field
    await expect(page.getByRole("heading", { name: "צריך להחליט (0)" })).toBeVisible();
    await expect(page.getByRole("list", { name: "צריך להחליט" }).locator("li[data-goto]")).toHaveCount(0);
    await page.getByLabel("שם המחזור בארכיון").fill("");
    await expect(page.getByRole("heading", { name: "צריך להחליט (1)" })).toBeVisible();
    await expect(speakers).toContainText("עוד החלטה אחת מחכה, מחוץ לרשימה הזו.");
    await expect(page.getByText("צריך שם למחזור בארכיון")).toBeVisible();
    await toFirst(page).click();
    await expect(page.getByLabel("שם המחזור בארכיון")).toBeFocused();
    await page.getByLabel("שם המחזור בארכיון").fill("ארכיון סבב שישי");
    await expect(page.getByRole("heading", { name: "צריך להחליט (0)" })).toBeVisible();
    // the confirm cancelled: the focus back at «ייבוא»
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ביטול", exact: true }).press("Enter");
    await expect(page.getByRole("button", { name: "ייבוא", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(page.getByText(/5 שיעורים במחזור «ארכיון סבב שישי»/)).toBeVisible();
  });

  test("סבב שישי — the escorts' file: «הרב מרצה 05 (ישיבת בדיקה)» is the pool's מרצה 05; «רק בוואטסאפ, לא להתקשר בשבת» proposes WhatsApp", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "one width is enough");
    await page.goto(`${demoUrl()}/settings/import`);
    await chooseKind(page, "escorts");
    await page.getByLabel("הדבקת טבלה").fill("מרצה\tמלווה\tהערות\nהרב מרצה 05 (ישיבת בדיקה)\tשירה בדקני\tרק בוואטסאפ, לא להתקשר בשבת\nמרצה 12 - מלווה: שירה\t\tדרך המזכירה");
    await page.getByRole("button", { name: "קריאת הטקסט שהוקלד" }).click();
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("1");
    await unfold(page, SPEAKERS);
    const card = (name: string) => page.locator("li[data-escort]").filter({ hasText: name });
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
    await chooseKind(page, "candidates");
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

  test("the escorts' question is asked outside «שינוי העמודות», and nothing is checked until it is answered", async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "two widths are enough for this flow");
    await page.goto(`${demoUrl()}/settings/import`);
    await chooseKind(page, "escorts");
    await page.getByRole("button", { name: "מילוי בנתונים לדוגמה" }).click();
    // every column found: the fold stays closed — the question is beside it, never inside
    await expect(page.locator("[data-columns]")).toHaveText("זיהינו: מרצה ← «מרצה» · ניסוחים ← «הערות»");
    const fold = page.locator("details").filter({ has: page.locator("summary", { hasText: "שינוי העמודות" }) });
    await expect(fold).not.toHaveAttribute("open");
    const ask = page.getByLabel("באיזו עמודה שמות המלווים?");
    await expect(ask).toBeVisible();
    expect(await ask.evaluate((el) => el.closest("details"))).toBeNull();
    await expect(page.getByLabel("שורת הכותרות")).toBeHidden();
    // well past the check's delay: still no check, and nothing to decide or import
    await page.waitForTimeout(1200);
    await expect(review(page)).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "בודקים מול המאגר" })).toHaveCount(0);
    await expect(page.getByText("צריך לומר באיזו עמודה שמות המלווים (או שאין).")).toBeVisible();
    await expect(page.getByRole("button", { name: "ייבוא", exact: true })).toHaveCount(0);
    await noSidewaysScroll(page);
    // answered: checked by itself
    await ask.selectOption("1");
    await expect(review(page)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "נבדק מול המאגר." })).toBeVisible();
    // taken back to «צריך לבחור»: the check goes with it
    await ask.selectOption("");
    await expect(review(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ייבוא", exact: true })).toHaveCount(0);
    // an answer that takes the speaker's column away: «שינוי העמודות» opens by itself, and says what is missing
    await ask.selectOption("0");
    await expect(fold).toHaveAttribute("open");
    await expect(page.locator("[data-columns]")).toContainText("צריך לבחור את העמודה של «מרצה»");
    await expect(page.getByLabel("מרצה", { exact: true })).toBeDisabled();
    await page.waitForTimeout(800);
    await expect(review(page)).toHaveCount(0);
  });

  test("the keyboard: the arrows go on between the three kinds (a choice never closes «קבצים של אשתקד»); «מקור» emptied: «לראשונה שמחכה להחלטה» opens «שינוי העמודות» to it", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough");
    await page.goto(`${demoUrl()}/settings/import`);
    await unfold(page, "קבצים של אשתקד");
    const kinds = page.locator("details").filter({ has: page.locator("summary", { hasText: "קבצים של אשתקד" }) });
    await page.getByRole("radio", { name: KIND.tracking }).check();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("radio", { name: KIND.candidates })).toBeChecked();
    await expect(page.getByRole("radio", { name: KIND.candidates })).toBeFocused();
    await expect(kinds).toHaveAttribute("open");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: KIND.tracking })).toBeChecked();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: KIND.escorts })).toBeChecked();
    await page.keyboard.press("ArrowDown"); // round to the first
    await expect(page.getByRole("radio", { name: KIND.candidates })).toBeChecked();
    await expect(kinds).toHaveAttribute("open");

    await paste(page, "<table><tr><td>מרצה</td></tr><tr><td>הרב בדיקה מקורית</td></tr></table>", "");
    await expect(review(page)).toBeVisible();
    await unfold(page, "שינוי העמודות");
    const source = page.getByLabel("מקור (נרשם למרצים החדשים)");
    await source.fill("");
    const columns = page.locator("details").filter({ has: page.locator("summary", { hasText: "שינוי העמודות" }) });
    await columns.locator("summary").click();
    await expect(columns).not.toHaveAttribute("open");
    await expect(savePanel(page)).toContainText("צריך מקור למרצים החדשים (ב«שינוי העמודות»)");
    await expect(page.getByRole("button", { name: "ייבוא", exact: true })).toBeDisabled();
    await toFirst(page).click();
    await expect(source).toBeFocused();
    await expect(columns).toHaveAttribute("open");
  });

  test("the escorts' file: «ניסוחים», «איך פונים» and «דרכי פנייה» are the phrases' column by themselves, as «הערות» is", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough");
    await page.goto(`${demoUrl()}/settings/import`);
    await chooseKind(page, "escorts");
    const fold = page.locator("details").filter({ has: page.locator("summary", { hasText: "שינוי העמודות" }) });
    for (const header of ["ניסוחים", "איך פונים", "דרכי פנייה"]) {
      await page.getByLabel("הדבקת טבלה").fill(`מרצה\tמלווה\t${header}\nמרצה 07\tשירה בדקני\tדרך המזכירה`);
      await page.getByRole("button", { name: "קריאת הטקסט שהוקלד" }).click();
      await expect(page.locator("[data-columns]")).toHaveText(`זיהינו: מרצה ← «מרצה» · ניסוחים ← «${header}»`);
      await expect(fold).not.toHaveAttribute("open"); // nothing missing: the fold stays closed
      await page.getByRole("button", { name: "ניקוי — טבלה אחרת" }).click();
    }
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
    await chooseKind(page, "candidates");
    const html = "<table><tr><td>מרצה</td><td>טלפון</td><td>חניך/ה</td><td>טווח ימים</td></tr><tr><td>הרב מרצה בדיקת חיבור</td><td>000-000-0004</td><td>חניך/ה שלא נקרא/ת</td><td>נסגר</td></tr></table>";
    const poolBefore = sb.count("/rest/v1/speakers");
    await paste(page, html, "");
    // a trainees' header: asked (סבב חמישי) — and until it is answered, nothing is asked of the pool, well past the delay
    await page.waitForTimeout(800);
    expect(sb.rpc.get("import_lookup")).toBeUndefined();
    expect(sb.count("/rest/v1/speakers")).toBe(poolBefore);
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("2");
    await expect(page.locator("li[data-row]")).toHaveCount(1);
    // nothing to decide: one sentence, and the card folded
    await expect(summaryOf(page, "review")).toHaveText("מרצה אחד/ת חדש/ה");
    await expect(review(page)).toContainText("אין מה להחליט.");
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
    await chooseKind(page, "candidates");
    await paste(page, "<table><tr><td>מרצה</td></tr><tr><td>הרב מרצה 07-ישיבת בדיקה</td></tr></table>", "");
    const card = page.locator('li[data-ref="2"]');
    await expect(card).toContainText("חדש");
    await unfold(page, SPEAKERS);
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
    await chooseKind(page, "escorts");
    const rows = [
      ["מרצה", "ליווי", "הערות"],
      ["מרצה 07", "שירה בדקני (ונועם ניסיוני)", "שירה תתקשר יום לפני דרך המזכירה"],
      ["מרצה 12", "אורי ניסיון (אוריק)", "וכשאוריק מתאם — רק בוואטסאפ, 000-000-0002"],
    ];
    await page.locator('input[type="file"]').setInputFiles({ name: "מלווים.docx", mimeType: DOCX, buffer: docx(rows, null) });
    await expect(page.locator("[data-columns]")).toContainText("ניסוחים ← «הערות»"); // the phrases' column by itself
    await page.getByLabel("באיזו עמודה שמות המלווים?").selectOption("1");
    await unfold(page, SPEAKERS);
    await page.locator("li[data-escort]").filter({ hasText: "מרצה 07" }).getByLabel("הערה משלך (לא חובה)").fill("רק בבוקר");
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

  test("the check by itself: once for a settled mapping — the pool, the categories, one import_lookup — once more after a change, never for the archive's name, its date or «מקור»", async ({ page }, info) => {
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
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;
    const target = week.speakers.find((x) => x.name === "מרצה 07")!;
    const counts = () => ({ pool: sb.count("/rest/v1/speakers"), categories: sb.count("/rest/v1/categories"), lookup: sb.rpc.get("import_lookup")?.length ?? 0 });

    await page.goto(`${mockUrl()}/settings/import`);
    await chooseKind(page, "tracking");
    await expect(page.getByLabel("הדבקת טבלה")).toBeVisible();
    const before = counts();
    await paste(page, "<table><tr><td>מרצה</td><td>שיעור ב</td><td>כותרת</td><td>נושא</td></tr><tr><td>מרצה 07</td><td>ראשון 8:30</td><td>כותרת לבדיקה</td><td>תנ\"ך</td></tr></table>", "");
    await expect(review(page)).toBeVisible();
    await expect.poll(() => counts().lookup).toBe(1);
    expect(counts()).toEqual({ pool: before.pool + 1, categories: before.categories + 1, lookup: 1 });
    expect(sb.rpc.get("import_lookup")).toEqual([{ p_speakers: [target.id], p_phone_keys: [] }]);

    // the archive's name, its date, «מקור»: not read — no check, and the review stays
    await page.getByLabel("שם המחזור בארכיון").fill("ארכיון לבדיקה");
    await page.getByLabel(/תאריך הפתיחה של אשתקד/).fill("2026-03-01");
    await unfold(page, "שינוי העמודות");
    await page.getByLabel("מקור (נרשם למרצים החדשים)").fill("tracking-test");
    await page.waitForTimeout(1000);
    expect(counts()).toEqual({ pool: before.pool + 1, categories: before.categories + 1, lookup: 1 });
    await expect(review(page)).toBeVisible();

    // a column's field changed: one more check, once
    await page.getByLabel("נושא", { exact: true }).selectOption("");
    await expect.poll(() => counts().lookup).toBe(2);
    await page.waitForTimeout(1000);
    expect(counts()).toEqual({ pool: before.pool + 2, categories: before.categories + 2, lookup: 2 });
    await expect(review(page)).toBeVisible();

    // two changes one after the other, faster than the delay: one check for the reading they settle on
    await page.getByRole("checkbox", { name: /מגדר מהתואר/ }).evaluate((el: HTMLInputElement) => {
      el.click();
      el.click();
    });
    await expect.poll(() => counts().lookup).toBe(3);
    await page.waitForTimeout(1000);
    expect(counts()).toEqual({ pool: before.pool + 3, categories: before.categories + 3, lookup: 3 });
    expect(sb.rpc.get("import_lookup")).toEqual(Array(3).fill({ p_speakers: [target.id], p_phone_keys: [] }));
    expect(sb.calls.some((c) => c.path.includes("import_commit"))).toBe(false);
  });

  test("a check that fails says so, with «לנסות שוב» — which asks again, once", async ({ page }, info) => {
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
    // import_lookup unanswered: the mock's 404
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;

    await page.goto(`${mockUrl()}/settings/import`);
    await chooseKind(page, "candidates");
    await paste(page, "<table><tr><td>מרצה</td></tr><tr><td>הרב מרצה בדיקת כשל</td></tr></table>", "");
    const failed = page.getByRole("alert").filter({ has: page.getByRole("button", { name: "לנסות שוב" }) });
    await expect(failed).toBeVisible();
    await expect(review(page)).toHaveCount(0);
    expect(sb.rpc.get("import_lookup")).toHaveLength(1);
    sb.answers.set("import_lookup", { phones: [], contacts: [] });
    // from the keyboard: the button goes as the retry starts — the focus waits on the check's status line, never <body>
    await failed.getByRole("button", { name: "לנסות שוב" }).press("Enter");
    await expect(review(page)).toBeVisible();
    await expect(failed).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "נבדק מול המאגר." })).toBeFocused();
    expect(sb.rpc.get("import_lookup")).toHaveLength(2);
  });

  test("one check at a time: a change while one is on the network waits for it, and its stale answer is never shown", async ({ page }, info) => {
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
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;
    const target = week.speakers.find((x) => x.name === "מרצה 07")!;
    // import_lookup held here (registered after the mock: it answers first): each answer waits for its release
    const asked: unknown[] = [];
    const release: (() => void)[] = [];
    const answers = [
      { phones: [], contacts: [] }, // the first reading's: no phone asked about
      { phones: [{ key: "0000000004", speaker_id: target.id }], contacts: [] }, // the second's: the row's phone is מרצה 07's
    ];
    await page.route("**/rest/v1/rpc/import_lookup", async (route) => {
      const n = asked.length;
      asked.push(route.request().postDataJSON());
      await new Promise<void>((done) => release.push(done));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answers[Math.min(n, 1)]) });
    });

    await page.goto(`${mockUrl()}/settings/import`);
    await chooseKind(page, "candidates");
    // «מספר» is no header of a field: its column is not read at first
    await paste(page, "<table><tr><td>מרצה</td><td>מספר</td></tr><tr><td>הרב מרצה בדיקת מירוץ</td><td>000-000-0004</td></tr></table>", "");
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toEqual({ p_speakers: [], p_phone_keys: [] });
    await expect(page.getByRole("status").filter({ hasText: "בודקים מול המאגר…" })).toBeVisible();

    // the column read as the phone while the first check waits on the network: the next check waits for it
    await unfold(page, "שינוי העמודות");
    await page.getByLabel("מספר", { exact: true }).selectOption("phone");
    await page.waitForTimeout(800);
    expect(asked).toHaveLength(1);
    await expect(review(page)).toHaveCount(0);

    // the first answer comes — for a reading that is gone: dropped, never shown; then the next check asks for the new one
    release[0]();
    await expect.poll(() => asked.length).toBe(2);
    expect(asked[1]).toEqual({ p_speakers: [], p_phone_keys: ["0000000004"] });
    await page.waitForTimeout(500);
    await expect(review(page)).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "בודקים מול המאגר…" })).toBeVisible();

    // its answer: the row's phone is the pool's מרצה 07 — never «חדש» from the stale answer
    release[1]();
    const card = page.locator('li[data-ref="2"]');
    await expect(review(page)).toBeVisible();
    await unfold(page, SPEAKERS);
    await expect(card).toContainText("תואם");
    await expect(card).toContainText("אותו טלפון כמו");
    await page.waitForTimeout(800);
    expect(asked).toHaveLength(2);
  });
});
