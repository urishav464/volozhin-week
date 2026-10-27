// The speaker pool in a real browser. Demo build, every width: create (search
// first, «ייתכן שזה…», a same-name refusal), the speaker sheet in the year's
// order (v14: the call — its points and result — then availability slot by
// slot: a tap cycles, the arrows move, a note; contacts and their buttons).
// Mock build: every pool RPC goes out by the contract's parameter names
// (tests/sql/speakers.test.ts pins them in the database) with the member's own
// token. Synthetic people only; the phone typed here is not shaped like a real
// one (scripts/pii-scan.mjs).
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
    await expect(maybe.getByRole("listitem").filter({ hasText: "מרצה 07" })).toBeVisible();
    await expect(maybe.getByRole("listitem").filter({ hasText: "מרצה 07" })).not.toContainText("אותו שם"); // a similar name: the list itself says so
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
    await expect(card.getByRole("region", { name: "השיחה" })).toContainText("בטיפולך · לפני שיחה");
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

  test("the sheet in the year's order: opened at the call (its points, a result), then availability slot by slot — a tap cycles, the arrows move, a note", async ({ page }) => {
    await page.goto(`${demoUrl()}/mine`);
    await page.getByRole("region", { name: "להתקשר", exact: true }).locator("li").filter({ hasText: "מרצה 32" }).getByRole("button", { name: "לשיחה" }).click();
    const sheet = page.getByRole("dialog", { name: "מרצה 32" });
    const parts = await sheet.locator("section[aria-label]").evaluateAll((s) => s.map((x) => x.getAttribute("aria-label")));
    expect(parts.slice(0, 5)).toEqual(["פרטים", "השיחה", "אישור המדריך/ה", "השיעור", "זמינות"]);
    expect(parts.indexOf("פרטי קשר")).toBeGreaterThan(parts.indexOf("זמינות"));

    // at the call: in view, the focus on it, the instructor's points open (X is the caller's name), addressed to her
    const call = sheet.getByRole("region", { name: "השיחה" });
    await expect(call).toBeInViewport();
    await expect(page.locator(":focus").getByRole("region", { name: "השיחה" })).toHaveCount(1);
    await expect(call).toContainText("בטיפולך · לפני שיחה");
    await expect(call.locator("[data-call-points]")).toBeVisible();
    await expect(call.locator("[data-call-points]")).toContainText("*אני מדריך/ה (הדגמה) מהמדרשה הגבוהה בעין פרת");
    await expect(call.locator("[data-call-points]")).toContainText("*נשמח שתגיעי ללמד שעה ורבע, תסכימי?");
    await noSidewaysScroll(page);

    // the result, with what was said: the status moves, and the note is the newest one on the approach
    const result = call.getByRole("group", { name: "תוצאת השיחה" });
    await expect(result.getByRole("button", { name: "לפני שיחה" })).toHaveCount(0); // not the status it already has
    await result.getByLabel("מה נאמר בשיחה").fill("נושא לדוגמה (נתון לדוגמה)");
    await result.getByRole("button", { name: "שוחחנו, מחכים לתשובה", exact: true }).click();
    await expect(toast(page, "עודכן: שוחחנו, מחכים לתשובה")).toBeVisible();
    await expect(call).toContainText("בטיפולך · שוחחנו, מחכים לתשובה");
    await expect(call).toContainText("«נושא לדוגמה (נתון לדוגמה)»");
    await expect(sheet.getByRole("region", { name: "ציר הפעולות" })).toContainText("«נושא לדוגמה (נתון לדוגמה)»");

    // availability: any slot in play, a tap at a time — — → ✓ → ✗ → —, each saved and said once under the grid
    const avail = sheet.getByRole("region", { name: "זמינות" });
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

    // «השיעור»: from the sheet to the week's own placing
    await sheet.getByRole("region", { name: "השיעור" }).getByRole("button", { name: "שבץ בשבוע" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("status").filter({ hasText: "משבצים את" })).toContainText("מרצה 32");
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
    await expect(sheet.getByRole("region", { name: "השיחה" })).toContainText("בטיפול חניך/ה א׳");
    await expect(sheet.getByRole("region", { name: "השיעור" })).toContainText("חמישי 08:30–10:00"); // the cell just offered
    // availability per slot: the seeded Sunday morning, one note said once for the three slots it is on
    const avail = sheet.getByRole("region", { name: "זמינות" });
    await expect(avail.getByRole("button", { name: /^ראשון 08:30–10:00: לא יכול — דוגמה: לא בבקרים/ })).toBeVisible();
    await expect(avail.getByRole("button", { name: /^ראשון 11:30–13:00: לא יכול — דוגמה: לא בבקרים/ })).toBeVisible();
    await expect(avail.getByRole("button", { name: /^ראשון 14:30–16:00: לא ידוע$/ })).toBeVisible();
    await expect(avail.getByRole("list", { name: "הערות על הזמינות" }).getByRole("listitem")).toHaveText(["ראשון 08:30–13:00 · לא יכול — דוגמה: לא בבקרים"]);
    await noSidewaysScroll(page);
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
    for (const fn of ["set_speaker_contacts", "update_speaker", "vet_speakers", "set_approach_status", "hand_over", "answer_handover", "set_slot_availability"]) sb.answers.set(fn, null);
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

    // «המרצים שלי»: take the hand-over offered to me; then a call — its result, with what was said, in the sheet
    await nav(page).getByRole("link", { name: "המרצים שלי" }).click();
    await page.getByRole("region", { name: "הוצעו לי" }).getByRole("button", { name: "קבלת הטיפול" }).click();
    await expect.poll(() => sb.rpc.get("answer_handover")).toEqual([{ p_approach: mine(13).id, p_accept: true, p_note: null }]);
    await page.getByRole("region", { name: "להתקשר", exact: true }).locator("li").filter({ hasText: "מרצה 32" }).getByRole("button", { name: "לשיחה" }).click();
    sheet = page.getByRole("dialog", { name: "מרצה 32" });
    const result = sheet.getByRole("group", { name: "תוצאת השיחה" });
    await result.getByLabel("מה נאמר בשיחה").fill("נושא לדוגמה");
    await result.getByRole("button", { name: "שוחחנו, מחכים לתשובה", exact: true }).click();
    await expect.poll(() => sb.rpc.get("set_approach_status")).toEqual([{ p_approach: mine(32).id, p_version: 1, p_status: "approached", p_note: "נושא לדוגמה" }]);

    // the same sheet: profile, contacts, a slot of availability, vetting, hand-over
    await sheet.getByRole("region", { name: "פרטים" }).getByRole("button", { name: "עריכה", exact: true }).click();
    await sheet.getByLabel("תיאור קצר").fill("תיאור לדוגמה");
    await sheet.getByRole("form", { name: "עריכת הפרטים" }).getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("update_speaker")).toEqual([{ p_edition: 7, p_speaker: 32, p_version: 1, p_patch: { bio_short: "תיאור לדוגמה" } }]);

    await sheet.getByRole("button", { name: "עריכת פרטי הקשר" }).click();
    await sheet.getByLabel("טלפון").fill("123 456 789");
    await sheet.getByRole("form", { name: "עריכת פרטי הקשר" }).getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("set_speaker_contacts")).toEqual([{ p_speaker: 32, p_phone: "123 456 789", p_email: null, p_secretary_note: null, p_notes: null }]);

    // one tap on Monday 08:30: «יכולה», by the row's id in this edition's grid
    await sheet.getByRole("region", { name: "זמינות" }).getByRole("button", { name: /^שני 08:30–10:00: לא ידוע$/ }).click();
    const row0830 = week.rows.find((r) => r.kind === "lesson" && r.start_min === 510)!.id;
    await expect.poll(() => sb.rpc.get("set_slot_availability")).toEqual([{ p_edition: 7, p_speaker: 32, p_day: 1, p_row: row0830, p_kind: "can", p_note: null }]);

    await sheet.getByRole("region", { name: "אישור המדריך/ה" }).getByRole("button", { name: "שינוי האישור" }).click();
    await sheet.getByRole("region", { name: "אישור המדריך/ה" }).getByRole("button", { name: "דחייה" }).click();
    await expect.poll(() => sb.rpc.get("vet_speakers")).toEqual([{ p_speakers: [32], p_state: "rejected", p_note: null }]);

    await sheet.getByRole("button", { name: "העברה לחבר/ת צוות" }).click();
    await sheet.getByLabel("להעביר ל…").selectOption({ label: "חניך/ה ב׳" });
    await sheet.getByRole("group", { name: "העברת הטיפול" }).getByRole("button", { name: "העברה" }).click();
    await expect.poll(() => sb.rpc.get("hand_over")).toEqual([{ p_approach: mine(32).id, p_to: 3, p_note: null }]);

    // every one of them carried the member's own token
    const pool_rpcs = ["speaker_matches", "create_speaker", "get_speaker_contacts", "speaker_history", "speaker_activity", "claim_speaker", "answer_handover", "set_approach_status", "update_speaker", "set_speaker_contacts", "set_slot_availability", "vet_speakers", "hand_over"];
    for (const fn of pool_rpcs) {
      const calls = sb.calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`);
      expect(calls.length, fn).toBeGreaterThan(0);
      for (const c of calls) expect(c.auth, fn).toBe(`Bearer ${session.access_token}`);
    }
  });

  test("a slot a content member marks: shown at once, put back when the database refuses it — the refusal in Hebrew; logistics only reads", async ({ page, context }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const week = demoWeek();
    week.edition.id = 7;
    const member = (role: "content" | "logistics", id: number) => ({
      status: "ok",
      schema_version: EXPECTED_SCHEMA_VERSION,
      email: "member@example.org",
      display_name: "חבר/ת צוות",
      global_admin: false,
      memberships: [{ edition_id: 7, role, member_id: id }],
    });
    /** A teammate's speaker's sheet, opened from the pool, as this member. */
    const open = async (p: Page, role: "content" | "logistics", id: number) => {
      const sb = new FakeSupabase({ status: 200, body: member(role, id) });
      sb.answers.set("editions", [week.edition]);
      sb.answers.set("load_week", week);
      sb.answers.set("speaker_history", []);
      sb.answers.set("speaker_activity", []);
      sb.answers.set("get_speaker_contacts", null);
      await sb.attach(p);
      await signIn(p);
      await p.goto(mockUrl());
      const pool = p.getByRole("region", { name: "מאגר המרצים" });
      await pool.getByRole("tab", { name: /בטיפול אחרים/ }).click();
      await pool.getByRole("button", { name: "כרטיס ד״ר מרצה 09" }).click();
      return p.getByRole("dialog", { name: "ד״ר מרצה 09" }).getByRole("region", { name: "זמינות" });
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
    await expect(read.getByRole("button")).toHaveCount(0);
    await expect(read).toContainText("צפייה בלבד");
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
