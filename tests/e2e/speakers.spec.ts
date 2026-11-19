// The staff's speakers (the reset, phase 3: no pool, no sheet, no «המרצים שלי» — the wide pages «מרצים», «מרצה חדש/ה»
// and the speaker page do it all) in a real browser. Demo build (the instructor, a global admin), every width: «+ מרצה
// חדש/ה» from the grid's toolbar searches first (the same name needs a disambiguator, a similar one is shown, a match
// opens its page); a lesson's speaker opens their page — contacts with their buttons, a refused phone, then a saved one,
// the years before; the call on the page (its points, a result) and availability slot by slot under «דיוק לפי משבצת»
// (a tap cycles, the arrows move, a note); each call's result moves the speaker on, as «כל הצוות» shows it; «כל הצוות» —
// a block per handler in the team's order, one sent back to the pool under «בלי אחראי/ת»; «הוצעו לך» atop «מרצים» —
// the hand-over taken on its page, one of mine moved to a teammate; who agreed waits for the vetting on her chip, is
// approved there, and her lesson closes on its page; a cell's chooser offers a speaker someone else handles to their
// handler. Mock build: every pool command on the pages goes out by the contract's parameter names
// (tests/sql/speakers.test.ts pins them) with the member's own token; a slot a content member marks shows at once and
// goes back when refused, logistics reads only; a refusal from the create reads in Hebrew; a content member is offered no
// vetting, the team view reads nothing new, and the offers line's hand-over is answer_handover. Synthetic people only;
// the phone typed here is not shaped like a real one (scripts/pii-scan.mjs).
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { demoWeek } from "../../src/data/demoWeek";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

/** A toast (the demo banner is a status too). */
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });
const call = (page: Page) => page.locator("#call");
/** «כל הצוות»: one handler's block, and a speaker's row in it. */
const block = (page: Page, who: string) => page.locator("[data-team-view]").getByRole("region", { name: who, exact: true });
const teamRow = (page: Page, who: string, name: string) => block(page, who).locator("li").filter({ hasText: name });

/** «מרצים» in the header, then «כל הצוות» from the list's header. */
async function teamView(page: Page) {
  await nav(page).getByRole("link", { name: "מרצים" }).click();
  await page.getByRole("link", { name: "כל הצוות" }).click();
  await expect(page).toHaveURL(/[?&]view=team/);
  await expect(page.locator("[data-team-view]")).toBeVisible();
}

/** «דיוק לפי משבצת» (the speaker page's per-slot grid), opened. */
async function slots(page: Page): Promise<Locator> {
  const av = page.locator("#availability");
  const fold = av.locator("summary", { hasText: "דיוק לפי משבצת" });
  if ((await fold.locator("xpath=..").getAttribute("open")) === null) await fold.click();
  return av;
}

