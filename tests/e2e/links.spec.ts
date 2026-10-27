// Links without an account and מכריכה לכריכה (milestone 5a; week-long since
// schema v15) in a real browser. Demo build, every width: an escort's page
// (their lessons only, no phone in a demo week, the four ticks, the pickup
// address sent and never shown back), a bad, a cross-scope and a cut-short
// link, the token out of the address bar; an admin issuing a link in
// «קישורים» — copied, on WhatsApp, opened in a new tab — and the replaced or
// revoked link refused; the sign-up (a name — never a leader's — and ONE book
// for the week, the same answer every time, never an overwrite) seen, moved and
// removed by the staff in «מכריכה לכריכה»; there, where the week stands, the
// sessions, a group's leaders before its book (not offered until it has one),
// one place per group, a leader never placed, the books, a group with sign-ups
// not deleted, the window; the schedule by day, printed; the ticks in the lesson
// panel and the escorts' list. Mock build: the public pages send the
// publishable key alone — never a session, even with a member signed in in the
// same browser — call only the six anon functions, the token in the body and
// never in a URL; a refusal from the server is the one page; «קישורים» and /kk
// go out by the contract with the member's token. Synthetic data only.
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
    await expect(page.getByText("הטלפון של כל מרצה יופיע כאן שבוע לפני תחילת שבוע וולוז'ין, אחרי שייקבע לו תאריך.")).toBeVisible();
    await expect(page.getByText("במכשיר משותף: ההיסטוריה של הדפדפן שומרת את הקישור כפי שנפתח, ולכן מוחקים אותו משם.")).toBeVisible();
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
    await expect(page.getByText("ההיסטוריה של הדפדפן שומרת את הכתובת כפי שנפתחה, עם הקוד. במכשיר משותף מוחקים אותה משם.")).toBeVisible();
    await expect(page.getByText(/כדי שלא יישאר בהיסטוריה/)).toHaveCount(0); // never promised: the browser's history keeps what was opened
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
    await expect(page.getByText("אולי פג תוקפו, בוטל או הוחלף בקישור חדש.", { exact: true })).toBeVisible();
    await expect(page.getByText("אחרי סוף השבוע הקישור כבר לא נפתח. אם השבוע עוד לא נגמר, אפשר לבקש קישור חדש מהצוות.")).toBeVisible();
    await expect(page.getByText("אם הקישור עבד עד לפני רגע, אפשר לנסות שוב בעוד כמה דקות.")).toBeVisible();
    expect(hashOf(page)).toBe("");
    await page.goto(`${demoUrl()}/k#${SEEDED.escort(2)}`); // an escort's link on the sign-up page
    await expect(invalid(page)).toBeVisible();
    await expect(page.getByText("ייתכן שההרשמה כבר נסגרה. לשאלות פונים לצוות.")).toBeVisible(); // the hint is the page's, never the token's
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

    // replace מלווה ב׳'s link: asked first («חזרה» backs out, the focus back at the button that asked), then a new token, once
    const replaceB = page.getByRole("button", { name: "קישור חדש: מלווה לדוגמה ב׳" });
    await replaceB.click();
    await expect(page.getByText("הקישור הקיים של מלווה לדוגמה ב׳ יפסיק לעבוד מיד")).toBeVisible();
    await page.getByRole("button", { name: "חזרה" }).press("Enter");
    await expect(replaceB).toBeFocused();
    await replaceB.click();
    await page.getByRole("button", { name: "קישור חדש במקומו" }).click();
    const box = page.getByRole("region", { name: "הקישור החדש: מלווה לדוגמה ב׳" });
    await expect(box).toContainText("הקישור החדש: מלווה לדוגמה ב׳");
    await expect(box).toContainText("הקישור מוצג רק עכשיו.");
    await expect(toast(page, "הקישור הונפק — מעתיקים או שולחים אותו עכשיו.")).toBeVisible();
    await expect(box).toBeInViewport(); // right under its row, brought into view
    await expect(box.getByLabel("הקישור")).toBeFocused();
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

    // the schedule's link, low on the page: its own box, under its own row, in view — and the first one still open
    await page.getByRole("button", { name: 'קישור חדש: הלו"ז' }).click();
    await page.getByRole("button", { name: "קישור חדש במקומו" }).click();
    const second = page.getByRole("region", { name: 'הקישור החדש: הלו"ז' });
    await expect(second).toBeInViewport();
    await expect(second.getByLabel("הקישור")).toBeFocused();
    await expect(box).toHaveCount(1);
    const rowOf = page.getByRole("button", { name: 'ביטול הקישור: הלו"ז' });
    expect((await second.boundingBox())!.y).toBeGreaterThan((await rowOf.boundingBox())!.y);
    await second.getByRole("button", { name: "סגירה" }).click();

    // closed, the token is nowhere on the page
    await box.getByRole("button", { name: "סגירה" }).click();
    await expect(box).toHaveCount(0);
    expect(await page.content()).not.toContain(token);

    // revoke the sign-up link: asked first — «חזרה» backs out (the focus back at the button that asked), «כן, לבטל» revokes
    const revokeKk = page.getByRole("button", { name: "ביטול הקישור: הרשמה למכריכה לכריכה" });
    await revokeKk.click();
    await expect(page.getByRole("button", { name: "חזרה" })).toBeFocused();
    await page.getByRole("button", { name: "חזרה" }).press("Enter");
    await expect(revokeKk).toBeFocused();
    await revokeKk.click();
    await page.getByRole("button", { name: "כן, לבטל את הקישור" }).click();
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

  test("the sign-up: a name — never a leader's — and one book for the week, the same answer every time, never an overwrite; the staff see it, move it, remove it", async ({ page }) => {
    await page.goto(`${demoUrl()}/settings/links`);
    await page.getByRole("link", { name: "טופס ההרשמה למכריכה לכריכה" }).click();
    await expect(page.getByRole("heading", { name: "הרשמה למכריכה לכריכה" })).toBeVisible();
    expect(hashOf(page)).toBe("");
    await expect(page.getByText(/^ההרשמה פתוחה עד \d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}\.$/)).toBeVisible();
    // the sessions are information: every group meets in each
    await page.getByText("נפגשים בכל מפגשי מכריכה לכריכה", { exact: true }).click();
    const sessions = page.getByRole("list", { name: "המפגשים" }).getByRole("listitem");
    await expect(sessions).toHaveCount(8);
    await expect(sessions.first()).toHaveText("ראשון 21:30–22:30");
    await expect(sessions.nth(1)).toHaveText("ליל ראשון–שני 05:00–06:30");
    await expect(sessions.first().locator("bdi")).toHaveText("21:30–22:30");
    await noSidewaysScroll(page);

    // the names: the trainees who lead a group are not among them, and the page says why
    const form = page.getByRole("form", { name: "הרשמה" });
    const names = form.getByLabel("השם שלי");
    await expect(names.locator("option")).toHaveText(["בחירה מהרשימה", "מלווה לדוגמה א׳", "מלווה לדוגמה ב׳", "מלווה לדוגמה ג׳", "מלווה לדוגמה ד׳"]);
    await expect(form.getByText("מי שמעביר/ה קבוצה לא מופיע/ה ברשימה: הם כבר בקבוצה שלהם.")).toBeVisible();
    // one choice: the books on offer — the group still without a book is not one
    const book = form.getByRole("group", { name: "הספר שלי" });
    await expect(book.getByRole("radio")).toHaveCount(3);
    await expect(page.getByText(/עוד לא נבחר ספר/)).toHaveCount(0);
    await expect(book).toContainText("ספר לדוגמה א׳ — מחבר/ת לדוגמה");
    await expect(book).toContainText("הדשא · מעבירים: מלווה לדוגמה ה׳ (חניך/ה), מעביר/ה מהצוות (לדוגמה) (מהצוות)");
    await expect(book).toContainText("הספרייה · מעבירים: מעביר/ה מעין פרת (לדוגמה) (מעין פרת)");

    await form.getByRole("button", { name: "הרשמה" }).click();
    await expect(form.getByRole("alert")).toHaveText("צריך לבחור את השם שלך מהרשימה.");
    await names.selectOption({ label: "מלווה לדוגמה ד׳" });
    await form.getByRole("button", { name: "הרשמה" }).click();
    await expect(form.getByRole("alert")).toHaveText("צריך לבחור ספר.");
    await book.getByRole("radio", { name: /^ספר לדוגמה ב׳/ }).check();
    await expect(form.getByText("מי שכבר נרשם/ה לא יכול/ה לשנות את ההרשמה כאן.")).toBeVisible(); // said before sending
    await expect(form.getByText("בהרשמה נשמרים השם שבחרת והספר. מי נרשם/ה לאיזה ספר רואה רק הצוות.")).toBeVisible();
    await form.getByRole("button", { name: "הרשמה" }).click();
    const done = page.getByRole("status", { name: "הבקשה נשלחה" });
    await expect(done).toContainText("הבקשה נשלחה.");
    await expect(done).toContainText("מה ששלחת: מלווה לדוגמה ד׳ — ספר לדוגמה ב׳");
    await expect(done).toContainText("ההרשמה נקלטת רק אם עוד לא נרשמת לספר השבוע ויש מקום בקבוצה. כדי לבדוק או לשנות — פונים לצוות.");
    await expect(done).not.toContainText("נקלט —"); // never a promise that it was recorded
    const answer = await done.locator("p").first().textContent();

    // the same name again, another book: the very same answer — and nothing changes (one book a week; the staff decide)
    await done.getByRole("button", { name: "הרשמה של שם נוסף" }).click();
    await names.selectOption({ label: "מלווה לדוגמה ד׳" });
    await book.getByRole("radio", { name: /^ספר לדוגמה א׳/ }).check();
    await form.getByRole("button", { name: "הרשמה" }).click();
    await expect(done.locator("p").first()).toHaveText(answer!);
    // a name the staff placed already: the same answer again
    await done.getByRole("button", { name: "הרשמה של שם נוסף" }).click();
    await names.selectOption({ label: "מלווה לדוגמה ג׳" });
    await book.getByRole("radio", { name: /^ספר לדוגמה ב׳/ }).check();
    await form.getByRole("button", { name: "הרשמה" }).click();
    await expect(done.locator("p").first()).toHaveText(answer!);

    // the staff's screen, in this tab (the same demo)
    await page.goBack();
    await nav(page).getByRole("link", { name: "מכריכה לכריכה" }).click();
    await expect(page.getByRole("heading", { name: "מכריכה לכריכה" })).toBeVisible();
    await expect(page.locator('[data-kk-status="signups"]')).toHaveText("נרשמו 4 מתוך 4"); // of those who may: the two leaders are not counted
    const groups = page.getByRole("region", { name: "הקבוצות" });
    const a = groups.getByRole("article", { name: "ספר לדוגמה א׳" });
    const b = groups.getByRole("article", { name: "ספר לדוגמה ב׳" });
    await expect(b.locator("[data-kk-count]")).toHaveText("נרשמו 2 מתוך 4");
    await b.locator("[data-kk-count]").click(); // the names behind their count
    await expect(b.getByRole("list", { name: "הנרשמים · ספר לדוגמה ב׳" })).toContainText("מלווה לדוגמה ד׳ · בקישור");
    await expect(a.locator("[data-kk-count]")).toHaveText("נרשמו 2 מתוך 6"); // ד׳ is not here, ג׳ stayed where the staff put them
    await a.locator("[data-kk-count]").click();
    await expect(a.getByRole("list", { name: "הנרשמים · ספר לדוגמה א׳" })).toContainText("מלווה לדוגמה ג׳ · שובץ/ה בידי הצוות");
    await noSidewaysScroll(page);

    // the staff move ד׳ to another book, then remove them
    await b.getByLabel("העברה של מלווה לדוגמה ד׳ לקבוצה אחרת").selectOption({ label: "העברה ל: ספר לדוגמה א׳" });
    await expect(toast(page, "ההרשמה הועברה")).toBeVisible();
    await expect(a.locator("[data-kk-count]")).toHaveText("נרשמו 3 מתוך 6");
    await expect(b.locator("[data-kk-count]")).toHaveText("נרשמו 1 מתוך 4");
    await expect(a.getByRole("list", { name: "הנרשמים · ספר לדוגמה א׳" })).toContainText("מלווה לדוגמה ד׳ · שובץ/ה בידי הצוות");
    const remove = a.getByRole("button", { name: "הסרה: מלווה לדוגמה ד׳" });
    await remove.click();
    await a.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ביטול", exact: true }).press("Enter"); // cancelled: the focus back at its «הסרה»
    await expect(remove).toBeFocused();
    await remove.click();
    await a.getByRole("group", { name: "אישור" }).getByRole("button", { name: "הסרה", exact: true }).click();
    await expect(toast(page, "ההרשמה הוסרה")).toBeVisible();
    await expect(a.locator("[data-kk-count]")).toHaveText("נרשמו 2 מתוך 6");
    await expect(page.locator('[data-kk-status="signups"]')).toHaveText("נרשמו 3 מתוך 4");

    // ד׳ is «עוד לא נרשמו» again; the trainees who lead are not, and are named apart
    const signup = page.getByRole("region", { name: "ההרשמה", exact: true });
    await expect(signup.locator("[data-kk-missing]")).toHaveText("1");
    await signup.getByText("עוד לא נרשמו", { exact: true }).click();
    await expect(signup.getByRole("list", { name: "עוד לא נרשמו" })).toHaveText("מלווה לדוגמה ד׳");
    await expect(signup.getByText("מעבירים קבוצה (הם כבר בקבוצה שלהם): מלווה לדוגמה ה׳ · מלווה לדוגמה ו׳")).toBeVisible();
    await expect(signup.getByRole("form", { name: "שיבוץ" }).getByLabel("חניך/ה").locator("option")).toHaveText(["בחירה", "מלווה לדוגמה ד׳"]);
  });

  test("«מכריכה לכריכה»: where the week stands; a group's leaders before its book — not offered until it has one; one place per group; a leader is never placed", async ({ page }) => {
    await page.goto(`${demoUrl()}/kk`);
    // where it stands, in the order of the work
    const strip = page.getByRole("list", { name: "איפה זה עומד" }).getByRole("listitem");
    await expect(strip).toHaveText([
      "מעבירים: 4 קבוצות, 3 עם שני מעבירים",
      "ספרים: 3 מתוך 4",
      /^ההרשמה פתוחה עד \d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}$/,
      "נרשמו 3 מתוך 4",
      "ספרים: הוזמנו 0 מתוך 4",
    ]);
    // the sessions, from the grid: every group in each
    const sessions = page.getByRole("region", { name: "המפגשים" });
    await expect(sessions).toContainText("8 מפגשים · כל הקבוצות בכל מפגש");
    await sessions.getByText("הימים והשעות", { exact: true }).click();
    await expect(sessions.getByRole("listitem")).toHaveCount(8);
    await expect(sessions.getByRole("listitem").nth(1)).toHaveText("ליל ראשון–שני 05:00–06:30");
    await expect(sessions.locator("bdi").first()).toHaveText("21:30–22:30"); // the range isolated: never drawn «22:30–21:30»
    // the demo's group still without a book: named by its leaders, not offered, nothing to order
    const groups = page.getByRole("region", { name: "הקבוצות" });
    const waiting = groups.getByRole("article", { name: "עוד לא נבחר ספר · מלווה לדוגמה ו׳ ו-מעביר/ה נוסף/ת מהצוות (לדוגמה)" });
    await expect(waiting).toContainText("עוד אין מרחב · מעבירים: מלווה לדוגמה ו׳ (חניך/ה), מעביר/ה נוסף/ת מהצוות (לדוגמה) (מהצוות)");
    await expect(waiting).toContainText("עוד לא מוצעת בקישור");
    await expect(waiting.getByText(/^ספרים:/)).toHaveCount(0);
    await noSidewaysScroll(page);

    // the one trainee still to sign up, picked to be placed (not sent yet)
    const signup = page.getByRole("region", { name: "ההרשמה", exact: true });
    await expect(signup.locator("[data-kk-missing]")).toHaveText("1");
    await signup.getByText("עוד לא נרשמו", { exact: true }).click();
    const place = signup.getByRole("form", { name: "שיבוץ" });
    await place.getByLabel("חניך/ה").selectOption({ label: "מלווה לדוגמה ד׳" });
    await place.getByLabel("לקבוצה").selectOption({ label: "ספר לדוגמה ג׳" });

    // a new group: its leaders first, no book — a trainee who leads elsewhere is not offered
    const add = groups.getByRole("button", { name: "+ קבוצה" });
    await add.click();
    const form = groups.getByRole("form", { name: "קבוצה חדשה" });
    await expect(form.getByLabel("מרשימת החניכים").locator("option")).toHaveText(["בחירה", "מלווה לדוגמה א׳", "מלווה לדוגמה ב׳", "מלווה לדוגמה ג׳", "מלווה לדוגמה ד׳"]);
    await expect(form.locator("datalist option")).toHaveCount(3); // the edition's rooms, only suggested
    await form.getByLabel("מרשימת החניכים").selectOption({ label: "מלווה לדוגמה ד׳" });
    await form.getByRole("button", { name: "הוספת מעביר/ה" }).click();
    // a name typed by hand that is a trainee's is that trainee — who leads another group already
    await form.getByLabel("מעביר/ה", { exact: true }).selectOption({ label: "מעין פרת" });
    await form.getByLabel("שם", { exact: true }).fill("מלווה  לדוגמה ה׳");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(form.getByRole("alert")).toHaveText("החניך/ה כבר מעביר/ה קבוצה אחרת. כל חניך/ה מעביר/ה קבוצה אחת.");
    const chips = form.getByRole("list", { name: "המעבירים" }).getByRole("listitem");
    await expect(chips).toHaveText([/^מלווה לדוגמה ד׳ \(חניך\/ה\)/, /^מלווה לדוגמה ה׳ \(חניך\/ה\)/]);
    await form.getByRole("button", { name: "הסרת מלווה לדוגמה ה׳ מהמעבירים" }).click();
    // someone of the team not on its list: «שם אחר…», typed — and saved without «הוספת מעביר/ה»
    await form.getByLabel("מעביר/ה", { exact: true }).selectOption({ label: "מהצוות" });
    await expect(form.getByLabel("מרשימת הצוות").locator("option")).toContainText(["מדריך/ה (הדגמה)", "שם אחר…"]);
    await form.getByLabel("מרשימת הצוות").selectOption({ label: "שם אחר…" });
    await form.getByLabel("שם", { exact: true }).fill("מעביר/ה חדש/ה (לדוגמה)");
    await noSidewaysScroll(page);
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "הקבוצה נוספה")).toBeVisible();
    await expect(add).toBeFocused(); // the form closed: «+ קבוצה» has the focus back
    const fresh = groups.getByRole("article", { name: "עוד לא נבחר ספר · מלווה לדוגמה ד׳ ו-מעביר/ה חדש/ה (לדוגמה)" });
    await expect(fresh).toContainText("עוד אין מרחב · מעבירים: מלווה לדוגמה ד׳ (חניך/ה), מעביר/ה חדש/ה (לדוגמה) (מהצוות)");
    await expect(fresh).toContainText("עוד לא מוצעת בקישור");
    await expect(strip.first()).toHaveText("מעבירים: 5 קבוצות, 4 עם שני מעבירים");
    await expect(strip.nth(1)).toHaveText("ספרים: 3 מתוך 5");
    await expect(strip.nth(3)).toHaveText("נרשמו 3 מתוך 3"); // ד׳ leads now: not someone who still needs a book

    // the placement picked before: ד׳ leads now, and a leader is never placed
    await expect(signup.locator("[data-kk-missing]")).toHaveText("0");
    await place.getByRole("button", { name: "שיבוץ" }).click();
    await expect(signup.getByRole("alert")).toHaveText("החניך/ה מעביר/ה קבוצה, ולכן לא נרשם/ת לקבוצה אחרת.");
    await expect(groups.getByRole("article", { name: "ספר לדוגמה ג׳" }).locator("[data-kk-count]")).toHaveText("נרשמו 0 מתוך 5");

    // not on the link: no book yet — and ד׳ is no longer among the names
    await signup.getByRole("link", { name: "בהגדרות ← «קישורים»" }).click();
    await page.getByRole("link", { name: "טופס ההרשמה למכריכה לכריכה" }).click();
    const signupForm = page.getByRole("form", { name: "הרשמה" });
    await expect(signupForm.getByRole("group", { name: "הספר שלי" }).getByRole("radio")).toHaveCount(3);
    await expect(signupForm.getByLabel("השם שלי").locator("option")).toHaveText(["בחירה מהרשימה", "מלווה לדוגמה א׳", "מלווה לדוגמה ב׳", "מלווה לדוגמה ג׳"]);
    await page.goBack();
    await nav(page).getByRole("link", { name: "מכריכה לכריכה" }).click();

    // the book, its place and a capacity: a place another group has is refused, in the form
    await groups.getByRole("button", { name: "עריכה: עוד לא נבחר ספר · מלווה לדוגמה ד׳ ו-מעביר/ה חדש/ה (לדוגמה)" }).click();
    const edit = groups.getByRole("form", { name: "עריכה · עוד לא נבחר ספר · מלווה לדוגמה ד׳ ו-מעביר/ה חדש/ה (לדוגמה)" });
    await edit.getByLabel("שם הספר (לא חובה: אפשר גם אחר כך)").fill("ספר חדש לדוגמה");
    await edit.getByLabel("מחבר/ת (לא חובה)").fill("מחבר/ת לדוגמה");
    await edit.getByLabel("מרחב (לא חובה)").fill(" הדשא ");
    await edit.getByLabel("תפוסה").fill("2");
    await noSidewaysScroll(page);
    await edit.getByRole("button", { name: "שמירה" }).click();
    await expect(edit.getByRole("alert")).toHaveText("המרחב הזה כבר של קבוצה אחרת. כל קבוצה נפגשת במרחב משלה.");
    await expect(edit.getByLabel("מרחב (לא חובה)")).toBeFocused();
    await edit.getByLabel("מרחב (לא חובה)").fill("כיתה ג׳");
    await edit.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "הקבוצה נשמרה")).toBeVisible();
    const g = groups.getByRole("article", { name: "ספר חדש לדוגמה" });
    await expect(g).toContainText("ספר חדש לדוגמה — מחבר/ת לדוגמה");
    await expect(g).toContainText("כיתה ג׳ · מעבירים: מלווה לדוגמה ד׳ (חניך/ה), מעביר/ה חדש/ה (לדוגמה) (מהצוות)");
    await expect(g.locator("[data-kk-count]")).toHaveText("נרשמו 0 מתוך 2");
    await expect(g.getByText("עוד לא מוצעת בקישור")).toHaveCount(0);
    await expect(g.getByRole("button", { name: "עריכה: ספר חדש לדוגמה" })).toBeFocused(); // closed: «עריכה» has the focus back
    await expect(strip.nth(1)).toHaveText("ספרים: 4 מתוך 5");

    // on the link now, with its place and its leaders
    await signup.getByRole("link", { name: "בהגדרות ← «קישורים»" }).click();
    await page.getByRole("link", { name: "טופס ההרשמה למכריכה לכריכה" }).click();
    const offered = signupForm.getByRole("group", { name: "הספר שלי" });
    await expect(offered.getByRole("radio")).toHaveCount(4);
    await expect(offered).toContainText("ספר חדש לדוגמה — מחבר/ת לדוגמה");
    await expect(offered).toContainText("כיתה ג׳ · מעבירים: מלווה לדוגמה ד׳ (חניך/ה), מעביר/ה חדש/ה (לדוגמה) (מהצוות)");
    await noSidewaysScroll(page);
  });

  test("«מכריכה לכריכה»: the books to order, a book changed after its order, a group with sign-ups not deleted, the window", async ({ page }) => {
    await page.goto(`${demoUrl()}/kk`);
    const groups = page.getByRole("region", { name: "הקבוצות" });
    const strip = page.getByRole("list", { name: "איפה זה עומד" }).getByRole("listitem");

    // the books (folded under their line on this screen): nothing filled in for the admin; the count they type, ordered
    const b = groups.getByRole("article", { name: "ספר לדוגמה ב׳" });
    await b.getByText("ספרים: עוד לא נקבע כמה להזמין").click();
    const books = b.getByRole("form", { name: "ספרים · ספר לדוגמה ב׳" });
    await expect(books.getByLabel("עותקים להזמנה")).toHaveValue("");
    await expect(books).toContainText("נרשמו 1 · מעבירים 1");
    await books.getByLabel("עותקים להזמנה").fill("3");
    await books.getByRole("checkbox", { name: /^הוזמן/ }).check();
    await books.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "הזמנת הספרים נשמרה")).toBeVisible();
    await expect(books.getByLabel("עותקים להזמנה")).toHaveValue("3");
    await expect(books.getByRole("checkbox", { name: /^הוזמן/ })).toBeChecked();
    await expect(strip.nth(4)).toHaveText("ספרים: הוזמנו 1 מתוך 4");
    await noSidewaysScroll(page);

    // a book whose copies are in an order: changing its title says to check the order; cancelled, nothing changed
    const a = groups.getByRole("article", { name: "ספר לדוגמה א׳" });
    await expect(a.getByText("ספרים: 6 עותקים · עוד לא הוזמנו")).toBeVisible();
    const editA = a.getByRole("button", { name: "עריכה: ספר לדוגמה א׳" });
    await editA.click();
    const form = groups.getByRole("form", { name: "עריכה · ספר לדוגמה א׳" });
    await expect(form.getByLabel("שם הספר (לא חובה: אפשר גם אחר כך)")).toHaveValue("ספר לדוגמה א׳");
    await expect(form.getByText("לספר הזה כבר יש הזמנת ספרים — כדאי לבדוק אותה.")).toHaveCount(0);
    await form.getByLabel("שם הספר (לא חובה: אפשר גם אחר כך)").fill("ספר אחר לדוגמה");
    await expect(form.getByText("לספר הזה כבר יש הזמנת ספרים — כדאי לבדוק אותה.")).toBeVisible();
    await form.getByRole("button", { name: "ביטול" }).click();
    await expect(editA).toBeFocused();

    // a group with someone in it is not deleted; the confirm cancelled first: the focus back at «מחיקה»
    const del = a.getByRole("button", { name: "מחיקה: ספר לדוגמה א׳" });
    await del.click();
    await expect(a.getByRole("group", { name: "אישור" })).toContainText("יש בה נרשמים");
    await a.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ביטול", exact: true }).press("Enter");
    await expect(del).toBeFocused();
    await del.click();
    await a.getByRole("group", { name: "אישור" }).getByRole("button", { name: "מחיקה", exact: true }).click();
    await expect(a.getByRole("alert")).toHaveText("יש נרשמים לקבוצה הזו. קודם מעבירים אותם לקבוצה אחרת או מסירים אותם, ואז מוחקים.");
    await expect(del).toBeFocused();
    await expect(a).toBeVisible();
    // one with nobody in it is
    const c = groups.getByRole("article", { name: "ספר לדוגמה ג׳" });
    await c.getByRole("button", { name: "מחיקה: ספר לדוגמה ג׳" }).click();
    await c.getByRole("group", { name: "אישור" }).getByRole("button", { name: "מחיקה", exact: true }).click();
    await expect(toast(page, "הקבוצה נמחקה")).toBeVisible();
    await expect(c).toHaveCount(0);
    await expect(strip.first()).toHaveText("מעבירים: 3 קבוצות, 2 עם שני מעבירים");

    // the window: closed by the admin — the screen and the public form say so, and the form sends nothing
    const signup = page.getByRole("region", { name: "ההרשמה", exact: true });
    await expect(signup).toContainText("פתוחה עכשיו");
    await signup.getByRole("button", { name: "עריכת החלון" }).click();
    await signup.getByRole("button", { name: "בלי חלון (ההרשמה סגורה)" }).click();
    await expect(toast(page, "ההרשמה סגורה: אין חלון")).toBeVisible();
    await expect(signup).toContainText("סגורה עכשיו");
    await expect(signup).toContainText("ההרשמה עוד לא נפתחה.");
    await expect(strip.nth(2)).toHaveText("ההרשמה עוד לא נפתחה");
    await expect(signup.getByRole("button", { name: "עריכת החלון" })).toBeFocused();
    await noSidewaysScroll(page);
    await signup.getByRole("link", { name: "בהגדרות ← «קישורים»" }).click();
    await page.getByRole("link", { name: "טופס ההרשמה למכריכה לכריכה" }).click();
    await expect(page.getByText("ההרשמה עוד לא נפתחה.", { exact: true })).toBeVisible();
    const closed = page.getByRole("form", { name: "הרשמה" });
    await expect(closed.getByRole("radio").first()).toBeDisabled();
    await expect(closed.getByRole("button", { name: "הרשמה" })).toHaveCount(0);
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
      {
        lesson_id: 42, kind: "lesson", day: 2, date: addDays(start, 2), start_min: 510, end_min: 585, room: "חדר לדוגמה",
        speaker: { name: "מרצה בלי טלפון לדוגמה", gender: "m" }, title: "כותרת שנייה לדוגמה", self_intro: true, duty_notes: [],
        escort_note: null, phone: null, transport: false, driver: null, ticks: { reminded: null, met: null, introduced: null, gift: null },
      },
      {
        lesson_id: 43, kind: "memorial", day: 2, date: addDays(start, 2), start_min: 780, end_min: 795, room: "חדר לדוגמה",
        speaker: null, title: null, self_intro: false, duty_notes: [], escort_note: null, phone: null, transport: false, driver: null,
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
    sessions: [
      { day: 0, date: start, start_min: 1290, end_min: 1350 },
      { day: 0, date: start, start_min: 1740, end_min: 1830 }, // the night's: the calendar's date is the next morning's
    ],
    groups: [
      { id: 21, title: "ספר לדוגמה", author: null, place: "מרחב לדוגמה", leaders: [{ kind: "staff", name: "מעביר/ה לדוגמה" }], full: false },
      { id: 22, title: "ספר מלא לדוגמה", author: "מחבר/ת לדוגמה", place: null, leaders: [], full: true },
    ],
  };
  /** «30.10.2026», as the page writes a date (before the Hebrew date beside it). */
  const dmy = (iso: string) => iso.split("-").reverse().map(Number).join(".");
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
    await expect(l.getByRole("checkbox", { name: /^הצגתי את המרצה/ })).toBeVisible();
    // past W−7, a speaker with no phone on file: where it is, not a blank
    const noPhone = escortLessons(page).nth(1);
    await expect(noPhone).toContainText("טלפון המרצה");
    await expect(noPhone.getByText("אצל הצוות", { exact: true })).toBeVisible();
    await expect(noPhone.getByRole("checkbox", { name: /^המרצה הציג את עצמו/ })).toBeVisible(); // a self-introduction
    // a memorial slot with nobody named: no «המרצה: TBD», «זמן זיכרון» once
    const memorial = escortLessons(page).nth(2);
    await expect(memorial).not.toContainText("המרצה: TBD");
    expect((await memorial.innerText()).split("זמן זיכרון").length - 1).toBe(1);
    await expect(memorial).not.toContainText("טלפון המרצה");
    await l.getByRole("checkbox", { name: /^הזכרתי למרצה/ }).check();
    await expect(l.getByRole("checkbox", { name: /^הזכרתי למרצה/ })).toBeChecked();
    await l.getByLabel("כתובת איסוף למרצה").fill("  כתובת לדוגמה  ");
    await l.getByRole("button", { name: "שליחה לצוות" }).click();
    await expect(l.getByRole("status")).toContainText("הכתובת נשלחה לצוות");
    expect(sb.rpc.get("escort_view")).toEqual([{ p_token: TOKEN }]);
    expect(sb.rpc.get("escort_tick")).toEqual([{ p_token: TOKEN, p_lesson: 41, p_item: "reminded", p_on: true }]);
    expect(sb.rpc.get("escort_pickup")).toEqual([{ p_token: TOKEN, p_lesson: 41, p_address: "  כתובת לדוגמה  " }]);

    // the sign-up: the sessions with their dates, one book, one call, the same answer
    await page.goto(`${mockUrl()}/k#${TOKEN}`);
    await page.getByText("נפגשים בכל מפגשי מכריכה לכריכה", { exact: true }).click();
    const sessions = page.getByRole("list", { name: "המפגשים" }).getByRole("listitem");
    await expect(sessions.first()).toContainText(`ראשון 21:30–22:30 · ${dmy(start)}`);
    await expect(sessions.nth(1)).toContainText(`ליל ראשון–שני 05:00–06:30 · ${dmy(addDays(start, 1))}`);
    const form = page.getByRole("form", { name: "הרשמה" });
    await expect(form.getByRole("radio", { name: /^ספר מלא לדוגמה/ })).toBeDisabled();
    await expect(form).toContainText("מלאה");
    await expect(form).toContainText("מרחב לדוגמה · מעבירים: מעביר/ה לדוגמה (מהצוות)");
    await form.getByLabel("השם שלי").selectOption({ label: "חניך/ה לדוגמה ב׳" });
    await form.getByRole("radio", { name: /^ספר לדוגמה/ }).first().check();
    await form.getByRole("button", { name: "הרשמה" }).click();
    await expect(page.getByRole("status", { name: "הבקשה נשלחה" })).toContainText("מה ששלחת: חניך/ה לדוגמה ב׳ — ספר לדוגמה");
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
      await expect(page.getByText("אולי פג תוקפו, בוטל או הוחלף בקישור חדש.", { exact: true })).toBeVisible();
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
    await page.getByRole("button", { name: "כן, לבטל את הקישור" }).click();
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
    // a member of the team whose name is a trainee's: picked from the team's list, sent as that trainee
    week.team[1].display_name = week.roster[2].full_name;
    const kk: KkData = {
      groups: [
        { id: 21, title: "ספר לדוגמה", author: null, place: "מרחב לדוגמה", capacity: 5, open: true },
        { id: 22, title: null, author: null, place: null, capacity: null, open: true },
      ],
      leaders: [{ id: 1, group_id: 22, kind: "staff", roster_id: null, label: "מעביר/ה לדוגמה" }],
      signups: [{ id: 1, group_id: 21, roster_id: week.roster[0].id, via: "link", created_at: new Date().toISOString() }],
      orders: [],
    };
    sb.answers.set("load_kk", kk);
    for (const f of ["kk_update_group", "kk_delete_group", "kk_place", "kk_unplace", "kk_set_window", "set_book_order"]) sb.answers.set(f, null);
    sb.answers.set("kk_add_group", 23);

    await page.goto(`${mockUrl()}/kk`);
    const groups = page.getByRole("region", { name: "הקבוצות" });
    const g = groups.getByRole("article", { name: "ספר לדוגמה", exact: true });
    await expect(g.locator("[data-kk-count]")).toHaveText("נרשמו 1 מתוך 5");
    await expect(groups.getByRole("article", { name: "עוד לא נבחר ספר · מעביר/ה לדוגמה" })).toBeVisible();
    expect(sb.rpc.get("load_kk")?.[0]).toEqual({ p_edition: 7 });

    // the window, in Israel's time (its form behind «עריכת החלון»)
    await page.getByRole("button", { name: "עריכת החלון" }).click();
    const win = page.getByRole("form", { name: "חלון ההרשמה" });
    await win.getByLabel("נפתחת (שעון ישראל)").fill("2027-01-10T20:00");
    await win.getByLabel("נסגרת (שעון ישראל)").fill("2027-01-17T20:00");
    await win.getByRole("button", { name: "שמירת החלון" }).click();
    await expect.poll(() => sb.rpc.get("kk_set_window")).toEqual([{ p_edition: 7, p_opens: "2027-01-10T18:00:00.000Z", p_closes: "2027-01-17T18:00:00.000Z" }]);

    // a new group for the week: no book yet, the fields as typed, nothing added — a leader typed, and one from the team's list
    await groups.getByRole("button", { name: "+ קבוצה" }).click();
    const form = groups.getByRole("form", { name: "קבוצה חדשה" });
    await form.getByLabel("מרחב (לא חובה)").fill("מרחב חדש לדוגמה");
    await form.getByLabel("מעביר/ה", { exact: true }).selectOption({ label: "מהצוות" });
    await form.getByLabel("מרשימת הצוות").selectOption({ label: "שם אחר…" });
    await form.getByLabel("שם", { exact: true }).fill("מעביר/ה חדש/ה לדוגמה");
    await form.getByRole("button", { name: "הוספת מעביר/ה" }).click();
    await form.getByLabel("מרשימת הצוות").selectOption({ label: week.roster[2].full_name });
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("kk_add_group")).toEqual([
      {
        p_edition: 7,
        p_fields: { title: null, author: null, place: "מרחב חדש לדוגמה", capacity: null, open: true, leaders: [{ kind: "staff", label: "מעביר/ה חדש/ה לדוגמה" }, { kind: "trainee", roster_id: week.roster[2].id }] },
      },
    ]);

    // the group's fields: every key, the leaders replaced as listed
    await g.getByRole("button", { name: "עריכה: ספר לדוגמה" }).click();
    const edit = groups.getByRole("form", { name: "עריכה · ספר לדוגמה" });
    await edit.getByLabel("תפוסה").fill("6");
    await edit.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("kk_update_group")).toEqual([{ p_group: 21, p_patch: { title: "ספר לדוגמה", author: null, place: "מרחב לדוגמה", capacity: 6, open: true, leaders: [] } }]);

    // place, move, books, remove, delete
    const signup = page.getByRole("region", { name: "ההרשמה", exact: true });
    await signup.getByText("עוד לא נרשמו", { exact: true }).click();
    const place = signup.getByRole("form", { name: "שיבוץ" });
    await place.getByLabel("חניך/ה").selectOption({ label: week.roster[1].full_name });
    await place.getByLabel("לקבוצה").selectOption({ label: "ספר לדוגמה" });
    await place.getByRole("button", { name: "שיבוץ" }).click();
    await expect.poll(() => sb.rpc.get("kk_place")).toEqual([{ p_group: 21, p_roster: week.roster[1].id }]);
    await g.locator("[data-kk-count]").click();
    await g.getByLabel(`העברה של ${week.roster[0].full_name} לקבוצה אחרת`).selectOption({ label: "העברה ל: עוד לא נבחר ספר · מעביר/ה לדוגמה" });
    await expect.poll(() => sb.rpc.get("kk_place")).toEqual([
      { p_group: 21, p_roster: week.roster[1].id },
      { p_group: 22, p_roster: week.roster[0].id },
    ]);
    await g.getByText(/^ספרים:/).click();
    const books = g.getByRole("form", { name: "ספרים · ספר לדוגמה" });
    await books.getByLabel("עותקים להזמנה").fill("5");
    await books.getByRole("checkbox", { name: /^הוזמן/ }).check();
    await books.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("set_book_order")).toEqual([{ p_group: 21, p_copies: 5, p_ordered: true }]);
    await g.getByRole("button", { name: `הסרה: ${week.roster[0].full_name}` }).click();
    await g.getByRole("group", { name: "אישור" }).getByRole("button", { name: "הסרה", exact: true }).click();
    await expect.poll(() => sb.rpc.get("kk_unplace")).toEqual([{ p_edition: 7, p_roster: week.roster[0].id }]);
    await g.getByRole("button", { name: "מחיקה: ספר לדוגמה" }).click();
    await g.getByRole("group", { name: "אישור" }).getByRole("button", { name: "מחיקה", exact: true }).click();
    await expect.poll(() => sb.rpc.get("kk_delete_group")).toEqual([{ p_group: 21 }]);

    for (const f of ["load_kk", "kk_set_window", "kk_add_group", "kk_update_group", "kk_place", "set_book_order", "kk_unplace", "kk_delete_group"]) {
      const calls = sb.calls.filter((c) => c.path === `/rest/v1/rpc/${f}`);
      expect(calls.length, f).toBeGreaterThan(0);
      for (const c of calls) expect(c.auth, f).toBe(`Bearer ${session.access_token}`);
    }
  });
});
