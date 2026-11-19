// «מרצים», «מרצה חדש/ה» and the speaker page — the trainee's wide pages for the pool (the reset, phase 2), in a real
// browser. Demo build `?as=trainee` («חניך/ה א׳» owns Sunday with «חניך/ה ב׳» and Wednesday with «חניך/ה ג׳»; Monday
// is the other two's), every width: the list as a table (a card each on a phone) with its filters in the address, a slot
// from «לבחור מרצה» and «להציע כאן»; a new speaker, search first, «פרט מבחין» only for a namesake, the contacts typed on
// the spot; the speaker page — «יכול/ה רק ביומיים, 17:00–19:00» in one save with its preview, «איפה אפשר לשבץ» with my
// day first and the Confirm before another pair's. Mock build: the ranges go out as ONE set_availability_ranges call, by
// the contract's parameter names, with the member's token. Synthetic people only.
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { demoDayOwners, demoWeek } from "../../src/data/demoWeek";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const row = (page: Page, id: number) => page.locator(`[data-speaker-row="${id}"]`);

/** On a phone the filters fold under the search: opened first. */
async function filters(page: Page, info: TestInfo) {
  if (info.project.name === "phone") {
    const fold = page.getByText("סינון ומיון");
    if ((await page.getByLabel("מצב", { exact: true }).count()) === 0 || !(await page.getByLabel("מצב", { exact: true }).isVisible())) await fold.click();
  }
}

/** «רק בשעות…» from–to on one day of the ranges editor. */
async function hours(av: Locator, day: number, name: string, from: string, to: string) {
  const d = av.locator(`[data-ranges-day="${day}"]`);
  await d.getByText("רק בשעות…").click();
  await d.getByLabel(`יום ${name}, טווח 1: מ־`).fill(from);
  await d.getByLabel(`יום ${name}, טווח 1: עד`).fill(to);
}

