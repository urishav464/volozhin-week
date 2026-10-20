// «הגדרות ← ייבוא» in a real browser (demo build, the demo user is the global admin), at 390 / 820 / 1440: a table
// pasted as text/html through a synthetic paste event (never inserted — a script and an onerror in it never run),
// mapped, checked against the pool, «עמום» decided, committed; an .xlsx built here with our own writer, uploaded,
// becoming an archive edition — and «אישור באצווה» of who taught in it; the escorts' file's phrases; a file that is
// not one. Nothing of the paste stays in the browser's storage. Synthetic people and numbers only.
import { expect, type Page, test } from "@playwright/test";
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

const CANDIDATES_HTML = `<html><head><style>td{color:red}</style><script>window.__pwned = 1</script></head><body>
<google-sheets-html-origin><table>
<tr><td>מרצה</td><td>מוסד</td><td>טווח ימים</td><td>העדפה</td><td>חניך/ה</td></tr>
<tr><td>הרב מרצה לבדיקה 1<img src="x" onerror="window.__pwned = 2"></td><td>מוסד לבדיקה</td><td>א-ב</td><td></td><td>חניך/ה לבדיקה</td></tr>
<tr><td>הרבנית מרצה לבדיקה 2</td><td></td><td>נסגר</td><td></td><td></td></tr>
<tr><td>מרצה-07</td><td>מוסד אחר</td><td></td><td></td><td></td></tr>
<tr><td>מרצה 07ב</td><td></td><td></td><td></td><td></td></tr>
<tr><td></td><td>שורה בלי שם</td><td></td><td></td><td></td></tr>
</table></google-sheets-html-origin></body></html>`;

