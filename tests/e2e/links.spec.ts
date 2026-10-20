// Links without an account and מכריכה לכריכה (milestone 5a) in a real browser.
// Demo build, every width: an escort's page (their lessons only, no phone in a
// demo week, the four ticks, the pickup address sent and never shown back), a
// bad, a cross-scope and a cut-short link, the token out of the address bar;
// an admin issuing a link in «קישורים» — copied, on WhatsApp, opened in a new
// tab — and the replaced or revoked link refused; the sign-up (a name, a group,
// the same answer every time, never an overwrite) seen and moved by the staff
// in «מכריכה לכריכה»; a group added there with its leaders, a placement and
// the books; the schedule by day, printed; the ticks in the lesson panel and the
// escorts' list. Mock build: the public pages send the publishable key alone —
// never a session, even with a member signed in in the same browser — call only
// the six anon functions, the token in the body and never in a URL; a refusal
// from the server is the one page; «קישורים» and /kk go out by the contract
// with the member's token. Synthetic data only.
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { demoWeek } from "../../src/data/demoWeek";
import type { KkData } from "../../src/data/kk";
import type { EscortView, KkForm, ScheduleView } from "../../src/data/publicPort";
import { addDays, israelDate } from "../../src/domain/israelTime";
import { scheduleEntries } from "../../src/exports/designer";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { MOCK_KEY } from "./global-setup";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });
const hashOf = (page: Page) => new URL(page.url()).hash;
const escortLessons = (page: Page) => page.getByRole("list", { name: "השיעורים שלי" }).locator("[data-escort-lesson]");
const invalid = (page: Page) => page.getByRole("heading", { name: "הקישור לא בתוקף" });

/** The demo's links issued in advance (src/data/demoLinks.ts demoToken(…, true)). */
const SEEDED = { escort: (r: number) => `demo-e-1-${r}-dugma00000`, kk: "demo-k-1-0-dugma00000", schedule: "demo-s-1-0-dugma00000" };

/** A closed lesson's panel: on a phone or a tablet, its day first. */
async function openLesson(page: Page, info: TestInfo, day: string, speaker: string): Promise<Locator> {
  if (info.project.name !== "desktop") await page.getByRole("tab", { name: day }).click();
  await page.locator("[data-lesson-id]").filter({ hasText: speaker }).first().click();
  const panel = page.getByRole("dialog", { name: "שיעור סגור" });
  await expect(panel).toBeVisible();
  return panel;
}

async function stage(panel: Locator, name: string): Promise<Locator> {
  const s = panel.getByRole("region", { name, exact: true });
  const toggle = s.getByRole("button", { name: new RegExp(`^${name}`) });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return s;
}

