// From placement to arrival (milestone 3) in a real browser — the stages on the lesson page (since the reset's phase 5
// the writing grid's panel shows a closed lesson's summary: its five dots, «לדף השיעור», «פעולות נוספות»). Demo build,
// every width: a payment request saved on the lesson page and approved (and another refused) from «אישורים», the badge
// counting requests; the summary message (blocked without a template and while the date is TBD, then sent; a change
// after it raises «לעדכן את המרצה», sending again clears it), an escort with the gap warning (the panel lists it once
// saved), sources and their dot, a trainee's delete listing the lessons they escort; on «ימים» a closed lesson's next
// step — in the words «המרצים שלי» had — opens its lesson page at that step. Mock build: every stage RPC goes out by the
// contract's parameter names (tests/sql/stages.test.ts pins them in the database) with the member's own token — the
// transport as the request's pickup (set_transport_request) and the driver's half (set_transport_driver), never the old
// whole-details write; staff's `/grid` is their week at `/`; an archive's lesson reads its sheet and transport only; a
// logistics member (`/grid` → «השבוע») is offered «שולם» and the transport only, and decides nothing in a practice week. Synthetic people and wording only («נוסח לדוגמה»):
// the real template is the instructor's. «אישורים» and the transport board themselves: approvals.spec.ts.
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { demoWeek } from "../../src/data/demoWeek";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { expectSections, goSection, INLINE_SECTIONS, LOGISTICS_SECTIONS, noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });
const card = (page: Page, speaker: string) => page.locator("[data-lesson-id]").filter({ hasText: speaker });

/** A closed lesson's panel (a summary since the reset's phase 5): on a phone or a tablet, its day first. */
async function openLesson(page: Page, info: TestInfo, day: string, speaker: string): Promise<Locator> {
  if (info.project.name !== "desktop") await page.getByRole("tab", { name: day }).click();
  await card(page, speaker).first().click();
  const panel = page.getByRole("dialog", { name: "שיעור סגור" });
  await expect(panel).toBeVisible();
  return panel;
}

/** A step of the lesson page (src/screens/lesson/LessonScreen.tsx), opened. */
const step = (page: Page, key: string) => page.locator(`[data-page-step="${key}"]`);
async function openStep(page: Page, key: string): Promise<Locator> {
  const toggle = step(page, key).locator("h3 button");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  return step(page, key);
}

/** A closed lesson's page from the grid — its card opens the panel, «לדף השיעור» the page — at the step `key`, opened. */
async function lessonPage(page: Page, info: TestInfo, day: string, speaker: string, key: string): Promise<Locator> {
  const panel = await openLesson(page, info, day, speaker);
  await panel.getByRole("link", { name: "לדף השיעור" }).click();
  await expect(page).toHaveURL(/\/lesson\/\d+$/);
  await expect(page.locator("[data-lesson-header]")).toContainText(speaker);
  return openStep(page, key);
}

