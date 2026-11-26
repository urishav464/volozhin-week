// «תורנויות» (milestone 7, schema v16) in a real browser, at every width. Demo build: a cohort, a group and a duty set
// up, the cohort marked on campus; «הצעה הוגנת» previewed (its chips dashed, «מוצע»), applied, then a hand edit onto a
// cohort not on campus — the chip and the warnings say so, a warning jumps to its cell; «עומס לפי קבוצה»; the
// suggested rows cleared behind a Confirm whose «ביטול» gives its button the focus back; nothing scrolls sideways at
// 390. «תוצרים ← תורנויות»: a PDF page per group (pdf-lib counts them), every sheet in the xlsx, and the heads'
// phones off by default — on the paper, in the file and in the setup. Mock build, on the wire: a content member reads
// /print/rota with no switch and get_rota_contacts never called; a logistics member reads load_rota once, the switch on
// asks get_rota_contacts once with the member's token, «החלת ההצעה» is ONE POST of an array, the clear ONE DELETE of
// source=eq.suggested, a head's phone goes through set_rota_contact alone; an archived edition reads only.
// The review's round: a group form open when the phones come (the switch checked after «עריכה», a late answer, a re-read
// after a save) takes the phone, and a save of another field never deletes or rolls it back; «קבוצה חדשה» keeps the
// focus after an add and a cohort chosen; «הסרה» lands the focus inside the sheet (a closed fold opened, a shift the week
// no longer has); a staff shift of a member deactivated since is edited; «לוח» is aria-current at /logistics/rota.
// v19 (the reset, phase 4): the cohorts' two flags («עוזרת בתורנויות», «הצוות שלה יכול להסיע») saved by the columns' names; the
// suggestion leaving a non-helping cohort's groups out and a hand assignment of one warned; Saturday night as two lists —
// the tasks and the shopping list, each with its own count, an item with its quantity, «נקנה», its own paste in ONE
// insert, a phone refused in a quantity — and the shopping list printed on a page of its own and a sheet of its own.
// Synthetic data only («לדוגמה»).
import { readFileSync } from "node:fs";
import { type Download, expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { demoWeek } from "../../src/data/demoWeek";
import type { RotaData } from "../../src/data/rota";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { goSection, noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const pills = (page: Page) => page.getByRole("navigation", { name: "תורנויות" });

async function downloaded(page: Page, click: () => Promise<void>): Promise<{ d: Download; bytes: Buffer }> {
  const [d] = await Promise.all([page.waitForEvent("download"), click()]);
  return { d, bytes: readFileSync((await d.path())!) };
}

/** The demo's 17 groups, as the sheets name them. */
const DEMO_CODES = [...[1, 2, 3, 4, 5, 6].map((n) => `א${n}`), ...[1, 2, 3, 4, 5, 6].map((n) => `ב${n}`), ...[1, 2, 3, 4, 5].map((n) => `נ${n}`)];

test.describe("demo build", () => {
  test("set up, suggest, apply, a hand edit onto a cohort not on campus warned, the loads, the clear behind a Confirm", async ({ page }, info) => {
    const phone = info.project.name === "phone";
    await page.goto(`${demoUrl()}/logistics`);
    await page.getByRole("navigation", { name: "לוגיסטיקה" }).getByRole("link", { name: "תורנויות" }).click();
    await expect(page).toHaveURL(/\/logistics\/rota$/);
    await expect(pills(page).getByRole("link")).toHaveText(["לוח", "קבוצות ומכינות", "משמרות צוות", "מוצ״ש"]);
    // no view in the address: «לוח» is drawn as the page, and a screen reader hears it so
    await expect(pills(page).getByRole("link", { name: "לוח" })).toHaveAttribute("aria-current", "page");
    await expect(pills(page).locator("[aria-current]")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "דפים להדפסה" })).toHaveAttribute("href", "/print/rota");

    // ---- the setup: a cohort with a diet, its presence, a group, a duty
    await pills(page).getByRole("link", { name: "קבוצות ומכינות" }).click();
    await expect(page).toHaveURL(/\/logistics\/rota\/setup$/);
    const cohorts = page.getByRole("region", { name: "המכינות" });
    await cohorts.getByRole("button", { name: "+ מכינה" }).click();
    const cform = cohorts.getByRole("form", { name: "מכינה חדשה" });
    await cform.getByLabel("אות").fill("ד");
    await cform.getByLabel("שם המכינה").fill("מכינה לדוגמה ד");
    await cform.getByRole("button", { name: "+ דיאטה" }).click();
    await cform.getByLabel("דיאטה 1", { exact: true }).fill("טבעוני (לדוגמה)");
    await cform.getByLabel("כמה אנשים: דיאטה 1").fill("2");
    await cform.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "המכינה נוספה")).toBeVisible();
    await expect(cohorts.locator('[data-rota-cohort="ד"]')).toContainText("דיאטות: טבעוני (לדוגמה) 2");

    const presence = page.getByRole("region", { name: "מתי בקמפוס" });
    const sunday = presence.getByRole("button", { name: "כל היום: ראשון · מכינה לדוגמה ד" });
    await expect(sunday).toHaveAttribute("aria-pressed", "false");
    await sunday.click();
    await expect(sunday).toHaveAttribute("aria-pressed", "true");
    await expect(presence.getByRole("checkbox", { name: "מכינה לדוגמה ד · ראשון · בוקר" })).toBeChecked();
    await expect(presence.getByRole("checkbox", { name: "מכינה לדוגמה ד · שני · בוקר" })).not.toBeChecked();
    // Thursday's night is not part of the week (it closes at 19:00): nothing to mark
    await expect(presence.getByRole("checkbox", { name: "מכינה לדוגמה ד · חמישי · לילה" })).toHaveCount(0);
    await noSidewaysScroll(page);

    const groups = page.getByRole("region", { name: "הקבוצות" });
    const gform = groups.getByRole("form", { name: "קבוצה חדשה" });
    const cohortSelect = gform.getByLabel("מכינה");
    await expect(gform.getByLabel("מספר")).toHaveValue("7"); // the first cohort's next number
    await cohortSelect.focus();
    await cohortSelect.selectOption({ label: "ד · מכינה לדוגמה ד" });
    await expect(gform.getByLabel("מספר")).toHaveValue("1"); // the next number of that cohort
    await expect(cohortSelect).toBeFocused(); // the form is not drawn anew: the keyboard keeps its place
    await gform.getByLabel("גודל", { exact: true }).fill("8");
    await gform.getByLabel("ראש/ת הקבוצה (לא חובה)").fill("ראש/ת קבוצה לדוגמה 18");
    const addGroup = gform.getByRole("button", { name: "הוספת הקבוצה" });
    await addGroup.press("Enter");
    await expect(toast(page, "הקבוצה ד1 נוספה")).toBeVisible();
    await expect(groups.locator('[data-rota-group="ד1"]')).toContainText("8 חניכים");
    await expect(gform.getByLabel("מספר")).toHaveValue("2");
    await expect(gform.getByLabel("גודל", { exact: true })).toHaveValue(""); // emptied in place, for the next group
    await expect(gform.getByLabel("ראש/ת הקבוצה (לא חובה)")).toHaveValue("");
    await expect(cohortSelect.locator("option:checked")).toHaveText("ד · מכינה לדוגמה ד");
    await expect(addGroup).toBeFocused(); // the busy button keeps the focus: the next group starts here, not at the top

    const duties = page.getByRole("region", { name: "התורנויות" });
    await expect(duties.locator("[data-rota-duty]")).toHaveCount(4); // the demo's: last year's four
    await duties.getByRole("button", { name: "+ תורנות" }).click();
    const dform = duties.getByRole("form", { name: "תורנות חדשה" });
    await dform.getByLabel("שם התורנות").fill("תורנות לדוגמה");
    await dform.getByLabel("בוקר", { exact: true }).fill("1");
    await dform.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "התורנות נוספה")).toBeVisible();
    await expect(duties.locator('[data-rota-duty="תורנות לדוגמה"]')).toContainText("בוקר: 1 · אחר צהריים: לא נקבע · לילה: לא נקבע");
    await noSidewaysScroll(page);

    // ---- the board: «הצעה הוגנת», first a preview
    await pills(page).getByRole("link", { name: "לוח" }).click();
    await expect(page.locator("[data-group-chip]:visible")).toHaveCount(0); // the demo has no assignment yet
    await page.getByRole("button", { name: "הצעה הוגנת" }).click();
    const status = page.locator("[data-suggest-status]");
    await expect(status).toHaveText(/^הוצעו \d+ · \d+ לא התמלאו · עומס \d+–\d+$/);
    const proposed = Number(/^הוצעו (\d+)/.exec((await status.textContent())!)![1]);
    expect(proposed).toBeGreaterThan(50);
    const dashed = page.locator("[data-group-chip][data-suggested]:visible");
    await expect(dashed.first()).toContainText("מוצע");
    await expect(dashed.first()).toHaveClass(/border-dashed/);
    await expect(page.locator("[data-group-chip][data-suggested]:visible [data-preview]").first()).toBeAttached(); // not stored yet
    await noSidewaysScroll(page);
    // «ביטול»: nothing stored, the focus back on «הצעה הוגנת»
    await page.getByRole("button", { name: "ביטול" }).click();
    await expect(page.getByRole("button", { name: "הצעה הוגנת" })).toBeFocused();
    await expect(page.locator("[data-group-chip]:visible")).toHaveCount(0);
    // again, and applied: the chips stay dashed «מוצע» until someone touches them
    await page.getByRole("button", { name: "הצעה הוגנת" }).click();
    await page.getByRole("button", { name: "החלת ההצעה" }).click();
    await expect(toast(page, `${proposed} שיבוצים מוצעים נוספו`)).toBeVisible();
    await expect(status).toHaveCount(0);
    await expect(page.locator("[data-group-chip][data-suggested]:visible [data-preview]")).toHaveCount(0);
    await expect(dashed.first()).toContainText("מוצע");

    // ---- a hand edit: נ1 into Wednesday morning's kitchen — its cohort is on campus Monday and Tuesday only
    if (phone) await page.getByRole("tab", { name: "רביעי" }).click();
    await page.getByRole("button", { name: "שיבוץ: מטבח · רביעי · בוקר" }).click();
    const sheet = page.getByRole("dialog", { name: "מטבח · רביעי · בוקר" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("list", { name: "קבוצות פנויות" }).locator("[data-candidate]").first()).toBeVisible();
    await expect(sheet.getByRole("list", { name: "קבוצות פנויות" }).locator('[data-candidate="נ1"]')).toHaveCount(0);
    await sheet.getByText("לא בקמפוס", { exact: true }).click();
    await sheet.getByRole("button", { name: "שיבוץ: נ1" }).click();
    await expect(toast(page, "נ1 שובצה ל«מטבח»")).toBeVisible();
    await expect(sheet.locator('[data-assigned="נ1"]')).toContainText("לא סומנה בקמפוס");
    await expect(sheet.getByRole("button", { name: "הסרה: נ1" })).toBeFocused(); // the focus follows the group
    // back where it came from, its fold closed: the fold opens and the focus follows it there — never to the page
    const away = sheet.locator("details").filter({ has: page.locator('ul[aria-label="לא בקמפוס"]') }); // closed, it is hidden from roles
    await sheet.getByText("לא בקמפוס", { exact: true }).click();
    await expect(away).not.toHaveAttribute("open");
    await sheet.getByRole("button", { name: "הסרה: נ1" }).press("Enter");
    await expect(toast(page, "נ1 הוסרה מ«מטבח»")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "שיבוץ: נ1" })).toBeFocused();
    await expect(away).toHaveAttribute("open");
    await sheet.getByRole("button", { name: "שיבוץ: נ1" }).press("Enter");
    await expect(sheet.locator('[data-assigned="נ1"]')).toContainText("לא סומנה בקמפוס");
    await expect(sheet.getByRole("button", { name: "הסרה: נ1" })).toBeFocused();
    await noSidewaysScroll(page);
    await sheet.getByRole("button", { name: "סגירה" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole("button", { name: "שיבוץ: מטבח · רביעי · בוקר" })).toBeFocused();
    // on the board: the chip amber with the warning's mark, not dashed (a hand's)
    const warned = page.locator('[data-group-chip="נ1"]:visible').filter({ hasText: "לא סומנה בקמפוס" });
    await expect(warned).toHaveCount(1);
    await expect(warned).toHaveClass(/border-amber-400/);
    await expect(warned).not.toHaveAttribute("data-suggested");
    await expect(warned.locator("[aria-hidden]").filter({ hasText: "!" })).toHaveCount(1);
    // the warnings: the message, and a jump to its cell
    await page.getByText("אזהרות", { exact: true }).click();
    const message = "נ1 שובצה ל«מטבח» ביום רביעי · משמרת בוקר, ומכינה לדוגמה נ לא סומנה בקמפוס במשמרת הזו";
    const item = page.getByRole("list", { name: "אזהרות" }).getByRole("button", { name: message });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.locator(":focus")).toContainText("נ1");
    await noSidewaysScroll(page);

    // ---- «עומס לפי קבוצה»
    await page.getByText("עומס לפי קבוצה", { exact: true }).click();
    const loads = page.locator("[data-rota-loads]");
    await expect(loads).toBeVisible();
    await expect(loads.locator(":visible", { hasText: "ד1" }).first()).toBeVisible();
    await noSidewaysScroll(page);

    // ---- the clear: behind «פעולות נוספות» and a Confirm; «ביטול» gives its button the focus back
    await page.getByText("פעולות נוספות", { exact: true }).click();
    const clear = page.getByRole("button", { name: `ניקוי השיבוצים המוצעים (${proposed})` });
    await clear.click();
    const confirm = page.getByRole("group", { name: "אישור" });
    await expect(confirm).toContainText(`למחוק את ${proposed} השיבוצים המוצעים?`);
    await expect(confirm.getByRole("button", { name: "ביטול" })).toBeFocused(); // a danger: the safe choice first
    await noSidewaysScroll(page);
    await confirm.getByRole("button", { name: "ביטול" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(clear).toBeFocused();
    await clear.click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ניקוי" }).click();
    await expect(toast(page, `${proposed} שיבוצים מוצעים נמחקו.`)).toBeVisible();
    await expect(page.getByRole("button", { name: "ניקוי השיבוצים המוצעים (0)" })).toBeFocused();
    await expect(page.locator("[data-group-chip][data-suggested]:visible")).toHaveCount(0);
    await expect(page.locator('[data-group-chip="נ1"]:visible')).toHaveCount(1); // the hand's stays
    await noSidewaysScroll(page);
  });

  test("`?as=logistics` (v19): a cohort that does not help — the suggestion leaves its groups out; one placed by hand warns, and the home counts it", async ({ page }, info) => {
    const phone = info.project.name === "phone";
    // the demo in that mode: «נ» does not help with the duties (on campus Monday and Tuesday — its presence still counts)
    await page.goto(`${demoUrl()}/logistics/rota?as=logistics`);
    await page.getByRole("button", { name: "הצעה הוגנת" }).click();
    await expect(page.locator("[data-suggest-status]")).toHaveText(/^הוצעו \d+ · /);
    await expect(page.locator('[data-group-chip^="א"]').first()).toBeAttached();
    await expect(page.locator('[data-group-chip^="נ"]')).toHaveCount(0);
    await page.getByRole("button", { name: "החלת ההצעה" }).click();
    await expect(toast(page, /שיבוצים מוצעים נוספו/)).toBeVisible();
    await expect(page.locator('[data-group-chip^="נ"]')).toHaveCount(0);

    // by hand: נ1 into Monday morning's kitchen, a shift it is on campus for — allowed, and warned
    if (phone) await page.getByRole("tab", { name: "שני" }).click();
    await page.getByRole("button", { name: "שיבוץ: מטבח · שני · בוקר" }).click();
    const sheet = page.getByRole("dialog", { name: "מטבח · שני · בוקר" });
    await sheet.getByRole("button", { name: "שיבוץ: נ1" }).click();
    await expect(toast(page, "נ1 שובצה ל«מטבח»")).toBeVisible();
    await sheet.getByRole("button", { name: "סגירה" }).click();
    await expect(sheet).toHaveCount(0);
    await page.getByText("אזהרות", { exact: true }).click();
    await expect(page.getByRole("list", { name: "אזהרות" }).getByRole("button", { name: "נ1 שובצה ב«מטבח» (יום שני · משמרת בוקר), אבל המכינה שלה לא עוזרת בתורנויות" })).toBeVisible();
    await noSidewaysScroll(page);

    // the logistics home's «שיבוץ התורנויות» counts it
    await page.getByRole("navigation", { name: "לוגיסטיקה" }).getByRole("link", { name: "בית" }).click();
    await expect(page.locator('[data-task="assign"]')).toHaveAttribute("data-state", "open");
    await expect(page.locator('[data-task="assign"]')).toContainText("שיבוץ אחד לקבוצה שלא עוזרת");
  });

  test("the heads' phones in the setup: none until «כולל טלפונים», then each group's; a phone saved and shown", async ({ page }) => {
    await page.goto(`${demoUrl()}/logistics/rota/setup`);
    const groups = page.getByRole("region", { name: "הקבוצות" });
    await expect(groups.locator("[data-rota-group]")).toHaveCount(17);
    const toggle = groups.locator("[data-head-phones]");
    await expect(toggle).not.toBeChecked();
    await expect(groups.locator("[data-head-phone]")).toHaveCount(0);
    await expect(page.getByText("טלפון לדוגמה")).toHaveCount(0);
    await expect(page.getByText(/טלפון:/)).toHaveCount(0);
    await groups.getByRole("button", { name: "עריכה: א1" }).click();
    const first = groups.getByRole("form", { name: "עריכת הקבוצה א1" });
    await expect(groups.getByLabel("הטלפון של ראש/ת הקבוצה")).toHaveCount(0); // no field while the switch is off
    // the switch checked with the form open (as its hint says): the field shows the stored phone, and a save of the size
    // alone keeps it — the empty field it once was is not a deletion
    await first.getByLabel("גודל", { exact: true }).fill("9");
    await toggle.check();
    await expect(first.getByLabel("הטלפון של ראש/ת הקבוצה")).toHaveValue("טלפון לדוגמה");
    await expect(first.getByLabel("גודל", { exact: true })).toHaveValue("9"); // what was typed stays
    await first.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "הקבוצה נשמרה")).toBeVisible();
    await expect(groups.locator('[data-rota-group="א1"]')).toContainText("9 חניכים");
    await expect(groups.locator('[data-rota-group="א1"] [data-head-phone]')).toContainText("טלפון לדוגמה");

    await expect(groups.locator("[data-head-phone]")).toHaveCount(17);
    await expect(groups.locator('[data-rota-group="א1"] [data-head-phone]')).toContainText("טלפון לדוגמה");
    await expect(groups.getByText("מידע אישי", { exact: false }).first()).toBeVisible();
    await groups.getByRole("button", { name: "עריכה: א1" }).click();
    const form = groups.getByRole("form", { name: "עריכת הקבוצה א1" });
    await expect(form.getByLabel("הטלפון של ראש/ת הקבוצה")).toHaveValue("טלפון לדוגמה");
    await form.getByLabel("הטלפון של ראש/ת הקבוצה").fill("12");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(form.getByRole("alert")).toContainText("צריך לפחות 6 ספרות");
    await form.getByLabel("הטלפון של ראש/ת הקבוצה").fill("000-000-0001");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "הקבוצה נשמרה")).toBeVisible();
    await expect(groups.locator('[data-rota-group="א1"] [data-head-phone]')).toContainText("000-000-0001");
    await noSidewaysScroll(page);
    await toggle.uncheck();
    await expect(groups.locator("[data-head-phone]")).toHaveCount(0);
    await expect(page.getByText("000-000-0001")).toHaveCount(0);
  });

  test("staff shifts and the Saturday night: a lead added, a pasted list numbered, a task moved and done; the shopping list beside it, printed on its own page", async ({ page }) => {
    await page.goto(`${demoUrl()}/logistics/rota/staff`);
    const monday = page.getByRole("region", { name: "יום שני" });
    await expect(monday.locator("[data-no-lead]")).toContainText("בלי אחראי/ת משמרת: בוקר, אחר צהריים, לילה");
    await monday.getByRole("button", { name: "+ משמרת צוות: יום שני" }).click();
    const form = monday.getByRole("form", { name: "משמרת צוות חדשה: יום שני" });
    await form.getByLabel("מ-").fill("06:30");
    await form.getByLabel("עד").fill("14:30");
    await form.getByRole("radio", { name: "שם אחר" }).check();
    await form.getByLabel("השם").fill("איש/אשת צוות לדוגמה ב");
    await form.getByRole("radio", { name: "אחראי/ת משמרת" }).check();
    await form.getByLabel("הערה (לא חובה)").fill("הקפצת מרצה (לדוגמה)");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "משמרת הצוות נוספה")).toBeVisible();
    const added = monday.locator("[data-staff-shift]").filter({ hasText: "איש/אשת צוות לדוגמה ב" });
    await expect(added).toContainText("06:30–14:30");
    await expect(added).toContainText("אחראי/ת משמרת");
    await expect(added).toContainText("הקפצת מרצה (לדוגמה)");
    await expect(monday.locator("[data-no-lead]")).toContainText("בלי אחראי/ת משמרת: אחר צהריים, לילה");
    await noSidewaysScroll(page);

    await page.getByRole("navigation", { name: "תורנויות" }).getByRole("link", { name: "מוצ״ש" }).click();
    await expect(page.locator("[data-prep]")).toHaveCount(4); // the demo's
    await page.getByText("הדבקת רשימה", { exact: true }).click();
    await page.getByLabel(/שורה לכל משימה/).fill("5. משימה מודבקת לדוגמה א\n\n6) משימה מודבקת לדוגמה ב\n");
    await expect(page.getByText("יתווספו 2 משימות, אחרי האחרונה.")).toBeVisible();
    await page.getByRole("button", { name: "הוספת הרשימה" }).click();
    await expect(toast(page, "נוספו 2 משימות")).toBeVisible();
    await expect(page.locator("[data-prep]")).toHaveCount(6);
    await expect(page.locator('[data-prep="5"]')).toContainText("משימה מודבקת לדוגמה א");
    // a phone in the paste refuses it all — in the lists' own words (a group head's phone has nothing to do with it)
    await page.getByLabel(/שורה לכל משימה/).fill("להתקשר ל-000-000-0055 לגבי השולחנות");
    await expect(page.getByRole("button", { name: "הוספת הרשימה" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("alert").filter({ hasText: "יש כאן טלפון או מייל" })).toHaveText("יש כאן טלפון או מייל. ברשימות של מוצ״ש לא כותבים טלפונים או מיילים.");
    // moved up: it is number 5 now, and keeps the focus
    const up = page.getByRole("button", { name: "הזזה למעלה: משימה 6" });
    await up.click();
    await expect(page.locator('[data-prep="5"]')).toContainText("משימה מודבקת לדוגמה ב");
    await expect(page.getByRole("button", { name: "הזזה למעלה: משימה 5" })).toBeFocused();
    await page.getByRole("checkbox", { name: "בוצע: משימה 1" }).check();
    await expect(page.locator("[data-prep-done]")).toHaveText("בוצעו 1 מתוך 6");
    await page.getByLabel("קבוצה: משימה 1").selectOption({ label: "א2" });
    await expect(page.getByLabel("קבוצה: משימה 1")).toHaveValue(/\d+/);
    await noSidewaysScroll(page);

    // v19: the shopping list beside the tasks — its own count, an item with its quantity, «נקנה», its own paste
    const tasks = page.locator('[data-prep-list="task"]');
    const items = page.locator('[data-prep-list="item"]');
    await expect(items).toContainText("עוד אין פריטים ברשימת הקניות.");
    await expect(items.locator("[data-prep-count]")).toHaveCount(0);
    const add = items.getByRole("form", { name: "פריט חדש" });
    await add.getByLabel("פריט חדש").fill("פריט לדוגמה א");
    await add.getByLabel("כמות").fill("2 (לדוגמה)");
    await add.getByRole("button", { name: "הוספה" }).click();
    await expect(toast(page, "הפריט נוסף")).toBeVisible();
    await expect(items.locator('[data-prep-item="1"]')).toContainText("פריט לדוגמה א");
    await expect(items.locator('[data-prep-item="1"] [data-qty]')).toHaveAttribute("data-qty", "2 (לדוגמה)");
    await expect(items.locator('[data-prep-item="1"]')).toContainText("· כמות: 2 (לדוגמה)");
    await expect(items.locator("[data-prep-count]")).toHaveText("נקנו 0 מתוך 1");
    await expect(page.locator("[data-prep]")).toHaveCount(6); // the tasks' list is its own
    // a quantity is text, never a phone — said in the lists' own words, not in those about a group head's phone
    const NO_CONTACT = "יש כאן טלפון או מייל. ברשימות של מוצ״ש לא כותבים טלפונים או מיילים.";
    await add.getByLabel("פריט חדש").fill("פריט לדוגמה ב");
    await add.getByLabel("כמות").fill("טל׳ 000-000-0055");
    await add.getByRole("button", { name: "הוספה" }).click();
    await expect(items.getByRole("alert")).toHaveText(NO_CONTACT);
    await expect(items.locator("[data-prep-item]")).toHaveCount(1);
    // the item's own text: the same words
    await add.getByLabel("פריט חדש").fill("פריט לדוגמה ב, טל׳ 000-000-0055");
    await add.getByLabel("כמות").fill("");
    await add.getByRole("button", { name: "הוספה" }).click();
    await expect(items.getByRole("alert")).toHaveText(NO_CONTACT);
    await expect(items.locator("[data-prep-item]")).toHaveCount(1);
    await add.getByLabel("פריט חדש").fill("פריט לדוגמה ב");
    await add.getByRole("button", { name: "הוספה" }).click();
    await expect(items.locator('[data-prep-item="2"]')).toContainText("פריט לדוגמה ב");
    await expect(items.locator('[data-prep-item="2"] [data-qty]')).toHaveCount(0); // no quantity: none shown
    await items.getByRole("checkbox", { name: "נקנה: פריט 1" }).check();
    await expect(items.locator("[data-prep-count]")).toHaveText("נקנו 1 מתוך 2");
    await expect(tasks.locator("[data-prep-count]")).toHaveText("בוצעו 1 מתוך 6"); // each list counts its own
    // the paste: a line an item, its quantity after a tab (a spreadsheet's second column), the numbering taken off
    await items.getByText("הדבקת רשימת קניות", { exact: true }).click();
    await items.getByLabel(/^שורה לכל פריט/).fill("1. פריט מודבק לדוגמה א\t3 (לדוגמה)\n\nפריט מודבק לדוגמה ב\n");
    await expect(items.getByText("יתווספו 2 פריטים, אחרי האחרון.")).toBeVisible();
    await items.getByRole("button", { name: "הוספת הפריטים" }).click();
    await expect(toast(page, "נוספו 2 פריטים")).toBeVisible();
    await expect(items.locator("[data-prep-item]")).toHaveCount(4);
    await expect(items.locator('[data-prep-item="3"]')).toContainText("פריט מודבק לדוגמה א");
    await expect(items.locator('[data-prep-item="3"] [data-qty]')).toHaveAttribute("data-qty", "3 (לדוגמה)");
    await expect(items.locator('[data-prep-item="4"] [data-qty]')).toHaveCount(0);
    // moved up inside its own list
    await items.getByRole("button", { name: "הזזה למעלה: פריט 3" }).click();
    await expect(items.locator('[data-prep-item="2"]')).toContainText("פריט מודבק לדוגמה א");
    await expect(page.locator('[data-prep="5"]')).toContainText("משימה מודבקת לדוגמה ב"); // the tasks untouched
    await noSidewaysScroll(page);

    // printed: the tasks, then the shopping list on a page of its own («קניות מוצ״ש»), the quantities as typed
    await goSection(page, "תוצרים");
    await page.getByRole("navigation", { name: "תוצרים" }).getByRole("link", { name: "תורנויות" }).click();
    await page.locator("#rota-view").selectOption("prep");
    const shopping = page.locator('[data-rota-table="קניות מוצ״ש"]');
    await expect(page.locator('[data-rota-table="מוצ״ש"]')).toContainText("משימה מודבקת לדוגמה א");
    await expect(page.locator('[data-rota-table="מוצ״ש"]')).not.toContainText("פריט לדוגמה");
    await expect(shopping).toContainText("פריט מודבק לדוגמה א");
    await expect(shopping).toContainText("3 (לדוגמה)");
    await expect(shopping).toContainText("נקנה");
    await expect(shopping).not.toContainText("משימת הכנה לדוגמה");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("table", { name: "קניות מוצ״ש" })).toBeVisible();
    expect(await page.getByRole("table", { name: "קניות מוצ״ש" }).locator("th").allTextContents()).toEqual(["#", "פריט", "כמות", "נקנה"]);
    const printed = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true }));
    expect(printed.getPageCount()).toBe(2);
    await page.emulateMedia({ media: "screen" });
    await noSidewaysScroll(page);
  });

  test("«תוצרים ← תורנויות»: a PDF page per group, every sheet in the xlsx, the heads' phones off by default", async ({ page }) => {
    await page.goto(`${demoUrl()}/print/rota`);
    const toggle = page.locator("[data-head-phones]");
    await expect(toggle).toBeVisible(); // the demo's user is an admin of every edition
    await expect(toggle).not.toBeChecked();
    await expect(page.getByText("טלפון לדוגמה")).toHaveCount(0);
    await page.locator("#rota-view").selectOption("groups");
    await expect(page.locator("[data-group-sheet]")).toHaveCount(17);
    await noSidewaysScroll(page);

    // the xlsx: a sheet per page, no phone in any of them while the switch is off
    const x = await downloaded(page, () => page.getByRole("button", { name: "הורדת xlsx (כל הגיליונות)" }).click());
    expect(x.d.suggestedFilename()).toMatch(/^volozhin-rota-edition-1-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const files = unzipSync(new Uint8Array(x.bytes));
    const names = [...strFromU8(files["xl/workbook.xml"]).matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    expect(names).toEqual([
      "לוח התורנויות",
      ...DEMO_CODES.map((c) => `לו״ז ${c}`),
      ...["ראשון", "שני", "שלישי", "רביעי", "חמישי"].map((d) => `יום ${d}`),
      "מטבח",
      "ראשי קבוצות",
      "משמרות צוות",
      "מוצ״ש",
      "קניות מוצ״ש", // v19: the shopping list, a sheet of its own (always there, empty or not)
      "אוכל",
      "מי בקמפוס",
      "עומס",
    ]);
    for (const [path, bytes] of Object.entries(files)) expect(strFromU8(bytes), path).not.toContain("טלפון לדוגמה");

    // printed: one A4 page per group
    await page.emulateMedia({ media: "print" });
    const pdf = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true }));
    expect(pdf.getPageCount()).toBe(17);
    await page.emulateMedia({ media: "screen" });

    // the heads' list: no phone column until the switch is on
    await page.locator("#rota-view").selectOption("heads");
    await expect(page.locator("[data-rota-view=heads]")).toContainText("ראש/ת קבוצה לדוגמה 1");
    await expect(page.getByRole("columnheader", { name: "טלפון" })).toHaveCount(0);
    await expect(page.getByText("טלפון לדוגמה")).toHaveCount(0);
    await toggle.check();
    await expect(page.getByText("טלפון לדוגמה").filter({ visible: true }).first()).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("the week's «תורנויות» lens: the duties alone, each shift's codes and its lead, a shift to the board", async ({ page }) => {
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    await page.goto(`${demoUrl()}/logistics/rota`);
    await page.getByRole("button", { name: "הצעה הוגנת" }).click();
    await page.getByRole("button", { name: "החלת ההצעה" }).click();
    await expect(toast(page, /שיבוצים מוצעים נוספו/)).toBeVisible();
    // the week, in the app (the demo keeps its data in memory): the fourth lens
    await page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" }).getByRole("link", { name: "השבוע" }).click();
    await expect(page.getByRole("radiogroup", { name: "עדשה" }).getByRole("radio")).toHaveText(["גיוון", "התקדמות", "אחריות", "תורנויות"]);
    await expect(page.locator("[data-lesson-id]").first()).toBeVisible();
    await page.getByRole("radio", { name: "תורנויות" }).click();
    await expect(page.getByRole("radio", { name: "תורנויות" })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("[data-rota-week]")).toBeVisible();
    await expect(page.locator("[data-lesson-id]")).toHaveCount(0); // no lesson in it
    // Sunday morning: «בית מדרש» first, its codes dashed («מוצע»), the shift's lead, said in words
    const sunday = page.locator('[data-lens-shift="0:0"]');
    await expect(sunday.locator('[data-lens-duty="בית מדרש"] [data-lens-chip][data-suggested]').first()).toBeVisible();
    await expect(sunday).toHaveAttribute("aria-label", /^ראשון, בוקר: בית מדרש: [אבנ]\d.* · אחראי\/ת: /);
    await expect(page.getByText("שובצה מ«הצעה הוגנת» ועוד לא נגעו בה")).toBeVisible();
    if (wide) {
      // the days' headers stand over their own columns (the corner holds the shifts' column)
      const head = (await page.getByRole("columnheader", { name: /^ראשון/ }).boundingBox())!;
      const cell = (await sunday.boundingBox())!;
      expect(Math.abs(head.x + head.width - (cell.x + cell.width))).toBeLessThan(2);
    }
    // Thursday has no night (the week closes at 19:00): hatched, not a link
    if (!wide) await page.getByRole("tab", { name: "חמישי" }).click();
    await expect(page.locator('[data-lens-shift="4:2"]')).toHaveAttribute("title", "מחוץ לשעות השבוע");
    await expect(page.locator('a[data-lens-shift="4:2"]')).toHaveCount(0);
    await expect(page.locator('a[data-lens-shift="4:1"]')).toBeVisible();
    await noSidewaysScroll(page);
    // a shift leads to the board (the demo's member is an admin)
    await page.locator('a[data-lens-shift="4:1"]').click();
    await expect(page).toHaveURL(/\/logistics\/rota$/);
  });
});

