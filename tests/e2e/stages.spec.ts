// From placement to arrival (milestone 3) in a real browser. Demo build, every
// width: a payment request approved from the queue, the summary message
// (blocked without a template and while the date is TBD, then sent; a change
// after it raises «לעדכן את המרצה», sending again clears it), an escort with
// the gap warning, sources and their dot, a trainee's delete listing the lessons
// they escort. Mock build: every new RPC goes out by the contract's parameter
// names (tests/sql/stages.test.ts pins them in the database) with the member's
// own token; a logistics member is offered «שולם» and approved transport only.
// Synthetic people and wording only («נוסח לדוגמה»): the real template is the
// instructor's.
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { demoWeek } from "../../src/data/demoWeek";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });
const card = (page: Page, speaker: string) => page.locator("[data-lesson-id]").filter({ hasText: speaker });

/** A closed lesson's panel: on a phone or a tablet, its day first. */
async function openLesson(page: Page, info: TestInfo, day: string, speaker: string): Promise<Locator> {
  if (info.project.name !== "desktop") await page.getByRole("tab", { name: day }).click();
  await card(page, speaker).first().click();
  const panel = page.getByRole("dialog", { name: "שיעור סגור" });
  await expect(panel).toBeVisible();
  return panel;
}

/** One stage of the panel, opened. */
async function stage(panel: Locator, name: string): Promise<Locator> {
  const s = panel.getByRole("region", { name, exact: true });
  const toggle = s.getByRole("button", { name: new RegExp(`^${name.replace("/", "\\/")}`) });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return s;
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

  test("payment: the handler asks, the instructor approves (and rejects) from the queue; the badge counts requests", async ({ page }, info) => {
    await page.goto(demoUrl());
    const badge = nav(page).getByRole("link", { name: /אישורים/ });
    await expect(badge).toHaveAccessibleName("אישורים, 6 ממתינים"); // five speakers and the demo's waiting request

    const panel = await openLesson(page, info, "ראשון", "מרצה 07");
    const pay = await stage(panel, "תשלום/הסעה");
    await expect(pay).toHaveAttribute("data-state", "na");
    const form = pay.getByRole("form", { name: "בקשת תשלום והסעה" });
    await form.getByRole("radio", { name: "תשלום", exact: true }).check();
    // the demo's user is the instructor: the request is saved, not «sent to the instructor» — she decides it above
    await form.getByRole("button", { name: "שמירת הבקשה" }).click();
    await expect(form.getByRole("alert")).toContainText("צריך לכתוב את הסכום"); // never a default amount
    await form.getByLabel("סכום בשקלים").fill("150");
    await form.getByRole("radio", { name: "הלוך ושוב" }).check();
    await form.getByRole("button", { name: "שמירת הבקשה" }).click();
    await expect(toast(page, "הבקשה ממתינה לאישור שלך")).toBeVisible();
    await expect(pay).toHaveAttribute("data-state", "waiting");
    await expect(pay).toContainText("150 ₪");
    // one primary action: the decision; the saved request waits behind «שינוי הבקשה»
    await expect(pay.getByRole("group", { name: "החלטת המדריך/ה" })).toBeVisible();
    await expect(pay.getByRole("form", { name: "בקשת תשלום והסעה" })).toHaveCount(0);
    await pay.getByRole("button", { name: "שינוי הבקשה" }).click();
    await expect(pay.getByRole("form", { name: "בקשת תשלום והסעה" }).getByLabel("סכום בשקלים")).toHaveValue("150");
    await pay.getByRole("form", { name: "בקשת תשלום והסעה" }).getByRole("button", { name: "ביטול" }).click();
    await expect(pay.getByRole("form", { name: "בקשת תשלום והסעה" })).toHaveCount(0);
    await expect(badge).toHaveAccessibleName("אישורים, 7 ממתינים");
    await noSidewaysScroll(page);

    await badge.click();
    const requests = page.getByRole("list", { name: "בקשות שממתינות לאישור" });
    await expect(requests.getByRole("listitem")).toHaveCount(2);
    await expect(requests.getByRole("listitem").filter({ hasText: "מרצה 07" })).toContainText("150 ₪ · הלוך ושוב");
    await noSidewaysScroll(page);
    await requests.getByRole("button", { name: "אישור הבקשה של מרצה 07" }).click();
    await expect(toast(page, "הבקשה אושרה")).toBeVisible();
    await expect(requests.getByRole("listitem")).toHaveCount(1);
    await expect(badge).toHaveAccessibleName("אישורים, 6 ממתינים");

    await requests.getByRole("button", { name: "דחיית הבקשה של פרופ׳ מרצה 04" }).click();
    await page.getByRole("group", { name: "דחיית הבקשה של פרופ׳ מרצה 04" }).getByLabel("למה? (לא חובה, גלוי לצוות)").fill("נתון לדוגמה: לבדוק שוב");
    await page.getByRole("button", { name: "לא לאשר" }).click();
    await expect(toast(page, "הבקשה לא אושרה")).toBeVisible();
    await expect(page.getByText("אין בקשות לתשלום או להסעה שממתינות לאישור.")).toBeVisible();
    await expect(badge).toHaveAccessibleName("אישורים, 5 ממתינים");

    // back on the week: approved — the card's first dot is done
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    if (info.project.name !== "desktop") await page.getByRole("tab", { name: "ראשון" }).click();
    await expect(card(page, "מרצה 07").locator('[data-stage="pay"]')).toHaveAttribute("data-state", "done");
  });

  test("the summary message: blocked without a template, then by the TBD date; sent; a change after it → «לעדכן את המרצה», sent again", async ({ page }, info) => {
    const wide = info.project.name === "desktop";
    await page.goto(demoUrl());
    let panel = await openLesson(page, info, "שני", "מרצה 12");
    let msg = await stage(panel, "הודעת סיכום");
    await expect(msg.getByRole("list", { name: "מה חסר כדי לשלוח" })).toContainText("אין עדיין נוסח להודעת הסיכום");
    await expect(msg.getByRole("button", { name: "סומן כנשלח" })).toHaveCount(0);
    await noSidewaysScroll(page);

    // the template is the instructor's, pasted in «הגדרות ← תבניות»
    await msg.getByRole("link", { name: /לנוסח, בהגדרות/ }).click();
    await expect(page).toHaveURL(/\/settings\/templates$/);
    await expect(page.getByRole("tab", { name: "תבניות" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("עוד אין נוסח, ועד שיהיה ההודעות למרצים חסומות.")).toBeVisible();
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
    panel = await openLesson(page, info, "שני", "מרצה 12");
    msg = await stage(panel, "הודעת סיכום");
    await expect(msg.getByRole("list", { name: "מה חסר כדי לשלוח" })).toHaveText("תאריך השבוע עוד לא נקבע (TBD).");
    await expect(msg.getByRole("region", { name: "תצוגה מקדימה של ההודעה" })).toContainText("«TBD: תאריך»");

    // the date, in «הגדרות ← מחזור»
    await nav(page).getByRole("link", { name: "הגדרות" }).click();
    await page.getByRole("tab", { name: "מחזור" }).click();
    const editions = page.getByRole(wide ? "table" : "list", { name: "המחזורים" });
    await editions.getByRole("button", { name: "עריכת התאריכים של הדגמה" }).click();
    await editions.getByLabel("תאריך הפתיחה (יום ראשון)").fill("2027-02-14");
    await editions.getByRole("button", { name: "שמירה", exact: true }).click();
    await expect(toast(page, "התאריכים נשמרו")).toBeVisible();

    // now it can go: the speaker's gender, the calendar's date, the teaching time in words, the amount
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    panel = await openLesson(page, info, "שני", "מרצה 12");
    msg = await stage(panel, "הודעת סיכום");
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

    // a change after it went out: moved (a drag on a desktop), or retitled (phone and tablet)
    if (wide) {
      await panel.getByRole("button", { name: "סגירה" }).click();
      const from = card(page, "מרצה 12");
      const to = page.locator('[data-drop="cell:1:1350:1440"]');
      const a = (await from.boundingBox())!;
      await to.scrollIntoViewIfNeeded();
      const b = (await to.boundingBox())!;
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
      await page.mouse.up();
      await expect(toast(page, "השיעור הוזז")).toBeVisible();
      await expect(card(page, "מרצה 12").locator("[data-reconfirm]")).toBeVisible();
      await expect(card(page, "מרצה 12")).toHaveAttribute("aria-label", /22:30–00:00, לעדכן את המרצה$/);
      panel = await openLesson(page, info, "שני", "מרצה 12");
      await panel.getByRole("button", { name: "להודעה" }).click();
    } else {
      const details = panel.getByRole("region", { name: "פרטי השיעור" });
      await details.getByRole("button", { name: "עריכה" }).click();
      await details.getByLabel("כותרת").fill("שיעור לדוגמה, כותרת חדשה");
      await details.getByRole("button", { name: "שמירה" }).click();
      await expect(toast(page, /^נשמר$/)).toBeVisible(); // not the demo banner («…שום דבר לא נשמר»)
      await expect(card(page, "מרצה 12").locator("[data-reconfirm]")).toBeVisible();
    }
    msg = panel.getByRole("region", { name: "הודעת סיכום", exact: true });
    await expect(msg).toHaveAttribute("data-state", "problem");
    await expect(msg).toContainText("לעדכן את המרצה");
    await expect(msg.getByRole("region", { name: "תצוגה מקדימה של ההודעה" })).toContainText(wide ? "22:30–23:45" : "שיעור לדוגמה, כותרת חדשה");
    await msg.getByRole("button", { name: "סומן כנשלח" }).click();
    await expect(toast(page, "סומן שההודעה נשלחה")).toBeVisible();
    await expect(card(page, "מרצה 12").locator("[data-reconfirm]")).toHaveCount(0);
    await expect(msg).toHaveAttribute("data-state", "done");
    await noSidewaysScroll(page);
  });

  test("escorts and sources: each trainee's load, the gap warning before and after saving, the dots; deleting a trainee lists their lessons", async ({ page }, info) => {
    await page.goto(demoUrl());
    const panel = await openLesson(page, info, "רביעי", "מרצה 19");
    const escort = await stage(panel, "מלווה");
    const who = escort.getByLabel("מלווה מרשימת החניכים");
    await expect(who.locator("option").filter({ hasText: "מלווה לדוגמה ב׳" })).toHaveText("מלווה לדוגמה ב׳ · 2 שיעורים");
    await who.selectOption({ label: "מלווה לדוגמה ד׳ · 2 שיעורים" }); // a lesson, and Sunday's memorial time as the family's liaison (5ב-2)
    await expect(escort.getByRole("list", { name: "שיעורים קרובים של המלווה" })).toContainText("צמוד, בלי הפסקה (הצעה: לפחות 30 דקות)");
    await expect(escort.getByRole("list", { name: "משהו שחשוב לדעת" })).toHaveCount(0); // no phrases pasted yet
    await expect(escort).toContainText("עוד אין ניסוחים");
    await escort.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "המלווה נשמר/ה")).toBeVisible();
    await expect(panel.getByText(/«מלווה לדוגמה ד׳» מלווה שני שיעורים צמודים/)).toBeVisible(); // the soft warning (src/rules)
    await expect(escort).toHaveAttribute("data-state", "done");
    await noSidewaysScroll(page);

    const sources = await stage(panel, "מקורות");
    await sources.getByRole("radio", { name: "מצגת", exact: true }).check();
    await expect(sources.getByRole("checkbox", { name: "להכניס למקראה" })).toBeDisabled(); // nothing to print
    await sources.getByLabel("קישור למצגת").fill("slides.example/presentation");
    await sources.getByRole("button", { name: "שמירה" }).click();
    await expect(sources.getByRole("alert")).toContainText("הקישור צריך להתחיל ב-http://");
    await sources.getByRole("radio", { name: "דף מקורות", exact: true }).check();
    await sources.getByLabel("קישור למצגת").fill("");
    await sources.getByRole("radio", { name: "להדפיס מראש" }).check();
    await sources.getByRole("checkbox", { name: "להכניס למקראה" }).check();
    await sources.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "המקורות נשמרו")).toBeVisible();
    for (const k of ["escort", "sources"]) await expect(card(page, "מרצה 19").locator(`[data-stage="${k}"]`)).toHaveAttribute("data-state", "done");
    // marked for the reader, but no file yet: the «מקראה» dot is not green — it says what the manifest says (5ב-1 review)
    const readerDot = card(page, "מרצה 19").locator('[data-stage="reader"]');
    await expect(readerDot).toHaveAttribute("data-state", "open");
    await expect(readerDot).toHaveAttribute("title", "מקראה: חסר קובץ");
    await noSidewaysScroll(page);

    // «פתיחה מחדש» says first what goes with the speaker: the stages start over
    await panel.getByRole("button", { name: "פתיחה מחדש (חזרה לטיוטה)" }).click();
    const ask = panel.getByRole("group", { name: "אישור" });
    await expect(ask).toContainText("בקשת ההסעה ופרטיה · המלווה · המקורות");
    await ask.getByRole("button", { name: "ביטול" }).press("Enter");
    await expect(panel.getByRole("button", { name: "פתיחה מחדש (חזרה לטיוטה)" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "פתיחה מחדש (חזרה לטיוטה)" })).toBeFocused(); // the confirm cancelled: the focus back at the button

    // «הגדרות ← חניכים»: deleting that escort lists the lessons they would leave
    await nav(page).getByRole("link", { name: "הגדרות" }).click();
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

  test("«המרצים שלי»: a closed lesson sits under its next step, and its button opens the lesson there", async ({ page }) => {
    await page.goto(`${demoUrl()}/mine`);
    const group = (name: string) => page.getByRole("region", { name, exact: true });
    await expect(group("תשלום/הסעה")).toContainText("200 ₪ · הלוך ושוב");
    await expect(group("תשלום/הסעה")).toContainText("ממתין לאישור"); // once, as the chip
    await expect(group("תשלום/הסעה")).not.toContainText("ממתין לאישור המדריך/ה:");
    await expect(group("לעדכן את המרצה")).toContainText("מרצה 08");
    await expect(group("לשלוח סיכום")).toContainText("מרצה 12");
    await expect(group("חסר מלווה")).toContainText("מרצה 24");
    await expect(group("חסרים מקורות")).toContainText("מרצה 20");
    await expect(group("נסגר")).toContainText("מרצה 16");
    await noSidewaysScroll(page);

    // the global admin decides a waiting request right in the row
    await group("תשלום/הסעה").getByRole("button", { name: "אישור הבקשה של פרופ׳ מרצה 04" }).click();
    await expect(toast(page, "הבקשה אושרה")).toBeVisible();
    await expect(group("לשלוח סיכום")).toContainText("מרצה 04");

    await group("חסר מלווה").getByRole("button", { name: "לשיבוץ מלווה" }).click();
    await expect(page).toHaveURL(/\/$/);
    const panel = page.getByRole("dialog", { name: "שיעור סגור" });
    await expect(panel.getByRole("region", { name: "מלווה", exact: true }).getByLabel("מלווה מרשימת החניכים")).toBeVisible();
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
    sb.answers.set("get_transport_details", { pickup_address: "כתובת לדוגמה", pickup_time: null, driver_name: null, driver_phone: null, arranged: false });
    for (const fn of ["set_payment", "decide_payments", "mark_confirm_sent", "set_escort", "set_sources", "set_paid", "set_transport_details", "set_confirm_template", "set_duty_phrases"]) {
      sb.answers.set(fn, null);
    }
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;
    await page.goto(mockUrl());
    await expect(page.getByRole("grid", { name: "רשת השבוע" })).toBeVisible();
    const lessonOf = (day: number, start: number) => week.lessons.find((l) => l.day === day && l.start_min === start && l.state === "closed")!.id;

    // a lesson with nothing yet: the request, the escort, the sources
    let panel = await openLesson(page, info, "ראשון", "מרצה 07");
    const pay = await stage(panel, "תשלום/הסעה");
    await pay.getByRole("radio", { name: "תשלום", exact: true }).check();
    await pay.getByLabel("סכום בשקלים").fill("1,500");
    await pay.getByRole("radio", { name: "הלוך", exact: true }).check();
    await pay.getByRole("button", { name: "שמירת הבקשה" }).click();
    await expect.poll(() => sb.rpc.get("set_payment")).toEqual([{ p_lesson: lessonOf(0, 870), p_version: 1, p_pay_amount: 1500, p_transport: "one_way" }]);

    const escort = await stage(panel, "מלווה");
    await escort.getByLabel("מלווה מרשימת החניכים").selectOption({ label: "מלווה לדוגמה א׳ · שיעור אחד" });
    await escort.getByLabel("הערה למלווה (לא חובה)").fill("נתון לדוגמה");
    await escort.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("set_escort")).toEqual([{ p_lesson: lessonOf(0, 870), p_version: 1, p_roster: 1, p_self_intro: false, p_note: "נתון לדוגמה" }]);

    const sources = await stage(panel, "מקורות");
    await sources.getByRole("radio", { name: "דף מקורות ומצגת" }).check();
    await sources.getByLabel("קישור למצגת").fill("https://slides.example/demo");
    await sources.getByRole("radio", { name: "להדפיס באותו יום" }).check();
    await sources.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("set_sources")).toEqual([
      { p_lesson: lessonOf(0, 870), p_version: 1, p_kind: "sheet_presentation", p_print_when: "same_day", p_note: null, p_url: "https://slides.example/demo", p_in_reader: false },
    ]);
    await panel.getByRole("button", { name: "סגירה" }).click();

    // transport details: read one lesson at a time, then written
    panel = await openLesson(page, info, "ראשון", "מרצה 01");
    const details = (await stage(panel, "תשלום/הסעה")).getByRole("group", { name: "פרטי ההסעה" });
    await expect(details).toContainText("כתובת לדוגמה");
    expect(sb.rpc.get("get_transport_details")).toContainEqual({ p_lesson: lessonOf(0, 510) });
    await details.getByRole("button", { name: "עריכת פרטי ההסעה" }).click();
    await details.getByLabel("הטלפון של הנהג/ת").fill("123 456 789");
    await details.getByRole("checkbox", { name: "ההסעה סודרה" }).check();
    // meanwhile the escort sends a pickup address through their link: the save keeps it, writing only what the form changed
    sb.answers.set("get_transport_details", { pickup_address: "כתובת מהמלווה לדוגמה", pickup_time: null, driver_name: null, driver_phone: null, arranged: false });
    await details.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("set_transport_details")).toEqual([
      { p_lesson: lessonOf(0, 510), p_pickup_address: "כתובת מהמלווה לדוגמה", p_pickup_time: null, p_driver_name: null, p_driver_phone: "123 456 789", p_arranged: true },
    ]);
    await panel.getByRole("button", { name: "סגירה" }).click();

    // an approved payment: «שולם»; the message: «סומן כנשלח»
    panel = await openLesson(page, info, "שני", "מרצה 12");
    await (await stage(panel, "תשלום/הסעה")).getByRole("button", { name: "סימון ששולם" }).click();
    await expect.poll(() => sb.rpc.get("set_paid")).toEqual([{ p_lesson: lessonOf(1, 1200), p_paid: true }]);
    const msg = await stage(panel, "הודעת סיכום");
    await expect(msg.getByRole("region", { name: "תצוגה מקדימה של ההודעה" })).toHaveText(/נוסח לדוגמה לפרופ׳ מרצה 12, 20:00–21:15\./);
    expect(sb.rpc.get("get_speaker_contacts")).toContainEqual({ p_speaker: 12 });
    await msg.getByRole("button", { name: "סומן כנשלח" }).click();
    await expect.poll(() => sb.rpc.get("mark_confirm_sent")).toEqual([{ p_lesson: lessonOf(1, 1200), p_version: 1 }]);
    await panel.getByRole("button", { name: "סגירה" }).click();

    // the approvals queue: the waiting request, at the version on screen
    await nav(page).getByRole("link", { name: /אישורים/ }).click();
    await page.getByRole("button", { name: "אישור הבקשה של פרופ׳ מרצה 04" }).click();
    await expect.poll(() => sb.rpc.get("decide_payments")).toEqual([{ p_lessons: [lessonOf(1, 510)], p_versions: [1], p_decision: "approved", p_note: null }]);

    // «הגדרות ← תבניות»: the template and the phrases
    await nav(page).getByRole("link", { name: "הגדרות" }).click();
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

    // every one of them carried the member's own token
    const rpcs = ["set_payment", "set_escort", "set_sources", "get_transport_details", "set_transport_details", "set_paid", "get_speaker_contacts", "mark_confirm_sent", "decide_payments", "set_confirm_template", "set_duty_phrases"];
    for (const fn of rpcs) {
      const calls = sb.calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`);
      expect(calls.length, fn).toBeGreaterThan(0);
      for (const c of calls) expect(c.auth, fn).toBe(`Bearer ${session.access_token}`);
    }
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
    await page.goto(mockUrl());
    await expect(nav(page).getByRole("link")).toHaveText(["השבוע", "תוצרים", "לוגיסטיקה", "זמני זיכרון", "מכריכה לכריכה", "ידע", "עזרה"]); // no «המרצים שלי», no approvals, no settings
    const lessonOf = (day: number, start: number) => week.lessons.find((l) => l.day === day && l.start_min === start && l.state === "closed")!.id;

    let panel = await openLesson(page, info, "שני", "מרצה 12");
    const pay = await stage(panel, "תשלום/הסעה");
    await expect(pay).toContainText("200 ₪");
    await expect(pay.getByRole("form", { name: "בקשת תשלום והסעה" })).toHaveCount(0);
    await pay.getByRole("button", { name: "סימון ששולם" }).click();
    await expect.poll(() => sb.rpc.get("set_paid")).toEqual([{ p_lesson: lessonOf(1, 1200), p_paid: true }]);
    const msg = await stage(panel, "הודעת סיכום");
    await expect(msg.getByRole("button", { name: "סומן כנשלח" })).toHaveCount(0);
    await expect(msg.getByRole("link", { name: "WhatsApp" })).toHaveCount(0);
    const escort = await stage(panel, "מלווה");
    await expect(escort.getByRole("form", { name: "שיבוץ מלווה" })).toHaveCount(0);
    await expect(escort).toContainText("אין");
    const sources = await stage(panel, "מקורות");
    await expect(sources.getByRole("form", { name: "מקורות" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "פתיחה מחדש (חזרה לטיוטה)" })).toHaveCount(0);
    await expect(panel.getByRole("region", { name: "פרטי השיעור" }).getByRole("button", { name: "עריכה" })).toHaveCount(0);
    await expect(panel.getByLabel("כותרת")).toHaveCount(0);
    await panel.getByRole("button", { name: "סגירה" }).click();

    // an approved transport: the pickup and the driver, through the policy
    panel = await openLesson(page, info, "ראשון", "מרצה 01");
    const details = (await stage(panel, "תשלום/הסעה")).getByRole("group", { name: "פרטי ההסעה" });
    await expect(details).toContainText("נהג/ת לדוגמה");
    await expect(details).toContainText("ההסעה סודרה");
    expect(sb.rpc.get("get_transport_details")).toEqual([{ p_lesson: lessonOf(0, 510) }]);
    for (const fn of ["get_transport_details", "set_paid"]) {
      for (const c of sb.calls.filter((x) => x.path === `/rest/v1/rpc/${fn}`)) expect(c.auth, fn).toBe(`Bearer ${session.access_token}`);
    }
    // nothing a logistics member may not write was ever sent
    for (const fn of ["set_payment", "decide_payments", "mark_confirm_sent", "set_escort", "set_sources", "update_lesson"]) expect(sb.rpc.get(fn), fn).toBeUndefined();
  });
});