test.describe("demo build", () => {
  test("the cheat-sheet inserts a variable and leaves the cursor after it at once — a late frame moves nothing", async ({ page }) => {
    // CI's headless browser paints late: a cursor placed a frame after the insert
    // split whatever was typed in between. Every frame here comes 300ms late.
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => (setTimeout(() => raf(cb), 300), 0);
    });
    await page.goto(`${demoUrl()}/settings/templates`);
    const body = page.getByLabel("הנוסח", { exact: true });
    await body.fill("נוסח לדוגמה ל{{פנייה}}: [[מוזמן|מוזמנת]] ללמד ביום {{יום}}, {{תאריך}}, {{שעה}} ({{משך}}), ב");
    await page.getByRole("button", { name: "הוספת {{מקום}} לנוסח" }).click();
    await body.pressSequentially(". הנושא: {{כותרת}}.");
    await expect(body).toHaveValue(
      "נוסח לדוגמה ל{{פנייה}}: [[מוזמן|מוזמנת]] ללמד ביום {{יום}}, {{תאריך}}, {{שעה}} ({{משך}}), ב{{מקום}}. הנושא: {{כותרת}}.",
    );
    await expect(body).toBeFocused();
  });

  test("payment: the handler asks on the lesson page, the instructor approves (and rejects) from the queue; the badge counts requests", async ({ page }, info) => {
    await page.goto(demoUrl());
    const badge = nav(page).getByRole("link", { name: /אישורים/ });
    await expect(badge).toHaveAccessibleName("אישורים, 2 ממתינים"); // the demo's waiting request, and a speaker who agreed and waits (v14)

    // the grid's panel is a summary: the stages are worked on the lesson page
    const pay = await lessonPage(page, info, "ראשון", "מרצה 07", "pay");
    await expect(pay).toHaveAttribute("data-state", "na");
    const form = pay.getByRole("form", { name: "בקשת תשלום והסעה" });
    await form.getByRole("radio", { name: "תשלום", exact: true }).check();
    await form.getByRole("button", { name: "שליחה לאישור" }).click();
    await expect(form.getByRole("alert")).toContainText("צריך לכתוב את הסכום"); // never a default amount
    await form.getByLabel("סכום בשקלים").fill("150");
    await form.getByRole("radio", { name: "הלוך ושוב" }).check();
    // a transport asks for its pickup (the demo's user is a global admin: the pickup is theirs to read)
    await form.getByLabel("כתובת איסוף").fill("כתובת לדוגמה 7");
    await form.getByLabel("שעת איסוף").fill("13:30");
    await form.getByRole("button", { name: "שליחה לאישור" }).click();
    await expect(toast(page, "הבקשה נשלחה לאישור")).toBeVisible();
    await expect(pay).toHaveAttribute("data-state", "waiting");
    await expect(pay).toContainText("150 ₪");
    // one primary action: the decision (the demo's user is the instructor); the saved request waits behind «שינוי הבקשה»
    await expect(pay.getByRole("group", { name: "החלטה על הבקשה" })).toBeVisible();
    await expect(pay.getByRole("form", { name: "בקשת תשלום והסעה" })).toHaveCount(0);
    await pay.getByRole("button", { name: "שינוי הבקשה" }).click();
    await expect(pay.getByRole("form", { name: "בקשת תשלום והסעה" }).getByLabel("סכום בשקלים")).toHaveValue("150");
    await pay.getByRole("form", { name: "בקשת תשלום והסעה" }).getByRole("button", { name: "ביטול" }).click();
    await expect(pay.getByRole("form", { name: "בקשת תשלום והסעה" })).toHaveCount(0);
    await expect(pay.getByRole("button", { name: "שינוי הבקשה" })).toBeFocused();
    await expect(badge).toHaveAccessibleName("אישורים, 3 ממתינים");
    await noSidewaysScroll(page);

    await badge.click();
    const requests = page.getByRole("list", { name: "בקשות שממתינות לאישור" });
    await expect(requests.getByRole("listitem")).toHaveCount(2);
    await expect(requests.getByRole("listitem").filter({ hasText: "מרצה 07" })).toContainText("150 ₪ · הלוך ושוב");
    await noSidewaysScroll(page);
    await requests.getByRole("button", { name: "אישור הבקשה של מרצה 07" }).click();
    await expect(toast(page, "הבקשה אושרה")).toBeVisible();
    await expect(requests.getByRole("listitem")).toHaveCount(1);
    await expect(badge).toHaveAccessibleName("אישורים, 2 ממתינים");

    await requests.getByRole("button", { name: "דחיית הבקשה של פרופ׳ מרצה 04" }).click();
    await page.getByRole("group", { name: "דחיית הבקשה של פרופ׳ מרצה 04" }).getByLabel("למה? (לא חובה, גלוי לצוות)").fill("נתון לדוגמה: לבדוק שוב");
    await page.getByRole("button", { name: "לא לאשר" }).click();
    await expect(toast(page, "הבקשה לא אושרה")).toBeVisible();
    await expect(page.getByText("אין בקשות שממתינות לאישור.")).toBeVisible();
    await expect(badge).toHaveAccessibleName("אישורים, 1 ממתין");

    // back on the week: approved — the card's first dot is done
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    if (info.project.name !== "desktop") await page.getByRole("tab", { name: "ראשון" }).click();
    await expect(card(page, "מרצה 07").locator('[data-stage="pay"]')).toHaveAttribute("data-state", "done");
  });

  test("the summary message: blocked without a template, then by the TBD date; sent; a change after it → «לעדכן את המרצה», sent again", async ({ page }, info) => {
    const wide = info.project.name === "desktop";
    await page.goto(demoUrl());
    let msg = await lessonPage(page, info, "שני", "מרצה 12", "msg");
    await expect(msg.getByRole("list", { name: "מה חסר כדי לשלוח" })).toContainText("אין עדיין נוסח להודעת הסיכום");
    await expect(msg.getByRole("button", { name: "סומן כנשלח" })).toHaveCount(0);
    await noSidewaysScroll(page);

    // the template is the instructor's, pasted in «הגדרות ← תבניות»
    await msg.getByRole("link", { name: /לנוסח, בהגדרות/ }).click();
    await expect(page).toHaveURL(/\/settings\/templates$/);
    await expect(page.getByRole("tab", { name: "תבניות" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("ריק: ההודעות חסומות")).toBeVisible();
    const body = page.getByLabel("הנוסח", { exact: true });
    await body.fill("נוסח לדוגמה ל{{פנייה}}: [[מוזמן|מוזמנת]] ללמד ביום {{יום}}, {{תאריך}}, {{שעה}} ({{משך}}), ב");
    await page.getByRole("button", { name: "הוספת {{מקום}} לנוסח" }).click(); // the cheat-sheet inserts at the cursor
    await body.press("End");
    await body.pressSequentially(". הנושא: {{כותרת}}. [[תשלום:התשלום {{תשלום}} ש״ח.|בהתנדבות.]]");
    const preview = page.getByRole("region", { name: "תצוגה מקדימה של הנוסח" });
    await expect(preview).toContainText("נוסח לדוגמה לד״ר פלונית לדוגמה: מוזמנת ללמד ביום שני");
    await expect(preview).toContainText("בחדר לדוגמה. הנושא: כותרת לדוגמה. התשלום 500 ש״ח.");
    await preview.getByRole("group", { name: "המרצה" }).getByRole("radio", { name: "זכר" }).check();
    await expect(preview).toContainText("פלוני לדוגמה: מוזמן ללמד");
    await preview.getByRole("group", { name: "תשלום" }).getByRole("radio", { name: "בהתנדבות" }).check();
    await expect(preview).toContainText("הנושא: כותרת לדוגמה. בהתנדבות.");
    await expect(preview.getByRole("list", { name: "מה חסר בתצוגה" })).toContainText("תאריך השבוע עוד לא נקבע");
    await page.getByRole("button", { name: "שמירת הנוסח" }).click();
    await expect(toast(page, "הנוסח נשמר")).toBeVisible();
    await noSidewaysScroll(page);

    // back on the week: the week's date is still TBD — still blocked, the preview says where
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    msg = await lessonPage(page, info, "שני", "מרצה 12", "msg");
    await expect(msg.getByRole("list", { name: "מה חסר כדי לשלוח" })).toHaveText("תאריך השבוע עוד לא נקבע (TBD).");
    await expect(msg.getByRole("region", { name: "תצוגה מקדימה של ההודעה" })).toContainText("«TBD: תאריך»");

    // the date, in «הגדרות ← מחזור»
    await goSection(page, "הגדרות");
    await page.getByRole("tab", { name: "מחזור" }).click();
    const editions = page.getByRole(wide ? "table" : "list", { name: "המחזורים" });
    await editions.getByRole("button", { name: "עריכת התאריכים של הדגמה" }).click();
    await editions.getByLabel("תאריך הפתיחה (יום ראשון)").fill("2027-02-14");
    await editions.getByRole("button", { name: "שמירה", exact: true }).click();
    await expect(toast(page, "התאריכים נשמרו")).toBeVisible();

    // now it can go: the speaker's gender, the calendar's date, the teaching time in words, the amount
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    msg = await lessonPage(page, info, "שני", "מרצה 12", "msg");
    const text = msg.getByRole("region", { name: "תצוגה מקדימה של ההודעה" });
    await expect(text).toContainText("נוסח לדוגמה לפרופ׳ מרצה 12: מוזמנת ללמד ביום שני, 15.2.2027");
    await expect(text).toContainText("20:00–21:15 (שעה ורבע), בבית מדרש. הנושא: שיעור לדוגמה 11. התשלום 200 ש״ח.");
    await expect(msg.getByRole("list", { name: "מה חסר כדי לשלוח" })).toHaveCount(0);
    // the demo's phone is a placeholder: WhatsApp opens with the text and no recipient; mail goes to the example address
    await expect(msg.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=%D7%A0%D7%95%D7%A1%D7%97/);
    await expect(msg.getByRole("link", { name: "מייל" })).toHaveAttribute("href", /^mailto:speaker12@example\.org\?subject=.+&body=.+/);
    await msg.getByRole("button", { name: "סומן כנשלח" }).click();
    await expect(toast(page, "סומן שההודעה נשלחה")).toBeVisible();
    await expect(msg).toHaveAttribute("data-state", "done");
    await expect(msg).toContainText("נשלחה ·");
    await noSidewaysScroll(page);

    // a change after it went out: moved (a drag on the grid, on a desktop), or retitled (phone and tablet, on the page)
    if (wide) {
      await nav(page).getByRole("link", { name: "השבוע" }).click();
      // both ends in view (the grid opens at its top; a click on the card used to scroll it there), measured after
      const from = card(page, "מרצה 12");
      const to = page.locator('[data-drop="cell:1:1350:1440"]');
      await from.scrollIntoViewIfNeeded();
      await to.scrollIntoViewIfNeeded();
      await expect(from).toBeInViewport();
      const a = (await from.boundingBox())!;
      const b = (await to.boundingBox())!;
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
      await page.mouse.up();
      await expect(toast(page, "השיעור הוזז")).toBeVisible();
      await expect(card(page, "מרצה 12").locator("[data-reconfirm]")).toBeVisible();
      await expect(card(page, "מרצה 12")).toHaveAttribute("aria-label", /22:30–00:00, תלמוד, הלכה ומדרש, לעדכן את המרצה$/); // the topic, then the flag
      msg = await lessonPage(page, info, "שני", "מרצה 12", "msg");
    } else {
      const details = (await openStep(page, "close")).getByRole("region", { name: "פרטי השיעור" });
      await details.getByRole("button", { name: "עריכה" }).click();
      await details.getByLabel("כותרת").fill("שיעור לדוגמה, כותרת חדשה");
      await details.getByRole("button", { name: "שמירה" }).click();
      await expect(toast(page, /^נשמר×?$/)).toBeVisible(); // not the demo banner («…שום דבר לא נשמר»); the page's toast has its «×»
      msg = await openStep(page, "msg");
    }
    await expect(msg).toHaveAttribute("data-state", "problem");
    await expect(msg).toContainText("לעדכן את המרצה");
    await expect(msg.getByRole("region", { name: "תצוגה מקדימה של ההודעה" })).toContainText(wide ? "22:30–23:45" : "שיעור לדוגמה, כותרת חדשה");
    await msg.getByRole("button", { name: "סומן כנשלח" }).click();
    await expect(toast(page, "סומן שההודעה נשלחה")).toBeVisible();
    await expect(msg).toHaveAttribute("data-state", "done");
    await noSidewaysScroll(page);
    // the grid's card: the flag is gone
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    if (!wide) await page.getByRole("tab", { name: "שני" }).click();
    await expect(card(page, "מרצה 12")).toBeVisible();
    await expect(card(page, "מרצה 12").locator("[data-reconfirm]")).toHaveCount(0);
  });

  test("escorts and sources: each trainee's load, the gap warning before and after saving, the dots; deleting a trainee lists their lessons", async ({ page }, info) => {
    await page.goto(demoUrl());
    const escort = await lessonPage(page, info, "רביעי", "מרצה 19", "escort");
    const who = escort.getByLabel("מלווה מרשימת החניכים");
    await expect(who.locator("option").filter({ hasText: "מלווה לדוגמה ב׳" })).toHaveText("מלווה לדוגמה ב׳ · 2 שיעורים");
    await who.selectOption({ label: "מלווה לדוגמה ד׳ · 2 שיעורים" }); // a lesson, and Sunday's memorial time as the family's liaison (5ב-2)
    await expect(escort.getByRole("list", { name: "שיעורים קרובים של המלווה" })).toContainText("צמוד, בלי הפסקה (הצעה: לפחות 30 דקות)");
    await expect(escort.getByRole("list", { name: "משהו שחשוב לדעת" })).toHaveCount(0); // no phrases pasted yet
    await expect(escort).toContainText("עוד אין ניסוחים");
    await escort.getByRole("button", { name: "שמירה", exact: true }).click();
    await expect(toast(page, "המלווה נשמר/ה")).toBeVisible();
    await expect(escort).toHaveAttribute("data-state", "done");
    await noSidewaysScroll(page);

    const sources = (await openStep(page, "sources")).getByRole("form", { name: "מקורות", exact: true });
    await sources.getByRole("radio", { name: "מצגת", exact: true }).check();
    await expect(sources.getByRole("checkbox", { name: "להכניס למקראה" })).toBeDisabled(); // nothing to print
    await sources.getByLabel("קישור למצגת").fill("slides.example/presentation");
    await sources.getByRole("button", { name: "שמירה", exact: true }).click();
    await expect(sources.getByRole("alert")).toContainText("הקישור צריך להתחיל ב-http://");
    await sources.getByRole("radio", { name: "דף מקורות", exact: true }).check();
    await sources.getByLabel("קישור למצגת").fill("");
    await sources.getByRole("radio", { name: "להדפיס מראש" }).check();
    await sources.getByRole("checkbox", { name: "להכניס למקראה" }).check();
    await sources.getByRole("button", { name: "שמירה", exact: true }).click();
    await expect(toast(page, "המקורות נשמרו")).toBeVisible();
    await noSidewaysScroll(page);

    // the grid's card: the dots; marked for the reader, but no file yet: the «מקראה» dot is not green — it says what
    // the manifest says (5ב-1 review)
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    if (info.project.name !== "desktop") await page.getByRole("tab", { name: "רביעי" }).click();
    for (const k of ["escort", "sources"]) await expect(card(page, "מרצה 19").locator(`[data-stage="${k}"]`)).toHaveAttribute("data-state", "done");
    const readerDot = card(page, "מרצה 19").locator('[data-stage="reader"]');
    await expect(readerDot).toHaveAttribute("data-state", "open");
    await expect(readerDot).toHaveAttribute("title", "מקראה: חסר קובץ");
    // the panel's summary: the soft warning (src/rules) once saved, the five stages to read
    const panel = await openLesson(page, info, "רביעי", "מרצה 19");
    await expect(panel.getByText(/«מלווה לדוגמה ד׳» מלווה שני שיעורים צמודים/)).toBeVisible();
    await expect(panel.locator("[data-panel-stages] li[data-stage]")).toHaveCount(5);
    await expect(panel.locator('[data-panel-stages] li[data-stage="escort"]')).toHaveAttribute("data-state", "done");
    await noSidewaysScroll(page);

    // «פתיחה מחדש» (under «פעולות נוספות») says first what goes with the speaker: the stages start over
    await panel.getByText("פעולות נוספות").click();
    await panel.getByRole("button", { name: "פתיחה מחדש (חזרה לטיוטה)" }).click();
    const ask = panel.getByRole("group", { name: "אישור" });
    await expect(ask).toContainText("בקשת ההסעה ופרטיה · המלווה · המקורות");
    await ask.getByRole("button", { name: "ביטול" }).press("Enter");
    await expect(panel.getByRole("button", { name: "פתיחה מחדש (חזרה לטיוטה)" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "פתיחה מחדש (חזרה לטיוטה)" })).toBeFocused(); // the confirm cancelled: the focus back at the button

    // «הגדרות ← חניכים»: deleting that escort lists the lessons they would leave
    await goSection(page, "הגדרות");
    await page.getByRole("tab", { name: "חניכים" }).click();
    if (info.project.name !== "desktop") await page.getByRole("button", { name: "עריכת מלווה לדוגמה ד׳" }).click();
    await page.getByRole("button", { name: "מחיקת מלווה לדוגמה ד׳" }).click();
    const confirm = page.getByRole("group", { name: "אישור" });
    await expect(confirm.getByRole("list", { name: "השיעורים שיישארו בלי מלווה" }).getByRole("listitem")).toHaveCount(3);
    await expect(confirm).toContainText("רביעי 10:00–11:30");
    await expect(confirm).toContainText("ראשון 13:00–13:15 · זמן זיכרון"); // the liaison of a memorial time is listed too
    await noSidewaysScroll(page);
    await confirm.getByRole("button", { name: "מחיקה" }).click();
    await expect(toast(page, "מלווה לדוגמה ד׳ הוסר/ה מהרשימה")).toBeVisible();
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    if (info.project.name !== "desktop") await page.getByRole("tab", { name: "רביעי" }).click();
    await expect(card(page, "מרצה 19").locator('[data-stage="escort"]')).toHaveAttribute("data-state", "open");
  });

  test("«ימים»: a closed lesson's next step in «המרצים שלי»'s words, and its link opens the lesson page there; a request decided there moves it on", async ({ page }) => {
    await page.goto(`${demoUrl()}/day/1`);
    const slot = (speaker: string) => page.locator("[data-slot-card]").filter({ hasText: speaker });
    await expect(slot("מרצה 04")).toContainText("תשלום/הסעה");
    await expect(slot("מרצה 08")).toContainText("לעדכן את המרצה");
    await expect(slot("מרצה 12")).toContainText("לשלוח סיכום");
    await noSidewaysScroll(page);

    // the waiting request, on its lesson page: what was asked, «ממתין לאישור» once — the staff's or logistics' to decide
    await slot("מרצה 04").getByRole("link", { name: "לשיעור" }).click();
    await expect(page).toHaveURL(/\/lesson\/\d+\?step=pay$/);
    const pay = page.locator('[data-page-step="pay"]');
    await expect(pay).toContainText("200 ₪");
    await expect(pay).toContainText("הלוך ושוב");
    await expect(pay.locator("[data-approval]")).toHaveText("ממתין לאישור");
    await expect(pay).not.toContainText("ממתין לאישור המדריך/ה");
    await pay.getByRole("group", { name: "החלטה על הבקשה" }).getByRole("button", { name: "אישור הבקשה" }).click();
    await expect(toast(page, "הבקשה אושרה")).toBeVisible();
    await nav(page).getByRole("link", { name: "ימים" }).click();
    await page.getByRole("tablist", { name: "ימי השבוע" }).getByRole("tab", { name: /^שני/ }).click();
    await expect(slot("מרצה 04")).toContainText("לשלוח סיכום");

    // the other days' steps: «חסרים מקורות», «חסר מלווה» (its link at the escort's step), and one all in place
    await page.getByRole("tablist", { name: "ימי השבוע" }).getByRole("tab", { name: /^רביעי/ }).click();
    await expect(slot("מרצה 20")).toContainText("חסרים מקורות");
    await page.getByRole("tablist", { name: "ימי השבוע" }).getByRole("tab", { name: /^שלישי/ }).click();
    await expect(slot("מרצה 16")).toContainText("הכול מוכן");
    await page.getByRole("tablist", { name: "ימי השבוע" }).getByRole("tab", { name: /^חמישי/ }).click();
    await expect(slot("מרצה 24")).toContainText("חסר מלווה");
    await slot("מרצה 24").getByRole("link", { name: "לשיעור" }).click();
    await expect(page).toHaveURL(/\/lesson\/\d+\?step=escort$/);
    await expect(page.locator('[data-page-step="escort"]').getByLabel("מלווה מרשימת החניכים")).toBeVisible();
  });
});