/** A closed lesson's panel on the grid (its day first on a phone or a tablet). */
async function openLesson(page: Page, info: TestInfo, day: string, speaker: string) {
  if (info.project.name !== "desktop") await page.getByRole("tablist", { name: "ימים" }).getByRole("tab", { name: day }).click();
  await page.locator("[data-lesson-id]").filter({ hasText: speaker }).first().click();
  const panel = page.getByRole("dialog", { name: "שיעור סגור" });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("demo build — the instructor", () => {
  test("«+ מרצה חדש/ה» searches first: the same name needs a disambiguator, a similar one is shown before it is added; then her page", async ({ page }) => {
    await page.goto(demoUrl());
    await page.getByRole("link", { name: "+ מרצה חדש/ה" }).click();
    await expect(page).toHaveURL(/\/speakers\/new$/);
    const name = page.getByLabel("שם המרצה (בלי תואר)");
    await expect(name).toBeFocused();

    await name.fill("מרצה 07");
    const maybe = page.getByRole("region", { name: "ייתכן שזה…" });
    await expect(maybe.getByRole("listitem").filter({ hasText: "מרצה 07" })).toContainText("אותו שם");
    await expect(maybe.getByRole("status")).toHaveText("אותו שם כבר במאגר.");
    // «פתיחה» to check whether it is the same person: their page (the sheet's «חזרה» went with the sheet — back is the browser's)
    await maybe.getByRole("button", { name: "פתיחת מרצה 07" }).click();
    await expect(page).toHaveURL(/\/speakers\/7$/);
    await expect(page.getByRole("heading", { level: 2, name: "מרצה 07", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/speakers\/new$/);
    await name.fill("מרצה 07");

    await page.getByRole("button", { name: "זה מישהו אחר — להמשיך" }).click();
    await expect(page.getByLabel("תואר", { exact: true })).toBeFocused(); // the fields, not the top of the page
    await expect(maybe.getByRole("listitem")).toHaveCount(0); // the matches already seen fold into one line
    await expect(maybe.getByRole("button", { name: /שמות דומים במאגר — הצגה|שם דומה אחד במאגר — הצגה/ })).toBeVisible();
    await expect(page.getByLabel(/פרט מבחין \(חובה/)).toBeVisible();
    await page.getByRole("button", { name: "הוספה למאגר" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "צריך להוסיף פרט מבחין" })).toBeVisible();
    await expect(page.getByLabel(/פרט מבחין/)).toBeFocused();
    await expect(page).toHaveURL(/\/speakers\/new$/); // nothing was created
    await noSidewaysScroll(page);

    // another name, close to an existing one: shown as similar, then added on purpose
    await name.fill("מרצה 077");
    await expect(maybe.getByRole("listitem").filter({ hasText: "מרצה 07" })).toBeVisible();
    await expect(maybe.getByRole("listitem").filter({ hasText: "מרצה 07" })).not.toContainText("אותו שם"); // a similar name: the list itself says so
    await expect(page.getByLabel(/פרט מבחין/)).toHaveCount(0);
    await page.getByRole("radio", { name: "נקבה" }).check();
    await page.getByLabel("נושאים", { exact: true }).fill("שירה");
    await page.getByLabel("נושאים", { exact: true }).press("Enter");
    await expect(page.getByRole("list", { name: "הנושאים שנבחרו" })).toContainText("שירה");
    await page.getByLabel("נושאים", { exact: true }).fill("תפילה"); // typed, never confirmed with Enter
    await expect(page.getByRole("checkbox", { name: /^לאשר כבר עכשיו/ })).not.toBeChecked(); // the instructor's, off unless chosen
    await page.getByRole("button", { name: "הוספה למאגר" }).click();
    await expect(page).toHaveURL(/\/speakers\/\d+$/);
    await expect(toast(page, "מרצה 077 נוספה למאגר")).toBeVisible();

    // her page: waiting for the vetting, in my hands, nothing guessed — both topics kept
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 2 }) });
    await expect(header.getByRole("heading", { level: 2 })).toHaveText("מרצה 077");
    await expect(header.locator('[data-vetting="pending"]')).toContainText("ממתינה לאישור");
    await expect(header.getByRole("list", { name: "נושאים" })).toContainText("שירה");
    await expect(header.getByRole("list", { name: "נושאים" })).toContainText("תפילה");
    await expect(call(page)).toContainText("בטיפולך · לפני שיחה");
    const log = page.getByRole("region", { name: "ציר הפעולות" });
    await log.locator("summary").click();
    await expect(log).toContainText("נוספה למאגר");
    await noSidewaysScroll(page);
  });

  test("a lesson's speaker opens their page: contacts with their buttons, a refused phone, then a saved one; the years before", async ({ page }, info) => {
    await page.goto(demoUrl());
    const panel = await openLesson(page, info, "שני", "מרצה 04");
    await panel.getByRole("button", { name: "פרופ׳ מרצה 04" }).click();
    await expect(page).toHaveURL(/\/speakers\/4$/);

    const contacts = call(page);
    await expect(contacts.getByRole("link", { name: "שליחת מייל" })).toHaveAttribute("href", "mailto:speaker04@example.org");
    await expect(contacts).toContainText("טלפון לדוגמה");
    await expect(contacts.getByRole("link", { name: "חיוג" })).toHaveCount(0); // a placeholder is no number
    await expect(page.getByRole("region", { name: "שיעורים במחזורים" })).toContainText("מחזור קודם (לדוגמה)");
    await noSidewaysScroll(page);

    await contacts.getByRole("button", { name: "עריכת פרטי הקשר" }).click();
    const form = contacts.getByRole("form", { name: "עריכת פרטי הקשר" });
    await form.getByLabel("טלפון").fill("12-34");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(form.getByRole("alert")).toContainText("מספר הטלפון לא תקין");
    await expect(form.getByLabel("טלפון")).toHaveAttribute("aria-invalid", "true");
    await form.getByLabel("טלפון").fill("123 456 789");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "פרטי הקשר נשמרו")).toBeVisible();
    await expect(contacts.getByRole("link", { name: "חיוג" })).toHaveAttribute("href", "tel:123456789");
    await expect(contacts.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/123456789");
    await expect(contacts.getByRole("definition").filter({ hasText: "123 456 789" })).toBeVisible(); // the contacts as they are now
    // «מה קרה» on the page is curated (the reset, phase 2): an edit of the contacts is not one of its lines — the page shows them
    await expect(page.getByRole("region", { name: "ציר הפעולות" })).not.toContainText("פרטי הקשר עודכנו");
    await noSidewaysScroll(page);

    // the page is an address of its own: back is the grid it came from
    await page.goBack();
    await expect(page.getByRole("radiogroup", { name: "עדשה" })).toBeVisible();
  });

  test("the call on the speaker's page (its points, a result), then availability slot by slot — a tap cycles, the arrows move, a note", async ({ page }) => {
    await page.goto(`${demoUrl()}/speakers/32#call`);
    await expect(call(page)).toBeVisible();
    // the page in the year's order: the call, availability, where to place, the lessons
    expect(await page.locator("section[id]").evaluateAll((s) => s.map((x) => x.id))).toEqual(["call", "availability", "placement", "lessons"]);
    // at the call: the instructor's points open (X is the caller's name), addressed to her
    await expect(call(page)).toContainText("בטיפולך · לפני שיחה");
    const points = call(page).locator("[data-call-points]");
    await expect(points).toBeVisible();
    await expect(points).toContainText("*אני מדריך/ה (הדגמה) מהמדרשה הגבוהה בעין פרת");
    await expect(points).toContainText("*נשמח שתגיעי ללמד שעה ורבע, תסכימי?");
    await noSidewaysScroll(page);

    // the result, with what was said: the status moves, and the note is the newest one on the approach
    const result = call(page).getByRole("group", { name: "תוצאת השיחה" });
    await expect(result.getByRole("button", { name: "לפני שיחה" })).toHaveCount(0); // not the status it already has
    await result.getByLabel("מה נאמר בשיחה").fill("נושא לדוגמה (נתון לדוגמה)");
    await result.getByRole("button", { name: "שוחחנו, מחכים לתשובה", exact: true }).click();
    await expect(toast(page, "עודכן: שוחחנו, מחכים לתשובה")).toBeVisible();
    await expect(call(page)).toContainText("בטיפולך · שוחחנו, מחכים לתשובה");
    await expect(call(page)).toContainText("«נושא לדוגמה (נתון לדוגמה)»");
    const log = page.getByRole("region", { name: "ציר הפעולות" });
    await log.locator("summary").click();
    await expect(log).toContainText("«נושא לדוגמה (נתון לדוגמה)»");

    // availability: any slot in play, a tap at a time — — → ✓ → ✗ → —, each saved and said once under the grid
    const avail = await slots(page);
    const slot = (name: RegExp) => avail.getByRole("button", { name });
    const said = avail.locator("[data-slot-said]");
    await expect(avail.getByRole("cell", { name: "מחוץ לשעות השבוע" })).toHaveCount(6); // Sunday before the opening, Thursday after the close
    await slot(/^שני 08:30–10:00: לא ידוע$/).click();
    await expect(said).toHaveText(/^נשמר: שני ‎?08:30–10:00 — יכולה$/);
    await slot(/^שני 08:30–10:00: יכולה$/).click();
    await expect(said).toHaveText(/^נשמר: שני ‎?08:30–10:00 — לא יכולה$/);
    await slot(/^שני 08:30–10:00: לא יכולה$/).click();
    await expect(said).toHaveText(/^נשמר: שני ‎?08:30–10:00 — לא ידוע$/);
    await expect(slot(/^שני 08:30–10:00: לא ידוע$/)).toBeVisible();
    await expect(toast(page, /נשמר:/)).toHaveCount(0); // no toast per tap (the demo banner says «…לא נשמר»)
    await noSidewaysScroll(page);

    // the keyboard: one tab stop, the arrows (← is the next day, right to left), a slot outside the week skipped
    await expect(avail.locator('button[tabindex="0"]')).toHaveCount(1);
    await slot(/^שני 08:30–10:00/).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(slot(/^שלישי 08:30–10:00/)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(slot(/^שלישי 06:30–07:15/)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(slot(/^שני 06:30–07:15/)).toBeFocused(); // Sunday's 06:30 is before the opening
    await page.keyboard.press("Space");
    await expect(slot(/^שני 06:30–07:15: יכולה$/)).toBeFocused();
    await expect(avail.locator('button[tabindex="0"]')).toHaveCount(1);

    // a note on a marked slot
    await avail.getByText("+ הערה").click();
    const note = avail.getByRole("form", { name: "הערה למשבצת" });
    await expect(note.getByLabel("המשבצת").locator("option")).toHaveCount(2); // «בחירה» and the one marked slot
    await note.getByLabel("המשבצת").selectOption({ index: 1 });
    await note.getByLabel("ההערה").fill("רק עד 07:00 (נתון לדוגמה)");
    await note.getByRole("button", { name: "שמירה" }).click();
    await expect(avail.getByRole("list", { name: "הערות על הזמינות" }).getByRole("listitem")).toHaveText(["שני 06:30–07:15 · יכולה — רק עד 07:00 (נתון לדוגמה)"]);
    await expect(slot(/^שני 06:30–07:15: יכולה — רק עד 07:00 \(נתון לדוגמה\)$/)).toBeVisible();
    await expect(said).toHaveText(/^ההערה נשמרה: שני ‎?06:30–07:15$/);
    await noSidewaysScroll(page);

    // where she can be placed (the grid's own placing mode went with the pool): a slot proposed, in «שיעורים» at once
    // Monday, where she now said «יכולה» (a day nobody owns opens where they can; any other is folded)
    const monday = page.locator('#placement [data-place-day="1"]');
    const option = monday.locator("[data-place-option]").first();
    if (!(await option.isVisible())) await monday.locator("summary").click();
    await option.getByRole("button", { name: "להציע כאן" }).click();
    await expect(toast(page, /מרצה 32 הוצעה למשבצת/)).toBeVisible();
    await expect(page.locator("#lessons").getByRole("link", { name: "לשיעור" })).toHaveAttribute("href", /^\/lesson\/\d+\?step=place$/);
  });

  test("each call's result moves the speaker on — «כל הצוות» shows where they stand; who agreed and was approved waits for a time", async ({ page }) => {
    await page.goto(demoUrl());
    await teamView(page);
    await expect(teamRow(page, "מדריך/ה (הדגמה)", "מרצה 32")).toContainText("להתקשר");
    /** A result on her page, then the team view: her row under its new group's word. */
    const result = async (said: string, group: string, note?: string) => {
      await teamRow(page, "מדריך/ה (הדגמה)", "מרצה 32").getByRole("link", { name: "מרצה 32" }).click();
      await expect(page).toHaveURL(/\/speakers\/32$/);
      const frame = call(page);
      const fold = frame.locator("summary", { hasText: "שינוי תוצאת השיחה" });
      if (await fold.count()) await fold.click();
      const results = frame.getByRole("group", { name: "תוצאת השיחה" });
      if (note) await results.getByLabel("מה נאמר בשיחה").fill(note);
      await results.getByRole("button", { name: said, exact: true }).click();
      await expect(toast(page, `עודכן: ${said}`)).toBeVisible();
      await expect(frame).toBeFocused(); // the pressed button went: the focus stays in «הפנייה»
      await teamView(page);
      await expect(teamRow(page, "מדריך/ה (הדגמה)", "מרצה 32")).toContainText(group);
    };
    await result("לא ענתה", "לנסות שוב");
    await result("שוחחנו, מחכים לתשובה", "מחכים לתשובה");
    await result("הסכימה", "לסגור שעה", "נושא לדוגמה; בהתנדבות (נתון לדוגמה)"); // approved already: nothing waits
    await noSidewaysScroll(page);
  });

  test("«כל הצוות»: a block per handler in the team's order and colour, each name to its page; one sent back to the pool under «בלי אחראי/ת»", async ({ page }) => {
    await page.goto(`${demoUrl()}/speakers`);
    await page.getByRole("link", { name: "כל הצוות" }).click();
    await expect(page).toHaveURL(/\/speakers\?view=team$/);
    await expect(nav(page).getByRole("link", { name: "מרצים" })).toHaveAttribute("aria-current", "page");
    // the team's order; logistics handles no speaker (and what waits for the instructor is «אישורים»' — its badge)
    expect(await page.locator("[data-team-view] section[data-team-block]").evaluateAll((s) => s.map((x) => x.getAttribute("aria-label")))).toEqual([
      "מדריך/ה (הדגמה)",
      "חניך/ה א׳",
      "חניך/ה ב׳",
      "חניך/ה ג׳",
    ]);
    await expect(block(page, "מדריך/ה (הדגמה)").locator("li").first()).toContainText("מרצה 32"); // by group: «להתקשר» first
    await expect(teamRow(page, "מדריך/ה (הדגמה)", "מרצה 56")).toContainText("ממתינה לאישור");
    await expect(teamRow(page, "חניך/ה א׳", "הרב מרצה 13")).toContainText("הוצע להעביר למדריך/ה (הדגמה)");
    await expect(teamRow(page, "חניך/ה ג׳", "מרצה 23")).toContainText("סירב");
    await expect(page.locator('[data-team-block="none"]')).toHaveCount(0); // nobody in process without a handler
    await expect(teamRow(page, "חניך/ה ג׳", "פרופ׳ מרצה 11").getByRole("link")).toHaveAttribute("href", "/speakers/11");
    await noSidewaysScroll(page);

    // the instructor sends one back to the pool: still in process, nobody's
    await teamRow(page, "חניך/ה ג׳", "פרופ׳ מרצה 11").getByRole("link").click();
    await expect(page).toHaveURL(/\/speakers\/11$/);
    await call(page).getByRole("button", { name: /^העברה לחבר\/ת צוות/ }).click();
    const form = call(page).getByRole("group", { name: "העברת הטיפול" });
    await form.getByLabel("להעביר ל…").selectOption({ label: "בחזרה למאגר, בלי מטפל/ת" });
    await form.getByRole("button", { name: "העברה", exact: true }).click();
    await expect(toast(page, /למאגר, בלי מטפל\/ת/)).toBeVisible();
    await expect(call(page)).toContainText("אין מטפל/ת כרגע");
    await page.goBack();
    const unowned = page.locator('[data-team-block="none"]');
    await expect(unowned.locator("summary")).toHaveText(/בלי אחראי\/ת\s*1/);
    await unowned.locator("summary").click();
    await expect(unowned.locator("li").filter({ hasText: "פרופ׳ מרצה 11" })).toContainText("מחכים לתשובה");
    await expect(block(page, "חניך/ה ג׳")).not.toContainText("מרצה 11");
    await noSidewaysScroll(page);

    // «לרשימה» back to the list; «המרצים שלי»'s old addresses land here
    await page.getByRole("link", { name: "לרשימה" }).click();
    await expect(page.locator("[data-team-view]")).toHaveCount(0);
    await expect(page.locator("[data-speaker-row]").first()).toBeVisible();
    await page.goto(`${demoUrl()}/mine/team`);
    await expect(page).toHaveURL(/\/speakers\?view=team$/);
    await page.goto(`${demoUrl()}/mine`);
    await expect(page).toHaveURL(/\/speakers\?s=mine$/);
  });

  test("«הוצעו לך» atop «מרצים»: the hand-over taken on its page; one of mine moved to a teammate — «כל הצוות» shows where they went", async ({ page }) => {
    await page.goto(`${demoUrl()}/speakers`);
    const offers = page.locator("[data-offers]");
    await expect(offers).toHaveText(/^הוצע\/ה לך מרצה אחד\/ת:\s*הרב מרצה 13$/);
    await offers.locator('[data-offer="13"]').click();
    await expect(page).toHaveURL(/\/speakers\/13$/);
    const waiting = call(page).getByRole("group", { name: "העברה שמחכה לך" });
    await expect(waiting).toContainText("חניך/ה א׳ מציע/ה להעביר אליך את הטיפול.");
    await waiting.getByRole("button", { name: "קבלת הטיפול" }).click();
    await expect(toast(page, "הטיפול עבר אליך")).toBeVisible();
    await expect(call(page).getByRole("group", { name: "העברה שמחכה לך" })).toHaveCount(0);
    await expect(call(page)).toContainText("בטיפולך");
    await expect(call(page)).toBeFocused();
    await nav(page).getByRole("link", { name: "מרצים" }).click();
    await expect(page.locator("[data-offers]")).toHaveCount(0);

    // one of mine to a teammate, with a note: an admin moves it at once
    await page.getByLabel("חיפוש", { exact: true }).fill("מרצה 32");
    await page.locator('[data-speaker-row="32"]').getByRole("link").first().click();
    await call(page).getByRole("button", { name: /^העברה לחבר\/ת צוות/ }).click();
    const form = call(page).getByRole("group", { name: "העברת הטיפול" });
    await form.getByLabel("להעביר ל…").selectOption({ label: "חניך/ה ב׳" });
    await form.getByLabel("הערה להעברה (לא חובה)").fill("יש לה קשר עם המרצה (נתון לדוגמה)");
    await form.getByRole("button", { name: "העברה", exact: true }).click();
    await expect(toast(page, "הטיפול עבר לחניך/ה ב׳")).toBeVisible();
    await expect(call(page)).toContainText("בטיפול חניך/ה ב׳");
    await noSidewaysScroll(page);

    await teamView(page);
    await expect(teamRow(page, "חניך/ה ב׳", "מרצה 32")).toContainText("להתקשר");
    await expect(teamRow(page, "מדריך/ה (הדגמה)", "הרב מרצה 13")).toContainText("מחכים לתשובה");
    await expect(block(page, "חניך/ה א׳")).not.toContainText("מרצה 13");
  });

  test("who agreed waits for the vetting: her chip, approved there — the badge counts down — and her lesson closes on its page", async ({ page }) => {
    await page.goto(`${demoUrl()}/speakers/56`);
    const badge = nav(page).getByRole("link", { name: /^אישורים/ });
    await expect(badge).toHaveAccessibleName("אישורים, 2 ממתינים"); // she agreed and waits; the demo's payment request
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 2 }) });
    const chip = header.locator("[data-vetting]");
    await expect(chip).toHaveAttribute("data-vetting", "pending");
    await expect(chip).toContainText("ממתינה לאישור");
    await expect(call(page)).toContainText("הסכימה");
    await noSidewaysScroll(page);

    await chip.click();
    await header.getByRole("group", { name: "אישור המדריך/ה" }).getByRole("button", { name: "אישור", exact: true }).click();
    await expect(toast(page, "מרצה 56 אושרה")).toBeVisible();
    await expect(badge).toHaveAccessibleName("אישורים, 1 ממתין");
    await expect(header.locator("[data-vetting]")).toHaveAttribute("data-vetting", "approved");

    // her proposed lesson (Tuesday 20:00): on its page, the closing is hers now
    await page.locator("#lessons").getByRole("link", { name: "לשיעור" }).click();
    await expect(page).toHaveURL(/\/lesson\/\d+\?step=place$/);
    await expect(page.locator("[data-pitch-id]").filter({ hasText: "מרצה 56" }).getByRole("button", { name: "המרצה אישרה את השעה — סגירה" })).toBeVisible();
  });

  test("a cell's chooser offers a speaker someone else handles to their handler; the speaker's page agrees on who handles them", async ({ page }, info) => {
    await page.goto(demoUrl());
    if (info.project.name !== "desktop") await page.getByRole("tablist", { name: "ימים" }).getByRole("tab", { name: "חמישי" }).click();
    await page.locator('[data-drop="cell:4:510:600"]').click();
    const free = page.getByRole("dialog", { name: "משבצת פנויה" });
    await free.getByLabel("חיפוש מרצה למשבצת").fill("מרצה 09");
    await free.locator('[data-chooser-speaker="9"]').getByRole("button", { name: "הצע לחניך/ה א׳" }).click();
    await expect(toast(page, "ד״ר מרצה 09 הוצע/ה לאחראי/ת")).toBeVisible();

    // the panel is the new draft's: the candidate, handled by her handler
    const cell = page.getByRole("dialog", { name: "משבצת בתהליך" });
    const card = cell.locator("[data-pitch-id]").filter({ hasText: "מרצה 09" });
    await expect(card).toContainText("בטיפול: חניך/ה א׳");
    await card.getByRole("button", { name: "ד״ר מרצה 09" }).click();
    await expect(page).toHaveURL(/\/speakers\/9$/);
    await expect(call(page)).toContainText("בטיפול חניך/ה א׳");
    await expect(page.locator("#lessons")).toContainText("חמישי 08:30–10:00"); // the cell just offered
    // availability per slot: the seeded Sunday morning, one note said once for the three slots it is on
    const avail = await slots(page);
    await expect(avail.getByRole("button", { name: /^ראשון 08:30–10:00: לא יכול — דוגמה: לא בבקרים/ })).toBeVisible();
    await expect(avail.getByRole("button", { name: /^ראשון 11:30–13:00: לא יכול — דוגמה: לא בבקרים/ })).toBeVisible();
    await expect(avail.getByRole("button", { name: /^ראשון 14:30–16:00: לא ידוע$/ })).toBeVisible();
    await expect(avail.getByRole("list", { name: "הערות על הזמינות" }).getByRole("listitem")).toHaveText(["ראשון 08:30–13:00 · לא יכול — דוגמה: לא בבקרים"]);
    await noSidewaysScroll(page);
  });
});