test.describe("demo build — a trainee", () => {
  test("the list: a table (cards on a phone), search and filters in the address, the sort; «מרצה חדש/ה» at hand", async ({ page }, info) => {
    await page.goto(`${demoUrl()}/speakers?as=trainee`);
    await expect(page.getByRole("heading", { name: "מרצים", level: 2 })).toBeVisible();
    if (info.project.name === "phone") {
      await expect(page.getByRole("list", { name: "המרצים" })).toBeVisible();
      await expect(page.getByRole("table", { name: "המרצים" })).toHaveCount(0);
    } else {
      const table = page.getByRole("table", { name: "המרצים" });
      await expect(table.getByRole("columnheader")).toHaveText(info.project.name === "desktop" ? ["שם", "נושאים", "מוסד", "מצב", "בטיפול", "זמינות", "שיעורים"] : ["שם", "נושאים", "מצב", "בטיפול", "זמינות", "שיעורים"]);
    }
    const all = await page.locator("[data-speaker-row]").count();
    expect(all).toBeGreaterThan(40);
    await noSidewaysScroll(page);

    await page.getByLabel("חיפוש", { exact: true }).fill("מרצה 33");
    await expect(page).toHaveURL(/q=%D7%9E%D7%A8%D7%A6%D7%94(%20|\+)33/);
    await expect(row(page, 33)).toBeVisible();
    await expect(page.locator("[data-speaker-row]")).toHaveCount(1);
    await page.getByLabel("חיפוש", { exact: true }).fill("");
    // the address changes at once and the list a render later (the router's updates are transitions): the cleared
    // search is the whole list again before a filter is chosen — else «שלי» would be counted on the search's one row
    await expect(page.locator("[data-speaker-row]")).toHaveCount(all);

    await filters(page, info);
    await page.getByLabel("מצב", { exact: true }).selectOption({ label: "שלי" });
    await expect(page).toHaveURL(/s=mine/);
    // the select follows the address: once it reads «שלי», the rows on screen are «שלי»'s
    await expect(page.getByLabel("מצב", { exact: true })).toHaveValue("mine");
    await expect.poll(() => page.locator("[data-speaker-row]").count()).toBeLessThan(all);
    const mine = await page.locator("[data-speaker-row]").count();
    expect(mine).toBeGreaterThan(0);
    for (const id of await page.locator("[data-speaker-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-speaker-row")))) {
      await expect(row(page, Number(id))).toContainText(info.project.name === "phone" ? "בטיפולך" : "אני");
    }
    await page.getByLabel("מיון", { exact: true }).selectOption({ label: "לפי שם" });
    await expect(page).toHaveURL(/s=mine&sort=name$/);
    // the address is the list: opened again (the demo tab stays the trainee's), the same filters
    await page.reload();
    await expect(page.locator("[data-speaker-row]")).toHaveCount(mine);
    await expect(page.getByLabel("מצב", { exact: true })).toHaveValue("mine");

    await page.getByRole("link", { name: "מרצה חדש/ה" }).click();
    await expect(page).toHaveURL(/\/speakers\/new$/);
  });

  test("a slot from «היום שלי»: who fits it, and «להציע כאן» takes the speaker to their call", async ({ page }) => {
    await page.goto(`${demoUrl()}/speakers?slot=0:1050-1140&as=trainee`);
    await expect(page.getByText("מרצים למשבצת: יום ראשון")).toBeVisible();
    // speaker 09 said «לא» for Sunday mornings only: still offered for the evening; nobody who cannot is
    await expect(row(page, 10)).toBeVisible();
    await row(page, 10).getByRole("button", { name: "להציע כאן" }).click();
    await expect(page).toHaveURL(/\/speakers\/10#call$/);
    await expect(toast(page, /מרצה 10 הוצעה למשבצת/)).toBeVisible();
    await expect(page.locator("#call")).toContainText("בטיפולך");
    await expect(page.locator("#lessons")).toContainText("ראשון");
    await noSidewaysScroll(page);
  });

  test("the speaker page: availability by ranges in one save, «איפה אפשר לשבץ», my day at once and another pair's after a Confirm", async ({ page }, info) => {
    await page.goto(`${demoUrl()}/speakers/10?as=trainee`);
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 2 }) });
    await expect(header.getByRole("heading", { level: 2 })).toHaveText("ד״ר מרצה 10");
    await expect(header.locator('[data-vetting="approved"]')).toBeVisible();
    await expect(page.getByText("אין תיאור.")).toHaveCount(0);
    await page.locator("#call").getByRole("button", { name: "אני מטפל/ת" }).click();
    await expect(toast(page, "המרצה בטיפולך")).toBeVisible();

    // «יכולה רק ביום ראשון ושני, 17:00–19:00»
    const av = page.locator("#availability");
    await hours(av, 0, "ראשון", "17:00", "19:00");
    await hours(av, 1, "שני", "17:00", "19:00");
    const preview = av.getByRole("region", { name: "מה יישמר" });
    await expect(preview).toContainText("משבצת נחשבת רק אם הטווח מכסה את כולה.");
    // 17:00–19:00 covers 17:30–19:00 whole (row 12), and the rest of the two days is «לא»
    await expect(preview.locator('[data-preview-slot][data-kind="can"]')).toHaveCount(2);
    await expect(preview.locator('[data-preview-slot="0:12"]')).toHaveAttribute("data-kind", "can");
    await expect(preview.locator('[data-preview-slot="1:12"]')).toHaveAttribute("data-kind", "can");
    await expect(preview.locator('[data-preview-slot="0:11"]')).toHaveAttribute("data-kind", "cannot");
    await expect(preview.locator('[data-preview-slot][data-kind="none"]')).toHaveCount(0);
    await noSidewaysScroll(page);
    await preview.getByRole("button", { name: "שמירת הזמינות" }).click();
    await expect(toast(page, "הזמינות נשמרה")).toBeVisible();
    await expect(preview).toHaveCount(0);
    await expect(av.locator('[data-ranges-day="0"]').getByRole("radio", { name: "רק בשעות…" })).toBeChecked();
    await expect(av.locator('[data-ranges-day="2"]').getByRole("radio", { name: "לא ידוע" })).toBeChecked();

    // where she fits: Sunday (my day) first, 17:30 «יכולה»; Monday folded — the other pair's
    const pl = page.locator("#placement");
    await expect(pl.locator("[data-place-day]").first()).toHaveAttribute("data-place-day", "0");
    await expect(pl.locator('[data-place-day="0"]')).toContainText("היום שלך, עם חניך/ה ב׳");
    const sunday = pl.locator('[data-place-option="0:1050"]');
    await expect(sunday).toContainText("יכולה");
    await expect(pl.locator('[data-place-day="0"] [data-place-option]')).toHaveCount(1); // the rest of Sunday is «לא»
    await sunday.getByRole("button", { name: "להציע כאן" }).click();
    await expect(toast(page, /מרצה 10 הוצעה למשבצת/)).toBeVisible();
    await expect(pl.locator('[data-place-day="0"]')).toHaveCount(0); // nothing left on Sunday

    const monday = pl.locator('[data-place-day="1"]');
    await expect(monday).toContainText("חניך/ה ב׳ ו-חניך/ה ג׳");
    await monday.locator("summary").click();
    await monday.locator('[data-place-option="1:1050"]').getByRole("button", { name: "להציע כאן" }).click();
    const ask = monday.getByText("היום הזה של חניך/ה ב׳ ו-חניך/ה ג׳. הם יראו שהשיבוץ אצלך. להמשיך?");
    await expect(ask).toBeVisible();
    // «ביטול» gives the focus back to the button that asked
    await monday.getByRole("button", { name: "ביטול" }).click();
    await expect(ask).toHaveCount(0);
    await expect(monday.locator('[data-place-option="1:1050"]').getByRole("button", { name: "להציע כאן" })).toBeFocused();
    await monday.locator('[data-place-option="1:1050"]').getByRole("button", { name: "להציע כאן" }).click();
    await monday.getByRole("button", { name: "להציע כאן" }).last().click();
    await expect(toast(page, /מרצה 10 הוצעה למשבצת/)).toBeVisible();

    // both in «שיעורים», each to its lesson page
    const lessons = page.locator("#lessons");
    await expect(lessons.getByRole("link", { name: "לשיעור" })).toHaveCount(2);
    await expect(lessons).toContainText("ראשון");
    await expect(lessons).toContainText("שני");
    // «מה קרה»: the approach and the availability — one line for the save, not one per slot
    const log = page.getByRole("region", { name: "ציר הפעולות" });
    await log.locator("summary").click();
    await expect(log.locator("li")).not.toHaveCount(0);
    expect(await log.locator("li").count()).toBeLessThan(8);
    await noSidewaysScroll(page);

    // the list: a day saved «רק בשעות…» (its hours «יכולה», the rest «לא») is a day she fits, drawn half and half
    await page.getByRole("link", { name: "מרצים", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "מרצים", level: 2 })).toBeVisible();
    await filters(page, info);
    await page.getByLabel("מתאים/ה ליום", { exact: true }).selectOption({ label: "יום שני" });
    await expect(page).toHaveURL(/day=1/);
    await expect(row(page, 10)).toBeVisible();
    await expect(row(page, 10).locator('[data-day-kind="some"]')).toHaveCount(2);
    await expect(row(page, 10).locator('[data-day-kind="cannot"]')).toHaveCount(0);
  });

  test("«מרצה חדש/ה»: search first; «פרט מבחין» only for a namesake; the phone typed on the spot; then the speaker's page", async ({ page }) => {
    await page.goto(`${demoUrl()}/speakers/new?as=trainee`);
    await expect(page.getByText("קודם בודקים שהמרצה לא כבר במאגר")).toBeVisible();
    const name = page.getByLabel("שם המרצה (בלי תואר)");
    // a namesake in the pool: the distinguishing detail is asked for
    await name.fill("מרצה 33");
    await page.getByRole("button", { name: "זה מישהו אחר — להמשיך" }).click();
    await expect(page.getByLabel(/פרט מבחין/)).toBeVisible();
    // a new name: no such field, and the contacts beside «דרך תקשורת»
    await name.fill("פלונית לדוגמה");
    await expect(page.getByText("אין במאגר שם דומה.")).toBeVisible();
    await expect(page.getByLabel(/פרט מבחין/)).toHaveCount(0);
    await page.getByRole("radio", { name: "נקבה" }).check();
    await expect(page.getByLabel("דרך תקשורת")).toBeVisible();
    await expect(page.getByLabel("דרך תקשורת").locator("option")).toHaveText(["לא צוין", "שיחה", "WhatsApp", "מייל", "דרך המזכירות"]);
    // a way with nothing to press for it yet (no address typed): the speaker's page says it in the same words
    await page.getByLabel("דרך תקשורת").selectOption({ label: "מייל" });
    await expect(page.getByRole("checkbox", { name: "אני מטפל/ת במרצה" })).toBeChecked();
    await page.getByLabel("טלפון", { exact: true }).fill("12-34");
    await page.getByRole("button", { name: "הוספה למאגר" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "מספר הטלפון לא תקין" })).toBeVisible(); // checked before anything is created
    await expect(page).toHaveURL(/\/speakers\/new/);
    await page.getByLabel("טלפון", { exact: true }).fill("123 456 789");
    await noSidewaysScroll(page);
    await page.getByRole("button", { name: "הוספה למאגר" }).click();
    await expect(page).toHaveURL(/\/speakers\/\d+$/);
    await expect(toast(page, "פלונית לדוגמה נוספה למאגר")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("פלונית לדוגמה");
    await expect(page.locator("#call")).toContainText("בטיפולך");
    await expect(page.locator("#call")).toContainText("123 456 789");
    await expect(page.locator("#call")).toContainText("דרך תקשורת: מייל");
    await expect(page.locator("#call")).not.toContainText("ערוץ");
  });
});