// ------------------------------------------------------------------ the mock build: on the wire

/** A small synthetic rota for edition 7: one cohort on campus all week, two groups, one duty, one row of each source. */
function mockRota(): RotaData {
  const slots: [number, number][] = [];
  for (let day = 0; day < 5; day++) for (let shift = 0; shift < 3; shift++) if (!(day === 4 && shift === 2)) slots.push([day, shift]);
  return {
    cohorts: [{ id: 1, edition_id: 7, letter: "א", name: "מכינה לדוגמה א", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 1 }],
    presence: slots.map(([day, shift]) => ({ cohort_id: 1, day: day as 0, shift: shift as 0 })),
    groups: [
      { id: 11, edition_id: 7, cohort_id: 1, number: 1, size: 8, head_name: "ראש/ת קבוצה לדוגמה 1" },
      { id: 12, edition_id: 7, cohort_id: 1, number: 2, size: 7, head_name: null },
    ],
    duties: [{ id: 21, edition_id: 7, name: "מטבח", description: null, need_morning: 1, need_afternoon: 1, need_night: 1, min_people: null, sort: 1 }],
    cohortDuties: [{ cohort_id: 1, duty_id: 21 }],
    assignments: [
      { id: 31, edition_id: 7, day: 0, shift: 0, duty_id: 21, group_id: 11, source: "suggested" },
      { id: 32, edition_id: 7, day: 0, shift: 1, duty_id: 21, group_id: 12, source: "hand" },
    ],
    staff: [],
    prep: [],
  };
}

