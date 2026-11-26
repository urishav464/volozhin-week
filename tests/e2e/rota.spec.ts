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
// v20 (the owner's notes of 26.11, plan §א–ו): a cohort's trainees and three diet numbers, saved and shown on its line,
// a refusal in the guard's words (rota_diets_exceed) before anything is sent; the duties it helps in — a new cohort every
// one; none: no groups, one line, no group option; the last one unticked from a cohort with groups behind a Confirm —;
// «חלוקה לקבוצות» (a «הצעה» as equal as possible, ONE rota_split_cohort; «חלוקה מחדש» behind a Confirm); the duties'
// order by «למעלה» / «למטה» and its sentence, a new duty's «כל המכינות העוזרות עוזרות בה»; the meals per day × meal on the
// cohorts page and on /print/rota with «תזונה לפי מכינה»; the staff's schedule (a day × the grid's rows, «+» filling a
// row's day and hours, one day at a time below 1024px, no «אחראי/ת») with the transports on the logistics side only —
// /print/rota's staff sheet has none, and no note; and a cohort contact's phone never in load_rota, /print/rota, a file
// or the browser's storage: read through get_rota_contacts when a cohort's form opens, written through set_rota_contact.
// Synthetic data only («לדוגמה»; phones in the «000-…» form or words).
import { readFileSync } from "node:fs";
import { type Download, expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { demoWeek } from "../../src/data/demoWeek";
import type { RotaData } from "../../src/data/rota";
import { errorMessage } from "../../src/errors";
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
/** The demo's duties, in their order (last year's four). */
const DEMO_DUTIES = ["בית מדרש", "פינת קפה", "מטבח", "נקיון"];
/** v20: the guard's words when the diet numbers do not agree (rota_diets_exceed) — the form says them before it sends. */
const DIETS_EXCEED = errorMessage("rota_diets_exceed");
/** The demo's lessons by place (src/data/demoWeek.ts): the ids the pages take. */
const lessonAt = (day: number, start: number) => demoWeek().lessons.find((l) => l.day === day && l.start_min === start && l.kind === "lesson" && l.state === "closed")!.id;
/** A wide screen: the staff's schedule shows the five days side by side from 1024px. */
const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

/** Everything this browser keeps for the origin: localStorage, sessionStorage and every IndexedDB store's values. */
function browserStorage(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const idb: Record<string, unknown> = {};
    for (const d of (await indexedDB.databases?.()) ?? []) {
      const name = d.name;
      if (!name) continue;
      idb[name] = await new Promise((resolve) => {
        const req = indexedDB.open(name);
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const db = req.result;
          const stores = [...db.objectStoreNames];
          if (stores.length === 0) {
            db.close();
            resolve({});
            return;
          }
          const tx = db.transaction(stores, "readonly");
          const out: Record<string, unknown> = {};
          for (const s of stores) {
            const all = tx.objectStore(s).getAll();
            all.onsuccess = () => (out[s] = all.result);
          }
          tx.oncomplete = () => {
            db.close();
            resolve(out);
          };
          tx.onerror = () => {
            db.close();
            resolve(out);
          };
        };
      });
    }
    return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, idb });
  });
}