/** The keyboard's way: the focus on the control, then Enter. */
async function press(target: Locator) {
  await target.focus();
  await target.press("Enter");
}

test.describe("demo build — a trainee, by the keyboard", () => {
  test("the speaker page: an act that takes its button away keeps the focus in its section", async ({ page }, info) => {
    await page.goto(`${demoUrl()}/speakers/10?as=trainee`);
    const call = page.locator("#call");
    // «אני מטפל/ת» is gone once I handle her: the focus stays in «הפנייה»
    await press(call.getByRole("button", { name: "אני מטפל/ת" }));
    await expect(toast(page, "המרצה בטיפולך")).toBeVisible();
    await expect(call).toBeFocused();
    // a call's result is not offered again: the same
    await press(call.getByRole("button", { name: "הסכימה", exact: true }));
    await expect(toast(page, /הסכימה/)).toBeVisible();
    await expect(call).toBeFocused();

    // «עריכה» opens the form at its first field; «ביטול» gives «עריכה» the focus back
    const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 2 }) });
    await press(header.getByRole("button", { name: "עריכה" }));
    await expect(header.getByLabel("תואר", { exact: true })).toBeFocused();
    // the edit form says the same words as the new speaker's: «דרך תקשורת», «שיחה»; no «פרט מבחין» nobody needs
    await expect(header.getByLabel("דרך תקשורת")).toBeVisible();
    await expect(header.getByLabel("דרך תקשורת").locator("option")).toHaveText(["לא צוין", "שיחה", "WhatsApp", "מייל", "דרך המזכירות"]);
    await expect(header.getByLabel(/פרט מבחין/)).toHaveCount(0);
    await press(header.getByRole("button", { name: "ביטול" }));
    await expect(header.getByRole("button", { name: "עריכה" })).toBeFocused();

    // availability: «מה יישמר» goes with the save, and with «ביטול השינויים» — the focus to the day's choice
    const av = page.locator("#availability");
    const tuesday = av.locator('[data-ranges-day="2"]');
    await tuesday.getByText("כל היום").click();
    await press(av.getByRole("button", { name: "שמירת הזמינות" }));
    await expect(toast(page, "הזמינות נשמרה: יום שלישי")).toBeVisible();
    await expect(tuesday.getByRole("radio", { name: "כל היום" })).toBeFocused();
    await tuesday.getByText("לא יכולה").click();
    await press(av.getByRole("button", { name: "ביטול השינויים" }));
    await expect(av.getByRole("region", { name: "מה יישמר" })).toHaveCount(0);
    await expect(tuesday.getByRole("radio", { name: "כל היום" })).toBeFocused();
    if (info.project.name !== "desktop") {
      // the shifts' quick pairs: a finger's 44px on a touch tablet too
      await av.locator('[data-ranges-day="4"]').getByText("רק בשעות…").click();
      for (const box of await av.locator('[data-ranges-day="4"] button[aria-label*="–"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);
      await av.getByRole("button", { name: "ביטול השינויים" }).click();
    }

    // «להציע כאן» on my own day: the slot leaves the list — the focus to «איפה אפשר לשבץ»
    const pl = page.locator("#placement");
    await press(pl.locator('[data-place-option="0:1050"]').getByRole("button", { name: "להציע כאן" }));
    await expect(toast(page, /מרצה 10 הוצעה למשבצת/)).toBeVisible();
    await expect(pl.locator('[data-place-option="0:1050"]')).toHaveCount(0);
    await expect(pl).toBeFocused();
  });

  test("the list: «להציע ל-…» and «ניקוי» keep the focus; a row (a card) opens the speaker, its name a 44px link", async ({ page }, info) => {
    await page.goto(`${demoUrl()}/speakers?slot=0:1200-1290&s=others&as=trainee`);
    const first = page.locator("[data-speaker-row]").first();
    const id = Number(await first.getAttribute("data-speaker-row"));
    const offer = first.getByRole("button", { name: /^להציע ל-/ });
    await press(offer);
    await expect(toast(page, /הוצע(ה)? ל/)).toBeVisible();
    await expect(first).toContainText(/כבר מוצע(ת)? כאן/);
    await expect(first.getByRole("link").first()).toBeFocused();
    await press(page.getByRole("button", { name: "ניקוי" }));
    await expect(page.getByText("מרצים למשבצת:")).toHaveCount(0);
    await expect(page.getByLabel("חיפוש", { exact: true })).toBeFocused();

    // the name is marked as a link everywhere, a finger's height on touch
    const link = row(page, id).getByRole("link").first();
    expect(await link.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("underline");
    if (info.project.name !== "desktop") {
      for (const h of await page.locator("[data-speaker-row] a[href^='/speakers/']").evaluateAll((els) => els.slice(0, 8).map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
    }
    // a tap away from the name — a card's corner, a row's cell — opens the speaker too
    const target = row(page, id);
    const box = (await target.boundingBox())!;
    if (info.project.name === "phone") await page.touchscreen.tap(box.x + 8, box.y + 8);
    else await target.locator("td").nth(3).click();
    await expect(page).toHaveURL(new RegExp(`/speakers/${id}$`));
  });
});

test.describe("mock build", () => {
  test("«שמירת הזמינות» is ONE set_availability_ranges call: the touched days, each with its own ranges, no rest", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.kind = "real";
    week.dayOwners = demoDayOwners();
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "trainee@example.org", display_name: "חניך/ה א׳", global_admin: false, memberships: [{ edition_id: 7, role: "content", member_id: 2 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("get_speaker_contacts", null);
    sb.answers.set("speaker_history", []);
    sb.answers.set("speaker_activity", []);
    sb.answers.set("set_availability_ranges", 22);
    await sb.attach(page);
    const session = await signIn(page, "trainee@example.org");
    sb.token = session.access_token;
    await page.goto(`${mockUrl()}/speakers/10`);
    const av = page.locator("#availability");
    await hours(av, 0, "ראשון", "17:00", "19:00");
    await hours(av, 1, "שני", "17:00", "19:00");
    await av.getByRole("button", { name: "שמירת הזמינות" }).click();
    await expect.poll(() => sb.rpc.get("set_availability_ranges")).toEqual([
      {
        p_edition: 7,
        p_speaker: 10,
        p_days: [0, 1],
        p_ranges: [
          // Sunday's span is 08:30–05:00 (the edition's first day), Monday's 06:30–05:00: «לא» before and after the hours
          { day: 0, start: 510, end: 1020, kind: "cannot" },
          { day: 0, start: 1020, end: 1140, kind: "can" },
          { day: 0, start: 1140, end: 1740, kind: "cannot" },
          { day: 1, start: 390, end: 1020, kind: "cannot" },
          { day: 1, start: 1020, end: 1140, kind: "can" },
          { day: 1, start: 1140, end: 1740, kind: "cannot" },
        ],
        p_rest: null,
      },
    ]);
    for (const c of sb.calls.filter((x) => x.path === "/rest/v1/rpc/set_availability_ranges")) expect(c.auth).toBe(`Bearer ${session.access_token}`);
    expect(sb.rpc.get("set_slot_availability")).toBeUndefined(); // never slot by slot
  });
});