test.describe("mock build", () => {
  const signedIn = async (page: Page, role: "content" | "logistics" | "admin", archived = false) => {
    const week = demoWeek();
    week.edition = { ...week.edition, id: 7, kind: "real", status: archived ? "archived" : "planning" };
    const email = `${role}@example.org`;
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email, display_name: "חבר/ת צוות לדוגמה", global_admin: false, memberships: [{ edition_id: 7, role, member_id: role === "logistics" ? 5 : role === "admin" ? 1 : 2 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("load_rota", mockRota());
    await sb.attach(page);
    const session = await signIn(page, email);
    sb.token = session.access_token;
    return { sb, week, session };
  };
  const authed = (sb: FakeSupabase, path: string, token: string) => {
    const calls = sb.calls.filter((c) => c.path === path);
    expect(calls.length, path).toBeGreaterThan(0);
    for (const c of calls) expect(c.auth, path).toBe(`Bearer ${token}`);
  };

  test("a content member: /print/rota to read, no phones' switch, get_rota_contacts never called; no «לוגיסטיקה»", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions");
    const { sb, session } = await signedIn(page, "content");
    await page.goto(`${mockUrl()}/tracking`);
    await expect(page.getByRole("navigation", { name: "תוצרים" }).getByRole("link")).toHaveText(["טבלת מעקב", "רשימת מלווים", "תורנויות", "מקראה"]);
    await page.getByRole("navigation", { name: "תוצרים" }).getByRole("link", { name: "תורנויות" }).click();
    await expect(page).toHaveURL(/\/print\/rota$/);
    await expect(page.locator("[data-rota-print]")).toBeVisible();
    await expect(page.locator("[data-rota-view=board]")).toContainText("א1"); // the board, read
    await expect(page.locator("[data-head-phones]")).toHaveCount(0);
    await page.locator("#rota-view").selectOption("heads");
    await expect(page.locator("[data-rota-view=heads]")).toContainText("ראש/ת קבוצה לדוגמה 1");
    await expect(page.getByRole("columnheader", { name: "טלפון" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^שיבוץ/ })).toHaveCount(0);
    expect(sb.rpc.get("load_rota")).toEqual([{ p_edition: 7 }]);
    authed(sb, "/rest/v1/rpc/load_rota", session.access_token);
    // «לוגיסטיקה» is not theirs: its address lands on the week
    await page.goto(`${mockUrl()}/logistics/rota`);
    await expect(page).toHaveURL(new RegExp(`${mockUrl()}/$`));
    expect(sb.rpc.get("get_rota_contacts")).toBeUndefined();
    expect(sb.calls.some((c) => c.path === "/rest/v1/rpc/get_rota_contacts" || c.path === "/rest/v1/rota_group_contacts")).toBe(false);
    expect(sb.writes).toEqual([]);
  });

  test("logistics: one load_rota; the switch → one get_rota_contacts; apply ONE POST of an array; clear ONE DELETE; a phone through set_rota_contact", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb, session } = await signedIn(page, "logistics");
    sb.answers.set("get_rota_contacts", [{ group_id: 11, head_phone: "טלפון לדוגמה מהשרת" }]);
    sb.answers.set("set_rota_contact", null);
    await page.goto(`${mockUrl()}/logistics/rota`);
    await expect(page.getByRole("table", { name: "לוח התורנויות" })).toBeVisible();
    await expect(page.locator('[data-group-chip="א1"]:visible')).toBeVisible();
    expect(sb.rpc.get("load_rota")).toEqual([{ p_edition: 7 }]); // once, on entry
    authed(sb, "/rest/v1/rpc/load_rota", session.access_token);
    expect(sb.rpc.get("get_rota_contacts")).toBeUndefined(); // not until asked

    // «הצעה הוגנת» → «החלת ההצעה»: ONE insert, every row «suggested», by the grant's columns only
    await page.getByRole("button", { name: "הצעה הוגנת" }).click();
    const status = page.locator("[data-suggest-status]");
    await expect(status).toHaveText(/^הוצעו \d+ · /);
    const proposed = Number(/^הוצעו (\d+)/.exec((await status.textContent())!)![1]);
    expect(proposed).toBeGreaterThan(0);
    await page.getByRole("button", { name: "החלת ההצעה" }).click();
    await expect(toast(page, "שיבוצים מוצעים נוספו")).toBeVisible();
    const posts = sb.writes.filter((w) => w.table === "rota_assignments" && w.method === "POST");
    expect(posts).toHaveLength(1);
    const body = posts[0].body as Record<string, unknown>[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(proposed);
    for (const r of body) {
      expect(Object.keys(r).sort()).toEqual(["day", "duty_id", "edition_id", "group_id", "shift", "source"]);
      expect([r.edition_id, r.source, r.duty_id]).toEqual([7, "suggested", 21]);
    }
    expect(posts[0].auth).toBe(`Bearer ${session.access_token}`);

    // the clear: ONE DELETE of the edition's «suggested» rows
    await page.getByText("פעולות נוספות", { exact: true }).click();
    await page.getByRole("button", { name: "ניקוי השיבוצים המוצעים (1)" }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ניקוי" }).click();
    await expect(toast(page, "שיבוץ מוצע אחד נמחק.")).toBeVisible();
    const deletes = sb.writes.filter((w) => w.table === "rota_assignments" && w.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect([deletes[0].query.get("edition_id"), deletes[0].query.get("source")]).toEqual(["eq.7", "eq.suggested"]);

    // the heads' phones: none on screen until the switch; then ONE get_rota_contacts with the member's token
    await page.getByRole("navigation", { name: "תורנויות" }).getByRole("link", { name: "קבוצות ומכינות" }).click();
    const groups = page.getByRole("region", { name: "הקבוצות" });
    await expect(groups.locator("[data-rota-group]")).toHaveCount(2);
    await expect(groups.locator("[data-head-phone]")).toHaveCount(0);
    expect(sb.rpc.get("get_rota_contacts")).toBeUndefined();
    await groups.locator("[data-head-phones]").check();
    await expect(groups.locator('[data-rota-group="א1"] [data-head-phone]')).toContainText("טלפון לדוגמה מהשרת");
    await expect(groups.locator('[data-rota-group="א2"] [data-head-phone]')).toContainText("—");
    expect(sb.rpc.get("get_rota_contacts")).toEqual([{ p_edition: 7 }]);
    authed(sb, "/rest/v1/rpc/get_rota_contacts", session.access_token);

    // a head's phone: set_rota_contact alone — never a table write of a phone
    await groups.getByRole("button", { name: "עריכה: א2" }).click();
    const form = groups.getByRole("form", { name: "עריכת הקבוצה א2" });
    await form.getByLabel("הטלפון של ראש/ת הקבוצה").fill(" 000-000-0001 ");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "הקבוצה נשמרה")).toBeVisible();
    expect(sb.rpc.get("set_rota_contact")).toEqual([{ p_group: 12, p_phone: "000-000-0001" }]);
    authed(sb, "/rest/v1/rpc/set_rota_contact", session.access_token);
    const patch = sb.writes.filter((w) => w.table === "rota_groups");
    expect(patch.map((w) => [w.method, w.query.get("id"), w.body])).toEqual([["PATCH", "eq.12", { number: 2, size: 7, head_name: null }]]);
    for (const w of sb.writes) expect(JSON.stringify(w.body), w.table).not.toContain("000-000-0001");
    await expect.poll(() => sb.rpc.get("get_rota_contacts")?.length).toBe(2); // read again after the save
    expect(sb.calls.some((c) => c.path === "/rest/v1/rota_group_contacts")).toBe(false);
  });

  test("v19 on the wire: the cohorts' two flags by the contract's names; the suggestion skips a cohort that does not help; the shopping list — an item with its quantity, «נקנה», a paste as ONE insert", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb, session } = await signedIn(page, "logistics");
    const base = mockRota();
    const slots = base.presence.map((p) => ({ ...p, cohort_id: 2 }));
    sb.answers.set("load_rota", {
      ...base,
      cohorts: [
        { ...base.cohorts[0], can_drive: false },
        { id: 2, edition_id: 7, letter: "ב", name: "מכינה לדוגמה ב", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 2, can_drive: true },
      ],
      presence: [...base.presence, ...slots], // on campus all week, as א: only the flag keeps its groups out
      groups: [...base.groups, { id: 13, edition_id: 7, cohort_id: 2, number: 1, size: 9, head_name: null }],
      assignments: [],
      prep: [
        { id: 51, edition_id: 7, text: "משימת הכנה לדוגמה", group_id: null, done: false, sort: 1, kind: "task", qty: null },
        { id: 52, edition_id: 7, text: "פריט לדוגמה", group_id: null, done: false, sort: 2, kind: "item", qty: "2 (לדוגמה)" },
      ],
    } satisfies RotaData);
    sb.tables.set("rota_prep_tasks", [{ sort: 2 }]); // the edition's last number, whatever its kind (addPrepTasks reads it)
    const writes = (table: string) => sb.writes.filter((w) => w.table === table).map((w) => [w.method, w.query.get("id"), w.body]);

    // the setup: each cohort's two flags as read, a badge for each that is not the default
    await page.goto(`${mockUrl()}/logistics/rota/setup`);
    const cohorts = page.getByRole("region", { name: "המכינות" });
    await expect(cohorts.locator('[data-rota-cohort="א"]')).toHaveAttribute("data-helps-rota", "y");
    await expect(cohorts.locator('[data-rota-cohort="א"]')).toHaveAttribute("data-can-drive", "-");
    await expect(cohorts.locator('[data-rota-cohort="ב"]')).toHaveAttribute("data-helps-rota", "-");
    await expect(cohorts.locator('[data-rota-cohort="ב"]')).toHaveAttribute("data-can-drive", "y");
    await expect(cohorts.locator('[data-rota-cohort="ב"]')).toContainText("לא עוזרת בתורנויות");
    await expect(cohorts.locator('[data-rota-cohort="ב"]')).toContainText("הצוות יכול להסיע");
    await expect(cohorts.locator('[data-rota-cohort="א"]')).not.toContainText("לא עוזרת בתורנויות");
    // edited: both flags always sent, by the columns' names
    await cohorts.getByRole("button", { name: "עריכה: מכינה לדוגמה א" }).click();
    const edit = cohorts.getByRole("form", { name: "עריכת המכינה: מכינה לדוגמה א" });
    await expect(edit.getByRole("checkbox", { name: "עוזרת בתורנויות" })).toBeChecked();
    await expect(edit.getByRole("checkbox", { name: "הצוות שלה יכול להסיע" })).not.toBeChecked();
    await expect(edit).toContainText("מכינה שלא עוזרת: ההצעה לא משבצת את הקבוצות שלה. הנוכחות שלה עדיין נספרת לארוחות.");
    await edit.getByRole("checkbox", { name: "הצוות שלה יכול להסיע" }).check();
    await edit.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "המכינה נשמרה")).toBeVisible();
    expect(writes("rota_cohorts")).toEqual([["PATCH", "eq.1", { letter: "א", name: "מכינה לדוגמה א", diets: [], helps_rota: true, can_drive: true }]]);
    // a new one: not helping — the defaults are helps, cannot drive
    await cohorts.getByRole("button", { name: "+ מכינה" }).click();
    const fresh = cohorts.getByRole("form", { name: "מכינה חדשה" });
    await expect(fresh.getByRole("checkbox", { name: "עוזרת בתורנויות" })).toBeChecked();
    await expect(fresh.getByRole("checkbox", { name: "הצוות שלה יכול להסיע" })).not.toBeChecked();
    await fresh.getByLabel("אות").fill("ד");
    await fresh.getByLabel("שם המכינה").fill("מכינה לדוגמה ד");
    await fresh.getByRole("checkbox", { name: "עוזרת בתורנויות" }).uncheck();
    await fresh.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "המכינה נוספה")).toBeVisible();
    expect(writes("rota_cohorts").at(-1)).toEqual(["POST", null, { edition_id: 7, letter: "ד", name: "מכינה לדוגמה ד", diets: [], sort: 3, helps_rota: false, can_drive: false }]);

    // «הצעה הוגנת»: never a group of the cohort that does not help, though it is on campus
    await page.getByRole("navigation", { name: "תורנויות" }).getByRole("link", { name: "לוח" }).click();
    await page.getByRole("button", { name: "הצעה הוגנת" }).click();
    await page.getByRole("button", { name: "החלת ההצעה" }).click();
    await expect(toast(page, "שיבוצים מוצעים נוספו")).toBeVisible();
    const posts = sb.writes.filter((w) => w.table === "rota_assignments" && w.method === "POST");
    expect(posts).toHaveLength(1);
    const rows = posts[0].body as { group_id: number }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.group_id))).toEqual(new Set([11, 12]));

    // מוצ״ש: two lists, each its own count
    await page.getByRole("navigation", { name: "תורנויות" }).getByRole("link", { name: "מוצ״ש" }).click();
    const items = page.locator('[data-prep-list="item"]');
    await expect(page.locator('[data-prep-list="task"] [data-prep-count]')).toHaveText("בוצעו 0 מתוך 1");
    await expect(items.locator("[data-prep-count]")).toHaveText("נקנו 0 מתוך 1");
    await expect(items.locator('[data-prep-item="1"] [data-qty]')).toHaveAttribute("data-qty", "2 (לדוגמה)");
    // an item: the text, its kind and its quantity, after the edition's last number
    const add = items.getByRole("form", { name: "פריט חדש" });
    await add.getByLabel("פריט חדש").fill(" פריט חדש לדוגמה ");
    await add.getByLabel("כמות").fill(" 3 (לדוגמה) ");
    await add.getByRole("button", { name: "הוספה" }).click();
    await expect(toast(page, "הפריט נוסף")).toBeVisible();
    // «נקנה» is the row's done (a click: the box shows what the database answers, and this fake answers the same rota)
    await items.getByRole("checkbox", { name: "נקנה: פריט 1" }).click();
    await expect.poll(() => writes("rota_prep_tasks").length).toBe(2);
    // the paste: ONE insert of every line, each item with its quantity (none: null)
    await items.getByText("הדבקת רשימת קניות", { exact: true }).click();
    await items.getByLabel(/^שורה לכל פריט/).fill("1. פריט מודבק לדוגמה א\t4 (לדוגמה)\n2) פריט מודבק לדוגמה ב\n");
    await items.getByRole("button", { name: "הוספת הפריטים" }).click();
    await expect(toast(page, "נוספו 2 פריטים")).toBeVisible();
    // a quantity with a phone in it: refused here, nothing sent
    await add.getByLabel("פריט חדש").fill("פריט לדוגמה ג");
    await add.getByLabel("כמות").fill("000-000-0055");
    await add.getByRole("button", { name: "הוספה" }).click();
    await expect(items.getByRole("alert").filter({ hasText: "טלפון" })).toBeVisible();
    expect(writes("rota_prep_tasks")).toEqual([
      ["POST", null, [{ edition_id: 7, text: "פריט חדש לדוגמה", kind: "item", qty: "3 (לדוגמה)", group_id: null, done: false, sort: 3 }]],
      ["PATCH", "eq.52", { done: true }],
      ["POST", null, [
        { edition_id: 7, text: "פריט מודבק לדוגמה א", kind: "item", qty: "4 (לדוגמה)", group_id: null, done: false, sort: 3 },
        { edition_id: 7, text: "פריט מודבק לדוגמה ב", kind: "item", qty: null, group_id: null, done: false, sort: 4 },
      ]],
    ]);
    for (const w of sb.writes) expect(w.auth, w.table).toBe(`Bearer ${session.access_token}`);
    for (const w of sb.writes) expect(JSON.stringify(w.body), w.table).not.toContain("000-000-0055");
  });

  test("the heads' phones answering late: a form opened before the answer takes the phone, and a save of the size alone sends no phone", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb } = await signedIn(page, "logistics");
    sb.answers.set("get_rota_contacts", [{ group_id: 11, head_phone: "000-000-0011" }]);
    sb.answers.set("set_rota_contact", null);
    // every get_rota_contacts waits until the test lets it go
    const held: (() => void)[] = [];
    await page.route("**/rest/v1/rpc/get_rota_contacts", (route) => new Promise<void>((done) => held.push(() => void route.fallback().then(done))));
    const release = async () => {
      await expect.poll(() => held.length).toBe(1);
      held.shift()!();
    };
    const patches = () => sb.writes.filter((w) => w.table === "rota_groups").map((w) => [w.method, w.query.get("id"), w.body]);
    await page.goto(`${mockUrl()}/logistics/rota/setup`);
    const groups = page.getByRole("region", { name: "הקבוצות" });
    await expect(groups.locator("[data-rota-group]")).toHaveCount(2);

    // the switch checked, «עריכה» before the answer: no field yet; the answer comes — the field shows it
    await groups.locator("[data-head-phones]").check();
    await groups.getByRole("button", { name: "עריכה: א1" }).click();
    const a1 = groups.getByRole("form", { name: "עריכת הקבוצה א1" });
    await expect(a1.getByLabel("גודל", { exact: true })).toHaveValue("8");
    await expect(a1.getByLabel("הטלפון של ראש/ת הקבוצה")).toHaveCount(0);
    await release();
    await expect(a1.getByLabel("הטלפון של ראש/ת הקבוצה")).toHaveValue("000-000-0011");
    await a1.getByLabel("גודל", { exact: true }).fill("9");
    await a1.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "הקבוצה נשמרה")).toBeVisible();
    expect(patches()).toEqual([["PATCH", "eq.11", { number: 1, size: 9, head_name: "ראש/ת קבוצה לדוגמה 1" }]]);
    expect(sb.rpc.get("set_rota_contact")).toBeUndefined(); // the phone untouched — not deleted

    // a phone saved, and the group opened again before the phones are read again: the field takes the new one when it comes
    await groups.getByRole("button", { name: "עריכה: א2" }).click();
    const a2 = groups.getByRole("form", { name: "עריכת הקבוצה א2" });
    await expect(a2.getByLabel("הטלפון של ראש/ת הקבוצה")).toHaveValue("");
    await a2.getByLabel("הטלפון של ראש/ת הקבוצה").fill("000-000-0012");
    await a2.getByRole("button", { name: "שמירה" }).click();
    await expect(a2).toHaveCount(0);
    expect(sb.rpc.get("set_rota_contact")).toEqual([{ p_group: 12, p_phone: "000-000-0012" }]);
    sb.answers.set("get_rota_contacts", [
      { group_id: 11, head_phone: "000-000-0011" },
      { group_id: 12, head_phone: "000-000-0012" },
    ]);
    await groups.getByRole("button", { name: "עריכה: א2" }).click();
    await expect(a2.getByLabel("הטלפון של ראש/ת הקבוצה")).toHaveValue(""); // the phones as they were read last
    await release();
    await expect(a2.getByLabel("הטלפון של ראש/ת הקבוצה")).toHaveValue("000-000-0012");
    await a2.getByLabel("גודל", { exact: true }).fill("6");
    await a2.getByRole("button", { name: "שמירה" }).click();
    await expect(a2).toHaveCount(0);
    expect(patches().at(-1)).toEqual(["PATCH", "eq.12", { number: 2, size: 6, head_name: null }]);
    expect(sb.rpc.get("set_rota_contact")).toEqual([{ p_group: 12, p_phone: "000-000-0012" }]); // not written over
  });

  test("a staff shift whose team member was deactivated since: edited and saved, the member kept", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb, week } = await signedIn(page, "logistics");
    expect(week.team.some((m) => m.id === 99)).toBe(false); // load_week's team is the active one
    const who = "איש/אשת צוות לדוגמה שהושבת/ה";
    sb.answers.set("load_rota", { ...mockRota(), staff: [{ id: 41, edition_id: 7, day: 1, start_min: 510, end_min: 870, member_id: 99, name: who, cohort_id: null, kind: "lead", note: null }] });
    await page.goto(`${mockUrl()}/logistics/rota/staff`);
    const monday = page.getByRole("region", { name: "יום שני" });
    await monday.getByRole("button", { name: `עריכה: ${who} 08:30–14:30` }).click();
    const form = monday.getByRole("form", { name: `עריכת משמרת צוות: ${who}` });
    const member = form.getByLabel("איש/אשת צוות", { exact: true });
    await expect(member).toHaveValue("99");
    await expect(member.locator("option:checked")).toHaveText(`${who} (מושבת/ת)`);
    await expect(member.locator("option")).toHaveCount(week.team.length + 2); // «בחירה…», the team, and this member alone
    await form.getByLabel("הערה (לא חובה)").fill("הערה לדוגמה");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "משמרת הצוות נשמרה")).toBeVisible();
    const writes = sb.writes.filter((w) => w.table === "rota_staff_shifts");
    expect(writes.map((w) => [w.method, w.query.get("id")])).toEqual([["PATCH", "eq.41"]]);
    expect(writes[0].body).toMatchObject({ member_id: 99, name: who, cohort_id: null, kind: "lead", note: "הערה לדוגמה" });
  });

  test("a shift the week no longer has: «הסרה» of its last group keeps the focus in the sheet; closing it lands on the cell", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the board's table: one width");
    const { sb, week } = await signedIn(page, "logistics");
    Object.assign(week.edition, { first_day_from: 900 }); // Sunday opens at 15:00: its morning is not part of the week
    await page.goto(`${mockUrl()}/logistics/rota`);
    await page.getByRole("button", { name: "שיבוץ: מטבח · ראשון · בוקר" }).click();
    const sheet = page.getByRole("dialog", { name: "מטבח · ראשון · בוקר" });
    await expect(sheet).toContainText("אפשר רק להסיר ממנה קבוצות");
    await expect(sheet.getByRole("button", { name: /^שיבוץ/ })).toHaveCount(0);
    sb.answers.set("load_rota", { ...mockRota(), assignments: mockRota().assignments.filter((a) => a.id !== 31) }); // the read after the delete
    await sheet.getByRole("button", { name: "הסרה: א1" }).press("Enter");
    await expect(toast(page, "א1 הוסרה מ«מטבח»")).toBeVisible();
    await expect(sheet.locator("[data-assigned]")).toHaveCount(0);
    await expect(sheet).toBeFocused(); // nowhere left in it to go: the sheet itself, never the page behind the dialog
    const deletes = sb.writes.filter((w) => w.table === "rota_assignments" && w.method === "DELETE");
    expect(deletes.map((w) => w.query.get("id"))).toEqual(["eq.31"]);
    await sheet.getByRole("button", { name: "סגירה" }).press("Enter");
    await expect(sheet).toHaveCount(0);
    await expect(page.locator("#rota-d-0-0-21")).toBeFocused(); // its «שיבוץ» is gone with its last group: the cell
  });

  test("an archived edition: logistics reads the board, the setup, the staff and the list — nothing to write, no phones", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions");
    const { sb } = await signedIn(page, "logistics", true);
    await page.goto(`${mockUrl()}/logistics/rota`);
    await expect(page.locator("[data-rota-readonly]")).toContainText("אפשר לצפות בתורנויות, אבל לא לשנות אותן");
    await expect(page.locator('[data-group-chip="א1"]:visible')).toBeVisible();
    await expect(page.getByRole("button", { name: "הצעה הוגנת" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^שיבוץ/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^ניקוי השיבוצים/ })).toHaveCount(0);
    await page.getByRole("navigation", { name: "תורנויות" }).getByRole("link", { name: "קבוצות ומכינות" }).click();
    await expect(page.getByRole("region", { name: "הקבוצות" }).locator("[data-rota-group]")).toHaveCount(2);
    await expect(page.getByRole("button", { name: /^\+ / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(עריכה|מחיקה|כל השבוע|כל היום)/ })).toHaveCount(0);
    await expect(page.getByRole("form", { name: "קבוצה חדשה" })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "מכינה לדוגמה א · ראשון · בוקר" })).toBeDisabled();
    await expect(page.locator("[data-head-phones]")).toHaveCount(0);
    await page.getByRole("navigation", { name: "תורנויות" }).getByRole("link", { name: "משמרות צוות" }).click();
    await expect(page.getByRole("region", { name: "יום ראשון" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^\+ משמרת צוות/ })).toHaveCount(0);
    await page.getByRole("navigation", { name: "תורנויות" }).getByRole("link", { name: "מוצ״ש" }).click();
    await expect(page.getByRole("form", { name: "משימה חדשה" })).toHaveCount(0);
    await expect(page.getByText("הדבקת רשימה")).toHaveCount(0);
    expect(sb.writes).toEqual([]);
    expect(sb.rpc.get("get_rota_contacts")).toBeUndefined();
  });
  test("the week's «תורנויות» lens: the staff's grid alone — load_rota only once it is on, never a phone; an edition admin's shift leads to the board", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb, session } = await signedIn(page, "admin");
    // the writing grid is the staff's, at `/` (the reset, phase 5: `/grid` sends them there)
    await page.goto(`${mockUrl()}/grid`);
    await expect(page).toHaveURL(new RegExp(`${mockUrl()}/$`));
    await expect(page.locator("[data-lesson-id]").first()).toBeVisible();
    expect(sb.rpc.get("load_rota")).toBeUndefined(); // the other lenses never read it
    await page.getByRole("radio", { name: "תורנויות" }).click();
    await expect(page.locator('[data-lens-shift="0:0"] [data-lens-chip="א1"]')).toHaveAttribute("data-suggested", "true");
    await expect(page.locator('[data-lens-shift="0:1"] [data-lens-chip="א2"]')).not.toHaveAttribute("data-suggested");
    await expect(page.locator('[data-lens-shift="0:0"]')).toHaveAttribute("aria-label", "ראשון, בוקר: מטבח: א1");
    await expect(page.locator('[data-lens-shift="1:0"]')).toHaveAttribute("aria-label", "שני, בוקר: אין שיבוצים");
    expect(sb.rpc.get("load_rota")).toEqual([{ p_edition: 7 }]);
    authed(sb, "/rest/v1/rpc/load_rota", session.access_token);
    // an edition admin's shift leads to «לוגיסטיקה ← תורנויות» (anyone else's to the printout)
    await expect(page.getByRole("link", { name: "ללוח התורנויות" })).toHaveAttribute("href", "/logistics/rota");
    await page.locator('a[data-lens-shift="0:0"]').click();
    await expect(page).toHaveURL(/\/logistics\/rota$/);
    // the heads' phones only behind their switch: never read on the way
    expect(sb.calls.some((c) => c.path === "/rest/v1/rpc/get_rota_contacts" || c.path === "/rest/v1/rota_group_contacts")).toBe(false);
    expect(sb.writes).toEqual([]);
  });

  test("a content member's week has no lens: `/grid` is «השבוע» to read, and load_rota is never asked", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb } = await signedIn(page, "content");
    await page.goto(`${mockUrl()}/grid`);
    await expect(page).toHaveURL(new RegExp(`${mockUrl()}/week$`));
    await expect(page.locator("[data-lesson-id]").first()).toBeVisible();
    await expect(page.getByRole("radio", { name: "תורנויות" })).toHaveCount(0);
    expect(sb.rpc.get("load_rota")).toBeUndefined();
    expect(sb.writes).toEqual([]);
  });
});