test.describe("demo build", () => {
  test("an escort's page: their own lessons, no phone in a demo week, the four ticks; the token leaves the address bar", async ({ page }) => {
    await page.goto(`${demoUrl()}/e#${SEEDED.escort(2)}`);
    await expect(page.getByRole("heading", { name: "שלום, מלווה לדוגמה ב׳" })).toBeVisible();
    expect(page.url()).toBe(`${demoUrl()}/e`); // read, then out of the address bar
    expect(hashOf(page)).toBe("");
    await expect(page.getByRole("status").first()).toContainText("מצב הדגמה");
    await expect(page.getByRole("navigation", { name: "אזורי המערכת" })).toHaveCount(0); // no team navigation, nobody signed in
    const lessons = escortLessons(page);
    await expect(lessons).toHaveCount(2); // מלווה ב׳ escorts two; nobody else's
    await expect(lessons.first()).toContainText("ראשון 10:00–11:15");
    await expect(lessons.first()).toContainText("התאריך TBD · בית מדרש");
    await expect(lessons.first()).toContainText("פרופ׳ מרצה 03");
    await expect(lessons.first()).toContainText("הצגה על ידי המלווה — מציג את המרצה");
    await expect(page.getByText("הטלפון של כל מרצה יופיע כאן שבוע לפני השבוע, אחרי שייקבע לו תאריך.")).toBeVisible();
    await expect(page.getByText("טלפון המרצה")).toHaveCount(0);
    await expect(page.getByText("טלפון לדוגמה")).toHaveCount(0);
    await expect(page.getByRole("form", { name: "כתובת איסוף" })).toHaveCount(0); // no transport approved for these
    await noSidewaysScroll(page);

    // a tick keeps its time; unticked, it is gone
    const gift = lessons.first().getByRole("checkbox", { name: /^נתתי מתנה/ });
    await gift.check();
    await expect(gift).toBeChecked();
    await expect(lessons.first().getByText(/^סומן ב-\d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}$/)).toBeVisible();
    await gift.uncheck();
    await expect(gift).not.toBeChecked();
    await expect(lessons.first().getByText(/^סומן ב-/)).toHaveCount(0);

    // another link in the same tab, only the hash changing: read afresh, and out of the address bar again
    await page.goto(`${demoUrl()}/e#${SEEDED.escort(1)}`);
    await expect(page.getByRole("heading", { name: "שלום, מלווה לדוגמה א׳" })).toBeVisible();
    expect(hashOf(page)).toBe("");

    // a reload: the token is no longer in the address — the page says to open the link again
    await page.reload();
    await expect(page.getByRole("heading", { name: "הקישור לא שלם" })).toBeVisible();
  });

  test("the pickup address: offered where transport was approved, sent to the team, never shown back", async ({ page }) => {
    await page.goto(`${demoUrl()}/e#${SEEDED.escort(1)}`);
    const l = escortLessons(page).first();
    await expect(l).toContainText("פתיחת השבוע (לדוגמה)");
    await expect(l.getByRole("checkbox", { name: /^הזכרתי למרצה/ })).toBeChecked(); // the demo's ticks
    await expect(l.getByRole("checkbox", { name: /^פגשתי בחניה/ })).toBeChecked();
    const pickup = l.getByRole("form", { name: "כתובת איסוף" });
    await expect(pickup.getByLabel("כתובת איסוף למרצה")).toHaveValue(""); // what is stored is never read back
    await pickup.getByRole("button", { name: "שליחה לצוות" }).click();
    await expect(pickup.getByRole("alert")).toHaveText("צריך לכתוב כתובת.");
    await pickup.getByLabel("כתובת איסוף למרצה").fill("כתובת חדשה לדוגמה");
    await pickup.getByRole("button", { name: "שליחה לצוות" }).click();
    await expect(pickup.getByRole("status")).toHaveText("הכתובת נשלחה לצוות. היא לא מוצגת כאן, כדי לשמור על פרטיות המרצה.");
    await expect(pickup.getByLabel("כתובת איסוף למרצה")).toHaveValue("");
    await page.getByRole("button", { name: "טעינה מחדש" }).click();
    await expect(page.getByText("כתובת חדשה לדוגמה")).toHaveCount(0);
    await expect(page.getByText("כתובת לדוגמה")).toHaveCount(0);
    await expect(page.getByText("נהג/ת")).toHaveCount(0); // a demo week shows no driver
    await noSidewaysScroll(page);
  });

  test("a wrong link, a link of another kind, a link cut short: one page each, nothing else told", async ({ page }) => {
    await page.goto(`${demoUrl()}/e#not-a-real-link-0000000`);
    await expect(invalid(page)).toBeVisible();
    await expect(page.getByText("הקישור לא בתוקף: אולי פג תוקפו, בוטל או הוחלף בקישור חדש.")).toBeVisible();
    expect(hashOf(page)).toBe("");
    await page.goto(`${demoUrl()}/k#${SEEDED.escort(2)}`); // an escort's link on the sign-up page
    await expect(invalid(page)).toBeVisible();
    await page.goto(`${demoUrl()}/s#${SEEDED.kk}`);
    await expect(invalid(page)).toBeVisible();
    await page.goto(`${demoUrl()}/s`);
    await expect(page.getByRole("heading", { name: "הקישור לא שלם" })).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("«קישורים»: an admin issues a link — shown once, copied, on WhatsApp, opened in a new tab; the replaced and the revoked ones stop", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`${demoUrl()}/settings/links`);
    await expect(page.getByRole("tab", { name: "קישורים" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("בתוקף עד").first()).toBeVisible();
    await noSidewaysScroll(page);

    // replace מלווה ב׳'s link: asked first, then a new token, once
    await page.getByRole("button", { name: "קישור חדש: מלווה לדוגמה ב׳" }).click();
    await expect(page.getByText("הקישור הקיים של מלווה לדוגמה ב׳ יפסיק לעבוד מיד")).toBeVisible();
    await page.getByRole("button", { name: "קישור חדש במקומו" }).click();
    const box = page.getByRole("region", { name: "הקישור החדש" });
    await expect(box).toContainText("הקישור החדש: מלווה לדוגמה ב׳");
    await expect(box).toContainText("הקישור מוצג רק עכשיו.");
    const url = await box.getByLabel("הקישור").inputValue();
    expect(url).toMatch(new RegExp(`^${demoUrl().replace(/[.]/g, "\\.")}/e#demo-e-1-2-[A-Za-z0-9_-]{10}$`));
    const token = url.split("#")[1];
    await expect(box.getByRole("link", { name: "שליחה ב-WhatsApp" })).toHaveAttribute(
      "href",
      `https://wa.me/?text=${encodeURIComponent(`שבוע וולוז'ין הדגמה — הדף שלך כמלווה:\n${url}`)}`,
    );
    await box.getByRole("button", { name: "העתקה" }).click();
    await expect(toast(page, "הקישור הועתק")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    await noSidewaysScroll(page);

    // opened in a new tab: the escort's page, the token out of its address bar
    const [tab] = await Promise.all([page.waitForEvent("popup"), box.getByRole("link", { name: "פתיחה" }).click()]);
    await expect(tab.getByRole("heading", { name: "שלום, מלווה לדוגמה ב׳" })).toBeVisible();
    expect(hashOf(tab)).toBe("");
    await expect(escortLessons(tab)).toHaveCount(2);
    await tab.close();

    // closed, the token is nowhere on the page
    await box.getByRole("button", { name: "סגירה" }).click();
    await expect(box).toHaveCount(0);
    expect(await page.content()).not.toContain(token);

    // revoke the sign-up link: asked first
    await page.getByRole("button", { name: "ביטול הקישור: הרשמה למכריכה לכריכה" }).click();
    await page.getByRole("button", { name: "ביטול הקישור", exact: true }).click();
    await expect(toast(page, "הקישור בוטל. הוא כבר לא נפתח.")).toBeVisible();
    await expect(page.getByRole("button", { name: "הנפקת קישור: הרשמה למכריכה לכריכה" })).toBeVisible();

    // the replaced link (opened in this tab, on the same demo) and the revoked one: the one refusal
    await page.getByRole("link", { name: "הדף של מלווה לדוגמה ב׳" }).click();
    await expect(invalid(page)).toBeVisible();
    expect(hashOf(page)).toBe("");
    await page.goBack();
    await page.getByRole("link", { name: "טופס ההרשמה למכריכה לכריכה" }).click();
    await expect(invalid(page)).toBeVisible();
  });

  test("the sign-up: a name and a group, the same answer every time, never an overwrite; the staff see it, move it, remove it", async ({ page }) => {
    await page.goto(`${demoUrl()}/settings/links`);
    await page.getByRole("link", { name: "טופס ההרשמה למכריכה לכריכה" }).click();
    await expect(page.getByRole("heading", { name: "הרשמה למכריכה לכריכה" })).toBeVisible();
    expect(hashOf(page)).toBe("");
    await expect(page.getByText(/^ההרשמה פתוחה עד \d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}\.$/)).toBeVisible();
    await expect(page.getByText("ספר לדוגמה ג׳")).toHaveCount(0); // no capacity entered: not on offer
    await noSidewaysScroll(page);

    const form = page.getByRole("form", { name: "הרשמה" });
    await expect(form.getByRole("group", { name: "ראשון 21:30–22:30" })).toBeVisible();
    await form.getByRole("button", { name: "הרשמה" }).click();
    await expect(form.getByRole("alert")).toHaveText("צריך לבחור את השם שלך מהרשימה.");
    await form.getByLabel("השם שלי").selectOption({ label: "מלווה לדוגמה ד׳" });
    await form.getByRole("radio", { name: /^ספר לדוגמה ב׳/ }).check();
    await form.getByRole("button", { name: "הרשמה" }).click();
    const done = page.getByRole("status", { name: "ההרשמה נשלחה" });
    await expect(done).toContainText("נקלט — אם יש בעיה, הצוות יחזור אליך.");
    await expect(done).toContainText("מלווה לדוגמה ד׳: ראשון 21:30–22:30 — ספר לדוגמה ב׳");
    const answer = await done.locator("p").first().textContent();

    // the same name again, another group: the very same answer — and nothing changes (the staff decide)
    await done.getByRole("button", { name: "הרשמה של שם נוסף" }).click();
    await form.getByLabel("השם שלי").selectOption({ label: "מלווה לדוגמה ד׳" });
    await form.getByRole("radio", { name: /^ספר לדוגמה א׳/ }).check();
    await form.getByRole("button", { name: "הרשמה" }).click();
    await expect(done.locator("p").first()).toHaveText(answer!);
    // a name the staff placed already: the same answer again
    await done.getByRole("button", { name: "הרשמה של שם נוסף" }).click();
    await form.getByLabel("השם שלי").selectOption({ label: "מלווה לדוגמה ג׳" });
    await form.getByRole("radio", { name: /^ספר לדוגמה ב׳/ }).check();
    await form.getByRole("button", { name: "הרשמה" }).click();
    await expect(done.locator("p").first()).toHaveText(answer!);

    // the staff's screen, in this tab (the same demo)
    await page.goBack();
    await nav(page).getByRole("link", { name: "מכריכה לכריכה" }).click();
    await expect(page.getByRole("heading", { name: "מכריכה לכריכה" })).toBeVisible();
    const sunday = page.getByRole("region", { name: "ראשון 21:30–22:30" });
    const a = sunday.getByRole("article", { name: "ספר לדוגמה א׳" });
    const b = sunday.getByRole("article", { name: "ספר לדוגמה ב׳" });
    await expect(b.locator("[data-kk-count]")).toHaveText("נרשמו 2 מתוך 4");
    await expect(b.getByRole("list", { name: "הנרשמים · ספר לדוגמה ב׳" })).toContainText("מלווה לדוגמה ד׳ · בקישור");
    await expect(a.locator("[data-kk-count]")).toHaveText("נרשמו 2 מתוך 6"); // ד׳ is not here, ג׳ stayed where the staff put them
    await expect(a.getByRole("list", { name: "הנרשמים · ספר לדוגמה א׳" })).toContainText("מלווה לדוגמה ג׳ · שובץ/ה בידי הצוות");
    await noSidewaysScroll(page);

    // the staff move ד׳, then remove them
    await b.getByLabel("העברה של מלווה לדוגמה ד׳ לקבוצה אחרת").selectOption({ label: "העברה ל: ספר לדוגמה א׳" });
    await expect(toast(page, "ההרשמה הועברה")).toBeVisible();
    await expect(a.locator("[data-kk-count]")).toHaveText("נרשמו 3 מתוך 6");
    await expect(b.locator("[data-kk-count]")).toHaveText("נרשמו 1 מתוך 4");
    await expect(a.getByRole("list", { name: "הנרשמים · ספר לדוגמה א׳" })).toContainText("מלווה לדוגמה ד׳ · שובץ/ה בידי הצוות");
    await a.getByRole("button", { name: "הסרה: מלווה לדוגמה ד׳" }).click();
    await a.getByRole("button", { name: "הסרה", exact: true }).click();
    await expect(toast(page, "ההרשמה הוסרה")).toBeVisible();
    await expect(a.locator("[data-kk-count]")).toHaveText("נרשמו 2 מתוך 6");
    await sunday.getByText("עוד לא נרשמו (3)").click();
    await expect(sunday.getByRole("list", { name: "עוד לא נרשמו · ראשון 21:30–22:30" })).toContainText("מלווה לדוגמה ד׳");
  });

  test("«מכריכה לכריכה»: a group as the admin types it — leaders, a capacity — a placement, the books; a group with sign-ups is not deleted", async ({ page }) => {
    await page.goto(`${demoUrl()}/kk`);
    await expect(page.getByRole("region", { name: "חלון ההרשמה" })).toContainText("פתוחה עכשיו");
    const monday = page.getByRole("region", { name: "שני 21:30–22:30" });
    await expect(monday).toContainText("אין קבוצות");
    await monday.getByRole("button", { name: "קבוצה חדשה: שני 21:30–22:30" }).click();
    const form = monday.getByRole("form", { name: "קבוצה חדשה · שני 21:30–22:30" });
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(form.getByRole("alert")).toHaveText("צריך לכתוב כותרת.");
    await form.getByLabel("שם הספר").fill("ספר חדש לדוגמה");
    await form.getByLabel("מחבר/ת (לא חובה)").fill("מחבר/ת לדוגמה");
    await form.getByLabel("חדר (לא חובה)").selectOption({ label: "כיתה ג׳" });
    await form.getByLabel("תפוסה").fill("2");
    await form.getByLabel("מרשימת החניכים").selectOption({ label: "מלווה לדוגמה ה׳" });
    await form.getByRole("button", { name: "הוספת מוביל/ה" }).click();
    await form.getByLabel("מוביל/ה", { exact: true }).selectOption({ label: "מעין פרת" });
    await form.getByLabel("שם", { exact: true }).fill("מוביל/ה לדוגמה");
    await form.getByRole("button", { name: "הוספת מוביל/ה" }).click();
    await expect(form.getByRole("list", { name: "המובילים" }).getByRole("listitem")).toHaveCount(2);
    await noSidewaysScroll(page);
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "הקבוצה נוספה")).toBeVisible();
    const g = monday.getByRole("article", { name: "ספר חדש לדוגמה" });
    await expect(g).toContainText("ספר חדש לדוגמה — מחבר/ת לדוגמה");
    await expect(g).toContainText("כיתה ג׳ · מובילים: מלווה לדוגמה ה׳ (חניך/ה), מוביל/ה לדוגמה (מעין פרת)");
    await expect(g.locator("[data-kk-count]")).toHaveText("נרשמו 0 מתוך 2");

    // a placement by the staff, from «עוד לא נרשמו»
    await monday.getByText("עוד לא נרשמו (6)").click();
    const place = monday.getByRole("form", { name: "שיבוץ · שני 21:30–22:30" });
    await place.getByLabel("חניך/ה").selectOption({ label: "מלווה לדוגמה א׳" });
    await place.getByLabel("לקבוצה").selectOption({ label: "ספר חדש לדוגמה" });
    await place.getByRole("button", { name: "שיבוץ" }).click();
    await expect(toast(page, "שובץ/ה")).toBeVisible();
    await expect(g.locator("[data-kk-count]")).toHaveText("נרשמו 1 מתוך 2");
    await expect(monday.getByText("עוד לא נרשמו (5)")).toBeVisible();

    // the books to order: nothing filled in for the admin; the count they type, ordered
    const books = g.getByRole("form", { name: "ספרים · ספר חדש לדוגמה" });
    await expect(books.getByLabel("עותקים להזמנה")).toHaveValue("");
    await expect(books).toContainText("נרשמו 1 · מובילים 2");
    await books.getByLabel("עותקים להזמנה").fill("3");
    await books.getByRole("checkbox", { name: /^הוזמן/ }).check();
    await books.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "הזמנת הספרים נשמרה")).toBeVisible();
    await expect(books.getByLabel("עותקים להזמנה")).toHaveValue("3");
    await expect(books.getByRole("checkbox", { name: /^הוזמן/ })).toBeChecked();

    // a group with someone in it is not deleted
    await g.getByRole("button", { name: "מחיקה: ספר חדש לדוגמה" }).click();
    await g.getByRole("button", { name: "מחיקה", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "יש נרשמים לקבוצה הזו" })).toBeVisible();
    await expect(g).toBeVisible();

    // the window: closed by the admin, then the public form says so
    await page.getByRole("button", { name: "בלי חלון (ההרשמה סגורה)" }).click();
    await expect(toast(page, "ההרשמה סגורה: אין חלון")).toBeVisible();
    await expect(page.getByRole("region", { name: "חלון ההרשמה" })).toContainText("ההרשמה עוד לא נפתחה.");
    await noSidewaysScroll(page);
  });

  test("the schedule to view: by day, the public facts only, printable on A4", async ({ page }, info) => {
    const entries = scheduleEntries(demoWeek());
    await page.goto(`${demoUrl()}/s#${SEEDED.schedule}`);
    await expect(page.getByRole("heading", { name: 'לו"ז שבוע וולוז\'ין הדגמה' })).toBeVisible();
    expect(hashOf(page)).toBe("");
    await expect(page.locator("[data-schedule-row]")).toHaveCount(entries.length);
    await expect(page.getByRole("region", { name: "יום ראשון" }).locator("[data-schedule-row]").first()).toContainText("08:30–09:45");
    await expect(page.getByText("במקביל").first()).toBeVisible();
    const text = await page.locator("main").innerText();
    for (const secret of ["טלפון לדוגמה", "example.org", "₪", "כתובת לדוגמה", "להגיע רבע שעה", "לבדוק שוב את הסכום"]) expect(text).not.toContain(secret);
    await noSidewaysScroll(page);

    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("banner")).toBeHidden();
    await expect(page.getByRole("button", { name: "הדפסה" })).toBeHidden();
    await expect(page.getByText("מדיניות פרטיות")).toBeHidden();
    await expect(page.getByText('לו"ז שבוע וולוז\'ין הדגמה').first()).toBeVisible(); // the printed page's title
    if (info.project.name === "desktop") {
      const pdf = (await page.pdf({ preferCSSPageSize: true })).toString("latin1");
      const box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(pdf)!;
      expect(Math.abs(Number(box[1]) - 595.3)).toBeLessThan(3); // A4 portrait
      expect(Math.abs(Number(box[2]) - 841.9)).toBeLessThan(3);
    }
    await page.emulateMedia({ media: "screen" });
  });

  test("the ticks reach the team: the escorts' list and the lesson panel", async ({ page }, info) => {
    await page.goto(`${demoUrl()}/print/escorts`);
    const a = page.getByRole("region", { name: "מלווה לדוגמה א׳" });
    const ticks = a.getByRole("list", { name: "הסימונים של המלווה" });
    await expect(ticks.locator('[data-done="true"]')).toHaveCount(2); // the demo's: reminded, met
    await expect(ticks.locator('[data-tick="reminded"]')).toContainText("✓ תזכורת למרצה");
    await expect(ticks.locator('[data-tick="gift"]')).toContainText("○ מתנה");
    await page.emulateMedia({ media: "print" });
    await expect(ticks).toBeHidden(); // the printed list is the escort's
    await page.emulateMedia({ media: "screen" });

    // מלווה ב׳ ticks «נתתי מתנה» through their link, in this tab
    await page.goto(`${demoUrl()}/settings/links`);
    await page.getByRole("link", { name: "הדף של מלווה לדוגמה ב׳" }).click();
    await escortLessons(page).first().getByRole("checkbox", { name: /^נתתי מתנה/ }).check();
    await expect(escortLessons(page).first().getByText(/^סומן ב-/)).toBeVisible();
    await page.goBack();
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    const panel = await openLesson(page, info, "ראשון", "מרצה 03");
    const escort = await stage(panel, "מלווה");
    const line = escort.getByRole("list", { name: "הסימונים של המלווה" });
    await expect(line.locator('[data-tick="gift"]')).toHaveAttribute("data-done", "true");
    await expect(line.locator('[data-tick="reminded"]')).toHaveAttribute("data-done", "false");
    await noSidewaysScroll(page);
  });
});