test.describe("mock build", () => {
  test("every stage command goes out as its RPC, by the contract's parameter names, with the member's token", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.settings.confirm_template = "נוסח לדוגמה ל{{פנייה}}, {{שעה}}.";
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "admin@example.org", display_name: "מדריך/ה לדוגמה", global_admin: true, memberships: [{ edition_id: null, role: "admin", member_id: 1 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("get_speaker_contacts", { phone: null, email: null, secretary_note: null, notes: null });
    sb.answers.set("get_transport_details", { pickup_address: "כתובת לדוגמה", pickup_time: null, pickup_min: null, driver_name: null, driver_phone: null, arranged: false });
    for (const fn of ["set_payment", "set_transport_request", "set_transport_driver", "decide_payments", "mark_confirm_sent", "set_escort", "set_sources", "set_paid", "set_confirm_template", "set_duty_phrases"]) {
      sb.answers.set(fn, null);
    }
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;
    // the writing grid has one address (the reset, phase 5): staff's `/grid` is their week at `/`
    await page.goto(`${mockUrl()}/grid`);
    await expect(page).toHaveURL(new RegExp(`${mockUrl()}/$`));
    await expect(page.getByRole("grid", { name: "רשת השבוע" })).toBeVisible();
    const lessonOf = (day: number, start: number) => week.lessons.find((l) => l.day === day && l.start_min === start && l.state === "closed")!.id;

    // a lesson with nothing yet, on its page: the request (and its pickup), the escort, the sources
    const seven = lessonOf(0, 870);
    await page.goto(`${mockUrl()}/lesson/${seven}?step=pay`);
    const pay = step(page, "pay");
    await pay.getByRole("radio", { name: "תשלום", exact: true }).check();
    await pay.getByLabel("סכום בשקלים").fill("1,500");
    await pay.getByRole("radio", { name: "הלוך", exact: true }).check();
    await expect(pay.getByLabel("כתובת איסוף")).toHaveValue("כתובת לדוגמה"); // as read
    await pay.getByLabel("שעת איסוף").fill("13:45");
    await pay.getByRole("button", { name: "שליחה לאישור" }).click();
    await expect.poll(() => sb.rpc.get("set_transport_request")).toEqual([
      // 13:45 on the lesson's day: minute 825, before the 14:30 start
      { p_lesson: seven, p_fields: { pickup_address: "כתובת לדוגמה", pickup_time: "13:45", pickup_min: 825 } },
    ]);
    expect(sb.rpc.get("set_payment")).toEqual([{ p_lesson: seven, p_version: 1, p_pay_amount: 1500, p_transport: "one_way" }]);

    const escort = await openStep(page, "escort");
    await escort.getByLabel("מלווה מרשימת החניכים").selectOption({ label: "מלווה לדוגמה א׳ · שיעור אחד" });
    await escort.getByLabel("הערה למלווה (לא חובה)").fill("נתון לדוגמה");
    await escort.getByRole("button", { name: "שמירה", exact: true }).click();
    await expect.poll(() => sb.rpc.get("set_escort")).toEqual([{ p_lesson: seven, p_version: 1, p_roster: 1, p_self_intro: false, p_note: "נתון לדוגמה" }]);

    const sources = (await openStep(page, "sources")).getByRole("form", { name: "מקורות", exact: true });
    await sources.getByRole("radio", { name: "דף מקורות ומצגת" }).check();
    await sources.getByLabel("קישור למצגת").fill("https://slides.example/demo");
    await sources.getByRole("radio", { name: "להדפיס באותו יום" }).check();
    await sources.getByRole("button", { name: "שמירה", exact: true }).click();
    await expect.poll(() => sb.rpc.get("set_sources")).toEqual([
      { p_lesson: seven, p_version: 1, p_kind: "sheet_presentation", p_print_when: "same_day", p_note: null, p_url: "https://slides.example/demo", p_in_reader: false },
    ]);

    // an approved transport: the details read one lesson at a time; the staff set the driver's half only
    const one = lessonOf(0, 510);
    await page.goto(`${mockUrl()}/lesson/${one}?step=pay`);
    const details = step(page, "pay").getByRole("group", { name: "פרטי ההסעה" });
    await expect(details).toContainText("כתובת לדוגמה");
    expect(sb.rpc.get("get_transport_details")).toContainEqual({ p_lesson: one });
    await expect(details.getByRole("button", { name: "עריכת פרטי ההסעה" })).toHaveCount(0); // the old whole-details form is gone
    await details.getByRole("button", { name: "עריכת הנהג/ת" }).click();
    const driver = details.getByRole("form", { name: /^עריכת הנהג\/ת/ });
    await driver.getByLabel("טלפון הנהג/ת").fill("123 456 789");
    await driver.getByRole("checkbox", { name: "סודר" }).check();
    // meanwhile the escort sends a pickup address through their link: the driver's half never writes the pickup
    sb.answers.set("get_transport_details", { pickup_address: "כתובת מהמלווה לדוגמה", pickup_time: null, pickup_min: null, driver_name: null, driver_phone: null, arranged: false });
    await driver.getByRole("button", { name: "שמירה", exact: true }).click();
    await expect.poll(() => sb.rpc.get("set_transport_driver")).toEqual([{ p_lesson: one, p_fields: { driver_phone: "123 456 789", arranged: true } }]);
    await expect(toast(page, "פרטי הנהג/ת נשמרו")).toBeVisible();

    // an approved payment: «שולם»; the message: «סומן כנשלח»
    const twelve = lessonOf(1, 1200);
    await page.goto(`${mockUrl()}/lesson/${twelve}?step=pay`);
    await step(page, "pay").getByRole("button", { name: "סימון ששולם" }).click();
    await expect.poll(() => sb.rpc.get("set_paid")).toEqual([{ p_lesson: twelve, p_paid: true }]);
    const msg = await openStep(page, "msg");
    await expect(msg.getByRole("region", { name: "תצוגה מקדימה של ההודעה" })).toHaveText(/נוסח לדוגמה לפרופ׳ מרצה 12, \u200F\u200E20:00–21:15\./); // v14: the range left to right (RLM, LRM)
    expect(sb.rpc.get("get_speaker_contacts")).toContainEqual({ p_speaker: 12 });
    await msg.getByRole("button", { name: "סומן כנשלח" }).click();
    await expect.poll(() => sb.rpc.get("mark_confirm_sent")).toEqual([{ p_lesson: twelve, p_version: 1 }]);

    // the approvals queue: the waiting request, at the version on screen
    await nav(page).getByRole("link", { name: /אישורים/ }).click();
    await page.getByRole("button", { name: "אישור הבקשה של פרופ׳ מרצה 04" }).click();
    await expect.poll(() => sb.rpc.get("decide_payments")).toEqual([{ p_lessons: [lessonOf(1, 510)], p_versions: [1], p_decision: "approved", p_note: null }]);

    // «הגדרות ← תבניות»: the template and the phrases
    await goSection(page, "הגדרות");
    await page.getByRole("tab", { name: "תבניות" }).click();
    await page.getByLabel("הנוסח", { exact: true }).fill("נוסח לדוגמה, מעודכן: {{פנייה}}");
    await page.getByRole("button", { name: "שמירת הנוסח" }).click();
    await expect.poll(() => sb.rpc.get("set_confirm_template")).toEqual([{ p_edition: 7, p_body: "נוסח לדוגמה, מעודכן: {{פנייה}}" }]);
    await page.getByLabel("מתי הניסוח חל").selectOption({ label: "הצגה עצמית" });
    await page.getByLabel("ניסוח (אפשר כמה, ניסוח בכל שורה)").fill("ניסוח לדוגמה א\nניסוח לדוגמה ב");
    await page.getByRole("button", { name: "הוספה", exact: true }).click();
    await expect.poll(() => sb.rpc.get("set_duty_phrases")).toEqual([
      {
        p_edition: 7,
        p_phrases: [
          { when: "self_intro", text: "ניסוח לדוגמה א" },
          { when: "self_intro", text: "ניסוח לדוגמה ב" },
        ],
      },
    ]);

    // every one of them carried the member's own token; the old whole-details write never went (the reset, phase 5)
    const rpcs = ["set_payment", "set_transport_request", "set_escort", "set_sources", "get_transport_details", "set_transport_driver", "set_paid", "get_speaker_contacts", "mark_confirm_sent", "decide_payments", "set_confirm_template", "set_duty_phrases"];
    for (const fn of rpcs) {
      const calls = sb.calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`);
      expect(calls.length, fn).toBeGreaterThan(0);
      for (const c of calls) expect(c.auth, fn).toBe(`Bearer ${session.access_token}`);
    }
    expect(sb.rpc.get("set_transport_details")).toBeUndefined();
  });

  test("an archive's lesson: the pay step reads last year's sheet and transport — no form, no driver, nothing written", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const week = demoWeek();
    week.edition = { ...week.edition, id: 9, kind: "archive", label: "ארכיון לדוגמה" };
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "admin@example.org", display_name: "מדריך/ה לדוגמה", global_admin: true, memberships: [{ edition_id: null, role: "admin", member_id: 1 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("get_import_note", "נתון לדוגמה מגיליון המעקב");
    sb.answers.set("get_transport_details", { pickup_address: "כתובת לדוגמה", pickup_time: "07:30", pickup_min: 450, driver_name: "נהג/ת לדוגמה", driver_phone: null, arranged: true });
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;
    // Sunday 08:30: an approved transport
    const lesson = week.lessons.find((l) => l.day === 0 && l.start_min === 510 && l.state === "closed")!;
    expect(lesson.transport).not.toBe("none");
    await page.goto(`${mockUrl()}/lesson/${lesson.id}?step=pay`);
    const pay = step(page, "pay");
    await expect(pay.getByRole("region", { name: "מגיליון המעקב של אשתקד" })).toContainText("נתון לדוגמה מגיליון המעקב");
    // the transport to read, as the caller may read it (a global admin: the details) — no edit of any part
    const read = pay.locator("[data-transport-read]");
    await expect(read).toHaveAttribute("role", "group");
    await expect(read).toHaveAccessibleName("פרטי ההסעה");
    await expect(read).toContainText("כתובת לדוגמה");
    await expect(read).toContainText("נהג/ת לדוגמה");
    await expect(read).toContainText("ההסעה סודרה");
    await expect(pay.locator("[data-staff-transport]")).toHaveCount(0);
    await expect(pay.getByRole("form")).toHaveCount(0);
    await expect(pay.getByRole("button", { name: /^עריכת (פרטי ההסעה|הנהג)/ })).toHaveCount(0);
    await expect(pay.getByRole("button", { name: "שינוי הבקשה" })).toHaveCount(0);
    expect(sb.rpc.get("get_transport_details")).toEqual([{ p_lesson: lesson.id }]);
    expect(sb.rpc.get("get_import_note")).toEqual([{ p_lesson: lesson.id }]);
    for (const fn of ["get_transport_details", "get_import_note"]) {
      for (const c of sb.calls.filter((x) => x.path === `/rest/v1/rpc/${fn}`)) expect(c.auth, fn).toBe(`Bearer ${session.access_token}`);
    }
    for (const fn of ["set_transport_details", "set_transport_driver", "set_transport_request", "set_payment"]) expect(sb.rpc.get(fn), fn).toBeUndefined();
  });

  test("logistics: reads the schedule and the amounts, marks «שולם», sees approved transport — and is offered nothing else", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions");
    const week = demoWeek();
    week.edition.id = 7;
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "logistics@example.org", display_name: "לוגיסטיקה לדוגמה", global_admin: false, memberships: [{ edition_id: 7, role: "logistics", member_id: 5 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("get_transport_details", { pickup_address: "כתובת לדוגמה", pickup_time: "אחרי השיעור (לדוגמה)", driver_name: "נהג/ת לדוגמה", driver_phone: null, arranged: true });
    sb.answers.set("set_paid", null);
    await sb.attach(page);
    const session = await signIn(page, "logistics@example.org");
    sb.token = session.access_token;
    // the writing grid is the staff's (the reset, phase 5): logistics' `/grid` is «השבוע» to read
    await page.goto(`${mockUrl()}/grid`);
    await expect(page).toHaveURL(new RegExp(`${mockUrl()}/week$`));
    // logistics' own header (phase 4; «מצגות» since phase 5), no settings; «אישורים» reads the requests (a practice week's: nobody decides them)
    await expectSections(page, LOGISTICS_SECTIONS, INLINE_SECTIONS);
    const lessonOf = (day: number, start: number) => week.lessons.find((l) => l.day === day && l.start_min === start && l.state === "closed")!.id;

    // a card opens the lesson page
    await card(page, "מרצה 12").first().click();
    await expect(page).toHaveURL(new RegExp(`/lesson/${lessonOf(1, 1200)}$`));
    const pay = await openStep(page, "pay");
    await expect(pay).toContainText("200 ₪");
    await expect(pay.getByRole("form", { name: "בקשת תשלום והסעה" })).toHaveCount(0);
    await pay.getByRole("button", { name: "סימון ששולם" }).click();
    await expect.poll(() => sb.rpc.get("set_paid")).toEqual([{ p_lesson: lessonOf(1, 1200), p_paid: true }]);
    const msg = await openStep(page, "msg");
    await expect(msg.getByRole("button", { name: "סומן כנשלח" })).toHaveCount(0);
    await expect(msg.getByRole("link", { name: "WhatsApp" })).toHaveCount(0);
    const escort = await openStep(page, "escort");
    await expect(escort.getByRole("form", { name: "שיבוץ מלווה" })).toHaveCount(0);
    await expect(escort).toContainText("אין");
    const sources = await openStep(page, "sources");
    await expect(sources.getByRole("form", { name: "מקורות", exact: true })).toHaveCount(0);
    const close = await openStep(page, "close");
    await expect(close.getByText("פעולות נוספות")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "פתיחה מחדש (חזרה לטיוטה)", includeHidden: true })).toHaveCount(0);
    await expect(close.getByRole("region", { name: "פרטי השיעור" }).getByRole("button", { name: "עריכה" })).toHaveCount(0);
    await expect(page.getByLabel("כותרת")).toHaveCount(0);

    // an approved transport: the pickup and the driver, through the policy
    await page.goto(`${mockUrl()}/lesson/${lessonOf(0, 510)}?step=pay`);
    const details = step(page, "pay").getByRole("group", { name: "פרטי ההסעה" });
    await expect(details).toContainText("נהג/ת לדוגמה");
    await expect(details).toContainText("ההסעה סודרה");
    expect(sb.rpc.get("get_transport_details")).toEqual([{ p_lesson: lessonOf(0, 510) }]);
    for (const fn of ["get_transport_details", "set_paid"]) {
      for (const c of sb.calls.filter((x) => x.path === `/rest/v1/rpc/${fn}`)) expect(c.auth, fn).toBe(`Bearer ${session.access_token}`);
    }
    // nothing a logistics member may not write was ever sent
    for (const fn of ["set_payment", "decide_payments", "mark_confirm_sent", "set_escort", "set_sources", "update_lesson", "set_transport_details"]) expect(sb.rpc.get(fn), fn).toBeUndefined();
  });
});