test.describe("demo build — the import of 5786", () => {
  test("candidates: a pasted table, mapped, checked, «עמום» decided, committed — and nothing of it kept", async ({ page }) => {
    await page.goto(`${demoUrl()}/settings/import`);
    await expect(page.getByRole("tab", { name: "ייבוא" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("radio", { name: "המועמדים (רשימת המרצים מהסיעור)" }).check();
    await paste(page, CANDIDATES_HTML, "plain text that must not be read");
    await expect(page.getByText(/5 שורות ו-5 עמודות מהדבקה/)).toBeVisible();
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
    await expect(page.getByText("מרצה אחד/ת «עמום/ה» מחכה להחלטה")).toBeVisible();
    await expect(page.getByRole("button", { name: "ייבוא", exact: true })).toBeDisabled();
    await noSidewaysScroll(page);

    await row(5).getByRole("radio", { name: /להשלים את .*מרצה 07/ }).check();
    await expect(row(5)).toContainText("אין מה להשלים");
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(toast(page, "הייבוא נשמר")).toBeVisible();
    await expect(page.getByText("נוספו 2 מרצים למאגר (ממתינים לאישור) · 2 כבר במאגר")).toBeVisible();
    await expect(page.getByRole("list", { name: "תצוגה מקדימה" })).toHaveCount(0); // the rows went with the commit
    await noSidewaysScroll(page);

    // nothing of the paste in the browser's storage
    const stored = await page.evaluate(async () => {
      const dbs = (await indexedDB.databases?.()) ?? [];
      return JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, dbs: dbs.map((d) => d.name) });
    });
    expect(stored).not.toContain("מרצה לבדיקה");
    expect(stored).not.toContain("טווח ימים");

    // the new speakers wait for approval
    await page.getByRole("banner").getByRole("link", { name: /אישורים/ }).click();
    const pending = page.getByRole("list", { name: "ממתינים לאישור" });
    await expect(pending.getByText("הרב מרצה לבדיקה 1")).toBeVisible();
    await expect(pending.getByText("הרבנית מרצה לבדיקה 2")).toBeVisible();
  });

  test("the tracking sheet: an .xlsx made here, «כפולה» decided, an archive edition — «אישור באצווה» of who taught in it", async ({ page }, info) => {
    const bytes = toXlsx([
      {
        name: "מעקב",
        headers: ["מרצה", "שיעור ב", "כותרת", "מקורות (נשלח?)", "הסעה/תשלום", "טלפון", "קיבל הודעת סיכום מ", "נושא"],
        rows: [
          ["הרב מרצה ארכיון 1", "ראשון 8:30", "שיעור ארכיון א", "כן", "300", "000-000-0003", "חניך/ה לדוגמה 1", "תנ\"ך"],
          ["מרצה ארכיון 2", "ראשון 8:30", "שיעור ארכיון ב", "כן+סרטון", "הסעה הלוך וחזור", "", "", "פילוסופיה"],
          ["מרצה ארכיון 3", "שני 10:00 כפולה", "שיעור ארכיון ג", "להדפיס לפני", "", "", "", ""],
          ["מרצה ארכיון 4", "שני 10:00 כפולה", "שיעור ארכיון ד", "", "", "", "", ""],
          ["מרצה ארכיון 5", "שישי 8:30", "שיעור בשישי", "", "", "", "", ""],
        ],
      },
    ]);
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "גיליון המעקב של אשתקד" }).check();
    await page.locator('input[type="file"]').setInputFiles({ name: "מעקב לדוגמה.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) });
    await expect(page.getByText(/5 שורות ו-8 עמודות מקובץ Excel \(מעקב לדוגמה\.xlsx\)/)).toBeVisible();
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
    await expect(page.getByRole("list", { name: "נושאים" }).getByLabel(/תנ"ך/)).not.toHaveValue("");
    await noSidewaysScroll(page);

    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ייבוא" }).click();
    await expect(page.getByText(/4 שיעורים במחזור «תשפ״ו לדוגמה»/)).toBeVisible();

    // the archive is an edition now: in «מחזור»
    await page.getByRole("tab", { name: "מחזור" }).click();
    await expect(page.getByText("תשפ״ו לדוגמה").first()).toBeVisible();

    // the approvals queue: one confirm approves the four who taught in it
    await page.getByRole("banner").getByRole("link", { name: /אישורים/ }).click();
    const batch = page.getByRole("group", { name: "אישור באצווה: מי שלימד/ה ב-תשפ״ו לדוגמה" });
    await expect(batch).toContainText("4 מרצים שממתינים לאישור לימדו שיעור");
    if (info.project.name === "desktop") {
      // «לימד/ה אצלנו» on the sheet shows the archive
      await page.getByRole("list", { name: "ממתינים לאישור" }).getByRole("button", { name: "מרצה ארכיון 2", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "מרצה ארכיון 2" })).toContainText("תשפ״ו לדוגמה");
      await page.keyboard.press("Escape");
    }
    await batch.getByRole("button", { name: "אישור 4 מרצים שלימדו ב-תשפ״ו לדוגמה" }).click();
    await batch.getByRole("button", { name: "אישור 4 מרצים" }).click();
    await expect(toast(page, "4 מרצים אושרו")).toBeVisible();
    await expect(page.getByRole("list", { name: "ממתינים לאישור" }).getByText("מרצה ארכיון 2")).toHaveCount(0);
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
    await expect(page.getByText("מרצה אחד/ת כבר במאגר · 1 הושלמו בפרטים שהיו חסרים · 1 קיבלו פרטי קשר שהיו חסרים")).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("a file that is not an Office file is refused in Hebrew; nothing is read", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "one width is enough");
    await page.goto(`${demoUrl()}/settings/import`);
    await page.getByRole("radio", { name: "המועמדים (רשימת המרצים מהסיעור)" }).check();
    await page.locator('input[type="file"]').setInputFiles({ name: "לא באמת.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("not a zip at all") });
    await expect(page.getByRole("alert")).toContainText("לא הצלחנו לקרוא את הקובץ");
    await expect(page.getByLabel("הדבקת טבלה")).toBeVisible();
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
    sb.answers.set("import_commit", { created: 1, merged: 0, filled: 0, contacts: 1, lessons: 0, replaced: 0, edition_id: null, speakers: [{ row: 2, speaker_id: 99, created: true }] });
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
