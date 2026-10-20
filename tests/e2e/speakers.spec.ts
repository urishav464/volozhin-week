// The speaker pool in a real browser. Demo build, every width: create (search
// first, «ייתכן שזה…», a same-name refusal), the speaker sheet (contacts and
// their buttons, status, availability), «המרצים שלי», the approvals queue, and
// a hand-over. Mock build: every new RPC goes out by the contract's parameter
// names (tests/sql/speakers.test.ts pins them in the database) with the
// member's own token. Synthetic people only; the phone typed here is not
// shaped like a real one (scripts/pii-scan.mjs).
import { expect, type Page, test } from "@playwright/test";
import { demoWeek } from "../../src/data/demoWeek";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

/** A toast (the demo banner is a status too). */
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });

/** The pool: a column on a wide desktop, the «מאגר» tab below 1024px. */
async function openPool(page: Page, wide: boolean) {
  if (!wide) await page.getByRole("navigation", { name: "ניווט" }).getByRole("button", { name: "מאגר" }).click();
  return page.getByRole("region", { name: "מאגר המרצים" });
}

test.describe("demo build", () => {
  test("«+ מרצה חדש/ה» searches first: the same name needs a disambiguator, a similar one is shown before it is added", async ({ page }, info) => {
    await page.goto(demoUrl());
    const pool = await openPool(page, info.project.name === "desktop");
    await pool.getByRole("button", { name: "+ מרצה חדש/ה" }).click();
    const sheet = page.getByRole("dialog", { name: "מרצה חדש/ה" });
    const name = sheet.getByLabel("שם המרצה (בלי תואר)");
    await expect(name).toBeFocused();

    await name.fill("מרצה 07");
    const maybe = sheet.getByRole("region", { name: "ייתכן שזה…" });
    await expect(maybe.getByRole("listitem").filter({ hasText: "מרצה 07" })).toContainText("אותו שם");
    await expect(maybe.getByRole("status")).toHaveText("אותו שם כבר במאגר.");

    // «פתיחה» to check whether it is the same person — and «חזרה» brings the name back
    await maybe.getByRole("button", { name: "פתיחת מרצה 07" }).click();
    const match = page.getByRole("dialog", { name: "מרצה 07" });
    await expect(match).toBeVisible();
    await match.getByRole("button", { name: "חזרה למרצה חדש/ה" }).click();
    await expect(sheet.getByLabel("שם המרצה (בלי תואר)")).toHaveValue("מרצה 07");

    await sheet.getByRole("button", { name: "זה מישהו אחר — להמשיך" }).click();
    await expect(sheet.getByLabel("תואר", { exact: true })).toBeFocused(); // the fields, not the top of the sheet
    await expect(maybe.getByRole("listitem")).toHaveCount(0); // the matches already seen fold into one line
    await expect(maybe.getByRole("button", { name: /שמות דומים במאגר — הצגה|שם דומה אחד במאגר — הצגה/ })).toBeVisible();
    await expect(sheet.getByLabel(/פרט מבחין \(חובה/)).toBeVisible();
    await sheet.getByRole("button", { name: "הוספה למאגר" }).click();
    await expect(sheet.getByRole("alert")).toContainText("צריך להוסיף פרט מבחין");
    await expect(sheet.getByLabel(/פרט מבחין/)).toBeFocused();
    await noSidewaysScroll(page);

    // another name, close to an existing one: shown as similar, then added on purpose
    await name.fill("מרצה 077");
    await expect(maybe.getByRole("listitem").filter({ hasText: "מרצה 07" })).toContainText("שם דומה");
    await sheet.getByRole("radio", { name: "נקבה" }).check();
    await sheet.getByLabel("נושאים", { exact: true }).fill("שירה");
    await sheet.getByLabel("נושאים", { exact: true }).press("Enter");
    await expect(sheet.getByRole("list", { name: "הנושאים שנבחרו" })).toContainText("שירה");
    await sheet.getByLabel("נושאים", { exact: true }).fill("תפילה"); // typed, never confirmed with Enter
    await sheet.getByRole("button", { name: "הוספה למאגר" }).click();
    await expect(toast(page, "מרצה 077 נוספה למאגר")).toBeVisible();

    // her sheet opens: waiting for approval, in my hands, nothing guessed — both topics kept
    const card = page.getByRole("dialog", { name: "מרצה 077" });
    await expect(card).toContainText("ממתינה לאישור");
    await expect(card.getByRole("list", { name: "נושאים" })).toContainText("שירה");
    await expect(card.getByRole("list", { name: "נושאים" })).toContainText("תפילה");
    await expect(card.getByRole("region", { name: "הטיפול השנה" })).toContainText("בטיפולך");
    await expect(card.getByRole("region", { name: "ציר הפעולות" })).toContainText("נוספה למאגר");
    await noSidewaysScroll(page);
  });

  test("a sheet from a lesson: contacts with their buttons, a refused phone, then a saved one", async ({ page }, info) => {
    await page.goto(demoUrl());
    if (info.project.name !== "desktop") await page.getByRole("tab", { name: "שני" }).click();
    await page.locator("[data-lesson-id]").filter({ hasText: "מרצה 04" }).first().click();
    await page.getByRole("dialog", { name: "שיעור סגור" }).getByRole("button", { name: "פרופ׳ מרצה 04" }).click();

    const sheet = page.getByRole("dialog", { name: "פרופ׳ מרצה 04" });
    const contacts = sheet.getByRole("region", { name: "פרטי קשר" });
    await expect(contacts.getByRole("link", { name: "שליחת מייל" })).toHaveAttribute("href", "mailto:speaker04@example.org");
    await expect(contacts).toContainText("טלפון לדוגמה");
    await expect(contacts.getByRole("link", { name: "חיוג" })).toHaveCount(0); // a placeholder is no number
    await expect(sheet.getByRole("region", { name: "שיעורים במחזורים" })).toContainText("מחזור קודם (לדוגמה)");
    await noSidewaysScroll(page);

    await contacts.getByRole("button", { name: "עריכת פרטי הקשר" }).click();
    await contacts.getByLabel("טלפון").fill("12-34");
    await contacts.getByRole("button", { name: "שמירה" }).click();
    await expect(contacts.getByRole("alert")).toContainText("מספר הטלפון לא תקין");
    await expect(contacts.getByLabel("טלפון")).toHaveAttribute("aria-invalid", "true");
    await contacts.getByLabel("טלפון").fill("123 456 789");
    await contacts.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "פרטי הקשר נשמרו")).toBeVisible();
    await expect(contacts.getByRole("link", { name: "חיוג" })).toHaveAttribute("href", "tel:123456789");
    await expect(contacts.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/123456789");
    await expect(sheet.getByRole("region", { name: "ציר הפעולות" })).toContainText("פרטי הקשר עודכנו: טלפון");
    await noSidewaysScroll(page);

    // opened from the lesson: Escape goes back to it, not to nothing
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "שיעור סגור" })).toBeVisible();
    await expect(sheet).toHaveCount(0);
  });

  test("«המרצים שלי»: «פניתי», then «הסכימה» with a note and an availability chip in the sheet, then «שבץ» on the week", async ({ page }) => {
    await page.goto(demoUrl());
    await nav(page).getByRole("link", { name: "המרצים שלי" }).click();
    await expect(page).toHaveURL(/\/mine$/);
    await expect(nav(page).getByRole("link", { name: "המרצים שלי" })).toHaveAttribute("aria-current", "page");
    const row = (group: string, name: string) => page.getByRole("region", { name: group }).locator("li").filter({ hasText: name });
    await noSidewaysScroll(page);

    await row("לפנות", "מרצה 32").getByRole("button", { name: "פניתי" }).click();
    await expect(toast(page, "עודכן: מרצה 32 · פנו")).toBeVisible();
    await expect(row("מחכה לתשובה", "מרצה 32")).toBeVisible();
    await expect(row("מחכה לתשובה", "מרצה 32").getByRole("button", { name: "מרצה 32" })).toBeFocused(); // the focus moved with the row

    // waiting for approval: a chip, not a dead button — and the global admin approves right there
    const waiting = row("מחכה לתשובה", "מרצה 56");
    await expect(waiting).toContainText("ממתינה לאישור");
    await expect(waiting.getByRole("button", { name: "הסכימה" })).toHaveCount(0);
    await waiting.getByRole("button", { name: "אישור מרצה 56" }).click();
    await expect(toast(page, "מרצה 56 אושרה")).toBeVisible();
    await expect(row("מחכה לתשובה", "מרצה 56").getByRole("button", { name: "הסכימה" })).toBeEnabled();

    await row("מחכה לתשובה", "מרצה 32").getByRole("button", { name: "מרצה 32" }).click();
    const sheet = page.getByRole("dialog", { name: "מרצה 32" });
    const approach = sheet.getByRole("region", { name: "הטיפול השנה" });
    await approach.getByLabel("הערה (לא חובה)").fill("ענתה בחיוב (נתון לדוגמה)");
    await approach.getByRole("group", { name: "מצב הפנייה" }).getByRole("button", { name: "הסכימה" }).click();
    await expect(toast(page, "עודכן: הסכימה")).toBeVisible();
    await expect(approach.getByRole("button", { name: "הסכימה" })).toHaveAttribute("aria-pressed", "true");
    await expect(sheet.getByRole("region", { name: "ציר הפעולות" })).toContainText("«ענתה בחיוב (נתון לדוגמה)»");

    const avail = sheet.getByRole("region", { name: "זמינות" });
    await avail.getByRole("button", { name: /^ראשון בוקר: לא ידוע/ }).click();
    await avail.getByRole("group", { name: "זמינות ראשון בוקר" }).getByRole("button", { name: "יכולה", exact: true }).click();
    await expect(toast(page, "הזמינות נשמרה")).toBeVisible();
    await expect(avail.getByRole("button", { name: /^ראשון בוקר: יכולה/ })).toBeVisible();
    await noSidewaysScroll(page);

    await sheet.getByRole("button", { name: "סגירה" }).click();
    await row("לסגור שעה", "מרצה 32").getByRole("button", { name: "שבץ" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("status").filter({ hasText: "משבצים את" })).toContainText("מרצה 32");
  });

  test("the approvals queue: one tap, then the rest as a batch; the badge counts down", async ({ page }) => {
    await page.goto(demoUrl());
    await nav(page).getByRole("link", { name: /אישורים/ }).click();
    await expect(page).toHaveURL(/\/approvals$/);
    // five speakers, and the demo's payment request (tests/e2e/stages.spec.ts)
    await expect(nav(page).getByRole("link", { name: /אישורים/ })).toHaveAccessibleName("אישורים, 6 ממתינים");
    const list = page.getByRole("list", { name: "ממתינים לאישור" });
    await expect(list.getByRole("listitem")).toHaveCount(5);
    await noSidewaysScroll(page);

    await list.getByRole("button", { name: "אישור מרצה 56" }).click();
    await expect(toast(page, "מרצה 56 אושרה")).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveCount(4);
    await expect(nav(page).getByRole("link", { name: /אישורים/ })).toHaveAccessibleName("אישורים, 5 ממתינים");

    await page.getByLabel("סימון הכול").check();
    await page.getByRole("button", { name: "אישור 4 מסומנים" }).click();
    await expect(toast(page, "4 מרצים אושרו")).toBeVisible();
    await expect(page.getByText("אין מרצים שממתינים לאישור.")).toBeVisible();
    await expect(nav(page).getByRole("link", { name: /אישורים/ })).toHaveAccessibleName("אישורים, 1 ממתין");
    await noSidewaysScroll(page);
  });

  test("the grid's «מטופל ע״י X» still offers a cell to the handler; the sheet agrees on who handles them", async ({ page }, info) => {
    const wide = info.project.name === "desktop";
    await page.goto(demoUrl());
    const pool = await openPool(page, wide);
    await pool.getByRole("tab", { name: /בטיפול אחרים/ }).click();
    await pool.locator('[data-speaker-id="9"]').getByRole("button", { name: "שבץ" }).click();
    if (!wide) await page.getByRole("tab", { name: "חמישי" }).click();
    await page.locator('[data-drop="cell:4:510:600"]').click();
    const offer = page.getByRole("alertdialog", { name: "המרצה בטיפול חבר/ת צוות" });
    await expect(offer).toContainText("ד״ר מרצה 09 בטיפול חניך/ה א׳");
    await offer.getByRole("button", { name: "הצעה לחניך/ה א׳" }).click();
    await expect(toast(page, "ד״ר מרצה 09 הוצע/ה לאחראי/ת")).toBeVisible();

    await page.locator("[data-lesson-id]").filter({ hasText: "מרצה 09" }).first().click();
    const cell = page.getByRole("dialog", { name: "משבצת בתהליך" });
    await expect(cell.locator("[data-pitch-id]").filter({ hasText: "מרצה 09" })).toContainText("בטיפול: חניך/ה א׳");
    await cell.getByRole("button", { name: "ד״ר מרצה 09" }).click();
    const sheet = page.getByRole("dialog", { name: "ד״ר מרצה 09" });
    await expect(sheet.getByRole("region", { name: "הטיפול השנה" })).toContainText("בטיפול חניך/ה א׳");
    await expect(sheet.getByRole("region", { name: "זמינות" }).getByRole("button", { name: /^ראשון בוקר: לא יכול — דוגמה: לא בבקרים/ })).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("a hand-over: take the one offered to me, and move one of mine to a teammate", async ({ page }) => {
    await page.goto(`${demoUrl()}/mine`);
    const offered = page.getByRole("region", { name: "הוצעו לי" });
    await expect(offered).toContainText("חניך/ה א׳ מציע/ה להעביר אליך את הטיפול");
    await offered.getByRole("button", { name: "קבלת הטיפול" }).click();
    await expect(toast(page, "הטיפול עבר אליך")).toBeVisible();
    await expect(page.getByRole("region", { name: "הוצעו לי" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "מחכה לתשובה" })).toContainText("הרב מרצה 13");

    await page.getByRole("region", { name: "לפנות" }).getByRole("button", { name: "מרצה 32" }).click();
    const sheet = page.getByRole("dialog", { name: "מרצה 32" });
    await sheet.getByRole("button", { name: "העברה לחבר/ת צוות" }).click();
    const form = sheet.getByRole("group", { name: "העברת הטיפול" });
    await form.getByLabel("להעביר ל…").selectOption({ label: "חניך/ה ב׳" });
    await form.getByLabel("הערה להעברה (לא חובה)").fill("יש לה קשר עם המרצה (נתון לדוגמה)");
    await form.getByRole("button", { name: "העברה" }).click();
    await expect(toast(page, "הטיפול עבר לחניך/ה ב׳")).toBeVisible();
    await expect(sheet.getByRole("region", { name: "הטיפול השנה" })).toContainText("בטיפול חניך/ה ב׳");
    await expect(sheet.getByRole("region", { name: "ציר הפעולות" })).toContainText("בטיפול חניך/ה ב׳");
    await expect(sheet.getByRole("region", { name: "ציר הפעולות" })).toContainText("«יש לה קשר עם המרצה (נתון לדוגמה)»");
    await noSidewaysScroll(page);
    await sheet.getByRole("button", { name: "סגירה" }).click();
    await expect(page.getByRole("region", { name: "לפנות" })).toHaveCount(0);
  });
});

test.describe("mock build", () => {
  test("every pool command goes out as its RPC, by the contract's parameter names, with the member's token", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const week = demoWeek();
    week.edition.id = 7;
    const mine = (speaker: number) => week.approaches.find((a) => a.speaker_id === speaker)!;
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "admin@example.org", display_name: "מדריך/ה לדוגמה", global_admin: true, memberships: [{ edition_id: null, role: "admin", member_id: 1 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("speaker_matches", []);
    sb.answers.set("create_speaker", { speaker_id: 61, approach_id: 90 });
    sb.answers.set("get_speaker_contacts", { phone: null, email: null, secretary_note: null, notes: null });
    sb.answers.set("speaker_history", []);
    sb.answers.set("speaker_activity", []);
    for (const fn of ["set_speaker_contacts", "update_speaker", "vet_speakers", "set_approach_status", "hand_over", "answer_handover", "set_availability"]) sb.answers.set(fn, null);
    sb.answers.set("claim_speaker", 91);
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;
    await page.goto(mockUrl());
    await expect(page.getByRole("grid", { name: "רשת השבוע" })).toBeVisible();

    // create: search first, then the form
    const pool = page.getByRole("region", { name: "מאגר המרצים" });
    await pool.getByRole("button", { name: "+ מרצה חדש/ה" }).click();
    const create = page.getByRole("dialog", { name: "מרצה חדש/ה" });
    await create.getByLabel("שם המרצה (בלי תואר)").fill("פלונית לדוגמה");
    await expect(create.getByText("אין במאגר שם דומה.")).toBeVisible();
    await create.getByRole("button", { name: "להמשיך" }).click();
    await create.getByRole("radio", { name: "נקבה" }).check();
    await create.getByRole("button", { name: "הוספה למאגר" }).click();
    await expect.poll(() => sb.rpc.get("create_speaker")?.length ?? 0).toBe(1);
    expect(sb.rpc.get("speaker_matches")).toEqual([{ p_name: "פלונית לדוגמה" }]);
    expect(sb.rpc.get("create_speaker")![0]).toEqual({
      p_edition: 7,
      p_fields: { title: null, name: "פלונית לדוגמה", disambiguator: null, gender: "f", affiliation: null, bio_short: null, topics: [], contact_pref: null },
      p_claim: true,
      p_approve: false,
      p_confirmed: false,
    });
    // the new speaker's sheet opens (this fake week does not have them)
    await expect(page.getByRole("dialog", { name: "מרצה", exact: true })).toContainText("המרצה לא נמצא/ה במאגר.");
    await page.keyboard.press("Escape");

    // a free speaker's sheet: its three reads, then «אני מטפל/ת»
    await pool.getByRole("button", { name: "כרטיס מרצה 15" }).click();
    let sheet = page.getByRole("dialog", { name: "מרצה 15" });
    await expect(sheet.getByText("עוד לא נרשמו פרטי קשר.")).toBeVisible();
    for (const fn of ["get_speaker_contacts", "speaker_history", "speaker_activity"]) expect(sb.rpc.get(fn)).toContainEqual({ p_speaker: 15 });
    await sheet.getByRole("button", { name: "אני מטפל/ת" }).click();
    await expect.poll(() => sb.rpc.get("claim_speaker")).toEqual([{ p_edition: 7, p_speaker: 15 }]);
    await page.keyboard.press("Escape");

    // «המרצים שלי»: take the hand-over offered to me, «פניתי»
    await nav(page).getByRole("link", { name: "המרצים שלי" }).click();
    await page.getByRole("region", { name: "הוצעו לי" }).getByRole("button", { name: "קבלת הטיפול" }).click();
    await expect.poll(() => sb.rpc.get("answer_handover")).toEqual([{ p_approach: mine(13).id, p_accept: true, p_note: null }]);
    await page.getByRole("region", { name: "לפנות" }).getByRole("button", { name: "פניתי" }).click();
    await expect.poll(() => sb.rpc.get("set_approach_status")).toEqual([{ p_approach: mine(32).id, p_version: 1, p_status: "approached", p_note: null }]);

    // the sheet of one of mine: profile, contacts, availability, vetting, hand-over
    await page.getByRole("region", { name: "לפנות" }).getByRole("button", { name: "מרצה 32" }).click();
    sheet = page.getByRole("dialog", { name: "מרצה 32" });
    await sheet.getByRole("button", { name: "עריכת הפרטים" }).click();
    await sheet.getByLabel("תיאור קצר").fill("תיאור לדוגמה");
    await sheet.getByRole("form", { name: "עריכת הפרטים" }).getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("update_speaker")).toEqual([{ p_edition: 7, p_speaker: 32, p_version: 1, p_patch: { bio_short: "תיאור לדוגמה" } }]);

    await sheet.getByRole("button", { name: "עריכת פרטי הקשר" }).click();
    await sheet.getByLabel("טלפון").fill("123 456 789");
    await sheet.getByRole("form", { name: "עריכת פרטי הקשר" }).getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("set_speaker_contacts")).toEqual([{ p_speaker: 32, p_phone: "123 456 789", p_email: null, p_secretary_note: null, p_notes: null }]);

    await sheet.getByRole("button", { name: /^שני ערב: לא ידוע/ }).click();
    await sheet.getByRole("group", { name: "זמינות שני ערב" }).getByRole("button", { name: "לא יכולה" }).click();
    await expect.poll(() => sb.rpc.get("set_availability")).toEqual([{ p_edition: 7, p_speaker: 32, p_day: 1, p_part: "evening", p_kind: "cannot", p_note: null }]);

    await sheet.getByRole("region", { name: "אישור המדריך/ה" }).getByRole("button", { name: "שינוי האישור" }).click();
    await sheet.getByRole("region", { name: "אישור המדריך/ה" }).getByRole("button", { name: "דחייה" }).click();
    await expect.poll(() => sb.rpc.get("vet_speakers")).toEqual([{ p_speakers: [32], p_state: "rejected", p_note: null }]);

    await sheet.getByRole("button", { name: "העברה לחבר/ת צוות" }).click();
    await sheet.getByLabel("להעביר ל…").selectOption({ label: "חניך/ה ב׳" });
    await sheet.getByRole("group", { name: "העברת הטיפול" }).getByRole("button", { name: "העברה" }).click();
    await expect.poll(() => sb.rpc.get("hand_over")).toEqual([{ p_approach: mine(32).id, p_to: 3, p_note: null }]);

    // every one of them carried the member's own token
    const pool_rpcs = ["speaker_matches", "create_speaker", "get_speaker_contacts", "speaker_history", "speaker_activity", "claim_speaker", "answer_handover", "set_approach_status", "update_speaker", "set_speaker_contacts", "set_availability", "vet_speakers", "hand_over"];
    for (const fn of pool_rpcs) {
      const calls = sb.calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`);
      expect(calls.length, fn).toBeGreaterThan(0);
      for (const c of calls) expect(c.auth, fn).toBe(`Bearer ${session.access_token}`);
    }
  });

  test("a refusal from a pool RPC reads in Hebrew beside the form", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const week = demoWeek();
    week.edition.id = 7;
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "member@example.org", display_name: "חבר/ת צוות", global_admin: false, memberships: [{ edition_id: 7, role: "content", member_id: 2 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("speaker_matches", []);
    await sb.attach(page);
    await signIn(page);
    await page.route("**/rest/v1/rpc/create_speaker", (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "speaker_similar", details: null, hint: null }) }),
    );
    await page.goto(mockUrl());
    await page.getByRole("region", { name: "מאגר המרצים" }).getByRole("button", { name: "+ מרצה חדש/ה" }).click();
    const create = page.getByRole("dialog", { name: "מרצה חדש/ה" });
    await create.getByLabel("שם המרצה (בלי תואר)").fill("פלונית לדוגמה");
    await create.getByRole("button", { name: "להמשיך" }).click();
    await expect(create.getByLabel("לאשר כבר עכשיו (אחרת: ממתין/ה לאישור)")).toHaveCount(0); // a content member does not vet
    await create.getByRole("button", { name: "הוספה למאגר" }).click();
    await expect(create.getByRole("alert")).toContainText("ייתכן שהמרצה כבר במאגר");
    await expect(page.getByText("speaker_similar")).toHaveCount(0);
    await expect.poll(() => sb.rpc.get("speaker_matches")?.length ?? 0).toBeGreaterThanOrEqual(2); // searched again
  });
});