/** The duties of a list, in order, by their names. */
const dutyOrder = (page: Page) => page.getByRole("region", { name: "התורנויות" }).locator("[data-rota-duty]").evaluateAll((els) => els.map((e) => e.getAttribute("data-rota-duty")));

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

    // ---- the setup: a cohort with its trainees and diet numbers (v20), its presence, a group, a duty
    await pills(page).getByRole("link", { name: "קבוצות ומכינות" }).click();
    await expect(page).toHaveURL(/\/logistics\/rota\/setup$/);
    const cohorts = page.getByRole("region", { name: "המכינות" });
    await cohorts.getByRole("button", { name: "+ מכינה" }).click();
    const cform = cohorts.getByRole("form", { name: "מכינה חדשה" });
    await cform.getByLabel("אות").fill("ד");
    await cform.getByLabel("שם המכינה").fill("מכינה לדוגמה ד");
    await cform.getByLabel("חניכים", { exact: true }).fill("8");
    await cform.getByLabel("צמחוני/טבעוני", { exact: true }).fill("2");
    await cform.getByLabel("ללא גלוטן", { exact: true }).fill("0");
    await cform.getByLabel("מהם גם וגם", { exact: true }).fill("0");
    await cform.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "המכינה נוספה")).toBeVisible();
    await expect(cohorts.locator('[data-rota-cohort="ד"] [data-cohort-numbers]')).toHaveText("8 חניכים · צמחוני/טבעוני 2 · ללא גלוטן 0 · מהם גם וגם 0 · בלי קבוצות");
    await expect(cohorts.locator('[data-rota-cohort="ד"] [data-cohort-duties]')).toHaveText(`עוזרת ב: ${DEMO_DUTIES.join(", ")}`); // a new cohort: every duty

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
    await expect(toast(page, "התורנות נוספה, ו-4 מכינות עוזרות בה")).toBeVisible(); // v20: «כל המכינות העוזרות עוזרות בה», ticked
    await expect(duties.locator('[data-rota-duty="תורנות לדוגמה"]')).toContainText("בוקר: 1 · אחר צהריים: לא נקבע · לילה: לא נקבע");
    await expect(duties.locator('[data-rota-duty="תורנות לדוגמה"] [data-duty-helpers]')).toHaveText("מכינות שעוזרות בה: א, ב, נ, ד");
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

    // ---- a hand edit: נ1 into Wednesday morning's «בית מדרש» — its cohort is on campus Monday and Tuesday only (v20: and
    // helps in «בית מדרש» alone, so its presence is the one thing warned about here; not_eligible is the next test's)
    if (phone) await page.getByRole("tab", { name: "רביעי" }).click();
    await page.getByRole("button", { name: "שיבוץ: בית מדרש · רביעי · בוקר" }).click();
    const sheet = page.getByRole("dialog", { name: "בית מדרש · רביעי · בוקר" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("list", { name: "קבוצות פנויות" }).locator("[data-candidate]").first()).toBeVisible();
    await expect(sheet.getByRole("list", { name: "קבוצות פנויות" }).locator('[data-candidate="נ1"]')).toHaveCount(0);
    await sheet.getByText("לא בקמפוס", { exact: true }).click();
    await expect(sheet.locator('[data-candidate="נ1"]')).toHaveAttribute("data-helps-here", "y");
    await sheet.getByRole("button", { name: "שיבוץ: נ1" }).click();
    await expect(toast(page, "נ1 שובצה ל«בית מדרש»")).toBeVisible();
    await expect(sheet.locator('[data-assigned="נ1"]')).toContainText("לא סומנה בקמפוס");
    await expect(sheet.getByRole("button", { name: "הסרה: נ1" })).toBeFocused(); // the focus follows the group
    // back where it came from, its fold closed: the fold opens and the focus follows it there — never to the page
    const away = sheet.locator("details").filter({ has: page.locator('ul[aria-label="לא בקמפוס"]') }); // closed, it is hidden from roles
    await sheet.getByText("לא בקמפוס", { exact: true }).click();
    await expect(away).not.toHaveAttribute("open");
    await sheet.getByRole("button", { name: "הסרה: נ1" }).press("Enter");
    await expect(toast(page, "נ1 הוסרה מ«בית מדרש»")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "שיבוץ: נ1" })).toBeFocused();
    await expect(away).toHaveAttribute("open");
    await sheet.getByRole("button", { name: "שיבוץ: נ1" }).press("Enter");
    await expect(sheet.locator('[data-assigned="נ1"]')).toContainText("לא סומנה בקמפוס");
    await expect(sheet.getByRole("button", { name: "הסרה: נ1" })).toBeFocused();
    await noSidewaysScroll(page);
    await sheet.getByRole("button", { name: "סגירה" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole("button", { name: "שיבוץ: בית מדרש · רביעי · בוקר" })).toBeFocused();
    // on the board: the chip amber with the warning's mark, not dashed (a hand's)
    const warned = page.locator('[data-group-chip="נ1"]:visible').filter({ hasText: "לא סומנה בקמפוס" });
    await expect(warned).toHaveCount(1);
    await expect(warned).toHaveClass(/border-amber-400/);
    await expect(warned).not.toHaveAttribute("data-suggested");
    await expect(warned.locator("[aria-hidden]").filter({ hasText: "!" })).toHaveCount(1);
    // the warnings: the message, and a jump to its cell
    await page.getByText("אזהרות", { exact: true }).click();
    const message = "נ1 שובצה ל«בית מדרש» ביום רביעי · משמרת בוקר, ומכינה לדוגמה נ לא סומנה בקמפוס במשמרת הזו";
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

  test("the cohort form (v20): trainees and three diet numbers saved and shown on its line; «גם וגם» above another, or more than the trainees, refused in the guard's words; a new cohort ticks every duty; the contact's phone in its form alone", async ({ page }) => {
    await page.goto(`${demoUrl()}/logistics/rota/setup`);
    const cohorts = page.getByRole("region", { name: "המכינות" });
    await expect(cohorts.locator("[data-rota-cohort]")).toHaveCount(3);
    await cohorts.getByRole("button", { name: "+ מכינה" }).click();
    const form = cohorts.getByRole("form", { name: "מכינה חדשה" });
    // a new cohort helps in every duty to begin with (plan §ג), in the duties' order
    const helps = form.getByRole("group", { name: "באילו תורנויות היא עוזרת" });
    await expect(helps.getByRole("checkbox")).toHaveCount(DEMO_DUTIES.length);
    for (const d of DEMO_DUTIES) await expect(helps.getByRole("checkbox", { name: d, exact: true })).toBeChecked();
    await form.getByLabel("אות").fill("ד");
    await form.getByLabel("שם המכינה").fill("מכינה לדוגמה ד");
    const count = (label: string, v: string) => form.getByLabel(label, { exact: true }).fill(v);
    // «מהם גם וגם» above «צמחוני/טבעוני»: said in the guard's words, nothing saved
    await count("חניכים", "23");
    await count("צמחוני/טבעוני", "3");
    await count("ללא גלוטן", "2");
    await count("מהם גם וגם", "4");
    await expect(form.locator("[data-diet-split]")).toHaveCount(0); // no meals' line while the numbers do not agree
    const save = form.getByRole("button", { name: "שמירה" });
    await save.click();
    await expect(form.getByRole("alert")).toHaveText(DIETS_EXCEED);
    await expect(cohorts.locator("[data-rota-cohort]")).toHaveCount(3);
    await expect(toast(page, "המכינה נוספה")).toHaveCount(0);
    // צמחוני/טבעוני + ללא גלוטן − גם וגם above the trainees: the same words
    await count("חניכים", "4");
    await count("ללא גלוטן", "3");
    await count("מהם גם וגם", "1");
    await save.click();
    await expect(form.getByRole("alert")).toHaveText(DIETS_EXCEED);
    await expect(cohorts.locator("[data-rota-cohort]")).toHaveCount(3);
    // agreed: the line under the numbers says what the meals are
    await count("חניכים", "23");
    await count("ללא גלוטן", "2");
    await expect(form.locator("[data-diet-split]")).toHaveText("כלומר: צמחוני/טבעוני בלבד 2 · ללא גלוטן בלבד 1 · גם וגם 1 · רגיל 19");
    // the staff contact: the name for the whole team, the phone into its own field (personal data)
    await form.getByLabel("איש/אשת קשר מהצוות (משבץ/ת)").fill("איש/אשת קשר לדוגמה ד");
    await form.getByLabel("הטלפון של איש/אשת הקשר").fill("000-000-0044");
    await helps.getByRole("checkbox", { name: "נקיון", exact: true }).uncheck();
    await noSidewaysScroll(page);
    await save.click();
    await expect(toast(page, "המכינה נוספה")).toBeVisible();
    await expect(form).toHaveCount(0);
    await expect(cohorts.getByRole("button", { name: "+ מכינה" })).toBeFocused();
    const line = cohorts.locator('[data-rota-cohort="ד"]');
    await expect(line.locator("[data-cohort-numbers]")).toHaveText("23 חניכים · צמחוני/טבעוני 3 · ללא גלוטן 2 · מהם גם וגם 1 · בלי קבוצות");
    await expect(line.locator("[data-cohort-duties]")).toHaveText("עוזרת ב: בית מדרש, פינת קפה, מטבח");
    await expect(line).toHaveAttribute("data-helps-rota", "y");
    await expect(line).toContainText("איש/אשת קשר: איש/אשת קשר לדוגמה ד");
    await expect(page.getByText("000-000-0044")).toHaveCount(0); // the phone is on no line
    // the meals: a cohort never marked on campus makes them TBD, and is named (never assumed)
    await expect(page.locator("[data-rota-food]")).toContainText("לא סומן מתי בקמפוס: מכינה לדוגמה ד");
    // opened again: the numbers, the duties, and the phone read into its field alone
    const edit = cohorts.getByRole("button", { name: "עריכה: מכינה לדוגמה ד" });
    await edit.click();
    const again = cohorts.getByRole("form", { name: "עריכת המכינה: מכינה לדוגמה ד" });
    await expect(again.getByLabel("הטלפון של איש/אשת הקשר")).toHaveValue("000-000-0044");
    await expect(again.getByLabel("חניכים", { exact: true })).toHaveValue("23");
    await expect(again.getByLabel("מהם גם וגם", { exact: true })).toHaveValue("1");
    await expect(again.getByRole("checkbox", { name: "נקיון", exact: true })).not.toBeChecked();
    await expect(again.getByRole("checkbox", { name: "מטבח", exact: true })).toBeChecked();
    await again.getByRole("button", { name: "ביטול" }).click();
    await expect(again).toHaveCount(0);
    await expect(edit).toBeFocused();
    await expect(page.getByText("000-000-0044")).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test("duties per cohort (v20): the last duty unticked from a cohort with groups asks first — «ביטול» gives «שמירה» the focus back —, then its groups go; a cohort that helps in no duty has one line and no group option", async ({ page }) => {
    await page.goto(`${demoUrl()}/logistics/rota/setup`);
    const cohorts = page.getByRole("region", { name: "המכינות" });
    const groups = page.getByRole("region", { name: "הקבוצות" });
    await expect(groups.locator("[data-rota-group]")).toHaveCount(17);
    // the demo's «נ» helps in «בית מדרש» alone, and has five groups
    await expect(cohorts.locator('[data-rota-cohort="נ"] [data-cohort-duties]')).toHaveText("עוזרת ב: בית מדרש");
    await cohorts.getByRole("button", { name: "עריכה: מכינה לדוגמה נ" }).click();
    const form = cohorts.getByRole("form", { name: "עריכת המכינה: מכינה לדוגמה נ" });
    const helps = form.getByRole("group", { name: "באילו תורנויות היא עוזרת" });
    await expect(helps.getByRole("checkbox", { name: "בית מדרש", exact: true })).toBeChecked();
    await expect(helps.getByRole("checkbox", { name: "מטבח", exact: true })).not.toBeChecked();
    await helps.getByRole("checkbox", { name: "בית מדרש", exact: true }).uncheck();
    const save = form.getByRole("button", { name: "שמירה" });
    await save.click();
    // what goes is said first: the groups by code, and with them their heads' names and phones
    const confirm = form.getByRole("group", { name: "אישור" });
    await expect(confirm).toContainText("בלי אף תורנות אין למכינה לדוגמה נ קבוצות: 5 הקבוצות שלה (נ1–נ5) יימחקו, ואיתן השמות והטלפונים של ראשי הקבוצות. לשמור כך?");
    await expect(confirm.getByRole("button", { name: "ביטול" })).toBeFocused(); // a danger: the safe choice first
    await noSidewaysScroll(page);
    await confirm.getByRole("button", { name: "ביטול" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(save).toBeFocused();
    await expect(groups.locator("[data-rota-group]")).toHaveCount(17); // nothing saved
    await save.click();
    await form.getByRole("group", { name: "אישור" }).getByRole("button", { name: "שמירה ומחיקת הקבוצות" }).click();
    await expect(toast(page, "המכינה נשמרה, ו-5 הקבוצות שלה נמחקו.")).toBeVisible();
    await expect(cohorts.getByRole("button", { name: "עריכה: מכינה לדוגמה נ" })).toBeFocused();
    const line = cohorts.locator('[data-rota-cohort="נ"]');
    await expect(line).toHaveAttribute("data-helps-rota", "-");
    await expect(line).toContainText("לא עוזרת בתורנויות");
    await expect(line.locator("[data-cohort-numbers]")).toContainText("בלי קבוצות");
    // no groups: one line, no split, and «קבוצה חדשה» does not offer it
    await expect(groups.locator("[data-rota-group]")).toHaveCount(12);
    await expect(groups.locator('[data-cohort-groups="נ"]')).toHaveText("מכינה לדוגמה נ לא עוזרת באף תורנות, ולכן אין לה קבוצות.");
    await expect(groups.locator('[data-cohort-groups="נ"] [data-split]')).toHaveCount(0);
    await expect(groups.getByRole("form", { name: "קבוצה חדשה" }).getByLabel("מכינה").locator("option")).toHaveText(["א · מכינה לדוגמה א", "ב · מכינה לדוגמה ב"]);
    await expect(page.getByRole("region", { name: "התורנויות" }).locator('[data-rota-duty="בית מדרש"] [data-duty-helpers]')).toHaveText("מכינות שעוזרות בה: א, ב");
    await noSidewaysScroll(page);
  });

  test("«חלוקה לקבוצות» (v20): 23 trainees by 8 — a «הצעה» of 8, 8, 7, saved at once; «חלוקה מחדש» behind a Confirm whose «ביטול» gives its button the focus back", async ({ page }) => {
    await page.goto(`${demoUrl()}/logistics/rota/setup`);
    const cohorts = page.getByRole("region", { name: "המכינות" });
    const groups = page.getByRole("region", { name: "הקבוצות" });
    // a new cohort of 23 (every duty ticked): it may have groups, and has none yet
    await cohorts.getByRole("button", { name: "+ מכינה" }).click();
    const form = cohorts.getByRole("form", { name: "מכינה חדשה" });
    await form.getByLabel("אות").fill("ד");
    await form.getByLabel("שם המכינה").fill("מכינה לדוגמה ד");
    await form.getByLabel("חניכים", { exact: true }).fill("23");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "המכינה נוספה")).toBeVisible();
    const mine = groups.locator('[data-cohort-groups="ד"]');
    await expect(mine).toContainText("עוד אין קבוצות · 23 חניכים");
    // the split is open while there are no groups: the size of a group typed, the preview a «הצעה»
    const split = mine.getByRole("form", { name: "חלוקה לקבוצות: מכינה לדוגמה ד" });
    await expect(split).toBeVisible();
    await expect(split).toHaveAttribute("data-split", "ד");
    await split.getByLabel("כמה חניכים בקבוצה").fill("8");
    const preview = split.locator("[data-split-preview]");
    await expect(preview).toContainText("3 קבוצות: ד1 — 8, ד2 — 8, ד3 — 7");
    await expect(preview).toContainText("הצעה");
    await noSidewaysScroll(page);
    await split.getByRole("button", { name: "חלוקה לקבוצות" }).click();
    await expect(toast(page, "מכינה לדוגמה ד חולקה ל-3 קבוצות. הגדלים הם הצעה: אפשר לשנות כל אחד ביד.")).toBeVisible();
    await expect(groups.locator('[data-rota-group^="ד"]')).toHaveCount(3);
    for (const [code, size] of [["ד1", 8], ["ד2", 8], ["ד3", 7]] as const) await expect(groups.locator(`[data-rota-group="${code}"]`)).toContainText(`${size} חניכים`);
    await expect(mine.locator("[data-sizes-against]")).toHaveCount(0); // 23 of 23
    // the review: the fold the split was made in stays open, and its button — now «חלוקה מחדש» — keeps the focus
    const again = mine.getByRole("form", { name: "חלוקה מחדש: מכינה לדוגמה ד" });
    await expect(again).toBeVisible();
    await expect(again.getByRole("button", { name: "חלוקה מחדש" })).toBeFocused();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
    // again: «חלוקה מחדש» — it says what goes before anything is written
    await again.getByLabel("כמה חניכים בקבוצה").fill("12");
    await expect(again.locator("[data-split-preview]")).toContainText("2 קבוצות: ד1 — 12, ד2 — 11");
    const button = again.getByRole("button", { name: "חלוקה מחדש" });
    await button.click();
    const confirm = again.getByRole("group", { name: "אישור" });
    await expect(confirm).toContainText("לחלק מחדש את מכינה לדוגמה ד? 3 הקבוצות שלה (ד1–ד3) יימחקו, ואיתן השמות והטלפונים של ראשי הקבוצות. במקומן: 2 קבוצות: ד1 — 12, ד2 — 11.");
    await expect(confirm.getByRole("button", { name: "ביטול" })).toBeFocused();
    await noSidewaysScroll(page);
    await confirm.getByRole("button", { name: "ביטול" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(groups.locator('[data-rota-group^="ד"]')).toHaveCount(3);
    await button.click();
    await again.getByRole("group", { name: "אישור" }).getByRole("button", { name: "חלוקה מחדש" }).click();
    await expect(toast(page, "מכינה לדוגמה ד חולקה ל-2 קבוצות.")).toBeVisible();
    await expect(groups.locator('[data-rota-group^="ד"]')).toHaveCount(2);
    await expect(groups.locator('[data-rota-group="ד1"]')).toContainText("12 חניכים");
    await expect(groups.locator('[data-rota-group="ד2"]')).toContainText("11 חניכים");
    // a size stays a «הצעה»: changed by hand, the line says the groups no longer add up to the trainees
    await groups.getByRole("button", { name: "עריכה: ד2" }).click();
    const d2 = groups.getByRole("form", { name: "עריכת הקבוצה ד2" });
    await d2.getByLabel("גודל", { exact: true }).fill("10");
    await d2.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "הקבוצה נשמרה")).toBeVisible();
    await expect(mine.locator("[data-sizes-against]")).toHaveText("בקבוצות 22 מתוך 23 החניכים");
    await noSidewaysScroll(page);
  });

  test("the duties' order (v20): no «סדר» field — «למעלה» / «למטה» and the sentence that says what the order does; a new duty's «כל המכינות העוזרות עוזרות בה», ticked to begin with", async ({ page }) => {
    await page.goto(`${demoUrl()}/logistics/rota/setup`);
    const duties = page.getByRole("region", { name: "התורנויות" });
    await expect.poll(() => dutyOrder(page)).toEqual(DEMO_DUTIES);
    await expect(duties.locator("[data-duty-order]")).toHaveText("הסדר כאן הוא הסדר בלוח ובדפים. כשאין מספיק קבוצות, התורנות שלמעלה מתמלאת קודם.");
    // the form has no «סדר» number
    await duties.getByRole("button", { name: "עריכה: מטבח" }).click();
    const edit = duties.getByRole("form", { name: "עריכת התורנות: מטבח" });
    await expect(edit.getByLabel("שם התורנות")).toHaveValue("מטבח");
    await expect(edit.getByLabel("סדר")).toHaveCount(0);
    await edit.getByRole("button", { name: "ביטול" }).click();
    await expect(duties.getByRole("button", { name: "עריכה: מטבח" })).toBeFocused();
    // «למעלה»: «מטבח» before «פינת קפה»; the focus stays on the button
    const up = duties.getByRole("button", { name: "הזזה למעלה: מטבח" });
    await up.click();
    await expect.poll(() => dutyOrder(page)).toEqual(["בית מדרש", "מטבח", "פינת קפה", "נקיון"]);
    await expect(up).toBeFocused();
    // «למטה» by the keyboard: «בית מדרש» after «מטבח»
    await duties.getByRole("button", { name: "הזזה למטה: בית מדרש" }).press("Enter");
    await expect.poll(() => dutyOrder(page)).toEqual(["מטבח", "בית מדרש", "פינת קפה", "נקיון"]);
    await expect(duties.getByRole("button", { name: "הזזה למטה: בית מדרש" })).toBeFocused();
    // the first cannot go up, the last cannot go down
    await expect(duties.getByRole("button", { name: "הזזה למעלה: מטבח" })).toHaveAttribute("aria-disabled", "true");
    await expect(duties.getByRole("button", { name: "הזזה למטה: נקיון" })).toHaveAttribute("aria-disabled", "true");
    for (const b of await duties.getByRole("button", { name: /^הזזה/ }).all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noSidewaysScroll(page);
    // the pages follow the list: «מטבח» first on /print/rota's board (its rows: a shift, then its duties in order)
    await page.getByRole("link", { name: "דפים להדפסה" }).click();
    const board = page.locator('[data-rota-table="לוח התורנויות"] table tbody tr');
    await expect(board.first()).toBeAttached();
    expect(await board.evaluateAll((rows) => rows.slice(0, 4).map((r) => r.querySelectorAll("td")[1]?.textContent))).toEqual(["מטבח", "בית מדרש", "פינת קפה", "נקיון"]);
    await page.goBack();
    await expect.poll(() => dutyOrder(page)).toEqual(["מטבח", "בית מדרש", "פינת קפה", "נקיון"]);

    // a new duty goes last; «כל המכינות העוזרות עוזרות בה» ticked: every cohort that helps now helps in it
    await duties.getByRole("button", { name: "+ תורנות" }).click();
    const form = duties.getByRole("form", { name: "תורנות חדשה" });
    await expect(form.getByLabel("סדר")).toHaveCount(0);
    const every = form.getByRole("checkbox", { name: "כל המכינות העוזרות עוזרות בה" });
    await expect(every).toBeChecked();
    await expect(form).toContainText("מכינה לדוגמה א, מכינה לדוגמה ב, מכינה לדוגמה נ. אפשר לשנות אחר כך בעריכת המכינה. התורנות החדשה נכנסת בסוף הרשימה.");
    await form.getByLabel("שם התורנות").fill("תורנות לדוגמה א");
    await form.getByLabel("בוקר", { exact: true }).fill("1");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "התורנות נוספה, ו-3 מכינות עוזרות בה")).toBeVisible();
    await expect.poll(() => dutyOrder(page)).toEqual(["מטבח", "בית מדרש", "פינת קפה", "נקיון", "תורנות לדוגמה א"]);
    await expect(duties.locator('[data-rota-duty="תורנות לדוגמה א"] [data-duty-helpers]')).toHaveText("מכינות שעוזרות בה: א, ב, נ");
    await expect(page.getByRole("region", { name: "המכינות" }).locator('[data-rota-cohort="נ"] [data-cohort-duties]')).toHaveText("עוזרת ב: בית מדרש, תורנות לדוגמה א");
    // unticked: no cohort helps in it — said, the suggestion will not fill it
    await duties.getByRole("button", { name: "+ תורנות" }).click();
    await form.getByLabel("שם התורנות").fill("תורנות לדוגמה ב");
    await form.getByRole("checkbox", { name: "כל המכינות העוזרות עוזרות בה" }).uncheck();
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("status").getByText("התורנות נוספה", { exact: true })).toBeVisible();
    await expect(duties.locator('[data-rota-duty="תורנות לדוגמה ב"] [data-duty-helpers]')).toHaveText("אף מכינה לא עוזרת בה: ההצעה לא תמלא אותה.");
    await noSidewaysScroll(page);
  });

  test("«כמויות אוכל» (v20): a day × meal under the cohorts — folded on a phone —, counting the cohorts on campus when the meal starts; on /print/rota with «תזונה לפי מכינה»", async ({ page }, info) => {
    const phone = info.project.name === "phone";
    await page.goto(`${demoUrl()}/logistics/rota/setup`);
    const food = page.locator("[data-rota-food]");
    await expect(food.getByRole("heading", { name: "כמויות אוכל" })).toBeVisible();
    await expect(food).toContainText("חניכים בלבד");
    const monday = `שני · ארוחת בוקר / חבורות ‎07:00–08:00`;
    if (phone) {
      // a card per meal is a long page: folded, the count beside it
      const cards = food.getByRole("list", { name: "אוכל" });
      await expect(cards).toBeHidden();
      await food.locator("summary", { hasText: "לכל ארוחה" }).click();
      await expect(cards).toBeVisible();
      await expect(cards.getByRole("listitem")).toHaveCount(17);
      await expect(cards.getByRole("listitem").filter({ hasText: monday })).toContainText("מכינה לדוגמה א, מכינה לדוגמה ב, מכינה לדוגמה נ");
    } else {
      const table = food.getByRole("table", { name: "אוכל" });
      await expect(table.locator("thead th")).toHaveText(["יום", "ארוחה", "מכינות בקמפוס", "חניכים", "צמחוני/טבעוני בלבד", "ללא גלוטן בלבד", "גם וגם", "רגיל"]);
      await expect(table.locator("tbody tr")).toHaveCount(17);
      // Monday's breakfast: «נ» is on campus Monday morning — 48 + 47 + 40; a midnight meal is the night before's
      await expect(table.locator("tbody tr").nth(3).locator("td")).toHaveText(["שני", "ארוחת בוקר / חבורות ‎07:00–08:00", "מכינה לדוגמה א, מכינה לדוגמה ב, מכינה לדוגמה נ", "135", "10", "4", "2", "119"]);
      await expect(table.locator("tbody tr").nth(2).locator("td").first()).toHaveText("ליל ראשון–שני");
    }
    await noSidewaysScroll(page);
    // the meal follows the cohort's presence in the shift it starts in: «נ» taken off Monday's morning
    await page.getByRole("region", { name: "מתי בקמפוס" }).getByRole("checkbox", { name: "מכינה לדוגמה נ · שני · בוקר" }).uncheck();
    const breakfast = food.locator('[data-rota-table="אוכל"]').locator(phone ? "li" : "tbody tr").filter({ hasText: phone ? monday : "ארוחת בוקר" }).first();
    await expect(breakfast).toContainText("מכינה לדוגמה א, מכינה לדוגמה ב");
    await expect(breakfast).not.toContainText("מכינה לדוגמה נ");
    await expect(breakfast).toContainText("95");

    // /print/rota: the same meals, then each cohort's own numbers — a page of the paper, whatever the width
    await food.getByRole("link", { name: "להדפסה", exact: true }).click();
    await expect(page).toHaveURL(/\/print\/rota\?view=food$/);
    const sheet = page.locator("[data-food-sheet]");
    await expect(sheet.locator("[data-food-meals]")).toBeVisible();
    await expect(sheet.locator("[data-food-cohorts]").getByRole("heading", { name: "תזונה לפי מכינה" })).toBeVisible();
    await noSidewaysScroll(page);
    await page.emulateMedia({ media: "print" });
    const cohortsTable = page.getByRole("table", { name: "תזונה לפי מכינה" });
    await expect(cohortsTable.locator("thead th")).toHaveText(["מכינה (חניכים בלבד)", "חניכים", "צמחוני/טבעוני בלבד", "ללא גלוטן בלבד", "גם וגם", "רגיל"]);
    expect(await cohortsTable.locator("tbody tr").evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent)))).toEqual([
      ["מכינה לדוגמה א", "48", "4", "1", "1", "42"],
      ["מכינה לדוגמה ב", "47", "3", "1", "0", "43"],
      ["מכינה לדוגמה נ", "40", "3", "2", "1", "34"],
      ["סה״כ", "135", "10", "4", "2", "119"],
    ]);
    await expect(page.getByRole("table", { name: "אוכל" }).locator("tbody tr")).toHaveCount(17);
    await page.emulateMedia({ media: "screen" });
  });

  test("`?as=logistics` (v20): «נ» helps in «בית מדרש» alone — placed by hand elsewhere it warns (not_eligible) and the home counts it; the suggestion never puts its groups elsewhere; «ד» helps in none: no groups, one line, no group option", async ({ page }, info) => {
    const phone = info.project.name === "phone";
    await page.goto(`${demoUrl()}/logistics/rota?as=logistics`);
    // by hand, before anything else is placed: נ1 into Monday morning's kitchen — on campus then, but not one of its duties
    if (phone) await page.getByRole("tab", { name: "שני" }).click();
    await page.getByRole("button", { name: "שיבוץ: מטבח · שני · בוקר" }).click();
    const sheet = page.getByRole("dialog", { name: "מטבח · שני · בוקר" });
    const free = sheet.getByRole("list", { name: "קבוצות פנויות" });
    // the groups whose cohort helps here first; the others after them, said so — allowed
    const helps = await free.locator("[data-candidate]").evaluateAll((els) => els.map((e) => e.getAttribute("data-helps-here")));
    expect(helps).toEqual([...helps].sort((a, b) => (a === b ? 0 : a === "y" ? -1 : 1)));
    expect(helps).toContain("y");
    await expect(free.locator('[data-candidate="א1"]')).toHaveAttribute("data-helps-here", "y");
    await expect(free.locator('[data-candidate="נ1"]')).toHaveAttribute("data-helps-here", "-");
    await expect(free.locator('[data-candidate="נ1"]')).toContainText("המכינה לא עוזרת בתורנות הזו");
    await expect(free.locator('[data-candidate="א1"]')).not.toContainText("המכינה לא עוזרת בתורנות הזו");
    await sheet.getByRole("button", { name: "שיבוץ: נ1" }).click();
    await expect(toast(page, "נ1 שובצה ל«מטבח»")).toBeVisible();
    await expect(sheet.locator('[data-assigned="נ1"]')).toContainText("נ1 שובצה ב«מטבח» (יום שני · משמרת בוקר), אבל מכינה לדוגמה נ לא עוזרת ב«מטבח»"); // the warning, beside it
    await noSidewaysScroll(page);
    await sheet.getByRole("button", { name: "סגירה" }).click();
    await expect(sheet).toHaveCount(0);
    await page.getByText("אזהרות", { exact: true }).click();
    await expect(page.getByRole("list", { name: "אזהרות" }).getByRole("button", { name: "נ1 שובצה ב«מטבח» (יום שני · משמרת בוקר), אבל מכינה לדוגמה נ לא עוזרת ב«מטבח»" })).toBeVisible();
    await expect(page.locator('[data-warning="not_eligible"]')).toHaveCount(1);

    // «הצעה הוגנת»: «נ»'s groups only where it helps — «בית מדרש» (by the cells' duty)
    await page.getByRole("button", { name: "הצעה הוגנת" }).click();
    await expect(page.locator("[data-suggest-status]")).toHaveText(/^הוצעו \d+ · /);
    await page.getByRole("button", { name: "החלת ההצעה" }).click();
    await expect(toast(page, /שיבוצים מוצעים נוספו/)).toBeVisible();
    const placed = await page.evaluate(() => {
      const beit = /^rota-btn-[dp]-\d+-\d+-(\d+)$/.exec(document.querySelector('[aria-label^="שיבוץ: בית מדרש"]')?.id ?? "")?.[1];
      const duties = [...document.querySelectorAll('[data-group-chip^="נ"][data-suggested]')].map((chip) => /^rota-[dp]-\d+-\d+-(\d+)$/.exec(chip.closest('[id^="rota-d-"], [id^="rota-p-"]')?.id ?? "")?.[1]);
      return { beit, duties };
    });
    expect(placed.beit).toBeTruthy();
    expect(placed.duties.length).toBeGreaterThan(0); // «נ» on campus Monday and Tuesday: placed then
    expect(new Set(placed.duties)).toEqual(new Set([placed.beit]));
    await expect(page.locator('[data-warning="not_eligible"]')).toHaveCount(1); // the suggestion added none
    await noSidewaysScroll(page);

    // the logistics home's «שיבוץ התורנויות» counts the hand's one
    await page.getByRole("navigation", { name: "לוגיסטיקה" }).getByRole("link", { name: "בית" }).click();
    await expect(page.locator('[data-task="assign"]')).toHaveAttribute("data-state", "open");
    await expect(page.locator('[data-task="assign"]')).toContainText("שיבוץ אחד בתורנות שהמכינה לא עוזרת בה");

    // «ד» helps in no duty (plan §ב): no groups — one line —, no split, and «קבוצה חדשה» does not offer it
    await page.getByRole("navigation", { name: "לוגיסטיקה" }).getByRole("link", { name: "תורנויות" }).click();
    await pills(page).getByRole("link", { name: "קבוצות ומכינות" }).click();
    const dalet = page.getByRole("region", { name: "המכינות" }).locator('[data-rota-cohort="ד"]');
    await expect(dalet).toHaveAttribute("data-helps-rota", "-");
    await expect(dalet).toContainText("לא עוזרת בתורנויות");
    await expect(dalet.locator("[data-cohort-numbers]")).toHaveText("30 חניכים · צמחוני/טבעוני 4 · ללא גלוטן 2 · מהם גם וגם 1 · בלי קבוצות");
    const groups = page.getByRole("region", { name: "הקבוצות" });
    await expect(groups.locator('[data-cohort-groups="ד"]')).toHaveText("מכינה לדוגמה ד לא עוזרת באף תורנות, ולכן אין לה קבוצות.");
    await expect(groups.locator('[data-rota-group^="ד"]')).toHaveCount(0);
    await expect(groups.getByRole("form", { name: "קבוצה חדשה" }).getByLabel("מכינה").locator("option")).toHaveText(["א · מכינה לדוגמה א", "ב · מכינה לדוגמה ב", "נ · מכינה לדוגמה נ"]);
    // it still eats: «ד» is on campus Wednesday and Thursday — counted in those meals
    await expect(page.locator("[data-rota-food]")).toContainText("מכינה לדוגמה א, מכינה לדוגמה ב, מכינה לדוגמה ד");
    await noSidewaysScroll(page);
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

  test("staff shifts and the Saturday night: the schedule's «+» fills a row's day and hours (v20, no «אחראי/ת»), a pasted list numbered, a task moved and done; the shopping list beside it, printed on its own page", async ({ page }) => {
    await page.goto(`${demoUrl()}/logistics/rota/staff`);
    const wide = isWide(page);
    const schedule = page.locator("[data-staff-schedule]");
    // a day × the grid's rows (plan §ה): from 1024px the five days side by side; below it one day at a time
    if (wide) {
      await expect(schedule.getByRole("columnheader")).toHaveText(["שעה", "ראשון", "שני", "שלישי", "רביעי", "חמישי"]);
      await expect(page.getByRole("tablist", { name: "ימים" })).toHaveCount(0);
    } else {
      const tabs = page.getByRole("tablist", { name: "ימים" }).getByRole("tab");
      await expect(tabs).toHaveCount(5);
      await expect(schedule).toHaveAttribute("data-staff-day", "0");
      await page.getByRole("tab", { name: /^יום שני/ }).click();
      await expect(schedule).toHaveAttribute("data-staff-day", "1");
      await expect(page.getByRole("tab", { name: /^יום שני/ })).toHaveAttribute("aria-selected", "true");
    }
    // there is no «אחראי/ת משמרת» anywhere (plan §ה): every staff shift is a shift
    await expect(page.getByText("אחראי/ת")).toHaveCount(0);
    await expect(page.locator("[data-no-lead]")).toHaveCount(0);
    // «+» in Monday's 08:30–10:00 row: the form, with the row's day and hours
    const plus = page.getByRole("button", { name: "+ משמרת צוות: יום שני 08:30–10:00" });
    await expect(plus).toHaveAttribute("aria-expanded", "false");
    const box = (await plus.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    await plus.click();
    await expect(plus).toHaveAttribute("aria-expanded", "true");
    const form = page.getByRole("form", { name: "משמרת צוות חדשה: יום שני" });
    await expect(form.getByLabel("יום", { exact: true })).toHaveValue("1");
    await expect(form.getByLabel("מ-", { exact: true })).toHaveValue("08:30");
    await expect(form.getByLabel("עד", { exact: true })).toHaveValue("10:00");
    await expect(form.getByRole("radio", { name: /אחראי/ })).toHaveCount(0);
    // extended to a later row's end: the end follows
    const until = form.getByLabel("להאריך עד סוף שורה");
    await expect(until).toHaveValue("600");
    await until.selectOption({ value: "870" });
    await expect(form.getByLabel("עד", { exact: true })).toHaveValue("14:30");
    await form.getByRole("radio", { name: "שם אחר" }).check();
    await form.getByLabel("השם").fill("איש/אשת צוות לדוגמה ב");
    await form.getByLabel("הערה (לא חובה)").fill("הערה לדוגמה");
    await noSidewaysScroll(page);
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "משמרת הצוות נוספה")).toBeVisible();
    await expect(form).toHaveCount(0);
    await expect(plus).toBeFocused(); // back on the «+» it came from
    // its first row: the hours, the note, «עריכה» / «מחיקה»; the rows after it: the name and «עד»
    const added = schedule.locator("[data-staff-shift]").filter({ hasText: "איש/אשת צוות לדוגמה ב" });
    await expect(added).toHaveCount(1);
    await expect(added).toContainText("08:30–14:30");
    await expect(added).toContainText("הערה לדוגמה");
    await expect(added.getByRole("button", { name: "עריכה: איש/אשת צוות לדוגמה ב 08:30–14:30" })).toBeVisible();
    const cont = schedule.locator("[data-staff-cont]").filter({ hasText: "איש/אשת צוות לדוגמה ב" });
    await expect(cont.first()).toContainText("איש/אשת צוות לדוגמה ב · עד 14:30");
    expect(await cont.count()).toBeGreaterThan(1); // 10:00–11:30, 11:30–13:00, …
    await expect(page.getByText("אחראי/ת")).toHaveCount(0);
    await noSidewaysScroll(page);
    // the review: moved to Tuesday — below 1024px Tuesday's tab opens on it — and its «עריכה» takes the focus back
    await added.getByRole("button", { name: "עריכה: איש/אשת צוות לדוגמה ב 08:30–14:30" }).click();
    const edit = page.getByRole("form", { name: "עריכת משמרת צוות: איש/אשת צוות לדוגמה ב" });
    await edit.getByLabel("יום", { exact: true }).selectOption("2");
    await edit.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "משמרת הצוות נשמרה")).toBeVisible();
    await expect(edit).toHaveCount(0);
    if (!wide) await expect(page.getByRole("tab", { name: /^יום שלישי/ })).toHaveAttribute("aria-selected", "true");
    await expect(schedule.locator('[data-staff-shift]').filter({ hasText: "איש/אשת צוות לדוגמה ב" }).getByRole("button", { name: "עריכה: איש/אשת צוות לדוגמה ב 08:30–14:30" })).toBeFocused();
    if (!wide) {
      // a new shift saved for another day than the tab: that day's tab, the shift in view, the focus on its schedule
      await page.getByRole("tab", { name: /^יום שני/ }).click();
      await page.getByRole("button", { name: "+ משמרת צוות: יום שני 08:30–10:00" }).click();
      const other = page.getByRole("form", { name: "משמרת צוות חדשה: יום שני" });
      await other.getByLabel("יום", { exact: true }).selectOption("3");
      await other.getByRole("radio", { name: "שם אחר" }).check();
      await other.getByLabel("השם").fill("איש/אשת צוות לדוגמה ג");
      await other.getByRole("button", { name: "שמירה" }).click();
      await expect(other).toHaveCount(0);
      await expect(page.getByRole("tab", { name: /^יום רביעי/ })).toHaveAttribute("aria-selected", "true");
      await expect(schedule.locator("[data-staff-shift]").filter({ hasText: "איש/אשת צוות לדוגמה ג" })).toHaveCount(1);
      await expect(schedule).toBeFocused();
    }

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

  test("the staff's schedule on the logistics side (v20): the transports in it — the pickup's row, a pickup before 06:30 in the night before, a round trip's return, dashed while it waits — each a way to the board; /print/rota's staff sheet: names only, no transport and no note", async ({ page }) => {
    const wide = isWide(page);
    await page.goto(`${demoUrl()}/logistics/rota/staff?as=logistics`);
    const schedule = page.locator("[data-staff-schedule]");
    await expect(schedule).toContainText("הקפצת מרצה (לדוגמה)"); // a shift's note: here, the logistics side
    await expect(page.locator("[data-staff-transports]")).toHaveAttribute("data-staff-transports", "4");
    const leg = (day: number, start: number, which: "pickup" | "return") => page.locator(`[data-staff-leg="${lessonAt(day, start)}:${which}"]`);
    // Sunday's, arranged — in Sunday's first row (the week opens at 08:30)
    await expect(leg(0, 510, "pickup")).toHaveAttribute("data-state", "arranged");
    await expect(leg(0, 510, "pickup")).toHaveText("הסעה 07:15 · ד״ר מרצה 01");
    // Monday's waits for its decision, dashed: picked up at 06:10 — on the staff's clock the night of Sunday
    const early = leg(1, 510, "pickup");
    await expect(early).toHaveAttribute("data-state", "pending");
    await expect(early).toHaveClass(/border-dashed/);
    await expect(early).toHaveText("הסעה 06:10 · פרופ׳ מרצה 04");
    expect(await early.evaluate((e) => e.closest("[data-staff-cell]")?.getAttribute("data-staff-cell")?.split(":")[0])).toBe("0");
    for (const l of await schedule.locator("[data-staff-leg]").all()) expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // …and back at the teaching's end, in Monday's column
    if (!wide) await page.getByRole("tab", { name: /^יום שני/ }).click();
    await expect(leg(1, 510, "return")).toHaveText("הסעה חזרה 09:45 · פרופ׳ מרצה 04");
    expect(await leg(1, 510, "return").evaluate((e) => e.closest("[data-staff-cell]")?.getAttribute("data-staff-cell")?.split(":")[0])).toBe("1");
    // Wednesday's: approved, in the row of its pickup
    if (!wide) await page.getByRole("tab", { name: /^יום רביעי/ }).click();
    const wed = leg(3, 600, "pickup");
    await expect(wed).toHaveAttribute("data-state", "approved");
    await expect(wed).toHaveText("הסעה 08:45 · פרופ׳ מרצה 19");
    // never an address or a phone here
    await expect(page.getByText("כתובת לדוגמה")).toHaveCount(0);
    await expect(page.getByText("טלפון לדוגמה")).toHaveCount(0);
    await noSidewaysScroll(page);
    // a transport leads to its day on the board
    await wed.click();
    await expect(page).toHaveURL(/\/logistics\/transports\?day=3$/);
    await expect(page.getByRole("button", { name: "יום רביעי: הסעה אחת" })).toHaveAttribute("aria-pressed", "true");

    // /print/rota is every member's: the same schedule, the names alone — no transport, no note (plan §ה)
    await page.goto(`${demoUrl()}/print/rota?view=staff`);
    const sheet = page.locator("[data-staff-sheet]");
    await expect(sheet).toContainText("לוגיסטיקה (הדגמה)");
    await expect(sheet).toContainText("איש/אשת צוות לדוגמה ב׳");
    for (const t of ["הסעה", "מרצה 01", "מרצה 04", "מרצה 19", "הקפצת מרצה", "אחראי/ת"]) await expect(sheet, t).not.toContainText(t);
    if (wide) {
      await expect(sheet.getByRole("table", { name: "משמרות צוות" })).toBeVisible();
    } else {
      // one day at a time below 1024px
      await expect(sheet.getByRole("tablist", { name: "ימים" }).getByRole("tab")).toHaveCount(5);
      await sheet.getByRole("tab", { name: "שני" }).click();
      await expect(sheet.locator('[data-staff-day="1"]')).toContainText("איש/אשת צוות לדוגמה ב׳");
      // the review: an hour range is never broken at its dash («08:30–» / «14:30» read as two times) — one line box each
      for (const [d, name] of ["ראשון", "שני", "שלישי", "רביעי", "חמישי"].entries()) {
        await sheet.getByRole("tab", { name, exact: true }).click();
        const ranges = sheet.locator(`[data-staff-day="${d}"] bdi`);
        expect(await ranges.count(), name).toBeGreaterThan(0);
        for (const b of await ranges.all()) expect(await b.evaluate((e) => e.getClientRects().length), `${name}: ${await b.textContent()}`).toBe(1);
      }
    }
    await noSidewaysScroll(page);
    // on paper: the whole table, still without them
    await page.emulateMedia({ media: "print" });
    await expect(sheet.getByRole("table", { name: "משמרות צוות" })).toBeVisible();
    await expect(sheet.getByRole("table", { name: "משמרות צוות" }).locator("thead th")).toHaveText(["שעה", "בלו״ז", "ראשון", "שני", "שלישי", "רביעי", "חמישי"]);
    await page.emulateMedia({ media: "screen" });
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
      "אוכל", // v20: a row per day × meal
      "תזונה לפי מכינה", // v20: each cohort's own numbers
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

  test("the week's «תורנויות» lens: the duties alone, each shift's codes and its staff, a shift to the board", async ({ page }) => {
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
    // Sunday morning: «בית מדרש» first, its codes dashed («מוצע»), the shift's staff (v20: all of them — no lead), said in words
    const sunday = page.locator('[data-lens-shift="0:0"]');
    await expect(sunday.locator('[data-lens-duty="בית מדרש"] [data-lens-chip][data-suggested]').first()).toBeVisible();
    await expect(sunday).toHaveAttribute("aria-label", /^ראשון, בוקר: בית מדרש: [אבנ]\d.* · צוות: לוגיסטיקה \(הדגמה\)$/);
    await expect(sunday).toContainText("צוות: לוגיסטיקה (הדגמה)");
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
    // v20: one duty — nothing to order: no «למעלה» / «למטה» and no sentence about the order
    await expect(page.getByRole("region", { name: "התורנויות" }).locator('[data-rota-duty="מטבח"]')).toBeVisible();
    await expect(page.locator("[data-duty-order]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^הזזה (למעלה|למטה): / })).toHaveCount(0);
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
    expect(sb.rpc.get("set_rota_contact")).toEqual([{ p_kind: "group", p_id: 12, p_phone: "000-000-0001" }]); // v20: one function for a group's or a cohort's phone
    authed(sb, "/rest/v1/rpc/set_rota_contact", session.access_token);
    const patch = sb.writes.filter((w) => w.table === "rota_groups");
    expect(patch.map((w) => [w.method, w.query.get("id"), w.body])).toEqual([["PATCH", "eq.12", { number: 2, size: 7, head_name: null }]]);
    for (const w of sb.writes) expect(JSON.stringify(w.body), w.table).not.toContain("000-000-0001");
    await expect.poll(() => sb.rpc.get("get_rota_contacts")?.length).toBe(2); // read again after the save
    expect(sb.calls.some((c) => c.path === "/rest/v1/rota_group_contacts")).toBe(false);
  });

  test("v20 on the wire: a cohort's fields and its duties by the contract's names (rota_cohort_duties: one insert, then one delete of the rest); the suggestion never puts a group on a duty its cohort does not help in; the shopping list — an item with its quantity, «נקנה», a paste as ONE insert", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb, session } = await signedIn(page, "logistics");
    sb.answers.set("get_rota_contacts", []); // read when a cohort's form opens (its contact's phone): none here
    const base = mockRota();
    const slots = base.presence.map((p) => ({ ...p, cohort_id: 2 }));
    sb.answers.set("load_rota", {
      ...base,
      cohorts: [
        { ...base.cohorts[0], can_drive: false },
        { id: 2, edition_id: 7, letter: "ב", name: "מכינה לדוגמה ב", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 2, can_drive: true },
      ],
      presence: [...base.presence, ...slots], // on campus all week, as א: only the duties it helps in keep its group out of «מטבח»
      groups: [...base.groups, { id: 13, edition_id: 7, cohort_id: 2, number: 1, size: 9, head_name: null }],
      duties: [...base.duties, { id: 22, edition_id: 7, name: "בית מדרש", description: null, need_morning: 1, need_afternoon: 1, need_night: 1, min_people: null, sort: 2 }],
      cohortDuties: [
        { cohort_id: 1, duty_id: 21 },
        { cohort_id: 1, duty_id: 22 },
        { cohort_id: 2, duty_id: 22 }, // «ב» helps in «בית מדרש» alone
      ],
      assignments: [],
      prep: [
        { id: 51, edition_id: 7, text: "משימת הכנה לדוגמה", group_id: null, done: false, sort: 1, kind: "task", qty: null },
        { id: 52, edition_id: 7, text: "פריט לדוגמה", group_id: null, done: false, sort: 2, kind: "item", qty: "2 (לדוגמה)" },
      ],
    } satisfies RotaData);
    sb.tables.set("rota_prep_tasks", [{ sort: 2 }]); // the edition's last number, whatever its kind (addPrepTasks reads it)
    const writes = (table: string) => sb.writes.filter((w) => w.table === table).map((w) => [w.method, w.query.get("id"), w.body]);

    // the setup: each cohort's duties (v20: a cohort helps when it has one) and its «יכול להסיע», as read
    await page.goto(`${mockUrl()}/logistics/rota/setup`);
    const cohorts = page.getByRole("region", { name: "המכינות" });
    await expect(cohorts.locator('[data-rota-cohort="א"]')).toHaveAttribute("data-helps-rota", "y");
    await expect(cohorts.locator('[data-rota-cohort="א"]')).toHaveAttribute("data-can-drive", "-");
    await expect(cohorts.locator('[data-rota-cohort="א"] [data-cohort-duties]')).toHaveText("עוזרת ב: מטבח, בית מדרש");
    await expect(cohorts.locator('[data-rota-cohort="ב"]')).toHaveAttribute("data-helps-rota", "y");
    await expect(cohorts.locator('[data-rota-cohort="ב"]')).toHaveAttribute("data-can-drive", "y");
    await expect(cohorts.locator('[data-rota-cohort="ב"] [data-cohort-duties]')).toHaveText("עוזרת ב: בית מדרש");
    await expect(cohorts.locator('[data-rota-cohort="ב"]')).toContainText("הצוות יכול להסיע");
    // edited: every field by the columns' names (the numbers TBD stay null); its duties unchanged — not sent
    await cohorts.getByRole("button", { name: "עריכה: מכינה לדוגמה א" }).click();
    const edit = cohorts.getByRole("form", { name: "עריכת המכינה: מכינה לדוגמה א" });
    await expect(edit.getByRole("checkbox", { name: "מטבח", exact: true })).toBeChecked();
    await expect(edit.getByRole("checkbox", { name: "בית מדרש", exact: true })).toBeChecked();
    await expect(edit.getByRole("checkbox", { name: "הצוות שלה יכול להסיע" })).not.toBeChecked();
    await expect(edit).toContainText("מכינה שלא עוזרת באף תורנות — אין לה קבוצות, והיא נספרת רק בכמויות האוכל.");
    await edit.getByRole("checkbox", { name: "הצוות שלה יכול להסיע" }).check();
    await edit.getByLabel("חניכים", { exact: true }).fill("15");
    await edit.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "המכינה נשמרה")).toBeVisible();
    expect(writes("rota_cohorts")).toEqual([
      ["PATCH", "eq.1", { letter: "א", name: "מכינה לדוגמה א", contact_name: null, trainees: 15, diet_veg: null, diet_gf: null, diet_both: null, can_drive: true }],
    ]);
    expect(writes("rota_cohort_duties")).toEqual([]);
    expect(sb.rpc.get("set_rota_contact")).toBeUndefined(); // no phone typed: none sent
    // a new one: every duty ticked to begin with, «מטבח» taken off — the cohort, then its duties
    await cohorts.getByRole("button", { name: "+ מכינה" }).click();
    const fresh = cohorts.getByRole("form", { name: "מכינה חדשה" });
    await expect(fresh.getByRole("checkbox", { name: "מטבח", exact: true })).toBeChecked();
    await expect(fresh.getByRole("checkbox", { name: "בית מדרש", exact: true })).toBeChecked();
    await expect(fresh.getByRole("checkbox", { name: "הצוות שלה יכול להסיע" })).not.toBeChecked();
    await fresh.getByLabel("אות").fill("ד");
    await fresh.getByLabel("שם המכינה").fill("מכינה לדוגמה ד");
    await fresh.getByRole("checkbox", { name: "מטבח", exact: true }).uncheck();
    await fresh.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "המכינה נוספה")).toBeVisible();
    const post = sb.writes.findIndex((w) => w.table === "rota_cohorts" && w.method === "POST");
    expect(writes("rota_cohorts").at(-1)).toEqual([
      "POST", null, { edition_id: 7, letter: "ד", name: "מכינה לדוגמה ד", contact_name: null, trainees: null, diet_veg: null, diet_gf: null, diet_both: null, sort: 3, can_drive: false },
    ]);
    const freshId = 100 + post + 1; // this fake's id for that insert (its row's id comes back, as return=representation does)
    const duty = sb.writes.filter((w) => w.table === "rota_cohort_duties");
    expect(duty.map((w) => [w.method, w.body])).toEqual([
      ["POST", [{ edition_id: 7, cohort_id: freshId, duty_id: 22 }]],
      ["DELETE", null],
    ]);
    expect(duty[0].query.get("on_conflict")).toBe("cohort_id,duty_id");
    expect(duty[0].prefer).toContain("resolution=ignore-duplicates"); // no UPDATE grant: an existing row is left as it is
    expect([duty[1].query.get("edition_id"), duty[1].query.get("cohort_id"), duty[1].query.get("duty_id")]).toEqual(["eq.7", `eq.${freshId}`, "not.in.(22)"]);

    // «הצעה הוגנת»: a group only on the duties its cohort helps in — «ב»'s never on «מטבח», though it is on campus
    await page.getByRole("navigation", { name: "תורנויות" }).getByRole("link", { name: "לוח" }).click();
    await page.getByRole("button", { name: "הצעה הוגנת" }).click();
    await page.getByRole("button", { name: "החלת ההצעה" }).click();
    await expect(toast(page, "שיבוצים מוצעים נוספו")).toBeVisible();
    const posts = sb.writes.filter((w) => w.table === "rota_assignments" && w.method === "POST");
    expect(posts).toHaveLength(1);
    const rows = posts[0].body as { group_id: number; duty_id: number }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.group_id))).toEqual(new Set([11, 12, 13]));
    expect(new Set(rows.filter((r) => r.group_id === 13).map((r) => r.duty_id))).toEqual(new Set([22]));

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

  test("v20 on the wire: the cohort form says rota_diets_exceed before anything is sent; «חלוקה לקבוצות» is ONE rota_split_cohort with p_sizes — «חלוקה מחדש» the same one call; the last duty unticked: the cohort, its groups, then its duties", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb, session } = await signedIn(page, "logistics");
    const base = mockRota();
    sb.answers.set("load_rota", {
      ...base,
      cohorts: [
        { ...base.cohorts[0], trainees: 15, diet_veg: 3, diet_gf: 2, diet_both: 1 },
        { id: 2, edition_id: 7, letter: "ב", name: "מכינה לדוגמה ב", trainees: 23, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 2, can_drive: false },
      ],
      cohortDuties: [
        { cohort_id: 1, duty_id: 21 },
        { cohort_id: 2, duty_id: 21 },
      ],
      assignments: [],
    } satisfies RotaData);
    sb.answers.set("get_rota_contacts", []);
    sb.answers.set("rota_split_cohort", [
      { id: 61, edition_id: 7, cohort_id: 2, number: 1, size: 8, head_name: null },
      { id: 62, edition_id: 7, cohort_id: 2, number: 2, size: 8, head_name: null },
      { id: 63, edition_id: 7, cohort_id: 2, number: 3, size: 7, head_name: null },
    ]);
    await page.goto(`${mockUrl()}/logistics/rota/setup`);
    const cohorts = page.getByRole("region", { name: "המכינות" });
    const groups = page.getByRole("region", { name: "הקבוצות" });

    // «מהם גם וגם» above «ללא גלוטן»: the guard's words beside the form — and nothing on the wire
    await cohorts.getByRole("button", { name: "עריכה: מכינה לדוגמה א" }).click();
    const edit = cohorts.getByRole("form", { name: "עריכת המכינה: מכינה לדוגמה א" });
    await expect(edit.getByLabel("ללא גלוטן", { exact: true })).toHaveValue("2");
    await edit.getByLabel("מהם גם וגם", { exact: true }).fill("4");
    await edit.getByRole("button", { name: "שמירה" }).click();
    await expect(edit.getByRole("alert")).toHaveText(DIETS_EXCEED);
    expect(sb.writes).toEqual([]);
    expect([...sb.rpc.keys()].sort()).toEqual(["get_rota_contacts", "load_rota", "load_week"]); // the form's phone read when it opened, nothing else
    await edit.getByRole("button", { name: "ביטול" }).click();

    // «חלוקה לקבוצות» of «ב» (23, no groups yet): ONE call with the sizes, never a group written one by one
    const split = groups.locator('[data-split="ב"]');
    await split.getByLabel("כמה חניכים בקבוצה").fill("8");
    await expect(split.locator("[data-split-preview]")).toContainText("3 קבוצות: ב1 — 8, ב2 — 8, ב3 — 7");
    await split.getByRole("button", { name: "חלוקה לקבוצות" }).click();
    await expect(toast(page, "מכינה לדוגמה ב חולקה ל-3 קבוצות.")).toBeVisible();
    expect(sb.rpc.get("rota_split_cohort")).toEqual([{ p_edition: 7, p_cohort: 2, p_sizes: [8, 8, 7] }]);
    expect(sb.writes.filter((w) => w.table === "rota_groups")).toEqual([]);
    // «חלוקה מחדש» of «א» (15, two groups): behind its Confirm, the same ONE call — no delete of its groups first
    const again = groups.locator('[data-cohort-groups="א"]');
    await again.locator("summary", { hasText: "חלוקה מחדש" }).click();
    await again.locator('[data-split="א"]').getByLabel("כמה חניכים בקבוצה").fill("8");
    await again.getByRole("button", { name: "חלוקה מחדש" }).click();
    await again.getByRole("group", { name: "אישור" }).getByRole("button", { name: "חלוקה מחדש" }).click();
    await expect.poll(() => sb.rpc.get("rota_split_cohort")?.length).toBe(2);
    expect(sb.rpc.get("rota_split_cohort")![1]).toEqual({ p_edition: 7, p_cohort: 1, p_sizes: [8, 7] });
    expect(sb.writes.filter((w) => w.table === "rota_groups")).toEqual([]);

    // «א»'s last duty unticked: the Confirm, then the cohort, its two groups, and its duties — in that order (in_use never falls)
    await cohorts.getByRole("button", { name: "עריכה: מכינה לדוגמה א" }).click();
    await edit.getByRole("checkbox", { name: "מטבח", exact: true }).uncheck();
    await edit.getByRole("button", { name: "שמירה" }).click();
    await expect(edit.getByRole("group", { name: "אישור" })).toContainText("2 הקבוצות שלה (א1, א2) יימחקו");
    await edit.getByRole("group", { name: "אישור" }).getByRole("button", { name: "שמירה ומחיקת הקבוצות" }).click();
    await expect(toast(page, "המכינה נשמרה, ו-2 הקבוצות שלה נמחקו.")).toBeVisible();
    expect(sb.writes.map((w) => [w.table, w.method, w.query.get("id")])).toEqual([
      ["rota_cohorts", "PATCH", "eq.1"],
      ["rota_groups", "DELETE", "eq.11"],
      ["rota_groups", "DELETE", "eq.12"],
      ["rota_cohort_duties", "DELETE", null],
    ]);
    expect(sb.writes[0].body).toEqual({ letter: "א", name: "מכינה לדוגמה א", contact_name: null, trainees: 15, diet_veg: 3, diet_gf: 2, diet_both: 1, can_drive: false });
    const none = sb.writes[3];
    expect([none.query.get("edition_id"), none.query.get("cohort_id"), none.query.get("duty_id")]).toEqual(["eq.7", "eq.1", null]); // the set emptied
    for (const w of sb.writes) expect(w.auth, w.table).toBe(`Bearer ${session.access_token}`);
    for (const c of sb.calls.filter((x) => x.path === "/rest/v1/rpc/rota_split_cohort")) expect(c.auth).toBe(`Bearer ${session.access_token}`);
  });

  test("a cohort contact's phone (v20): never in what load_rota answers, never on /print/rota (its heads' switch on too) or in its xlsx, never in the browser's storage; read through get_rota_contacts only when a cohort's form opens, written through set_rota_contact alone", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb, session } = await signedIn(page, "logistics");
    const PHONE = "000-000-0066";
    const TYPED = "000-000-0067";
    const HEAD = "000-000-0011";
    const base = mockRota();
    sb.answers.set("load_rota", { ...base, cohorts: [{ ...base.cohorts[0], trainees: 15, contact_name: "איש/אשת קשר לדוגמה א" }] } satisfies RotaData);
    sb.answers.set("get_rota_contacts", [
      { group_id: 11, head_phone: HEAD },
      { cohort_id: 1, phone: PHONE },
    ]);
    sb.answers.set("set_rota_contact", null);
    const answered: string[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/rest/v1/rpc/load_rota")) void r.text().then((t) => answered.push(t));
    });
    const phonesIn = async () => {
      const html = await page.content();
      return [PHONE, TYPED].filter((p) => html.includes(p));
    };

    // the board and the setup: the contact's name for the team; no phone read, none on screen
    await page.goto(`${mockUrl()}/logistics/rota`);
    await expect(page.locator('[data-group-chip="א1"]:visible')).toBeVisible();
    await pills(page).getByRole("link", { name: "קבוצות ומכינות" }).click();
    const cohorts = page.getByRole("region", { name: "המכינות" });
    await expect(cohorts.locator('[data-rota-cohort="א"]')).toContainText("איש/אשת קשר: איש/אשת קשר לדוגמה א");
    expect(sb.rpc.get("get_rota_contacts")).toBeUndefined();
    expect(await phonesIn()).toEqual([]);
    // the cohort's form: ONE get_rota_contacts as it opens, the phone into its field alone
    await cohorts.getByRole("button", { name: "עריכה: מכינה לדוגמה א" }).click();
    const form = cohorts.getByRole("form", { name: "עריכת המכינה: מכינה לדוגמה א" });
    await expect(form.locator("[data-cohort-phone]")).toHaveValue(PHONE);
    expect(sb.rpc.get("get_rota_contacts")).toEqual([{ p_edition: 7 }]);
    await expect(form).toContainText("מידע אישי: נשמר רק במסד");
    // changed: set_rota_contact alone carries it — never a table write
    await form.locator("[data-cohort-phone]").fill(` ${TYPED} `);
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "המכינה נשמרה")).toBeVisible();
    expect(sb.rpc.get("set_rota_contact")).toEqual([{ p_kind: "cohort", p_id: 1, p_phone: TYPED }]);
    expect(sb.writes.map((w) => [w.table, w.method])).toEqual([["rota_cohorts", "PATCH"]]);
    for (const w of sb.writes) for (const p of [PHONE, TYPED]) expect(JSON.stringify(w.body), w.table).not.toContain(p);
    expect(await phonesIn()).toEqual([]);
    // the other views
    for (const view of ["משמרות צוות", "מוצ״ש"]) {
      await pills(page).getByRole("link", { name: view }).click();
      await expect(pills(page).getByRole("link", { name: view })).toHaveAttribute("aria-current", "page");
      expect(await phonesIn(), view).toEqual([]);
    }

    // /print/rota, every page — with the heads' switch on too (it reads the contacts: the heads' phones show, never the cohort's)
    await page.getByRole("link", { name: "דפים להדפסה" }).click();
    await expect(page.locator("[data-rota-print]")).toBeVisible();
    const views = await page.locator("#rota-view option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(views.length).toBeGreaterThanOrEqual(10);
    for (const on of [false, true]) {
      if (on) await page.locator("[data-head-phones]").check();
      for (const v of views) {
        await page.locator("#rota-view").selectOption(v);
        await expect(page.locator(`[data-rota-view="${v}"]`)).toBeAttached();
        expect(await phonesIn(), `${v}${on ? " (phones on)" : ""}`).toEqual([]);
      }
    }
    await page.locator("#rota-view").selectOption("heads");
    await expect(page.locator("[data-rota-view=heads]")).toContainText(HEAD);
    // its xlsx, the switch on: the heads' phone in it — the cohort's in no part of it
    const x = await downloaded(page, () => page.getByRole("button", { name: "הורדת xlsx (כל הגיליונות)" }).click());
    const files = unzipSync(new Uint8Array(x.bytes));
    expect(Object.values(files).some((b) => strFromU8(b).includes(HEAD))).toBe(true);
    for (const [path, bytes] of Object.entries(files)) for (const p of [PHONE, TYPED]) expect(strFromU8(bytes), path).not.toContain(p);

    // load_rota never carried it; the browser keeps none of the phones
    expect(answered.length).toBeGreaterThan(0);
    for (const a of answered) {
      for (const p of [PHONE, TYPED, HEAD]) expect(a).not.toContain(p);
      for (const c of JSON.parse(a).cohorts) expect(Object.keys(c)).not.toContain("phone");
    }
    const kept = await browserStorage(page);
    for (const p of [PHONE, TYPED, HEAD]) expect(kept).not.toContain(p);
    for (const c of sb.calls.filter((x) => x.path === "/rest/v1/rpc/get_rota_contacts" || x.path === "/rest/v1/rpc/set_rota_contact")) expect(c.auth).toBe(`Bearer ${session.access_token}`);
    expect(sb.calls.some((c) => c.path === "/rest/v1/rota_cohort_contacts" || c.path === "/rest/v1/rota_group_contacts")).toBe(false); // never the tables
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
    expect(sb.rpc.get("set_rota_contact")).toEqual([{ p_kind: "group", p_id: 12, p_phone: "000-000-0012" }]);
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
    expect(sb.rpc.get("set_rota_contact")).toEqual([{ p_kind: "group", p_id: 12, p_phone: "000-000-0012" }]); // not written over
  });

  test("a staff shift whose team member was deactivated since: edited and saved, the member kept", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb, week } = await signedIn(page, "logistics");
    expect(week.team.some((m) => m.id === 99)).toBe(false); // load_week's team is the active one
    const who = "איש/אשת צוות לדוגמה שהושבת/ה";
    sb.answers.set("load_rota", { ...mockRota(), staff: [{ id: 41, edition_id: 7, day: 1, start_min: 510, end_min: 870, member_id: 99, name: who, cohort_id: null, note: null }] });
    await page.goto(`${mockUrl()}/logistics/rota/staff`);
    // v20: the schedule — the shift's first row holds its «עריכה»
    const first = page.locator('[data-staff-schedule] [data-staff-shift="41"]');
    await expect(first).toHaveCount(1);
    await first.getByRole("button", { name: `עריכה: ${who} 08:30–14:30` }).click();
    const form = page.getByRole("form", { name: `עריכת משמרת צוות: ${who}` });
    const member = form.getByLabel("איש/אשת צוות", { exact: true });
    await expect(member).toHaveValue("99");
    await expect(member.locator("option:checked")).toHaveText(`${who} (מושבת/ת)`);
    await expect(member.locator("option")).toHaveCount(week.team.length + 2); // «בחירה…», the team, and this member alone
    await form.getByLabel("הערה (לא חובה)").fill("הערה לדוגמה");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "משמרת הצוות נשמרה")).toBeVisible();
    const writes = sb.writes.filter((w) => w.table === "rota_staff_shifts");
    expect(writes.map((w) => [w.method, w.query.get("id")])).toEqual([["PATCH", "eq.41"]]);
    expect(writes[0].body).toMatchObject({ day: 1, start_min: 510, end_min: 870, member_id: 99, name: who, cohort_id: null, note: "הערה לדוגמה" });
    expect(writes[0].body).not.toHaveProperty("kind"); // v20: no «אחראי/ת משמרת» — the column is gone
  });

  test("the review: the one transports read again when the tab is back in view and every two minutes while in view — the staff schedule and the board (a pickup corrected or a driver set elsewhere changes no lesson)", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "timers, not layout: one run is enough");
    const { sb } = await signedIn(page, "logistics");
    sb.answers.set("get_transports_for", []);
    const reads = () => sb.rpc.get("get_transports_for")?.length ?? 0;
    await page.clock.install();
    for (const [path, ready] of [["/logistics/rota/staff", "[data-staff-transports]"], ["/logistics/transports", "[data-board-counts], [data-board]"]] as const) {
      await page.goto(`${mockUrl()}${path}`);
      await expect(page.locator(ready).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      const start = reads();
      expect(start, path).toBeGreaterThan(0);
      // back in view (another tab was in front): at once
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect.poll(reads, path).toBe(start + 1);
      // two minutes in view: again
      await page.clock.runFor(120_000);
      await expect.poll(reads, path).toBe(start + 2);
      // hidden: the minutes pass with no read
      await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }));
      await page.clock.runFor(240_000);
      await page.waitForTimeout(200);
      expect(reads(), path).toBe(start + 2);
      await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }));
    }
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
    await expect(page.locator("[data-staff-schedule]")).toBeVisible();
    await expect(page.getByRole("button", { name: /^\+ משמרת צוות/ })).toHaveCount(0);
    await expect(page.locator("[data-staff-schedule] [data-add]")).toHaveCount(0);
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