// ------------------------------------------------------------------ mock build

const member = (role: "admin" | "content" | "logistics", id: number, global = false) => ({
  status: "ok",
  schema_version: EXPECTED_SCHEMA_VERSION,
  email: global ? "admin@example.org" : "member@example.org",
  display_name: global ? "מדריך/ה לדוגמה" : "חבר/ת צוות",
  global_admin: global,
  memberships: [{ edition_id: global ? null : 7, role, member_id: id }],
});

test.describe("mock build", () => {
  test("every pool command on the speaker pages goes out as its RPC, by the contract's parameter names, with the member's token", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const week = demoWeek();
    week.edition.id = 7;
    const mine = (speaker: number) => week.approaches.find((a) => a.speaker_id === speaker)!;
    const sb = new FakeSupabase({ status: 200, body: member("admin", 1, true) });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("speaker_matches", []);
    sb.answers.set("create_speaker", { speaker_id: 61, approach_id: 90 });
    sb.answers.set("get_speaker_contacts", { phone: null, email: null, secretary_note: null, notes: null });
    sb.answers.set("speaker_history", []);
    sb.answers.set("speaker_activity", []);
    for (const fn of ["set_speaker_contacts", "update_speaker", "vet_speakers", "set_approach_status", "hand_over", "answer_handover", "set_slot_availability"]) sb.answers.set(fn, null);
    sb.answers.set("claim_speaker", 91);
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;
    await page.goto(mockUrl());
    await expect(page.getByRole("grid", { name: "רשת השבוע" })).toBeVisible();

    // create: search first, then the form — from the grid's toolbar
    await page.getByRole("link", { name: "+ מרצה חדש/ה" }).click();
    await page.getByLabel("שם המרצה (בלי תואר)").fill("פלונית לדוגמה");
    await expect(page.getByText("אין במאגר שם דומה.")).toBeVisible();
    await page.getByRole("button", { name: "להמשיך", exact: true }).click();
    await page.getByRole("radio", { name: "נקבה" }).check();
    await page.getByRole("button", { name: "הוספה למאגר" }).click();
    await expect.poll(() => sb.rpc.get("create_speaker")?.length ?? 0).toBe(1);
    expect(sb.rpc.get("speaker_matches")).toEqual([{ p_name: "פלונית לדוגמה" }]);
    expect(sb.rpc.get("create_speaker")![0]).toEqual({
      p_edition: 7,
      p_fields: { title: null, name: "פלונית לדוגמה", disambiguator: null, gender: "f", affiliation: null, bio_short: null, topics: [], contact_pref: null },
      p_claim: true,
      p_approve: false,
      p_confirmed: false,
    });
    // the new speaker's page (this fake week does not have them)
    await expect(page).toHaveURL(/\/speakers\/61$/);
    await expect(page.getByText("המרצה לא נמצא/ה במאגר.")).toBeVisible();

    // a free speaker's page: its three reads, then «אני מטפל/ת»
    await page.goto(`${mockUrl()}/speakers/15`);
    await expect(page.getByText("עוד לא נרשמו פרטי קשר.")).toBeVisible();
    for (const fn of ["get_speaker_contacts", "speaker_history", "speaker_activity"]) expect(sb.rpc.get(fn)).toContainEqual({ p_speaker: 15 });
    await call(page).getByRole("button", { name: "אני מטפל/ת" }).click();
    await expect.poll(() => sb.rpc.get("claim_speaker")).toEqual([{ p_edition: 7, p_speaker: 15 }]);

    // «הוצעו לך» on «מרצים»: the hand-over offered to me, taken on its page
    await nav(page).getByRole("link", { name: "מרצים" }).click();
    await page.locator('[data-offers] [data-offer="13"]').click();
    await call(page).getByRole("group", { name: "העברה שמחכה לך" }).getByRole("button", { name: "קבלת הטיפול" }).click();
    await expect.poll(() => sb.rpc.get("answer_handover")).toEqual([{ p_approach: mine(13).id, p_accept: true, p_note: null }]);

    // a call: its result, with what was said
    await page.goto(`${mockUrl()}/speakers/32#call`);
    const result = call(page).getByRole("group", { name: "תוצאת השיחה" });
    await result.getByLabel("מה נאמר בשיחה").fill("נושא לדוגמה");
    await result.getByRole("button", { name: "שוחחנו, מחכים לתשובה", exact: true }).click();
    await expect.poll(() => sb.rpc.get("set_approach_status")).toEqual([{ p_approach: mine(32).id, p_version: 1, p_status: "approached", p_note: "נושא לדוגמה" }]);

    // the same page: the profile, the contacts, a slot of availability, the vetting, the hand-over
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 2 }) });
    await header.getByRole("button", { name: "עריכה", exact: true }).click();
    await header.getByLabel("תיאור קצר").fill("תיאור לדוגמה");
    await header.getByRole("form", { name: "עריכת הפרטים" }).getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("update_speaker")).toEqual([{ p_edition: 7, p_speaker: 32, p_version: 1, p_patch: { bio_short: "תיאור לדוגמה" } }]);

    await call(page).getByRole("button", { name: "עריכת פרטי הקשר" }).click();
    await call(page).getByLabel("טלפון").fill("123 456 789");
    await call(page).getByRole("form", { name: "עריכת פרטי הקשר" }).getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("set_speaker_contacts")).toEqual([{ p_speaker: 32, p_phone: "123 456 789", p_email: null, p_secretary_note: null, p_notes: null }]);

    // one tap on Monday 08:30: «יכולה», by the row's id in this edition's grid
    await (await slots(page)).getByRole("button", { name: /^שני 08:30–10:00: לא ידוע$/ }).click();
    const row0830 = week.rows.find((r) => r.kind === "lesson" && r.start_min === 510)!.id;
    await expect.poll(() => sb.rpc.get("set_slot_availability")).toEqual([{ p_edition: 7, p_speaker: 32, p_day: 1, p_row: row0830, p_kind: "can", p_note: null }]);

    await header.locator("[data-vetting]").click();
    await header.getByRole("group", { name: "אישור המדריך/ה" }).getByRole("button", { name: "דחייה" }).click();
    await expect.poll(() => sb.rpc.get("vet_speakers")).toEqual([{ p_speakers: [32], p_state: "rejected", p_note: null }]);

    await call(page).getByRole("button", { name: /^העברה לחבר\/ת צוות/ }).click();
    await call(page).getByLabel("להעביר ל…").selectOption({ label: "חניך/ה ב׳" });
    await call(page).getByRole("group", { name: "העברת הטיפול" }).getByRole("button", { name: "העברה" }).click();
    await expect.poll(() => sb.rpc.get("hand_over")).toEqual([{ p_approach: mine(32).id, p_to: 3, p_note: null }]);

    // every one of them carried the member's own token
    const pool = ["speaker_matches", "create_speaker", "get_speaker_contacts", "speaker_history", "speaker_activity", "claim_speaker", "answer_handover", "set_approach_status", "update_speaker", "set_speaker_contacts", "set_slot_availability", "vet_speakers", "hand_over"];
    for (const fn of pool) {
      const calls = sb.calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`);
      expect(calls.length, fn).toBeGreaterThan(0);
      for (const c of calls) expect(c.auth, fn).toBe(`Bearer ${session.access_token}`);
    }
  });

  test("a slot a content member marks: shown at once, put back when the database refuses it — the refusal in Hebrew; logistics only reads", async ({ page, context }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const week = demoWeek();
    week.edition.id = 7;
    /** A teammate's speaker's page, «דיוק לפי משבצת» opened, as this member. */
    const open = async (p: Page, role: "content" | "logistics", id: number) => {
      const sb = new FakeSupabase({ status: 200, body: member(role, id) });
      sb.answers.set("editions", [week.edition]);
      sb.answers.set("load_week", week);
      sb.answers.set("speaker_history", []);
      sb.answers.set("speaker_activity", []);
      sb.answers.set("get_speaker_contacts", null);
      await sb.attach(p);
      await signIn(p);
      await p.goto(`${mockUrl()}/speakers/9`);
      return slots(p);
    };

    // a content member, no approach of theirs: the tap shows while the answer waits, and goes back when it is a refusal
    const avail = await open(page, "content", 3); // ד״ר מרצה 09 is חניך/ה א׳'s
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/rest/v1/rpc/set_slot_availability", async (route) => {
      await held;
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "outside_grid", details: null, hint: null }) });
    });
    await avail.getByRole("button", { name: /^שני 10:00–11:30: לא ידוע$/ }).click();
    await expect(avail.getByRole("button", { name: /^שני 10:00–11:30: יכול$/ })).toBeVisible();
    release();
    await expect(page.getByRole("alert").filter({ hasText: "השעה הזו מחוץ לשורות של הרשת." })).toBeVisible();
    await expect(avail.getByRole("button", { name: /^שני 10:00–11:30: לא ידוע$/ })).toBeVisible();
    await expect(avail.locator("[data-slot-said]")).toHaveText("");
    await expect(page.getByText("outside_grid")).toHaveCount(0);

    // logistics: the same grid, read-only
    const read = await open(await context.newPage(), "logistics", 5);
    await expect(read.getByRole("img", { name: /^ראשון 08:30–10:00: לא יכול — דוגמה: לא בבקרים$/ })).toBeVisible();
    await expect(read.locator("[data-slot-grid], table").getByRole("button")).toHaveCount(0);
    await expect(read).toContainText("צפייה בלבד");
  });

  test("a refusal from the create reads in Hebrew beside the form; a content member does not vet", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const week = demoWeek();
    week.edition.id = 7;
    const sb = new FakeSupabase({ status: 200, body: member("content", 2) });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("speaker_matches", []);
    await sb.attach(page);
    await signIn(page);
    await page.route("**/rest/v1/rpc/create_speaker", (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "speaker_similar", details: null, hint: null }) }),
    );
    await page.goto(`${mockUrl()}/speakers/new`);
    await page.getByLabel("שם המרצה (בלי תואר)").fill("פלונית לדוגמה");
    await page.getByRole("button", { name: "להמשיך", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: /^לאשר כבר עכשיו/ })).toHaveCount(0); // a content member does not vet
    await page.getByRole("button", { name: "הוספה למאגר" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "ייתכן שהמרצה כבר במאגר" })).toBeVisible();
    await expect(page.getByText("speaker_similar")).toHaveCount(0);
    await expect(page).toHaveURL(/\/speakers\/new$/);
    await expect.poll(() => sb.rpc.get("speaker_matches")?.length ?? 0).toBeGreaterThanOrEqual(2); // searched again
  });

  test("a content member: no vetting on a page, «כל הצוות» reads nothing new, the offers line's hand-over on the wire", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions and the wire format");
    const week = demoWeek();
    week.edition.id = 7;
    const mine = (speaker: number) => week.approaches.find((a) => a.speaker_id === speaker)!;
    const sb = new FakeSupabase({ status: 200, body: member("content", 1) });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("speaker_history", []);
    sb.answers.set("speaker_activity", []);
    sb.answers.set("get_speaker_contacts", null);
    sb.answers.set("answer_handover", null);
    await sb.attach(page);
    const session = await signIn(page);
    sb.token = session.access_token;
    // a content member's header lists only the trainee's pages (the reset, phase 2): no «אישורים»
    await page.goto(`${mockUrl()}/speakers/56`);
    await expect(nav(page).getByRole("link", { name: /אישורים/ })).toHaveCount(0);
    // who agreed: the chip says she waits, never a button — the instructor approves
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 2 }) });
    await expect(header.locator('[data-vetting="pending"]')).toContainText("ממתינה לאישור");
    await expect(header.getByRole("button", { name: /ממתינה לאישור/ })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "אישור המדריך/ה" })).toHaveCount(0);

    // the team view is the loaded week: no call of its own
    await nav(page).getByRole("link", { name: "מרצים" }).click();
    const before = new Set(sb.rpc.keys());
    await page.getByRole("link", { name: "כל הצוות" }).click();
    await expect(block(page, "חניך/ה א׳")).toBeVisible();
    expect(new Set(sb.rpc.keys())).toEqual(before);

    await page.getByRole("link", { name: "לרשימה" }).click();
    await page.locator('[data-offers] [data-offer="13"]').click();
    await call(page).getByRole("group", { name: "העברה שמחכה לך" }).getByRole("button", { name: "קבלת הטיפול" }).click();
    await expect.poll(() => sb.rpc.get("answer_handover")).toEqual([{ p_approach: mine(13).id, p_accept: true, p_note: null }]);
    for (const c of sb.calls.filter((x) => x.path === "/rest/v1/rpc/answer_handover")) expect(c.auth).toBe(`Bearer ${session.access_token}`);
    expect(sb.rpc.get("vet_speakers")).toBeUndefined();
  });
});