test.describe("mock build", () => {
  const TOKEN = "Tk9fUkVBTF9UT0tFTl9YWQ"; // 22 characters, synthetic
  const today = israelDate(new Date().toISOString());
  const start = addDays(today, 3); // the week opens in three days: past W−7
  const edition = { label: "מחזור לדוגמה", start_date: start };
  const escortView: EscortView = {
    edition,
    escort: { full_name: "מלווה לדוגמה", gender: "f" },
    phones_from: addDays(start, -7),
    lessons: [
      {
        lesson_id: 41, kind: "lesson", day: 1, date: addDays(start, 1), start_min: 1200, end_min: 1275, room: "חדר לדוגמה",
        speaker: { name: "ד״ר מרצה לדוגמה", gender: "f" }, title: "כותרת לדוגמה", self_intro: false, duty_notes: ["ניסוח לדוגמה"],
        escort_note: "הערה לדוגמה", phone: "טלפון לדוגמה מהשרת", transport: true, driver: { name: "נהג/ת לדוגמה", phone: "טלפון נהג/ת לדוגמה" },
        ticks: { reminded: null, met: null, introduced: null, gift: null },
      },
    ],
  };
  const kkForm: KkForm = {
    edition,
    window: { opens_at: new Date(Date.now() - 86_400_000).toISOString(), closes_at: new Date(Date.now() + 7 * 86_400_000).toISOString() },
    open: true,
    roster: [
      { id: 11, full_name: "חניך/ה לדוגמה א׳" },
      { id: 12, full_name: "חניך/ה לדוגמה ב׳" },
    ],
    tracks: [
      {
        id: 3, day: 0, date: start, start_min: 1290, end_min: 1350,
        groups: [
          { id: 21, title: "ספר לדוגמה", author: null, room: "חדר לדוגמה", leaders: [{ kind: "staff", name: "מוביל/ה לדוגמה" }], full: false },
          { id: 22, title: "ספר מלא לדוגמה", author: "מחבר/ת לדוגמה", room: null, leaders: [], full: true },
        ],
      },
    ],
  };
  const scheduleView: ScheduleView = {
    edition,
    rows: [
      { kind: "lesson", day: 0, date: start, start_min: 510, end_min: 585, speaker: "ד״ר מרצה לדוגמה", title: "כותרת לדוגמה", category: "קטגוריה לדוגמה", room: "חדר לדוגמה", parallel: false },
      { kind: "memorial", day: 0, date: start, start_min: 780, end_min: 795, speaker: "", title: null, category: "", room: "חדר לדוגמה", parallel: false },
    ],
  };
  const ANON = ["escort_view", "escort_tick", "escort_pickup", "kk_form", "kk_signup", "schedule_view"].map((f) => `/rest/v1/rpc/${f}`);

  /** Every call: an anon function, POSTed with the publishable key and no Authorization, the token never in the URL. */
  const anonOnly = (sb: FakeSupabase) => {
    expect(sb.calls.length).toBeGreaterThan(0);
    for (const c of sb.calls) {
      expect(ANON, c.path).toContain(c.path);
      expect(c.method, c.path).toBe("POST");
      expect(c.auth, c.path).toBeUndefined();
      expect(c.apikey, c.path).toBe(MOCK_KEY);
      expect(c.url, c.path).not.toContain(TOKEN);
      expect([...c.query.keys()], c.path).toEqual([]);
    }
  };

  test("the public pages carry the publishable key alone — never the session of a member signed in in this browser — and call only the anon functions", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const sb = new FakeSupabase();
    sb.answers.set("escort_view", escortView);
    sb.answers.set("escort_tick", { reminded: new Date().toISOString(), met: null, introduced: null, gift: null });
    sb.answers.set("escort_pickup", null);
    sb.answers.set("kk_form", kkForm);
    sb.answers.set("kk_signup", { status: "received" });
    sb.answers.set("schedule_view", scheduleView);
    await sb.attach(page);
    await signIn(page); // a team member's session sits in this browser's storage

    // the escort's page: what the server sent — the phone (past W−7) and the driver — and the ticks and the address by the contract
    await page.goto(`${mockUrl()}/e#${TOKEN}`);
    await expect(page.getByRole("heading", { name: "שלום, מלווה לדוגמה" })).toBeVisible();
    expect(hashOf(page)).toBe("");
    const l = escortLessons(page).first();
    await expect(l).toContainText("טלפון המרצה");
    await expect(l).toContainText("טלפון לדוגמה מהשרת");
    await expect(l).toContainText("נהג/ת לדוגמה · טלפון נהג/ת לדוגמה");
    await expect(l).toContainText("ניסוח לדוגמה");
    await expect(l).toContainText("הערה לדוגמה");
    await expect(page.getByText("הטלפון של כל מרצה יופיע כאן")).toHaveCount(0);
    await l.getByRole("checkbox", { name: /^הזכרתי למרצה/ }).check();
    await expect(l.getByRole("checkbox", { name: /^הזכרתי למרצה/ })).toBeChecked();
    await l.getByLabel("כתובת איסוף למרצה").fill("  כתובת לדוגמה  ");
    await l.getByRole("button", { name: "שליחה לצוות" }).click();
    await expect(l.getByRole("status")).toContainText("הכתובת נשלחה לצוות");
    expect(sb.rpc.get("escort_view")).toEqual([{ p_token: TOKEN }]);
    expect(sb.rpc.get("escort_tick")).toEqual([{ p_token: TOKEN, p_lesson: 41, p_item: "reminded", p_on: true }]);
    expect(sb.rpc.get("escort_pickup")).toEqual([{ p_token: TOKEN, p_lesson: 41, p_address: "  כתובת לדוגמה  " }]);

    // the sign-up: one call per track chosen, the same answer
    await page.goto(`${mockUrl()}/k#${TOKEN}`);
    const form = page.getByRole("form", { name: "הרשמה" });
    await expect(form.getByRole("radio", { name: /^ספר מלא לדוגמה/ })).toBeDisabled();
    await expect(form).toContainText("מלאה");
    await form.getByLabel("השם שלי").selectOption({ label: "חניך/ה לדוגמה ב׳" });
    await form.getByRole("radio", { name: /^ספר לדוגמה/ }).first().check();
    await form.getByRole("button", { name: "הרשמה" }).click();
    await expect(page.getByRole("status", { name: "ההרשמה נשלחה" })).toContainText("נקלט — אם יש בעיה, הצוות יחזור אליך.");
    expect(sb.rpc.get("kk_signup")).toEqual([{ p_token: TOKEN, p_roster: 12, p_group: 21 }]);

    // the schedule
    await page.goto(`${mockUrl()}/s#${TOKEN}`);
    await expect(page.locator("[data-schedule-row]")).toHaveCount(2);
    await expect(page.locator("[data-schedule-row]").nth(1)).toContainText("זמן זיכרון");
    expect(sb.rpc.get("schedule_view")).toEqual([{ p_token: TOKEN }]);

    anonOnly(sb); // no whoami, no /auth/v1, no table, no session
  });

  test("whatever the reason — expired, revoked, replaced, wrong — the server's one refusal is one page", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const sb = new FakeSupabase();
    await sb.attach(page);
    await page.route(
      (u) => ANON.includes(u.pathname),
      (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "link_invalid", details: null, hint: null }) }),
    );
    for (const p of ["e", "k", "s"]) {
      await page.goto(`${mockUrl()}/${p}#${TOKEN}`);
      await expect(invalid(page)).toBeVisible();
      await expect(page.getByText("הקישור לא בתוקף: אולי פג תוקפו, בוטל או הוחלף בקישור חדש.")).toBeVisible();
      expect(hashOf(page)).toBe("");
    }
    // the network, not the link: try again, the token still in memory
    await page.unrouteAll();
    await sb.attach(page);
    let first = true;
    await page.route(
      (u) => u.pathname === "/rest/v1/rpc/schedule_view",
      (route) => {
        if (first) {
          first = false;
          return route.fulfill({ status: 503, contentType: "text/html", body: "<p>gateway</p>" });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(scheduleView) });
      },
    );
    await page.goto("about:blank"); // a fresh load (the same address but its hash would stay on the page)
    await page.goto(`${mockUrl()}/s#${TOKEN}`);
    await expect(page.getByRole("alert")).toContainText("לא הצלחנו לטעון");
    await page.getByRole("button", { name: "לנסות שוב" }).click();
    await expect(page.locator("[data-schedule-row]")).toHaveCount(2);
  });

  // the team's side: an admin of edition 7, its week the demo's (synthetic)
  const signedIn = async (page: Page) => {
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.kind = "real";
    const sb = new FakeSupabase({
      status: 200,
      body: {
        status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "admin@example.org", display_name: "מדריך/ה לדוגמה", global_admin: true,
        memberships: [{ edition_id: null, role: "admin", member_id: 1 }],
      },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    await sb.attach(page.context()); // a tab the page opens is answered too
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;
    return { sb, week, session };
  };

  test("«קישורים» on the wire: the list never asks for the hash; issue_link and revoke_link with the member's token; the opened link runs as anon", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb, session } = await signedIn(page);
    const later = new Date(Date.now() + 20 * 86_400_000).toISOString();
    sb.tables.set("share_links", [{ id: 5, scope: "escort", subject_id: 1, created_by: 1, created_at: new Date().toISOString(), expires_at: later, revoked_at: null }]);
    sb.answers.set("issue_link", { link_id: 9, token: TOKEN, expires_at: later });
    sb.answers.set("revoke_link", null);
    sb.answers.set("kk_form", kkForm);

    await page.goto(`${mockUrl()}/settings/links`);
    await expect(page.getByRole("button", { name: "ביטול הקישור: מלווה לדוגמה א׳" })).toBeVisible();
    const list = sb.calls.find((c) => c.path === "/rest/v1/share_links")!;
    expect(list.query.get("select")).toBe("id,scope,subject_id,created_by,created_at,expires_at,revoked_at");
    expect(list.query.get("edition_id")).toBe("eq.7");
    expect(list.auth).toBe(`Bearer ${session.access_token}`);

    await page.getByRole("button", { name: "הנפקת קישור: הרשמה למכריכה לכריכה" }).click();
    const box = page.getByRole("region", { name: "הקישור החדש" });
    await expect(box.getByLabel("הקישור")).toHaveValue(`${mockUrl()}/k#${TOKEN}`);
    expect(sb.rpc.get("issue_link")).toEqual([{ p_edition: 7, p_scope: "kk_signup", p_subject: null }]);

    await page.getByRole("button", { name: "ביטול הקישור: מלווה לדוגמה א׳" }).click();
    await page.getByRole("button", { name: "ביטול הקישור", exact: true }).click();
    await expect.poll(() => sb.rpc.get("revoke_link")).toEqual([{ p_link: 5 }]);
    for (const p of ["/rest/v1/rpc/issue_link", "/rest/v1/rpc/revoke_link"]) {
      for (const c of sb.calls.filter((x) => x.path === p)) expect(c.auth, p).toBe(`Bearer ${session.access_token}`);
    }

    // opened in a new tab: the session is in this browser's storage, and still nothing but the anon function goes out
    const before = sb.calls.length;
    const [tab] = await Promise.all([page.waitForEvent("popup"), box.getByRole("link", { name: "פתיחה" }).click()]);
    await expect(tab.getByRole("heading", { name: "הרשמה למכריכה לכריכה" })).toBeVisible();
    expect(hashOf(tab)).toBe("");
    const fromTab = sb.calls.slice(before).filter((c) => ANON.includes(c.path));
    expect(fromTab.map((c) => c.path)).toEqual(["/rest/v1/rpc/kk_form"]);
    for (const c of fromTab) {
      expect(c.auth).toBeUndefined();
      expect(c.apikey).toBe(MOCK_KEY);
    }
    expect(sb.calls.slice(before).filter((c) => c.path.startsWith("/auth/") || c.path === "/rest/v1/rpc/whoami")).toEqual([]);
  });

  test("«מכריכה לכריכה» on the wire: every staff write is its function, by the contract's parameter names, with the member's token", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb, week, session } = await signedIn(page);
    const kk: KkData = {
      tracks: [{ id: 3, day: 0, start_min: 1290, end_min: 1350 }],
      groups: [{ id: 21, track_id: 3, title: "ספר לדוגמה", author: null, room_id: null, capacity: 5, open: true }],
      leaders: [],
      signups: [{ id: 1, track_id: 3, group_id: 21, roster_id: week.roster[0].id, via: "link", created_at: new Date().toISOString() }],
      orders: [],
    };
    sb.answers.set("load_kk", kk);
    for (const f of ["kk_update_group", "kk_place", "kk_unplace", "kk_set_window", "set_book_order"]) sb.answers.set(f, null);
    sb.answers.set("kk_add_group", 22);

    await page.goto(`${mockUrl()}/kk`);
    const sunday = page.getByRole("region", { name: "ראשון 21:30–22:30" });
    await expect(sunday.getByRole("article", { name: "ספר לדוגמה" }).locator("[data-kk-count]")).toHaveText("נרשמו 1 מתוך 5");
    expect(sb.rpc.get("load_kk")?.[0]).toEqual({ p_edition: 7 });

    // the window, in Israel's time
    const win = page.getByRole("form", { name: "חלון ההרשמה" });
    await win.getByLabel("נפתחת (שעון ישראל)").fill("2027-01-10T20:00");
    await win.getByLabel("נסגרת (שעון ישראל)").fill("2027-01-17T20:00");
    await win.getByRole("button", { name: "שמירת החלון" }).click();
    await expect.poll(() => sb.rpc.get("kk_set_window")).toEqual([{ p_edition: 7, p_opens: "2027-01-10T18:00:00.000Z", p_closes: "2027-01-17T18:00:00.000Z" }]);

    // a new group: the fields as typed, nothing added
    await sunday.getByRole("button", { name: "קבוצה חדשה: ראשון 21:30–22:30" }).click();
    const form = sunday.getByRole("form", { name: "קבוצה חדשה · ראשון 21:30–22:30" });
    await form.getByLabel("שם הספר").fill("ספר חדש לדוגמה");
    await form.getByLabel("מוביל/ה", { exact: true }).selectOption({ label: "מהצוות" });
    await form.getByLabel("שם", { exact: true }).fill("מוביל/ה לדוגמה");
    await form.getByRole("button", { name: "הוספת מוביל/ה" }).click();
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("kk_add_group")).toEqual([
      { p_edition: 7, p_day: 0, p_start: 1290, p_fields: { title: "ספר חדש לדוגמה", author: null, room_id: null, capacity: null, open: true, leaders: [{ kind: "staff", label: "מוביל/ה לדוגמה" }] } },
    ]);

    // place, books, remove
    await sunday.getByText(/^עוד לא נרשמו/).click();
    const place = sunday.getByRole("form", { name: "שיבוץ · ראשון 21:30–22:30" });
    await place.getByLabel("חניך/ה").selectOption({ label: week.roster[1].full_name });
    await place.getByLabel("לקבוצה").selectOption({ label: "ספר לדוגמה" });
    await place.getByRole("button", { name: "שיבוץ" }).click();
    await expect.poll(() => sb.rpc.get("kk_place")).toEqual([{ p_group: 21, p_roster: week.roster[1].id }]);
    const books = sunday.getByRole("form", { name: "ספרים · ספר לדוגמה" });
    await books.getByLabel("עותקים להזמנה").fill("5");
    await books.getByRole("checkbox", { name: /^הוזמן/ }).check();
    await books.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("set_book_order")).toEqual([{ p_group: 21, p_copies: 5, p_ordered: true }]);
    const g = sunday.getByRole("article", { name: "ספר לדוגמה" });
    await g.getByRole("button", { name: `הסרה: ${week.roster[0].full_name}` }).click();
    await g.getByRole("button", { name: "הסרה", exact: true }).click();
    await expect.poll(() => sb.rpc.get("kk_unplace")).toEqual([{ p_track: 3, p_roster: week.roster[0].id }]);

    for (const f of ["load_kk", "kk_set_window", "kk_add_group", "kk_place", "set_book_order", "kk_unplace"]) {
      const calls = sb.calls.filter((c) => c.path === `/rest/v1/rpc/${f}`);
      expect(calls.length, f).toBeGreaterThan(0);
      for (const c of calls) expect(c.auth, f).toBe(`Bearer ${session.access_token}`);
    }
  });
});
