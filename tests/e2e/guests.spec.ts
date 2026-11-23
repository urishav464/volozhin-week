// What guests will see, filled in by the team (the reset, phase 5) — the speaker page's and the lesson page's «לאתר
// האורחים» (#guest) and «תוצרים ← אתר האורחים» (/export/guests), in a real browser. Demo build, every width: a trainee
// fills in their own speaker from empty — the box «מאושר להופיע» once the speaker agreed, the description for guests with
// its counter and a phone or an e-mail refused in place, a photo stored on its side (EXIF orientation 6) redrawn upright
// by the browser, the preview being the very bytes saved, its removal asked once with «ביטול» giving the focus back; the
// lesson page's description (at most 400), the box on the speaker's own row, what each lacks and the guests' card folded;
// another trainee's speaker read-only; the staff's overview — its counts, the filters in the address, each «חסר» a link
// to where it is filled, a mark taken back in place, «תצוגה מקדימה לאורחים» — and «ימים»'s way to it; nobody else's
// page. Mock build: set_public_ok, update_speaker (public_bio alone), set_speaker_photo (the bytes previewed: upright,
// stripped, ≤ 20KB, baseline — also from a 2400×1600 picture of noise) and update_lesson (public_note alone) by the
// contract's names with the member's token; get_speaker_photo once on opening and never after a save; the overview reads
// the week alone and a preview only the approved speakers' photos; no photo in the browser's storage; a practice week
// offers nobody the box but a global admin. Synthetic people, words and pictures only (src/testing/photos.ts).
import { expect, type Page, test } from "@playwright/test";
import { DEMO_GUEST_BIOS, DEMO_GUEST_NOTE, demoWeek } from "../../src/data/demoWeek";
import { PHOTO_DATA_PREFIX, PHOTO_LIMITS, photoFromBase64, photoOk } from "../../src/domain/photo";
import { jpegSize } from "../../src/domain/photoFit";
import { scheduleEntries } from "../../src/exports/designer";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { jpegWithOrientation, photoBase64 } from "../../src/testing/photos";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const speakerGuest = (page: Page) => page.locator("[data-speaker-guest] #guest");
const lessonGuest = (page: Page) => page.locator("[data-lesson-guest] #guest");

/** The demo's closed lessons by place (src/data/demoWeek.ts): the ids the addresses take. */
const lessonAt = (day: number, start: number, room = 1) => demoWeek().lessons.find((l) => l.kind === "lesson" && l.state === "closed" && l.day === day && l.start_min === start && l.room_id === room)!.id;
const approachOf = (speakerId: number) => demoWeek().approaches.find((a) => a.speaker_id === speakerId)!.id;

/** Today in Israel as the photo's «הועלתה» says it. */
const today = () => new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Jerusalem" }).format(new Date());

/** A JPEG with an EXIF orientation 6: stored 32×16 on its side, to be drawn 16×32. */
const sideways = () => ({ name: "צילום לדוגמה.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpegWithOrientation(6)) });

/** The bytes a data URL of the page carries (an <img>'s src), as set_speaker_photo would decode them. */
function bytesOf(src: string | null): Uint8Array {
  expect(src?.startsWith(PHOTO_DATA_PREFIX), "a JPEG inside the page").toBe(true);
  const b = photoFromBase64(src!.slice(PHOTO_DATA_PREFIX.length));
  expect(b, "a canonical base64").not.toBeNull();
  return b!;
}

/** What the server accepts as a guests' photo (app.photo_ok ≡ photoOk) — and no EXIF left: FF E1 never appears in a valid JPEG without one. */
function servable(b: Uint8Array) {
  expect(photoOk(b)).toBe(true);
  expect(b.length).toBeLessThanOrEqual(PHOTO_LIMITS.maxBytes);
  expect(b.some((x, i) => x === 0xff && b[i + 1] === 0xe1)).toBe(false);
}

/** The focus is somewhere on the page, never dropped to <body>. */
async function focusKept(page: Page) {
  expect(await page.evaluate(() => document.activeElement != null && document.activeElement !== document.body)).toBe(true);
}

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
            resolve(null);
          };
        };
      });
    }
    return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, idb });
  });
}

/** No photo anywhere in the browser's storage: neither a data URL nor the bytes' base64 (a piece from its middle). */
async function noPhotoKept(page: Page, ...b64: string[]) {
  const kept = await browserStorage(page);
  expect(kept).not.toContain("data:image");
  for (const s of b64) expect(kept).not.toContain(s.slice(40, 120));
}

test.describe("demo build — a trainee fills in their own speaker", () => {
  test("the speaker page's #guest: the approval once they agreed, the description with its counter, a photo turned upright — the preview is what is saved — and its removal asked once", async ({ page }) => {
    // «הרב מרצה 05», Sunday 11:30 — «חניך/ה א׳»'s (member 2), nothing filled in for guests yet
    await page.goto(`${demoUrl()}/speakers/5?as=trainee#guest`);
    const guest = speakerGuest(page);
    await expect(guest).toBeFocused();
    await expect(guest).toBeInViewport();
    await expect(guest.getByRole("heading", { name: "לאתר האורחים" })).toBeVisible();
    await expect(guest).toContainText("לא מאושר להופיע");

    // the box: the speaker agreed (the lesson is closed), so it is offered — with when to mark it
    const box = guest.locator(`[data-public-ok="${approachOf(5)}"]`);
    await expect(box).not.toBeChecked();
    await expect(box).toBeEnabled();
    await expect(guest.getByRole("checkbox", { name: "מאושר להופיע באתר האורחים" })).toHaveCount(1);
    await expect(guest).toContainText("מסמנים רק אחרי שהמרצה הסכים שהשם, התיאור והתמונה יופיעו באתר. ביטול מוריד אותם מהאתר מיד.");
    await box.check();
    await expect(toast(page, "הרב מרצה 05 אושר להופיע באתר האורחים")).toBeVisible();
    await expect(box).toBeChecked();
    await expect(guest).toContainText("מאושר להופיע במחזור הזה");
    await focusKept(page);

    // the description for guests: its own form, a counter, a phone or an e-mail refused in place — the text kept
    const bio = guest.locator("[data-bio-state]");
    await expect(bio).toHaveAttribute("data-bio-state", "-");
    await expect(bio).toContainText("עוד אין תיאור לאורחים.");
    await bio.getByRole("button", { name: "עריכת התיאור" }).click();
    const form = guest.getByRole("form", { name: "תיאור לאורחים" });
    const area = form.getByRole("textbox", { name: "תיאור לאורחים" });
    await expect(area).toBeFocused();
    await expect(area).toHaveAttribute("maxlength", "600");
    await expect(form.locator("[data-bio-count]")).toHaveText("0/600");
    await expect(form).toContainText("מה שהאורחים קוראים: בגוף שלישי, בלי טלפון ובלי מייל. נשמר עם המרצה גם לשנים הבאות.");
    const withMail = "תיאור לאורחים לדוגמה. לפרטים: guests@example.org";
    await area.fill(withMail);
    await expect(form.locator("[data-bio-count]")).toHaveText(`${withMail.length}/600`);
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(form.getByRole("alert")).toHaveText("יש כאן טלפון או מייל. האורחים קוראים את התיאור — מסירים ומנסים שוב.");
    await expect(area).toHaveValue(withMail);
    await expect(area).toHaveAttribute("aria-invalid", "true");
    // «ביטול»: nothing saved, the focus back on «עריכת התיאור»
    await form.getByRole("button", { name: "ביטול" }).click();
    await expect(form).toHaveCount(0);
    await expect(bio.getByRole("button", { name: "עריכת התיאור" })).toBeFocused();
    await expect(bio).toContainText("עוד אין תיאור לאורחים.");
    await bio.getByRole("button", { name: "עריכת התיאור" }).click();
    const words = "מלמד בבית מדרש לדוגמה (נתון לדוגמה).";
    await area.fill(words);
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "התיאור לאורחים נשמר")).toBeVisible();
    await expect(form).toHaveCount(0);
    await expect(bio).toHaveAttribute("data-bio-state", "y");
    await expect(bio.locator("p").first()).toHaveText(words);
    await expect(bio.getByRole("button", { name: "עריכת התיאור" })).toBeFocused();

    // the photo: none yet
    const photo = guest.locator("[data-photo-state]");
    await expect(photo).toHaveAttribute("data-photo-state", "none");
    await expect(photo).toContainText("אין תמונה");
    await expect(photo.locator("label")).toHaveText("העלאת תמונה");
    await expect(photo).toContainText("הדפדפן מקטין את התמונה ומוריד ממנה את פרטי המצלמה והמיקום.");
    await expect(photo.locator("[data-photo-remove]")).toHaveCount(0);
    // a picture stored on its side (32×16, EXIF orientation 6): the browser draws it upright — 16×32, the EXIF gone. The
    // picker has the focus as a click on its label or the keyboard gives it (setInputFiles alone moves none); it goes
    // while the picture is prepared, and the focus lands on «שמירת התמונה»
    await photo.locator("[data-photo-pick]").focus();
    await photo.locator("[data-photo-pick]").setInputFiles(sideways());
    await expect(photo).toHaveAttribute("data-photo-state", "preview");
    await expect(photo).toHaveAttribute("data-photo-dims", "16x32");
    const img = photo.getByRole("img", { name: "התמונה של הרב מרצה 05 לאתר האורחים" });
    const previewSrc = await img.getAttribute("src");
    const previewed = bytesOf(previewSrc);
    servable(previewed);
    expect(jpegSize(previewed)).toEqual({ width: 16, height: 32 });
    await expect(photo).toHaveAttribute("data-photo-size", String(previewed.length));
    await expect(photo.locator("bdi")).toHaveText(`16×32 · ${Math.max(1, Math.round(previewed.length / 1024))} KB`);
    await expect(photo.locator("[data-photo-pick]")).toHaveCount(0); // nothing else picked while a preview waits
    await expect(photo.locator("[data-photo-save]")).toBeFocused();
    await photo.locator("[data-photo-save]").click();
    await expect(toast(page, "התמונה נשמרה")).toBeVisible();
    await expect(photo).toHaveAttribute("data-photo-state", "stored");
    // the photo on screen is the bytes it sent — the same as the preview, to the byte
    await expect(img).toHaveAttribute("src", previewSrc!);
    await expect(photo).toHaveAttribute("data-photo-dims", "16x32");
    await expect(photo).toContainText(`הועלתה ${today()}`);
    await expect(photo.locator("label")).toHaveText("החלפת התמונה");
    await focusKept(page);

    // the removal: asked once — «ביטול» gives «הסרת התמונה» the focus back; «הסרה» removes it
    await photo.locator("[data-photo-remove]").click();
    const confirm = photo.getByRole("group", { name: "אישור" });
    await expect(confirm).toContainText("להסיר את התמונה של הרב מרצה 05? היא תרד גם מאתר האורחים.");
    await expect(confirm.getByRole("button", { name: "ביטול" })).toBeFocused(); // the safe choice first
    await confirm.getByRole("button", { name: "ביטול" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(photo.locator("[data-photo-remove]")).toBeFocused();
    await expect(photo).toHaveAttribute("data-photo-state", "stored");
    await photo.locator("[data-photo-remove]").click();
    await confirm.getByRole("button", { name: "הסרה" }).click();
    await expect(toast(page, "התמונה הוסרה")).toBeVisible();
    await expect(photo).toHaveAttribute("data-photo-state", "none");
    await expect(photo).toContainText("אין תמונה");
    await expect(photo.getByRole("img")).toHaveCount(0);
    await expect(photo.locator("label")).toHaveText("העלאת תמונה");
    await focusKept(page);
    await noSidewaysScroll(page);
    // the bytes lived in the page only
    await noPhotoKept(page, previewSrc!.slice(PHOTO_DATA_PREFIX.length));
  });

  test("the lesson page's #guest: the lesson's description (at most 400) and the box on the speaker's row; what each lacks; the guests' card folded; another trainee's speaker read-only", async ({ page }) => {
    const mine = lessonAt(0, 690); // Sunday 11:30, «הרב מרצה 05» — «חניך/ה א׳»'s
    await page.goto(`${demoUrl()}/lesson/${mine}?as=trainee#guest`);
    const guest = lessonGuest(page);
    await expect(guest).toBeFocused();
    await expect(guest).toBeInViewport();
    await expect(page.locator("[data-page-step]")).toHaveCount(6); // never a step
    const line = guest.locator("[data-guest-line]");
    await expect(line).toHaveText("חסר לאתר האורחים: תיאור לשיעור, אישור להופיע, תיאור למרצה, תמונה");

    // the description: «עוד אין…», a form of its own with a counter — never more than 400, a contact refused in place
    const note = guest.locator("[data-note-state]");
    await expect(note).toHaveAttribute("data-note-state", "-");
    await expect(note).toContainText("עוד אין תיאור לשיעור.");
    await note.getByRole("button", { name: "עריכת התיאור" }).click();
    const form = guest.getByRole("form", { name: "תיאור קצר לשיעור" });
    const area = form.getByRole("textbox", { name: "תיאור קצר לשיעור (רשות)" });
    await expect(area).toBeFocused();
    await expect(area).toHaveAttribute("maxlength", "400");
    await expect(form.locator("[data-note-count]")).toHaveText("0/400");
    await expect(form).toContainText("האורחים רואים אותו כשהם פותחים את השיעור. בלי טלפון ובלי מייל.");
    await area.fill("א".repeat(450));
    await expect(area).toHaveValue("א".repeat(400));
    await expect(form.locator("[data-note-count]")).toHaveText("400/400");
    await area.fill("שיעור לדוגמה. לפרטים: guests@example.org");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(form.getByRole("alert")).toHaveText("יש כאן טלפון או מייל. האורחים קוראים את התיאור — מסירים ומנסים שוב.");
    const words = "שיעור לדוגמה על סוגיה לדוגמה (נתון לדוגמה).";
    await area.fill(words);
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "התיאור לשיעור נשמר")).toBeVisible();
    await expect(form).toHaveCount(0);
    await expect(note).toHaveAttribute("data-note-state", "y");
    await expect(note.locator("p").first()).toHaveText(words);
    await expect(note.getByRole("button", { name: "עריכת התיאור" })).toBeFocused();
    await expect(line).toHaveText("חסר לאתר האורחים: אישור להופיע, תיאור למרצה, תמונה");

    // the speaker's row: their name to their #guest, what they lack in words, the box — the hint once, under the list
    const row = guest.locator('[data-guest-speaker="5"]');
    await expect(row.getByRole("link", { name: "הרב מרצה 05" })).toHaveAttribute("href", "/speakers/5#guest");
    await expect(row).toContainText("תיאור: חסר");
    await expect(row).toContainText("תמונה: חסרה");
    await expect(guest.getByText("מסמנים רק אחרי שהמרצה הסכים שהשם, התיאור והתמונה יופיעו באתר. ביטול מוריד אותם מהאתר מיד.")).toHaveCount(1);
    await row.locator(`[data-public-ok="${approachOf(5)}"]`).check();
    await expect(toast(page, "הרב מרצה 05 אושר להופיע באתר האורחים")).toBeVisible();
    await expect(row.locator(`[data-public-ok="${approachOf(5)}"]`)).toBeChecked();
    await expect(line).toHaveText("חסר לאתר האורחים: תיאור למרצה, תמונה");
    await focusKept(page);

    // «כך זה ייראה לאורחים», folded: the guests' card — the description; no speaker listed (no description, no photo)
    const preview = guest.locator("[data-guest-preview]");
    await expect(preview).not.toHaveAttribute("open", "");
    await preview.getByText("כך זה ייראה לאורחים").click();
    await expect(preview).toHaveAttribute("open", "");
    // inside the page's «לאתר האורחים» (an h3): the card's title an h4 — the outline never jumps back to h2 (the review)
    await expect(preview.getByRole("heading", { level: 4 })).toHaveText(`שיעור לדוגמה ${mine}`);
    await expect(preview.getByRole("heading", { level: 2 })).toHaveCount(0);
    await expect(preview.locator("[data-guest-note]")).toHaveText(words);
    await expect(preview.locator("[data-guest-person]")).toHaveCount(0);
    await expect(preview).toContainText("הרב מרצה 05");
    await noSidewaysScroll(page);

    // «לתיאור ולתמונה ‹»: the speaker page's #guest, where the two are filled — the mark made here is there
    await row.getByRole("link", { name: "לתיאור ולתמונה ‹" }).click();
    await expect(page).toHaveURL(/\/speakers\/5#guest$/);
    await expect(speakerGuest(page)).toBeFocused();
    await expect(speakerGuest(page)).toContainText("מאושר להופיע במחזור הזה");

    // another trainee's lesson (Sunday 14:30, «מרצה 07», «חניך/ה ג׳»'s): the box is theirs — read-only here; the
    // description any editor writes (update_lesson's rule)
    await page.goto(`${demoUrl()}/lesson/${lessonAt(0, 870)}?as=trainee#guest`);
    const theirs = lessonGuest(page).locator('[data-guest-speaker="7"]');
    const box = theirs.locator(`[data-public-ok="${approachOf(7)}"]`);
    await expect(box).toBeDisabled();
    await expect(box).not.toBeChecked();
    await expect(theirs).toContainText("מסמנים: מי שמטפל/ת במרצה, או הצוות.");
    // the hint on when to mark is for whoever may: not here (the review — as the speaker page, one line)
    await expect(lessonGuest(page).getByText(/^מסמנים רק אחרי/)).toHaveCount(0);
    await expect(theirs).toContainText("תיאור: יש"); // their description is written, they are not approved
    await expect(lessonGuest(page).locator("[data-guest-line]")).toHaveText("חסר לאתר האורחים: תיאור לשיעור, אישור להופיע, תמונה");
    await expect(lessonGuest(page).getByRole("button", { name: "עריכת התיאור" })).toBeVisible();
    // and on the speaker's page: read, nothing to write
    await theirs.getByRole("link", { name: "מרצה 07" }).click();
    const page7 = speakerGuest(page);
    await expect(page7).toBeFocused();
    await expect(page7.locator(`[data-public-ok="${approachOf(7)}"]`)).toBeDisabled();
    await expect(page7.locator("[data-bio-state]")).toContainText(DEMO_GUEST_BIOS.notMarked);
    await expect(page7.getByRole("button", { name: "עריכת התיאור" })).toHaveCount(0);
    await expect(page7.locator("[data-photo-pick]")).toHaveCount(0);
    await expect(page7.locator("[data-photo-remove]")).toHaveCount(0);
    await noSidewaysScroll(page);
  });
});

test.describe("demo build — the staff's overview", () => {
  test("«תוצרים ← אתר האורחים»: the counts, filters in the address, each «חסר» a link to where it is filled, a mark taken back in place, the guests' preview — and «ימים» leads to it", async ({ page }) => {
    // «ימים» of Tuesday: an admin's way to the day on the overview
    await page.goto(`${demoUrl()}/day/2`);
    await expect(page.locator("[data-day-guests]")).toHaveAttribute("href", "/export/guests?day=2");
    await page.locator("[data-day-guests]").click();
    await expect(page).toHaveURL(/\/export\/guests\?day=2$/);
    const day = page.locator('[data-guests-filter="day"] select');
    await expect(day).toHaveValue("2");
    const rows = page.locator("[data-guests-row]");
    await expect(rows).toHaveCount(4);
    await expect(page.getByText("4 מתוך 18 שיעורים")).toBeVisible();

    // the counts are the week's, whatever the filter: two lessons described, two speakers approved, one photo
    await expect(page.locator('[data-guests-count="note"]')).toHaveText("שיעורים עם תיאור 2/18");
    await expect(page.locator('[data-guests-count="ok"]')).toHaveText("מרצים מאושרים להופיע 2/18");
    await expect(page.locator('[data-guests-count="bio"]')).toHaveText("עם תיאור לאורחים 2/2");
    await expect(page.locator('[data-guests-count="photo"]')).toHaveText("עם תמונה 1/2");
    await noSidewaysScroll(page);

    // the filters live in the address: every day, Sunday, only what is missing, one handler
    await day.selectOption({ label: "כל הימים" });
    await expect(page).toHaveURL(/\/export\/guests$/);
    await expect(rows).toHaveCount(18);
    await expect(page.getByText("18 שיעורים", { exact: true })).toBeVisible();
    await day.selectOption({ label: "יום ראשון" });
    await expect(page).toHaveURL(/\/export\/guests\?day=0$/);
    await expect(rows).toHaveCount(5);
    const opening = lessonAt(0, 510);
    const cell = (lesson: number, what: string) => page.locator(`[data-guests-row="${lesson}"] [data-guests-cell="${what}"]`);
    // Sunday 08:30 has it all: its description, «ד״ר מרצה 01» approved with a description and a photo
    for (const what of ["note", "ok", "bio", "photo"]) await expect(cell(opening, what), what).toHaveAttribute("data-has", "y");
    // (a click, not check(): the box follows the address, which the router updates a render later)
    await page.locator('[data-guests-filter="missing"] input').click();
    await expect(page).toHaveURL(/\/export\/guests\?day=0&missing=1$/);
    await expect(page.locator('[data-guests-filter="missing"] input')).toBeChecked();
    await expect(rows).toHaveCount(4);
    await expect(page.locator(`[data-guests-row="${opening}"]`)).toHaveCount(0);
    await page.locator('[data-guests-filter="handler"] select').selectOption({ label: "חניך/ה א׳" });
    await expect(page).toHaveURL(/\/export\/guests\?day=0&h=2&missing=1$/);
    await expect(rows).toHaveCount(1); // Sunday 11:30 — «הרב מרצה 05», member 2's
    await expect(page.locator(`[data-guests-row="${lessonAt(0, 690)}"]`)).toBeVisible();
    // the address is the filter: opened again, the same
    await page.reload();
    await expect(rows).toHaveCount(1);
    await expect(page.locator('[data-guests-filter="missing"] input')).toBeChecked();
    await expect(page.locator('[data-guests-filter="handler"] select')).toHaveValue("2");
    await noSidewaysScroll(page);

    // each «חסר» leads to where it is filled: a lesson's to its #guest, a speaker's to theirs
    await page.goto(`${demoUrl()}/export/guests?day=2`);
    const tuesday = lessonAt(2, 960, 1); // «מרצה 16», approved with a description and no photo
    await expect(cell(tuesday, "ok")).toHaveAttribute("data-has", "y");
    await expect(cell(tuesday, "bio")).toHaveAttribute("data-has", "y");
    await expect(cell(tuesday, "photo")).toHaveAttribute("data-has", "-");
    await expect(cell(tuesday, "note")).toHaveAttribute("data-has", "-");
    await expect(cell(tuesday, "note").getByRole("link")).toHaveAttribute("href", `/lesson/${tuesday}#guest`);
    await cell(tuesday, "photo").getByRole("link").click();
    await expect(page).toHaveURL(/\/speakers\/16#guest$/);
    await expect(speakerGuest(page)).toBeFocused();
    await expect(speakerGuest(page).locator("[data-photo-state]")).toHaveAttribute("data-photo-state", "none");
    await page.goBack();
    await expect(page).toHaveURL(/\/export\/guests\?day=2$/);

    // a mark taken back in place — no Confirm (a mark is made again on the lesson page): the focus on what stands there now
    const unmark = page.locator(`[data-guests-unmark="${approachOf(16)}"]`);
    await expect(unmark).toHaveAccessibleName("ביטול האישור של מרצה 16");
    await unmark.click();
    await expect(toast(page, "מרצה 16 הוסרה מאתר האורחים")).toBeVisible();
    await expect(cell(tuesday, "ok")).toHaveAttribute("data-has", "-");
    await expect(page.locator(`[data-guests-person="${tuesday}:16"] a`)).toBeFocused();
    await expect(page.locator(`[data-guests-person="${tuesday}:16"] a`)).toHaveAttribute("href", `/lesson/${tuesday}#guest`);
    await expect(page.locator('[data-guests-count="ok"]')).toHaveText("מרצים מאושרים להופיע 1/18");
    await expect(page.locator('[data-guests-count="photo"]')).toHaveText("עם תמונה 1/1");

    // «תצוגה מקדימה לאורחים»: the link's page as it is now — the approved speaker's card with the photo; no print
    const show = page.getByRole("button", { name: "תצוגה מקדימה לאורחים" });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("[data-guests-preview]")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "«הגדרות ← קישורים»" })).toHaveAttribute("href", "/settings/links");
    await show.click();
    await expect(show).toHaveAttribute("aria-expanded", "true");
    const preview = page.locator("[data-guests-preview]");
    await expect(preview.locator("[data-schedule-row]").first()).toBeVisible();
    await expect(preview.getByRole("button", { name: "הדפסה" })).toHaveCount(0);
    const first = preview.locator('[data-guest-lesson="0"]'); // Sunday 08:30, the week's first row
    await first.click();
    const card = page.locator("dialog[data-guest-card]");
    await expect(card).toBeVisible();
    await expect(card.locator("[data-guest-note]")).toHaveText(DEMO_GUEST_NOTE);
    await expect(card.locator("[data-guest-person]")).toHaveCount(1);
    await expect(card.locator("[data-guest-person]")).toContainText("ד״ר מרצה 01");
    await expect(card.locator("[data-guest-person]")).toContainText(DEMO_GUEST_BIOS.photo);
    await expect(card.locator("img[data-guest-photo]")).toHaveAttribute("src", PHOTO_DATA_PREFIX + photoBase64("clean"));
    await expect(card.locator("img[data-guest-photo]")).toHaveAttribute("alt", "תמונה של ד״ר מרצה 01");
    await noSidewaysScroll(page);
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await expect(first).toBeFocused();
    // a speaker taken back is off the preview at once: Tuesday's 16:00 (no description, nobody approved now) is a row
    // with nothing more to open — its speaker's description, «תיאור לדוגמה ב׳», on no card
    const at = scheduleEntries(demoWeek()).findIndex((e) => e.lesson_id === tuesday);
    await expect(preview.locator("[data-schedule-row]").nth(at)).toContainText("מרצה 16");
    await expect(preview.locator(`[data-guest-lesson="${at}"]`)).toHaveCount(0);
    await expect(preview).not.toContainText(DEMO_GUEST_BIOS.bioOnly);
    await show.click();
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("[data-guests-preview]")).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test("the overview is the edition admins': a trainee and logistics are sent to «מעקב»; logistics read a speaker's #guest and write none of it", async ({ page }) => {
    await page.goto(`${demoUrl()}/export/guests?as=trainee`);
    await expect(page).toHaveURL(/\/tracking$/);
    await expect(page.locator("[data-guests-page]")).toHaveCount(0);
    await page.goto(`${demoUrl()}/export/guests?as=logistics`);
    await expect(page).toHaveURL(/\/tracking$/);
    await expect(page.locator("[data-guests-page]")).toHaveCount(0);
    // logistics on «ד״ר מרצה 01»'s page: the approval, the description and the photo to read — no box to change, no form, no upload
    await page.goto(`${demoUrl()}/speakers/1?as=logistics#guest`);
    const guest = speakerGuest(page);
    await expect(guest).toBeFocused();
    await expect(guest).toContainText("מאושר להופיע במחזור הזה");
    await expect(guest.locator(`[data-public-ok="${approachOf(1)}"]`)).toBeChecked();
    await expect(guest.locator(`[data-public-ok="${approachOf(1)}"]`)).toBeDisabled();
    await expect(guest.locator("[data-bio-state]")).toContainText(DEMO_GUEST_BIOS.photo);
    await expect(guest.locator("[data-photo-state]")).toHaveAttribute("data-photo-state", "stored");
    await expect(guest.getByRole("img", { name: "התמונה של ד״ר מרצה 01 לאתר האורחים" })).toHaveAttribute("src", PHOTO_DATA_PREFIX + photoBase64("clean"));
    await expect(guest.locator("[data-photo-state]")).toHaveAttribute("data-photo-dims", "32x16");
    for (const none of ["[data-photo-pick]", "[data-photo-remove]", "[data-photo-save]"]) await expect(guest.locator(none), none).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "עריכת התיאור" })).toHaveCount(0);
    await noSidewaysScroll(page);

    // the lesson page's #guest for logistics: the box to read and the one line the speaker page says — never the hint on
    // when to mark, which is for whoever may (the review)
    await page.goto(`${demoUrl()}/lesson/${lessonAt(0, 510)}?as=logistics#guest`);
    const lesson = lessonGuest(page);
    await expect(lesson).toBeFocused();
    await expect(lesson.locator(`[data-public-ok="${approachOf(1)}"]`)).toBeDisabled();
    await expect(lesson.locator('[data-guest-speaker="1"]')).toContainText("מסמנים: מי שמטפל/ת במרצה, או הצוות.");
    await expect(lesson.getByText(/^מסמנים רק אחרי/)).toHaveCount(0);
  });

  test("«אתר האורחים»'s every link and button is a 44px target — the table's «חסר» and names too, at every width (the review)", async ({ page }) => {
    await page.goto(`${demoUrl()}/export/guests`);
    await expect(page.locator("[data-guests-row]").first()).toBeVisible();
    const small = await page.locator("[data-guests-page]").evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>("a[href], button")]
        .filter((el) => el.getClientRects().length > 0 && el.closest("p") == null) // a link inside a sentence is the text's
        .map((el) => ({ text: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(), w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }))
        .filter((b) => b.w < 44 - 0.5 || b.h < 44 - 0.5)
        .map((b) => `${b.text} ${Math.round(b.w)}x${Math.round(b.h)}`),
    );
    expect(small).toEqual([]);
    // the table (from 1024px) has the «חסר» links and the speakers' names the review measured
    expect(await page.locator("[data-guests-page] a[href]").count()).toBeGreaterThan(20);
    // a short name («דן לוי») or title is a 44px target too, not only the demo's long ones (the final review): every link's
    // text cut to two letters, measured again
    const short = await page.locator("[data-guests-page]").evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>("a[href]")]
        .filter((el) => el.getClientRects().length > 0 && el.closest("p") == null)
        .map((el) => {
          el.textContent = "דן";
          const r = el.getBoundingClientRect();
          return { w: r.width, h: r.height, href: el.getAttribute("href") };
        })
        .filter((b) => b.w < 44 - 0.5 || b.h < 44 - 0.5)
        .map((b) => `${b.href} ${Math.round(b.w)}x${Math.round(b.h)}`),
    );
    expect(short).toEqual([]);
  });
});

// ------------------------------------------------------------------ the mock build: the wire

/** A whoami body: one membership. */
const whoami = (role: "admin" | "content" | "logistics", memberId: number, opts: { global?: boolean; edition?: number | null } = {}) => ({
  status: "ok",
  schema_version: EXPECTED_SCHEMA_VERSION,
  email: `${role}@example.org`,
  display_name: `${role} (לדוגמה)`,
  global_admin: opts.global ?? false,
  memberships: [{ edition_id: opts.edition === undefined ? 7 : opts.edition, role, member_id: memberId }],
});

/** The demo's week as edition 7, a real one; what a speaker's page reads besides answered empty. */
function mockWeek(sb: FakeSupabase) {
  const week = demoWeek();
  week.edition.id = 7;
  week.edition.kind = "real";
  sb.answers.set("editions", [week.edition]);
  sb.answers.set("load_week", week);
  sb.answers.set("get_speaker_contacts", null);
  sb.answers.set("speaker_history", []);
  sb.answers.set("speaker_activity", []);
  return week;
}

/** A picture a camera might give, at its worst for JPEG: 2400×1600 of seeded noise, as a PNG — made in the page (no file in git). */
async function noisePng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 2400;
    c.height = 1600;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(c.width, c.height);
    let x = 12345;
    for (let i = 0; i < img.data.length; i += 4) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      img.data[i] = x & 0xff;
      img.data[i + 1] = (x >> 8) & 0xff;
      img.data[i + 2] = (x >> 16) & 0xff;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  return Buffer.from(b64, "base64");
}

test.describe("mock build", () => {
  test("the speaker page's wire: get_speaker_photo once on opening and never after a save; set_public_ok, update_speaker (public_bio alone) and set_speaker_photo (the bytes previewed) by name, with the member's token; no photo kept", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the wire is the same at every width: one run is enough");
    test.setTimeout(90_000);
    const sb = new FakeSupabase({ status: 200, body: whoami("content", 2) });
    const week = mockWeek(sb);
    // «ד״ר מרצה 01» — member 2's, a photo stored, not approved yet
    const s1 = week.speakers.find((s) => s.id === 1)!;
    const a1 = week.approaches.find((a) => a.speaker_id === 1)!;
    s1.has_photo = true;
    sb.answers.set("get_speaker_photo", { photo: photoBase64("clean"), uploaded_at: "2026-11-01T08:00:00.000Z" });
    for (const fn of ["set_public_ok", "update_speaker", "set_speaker_photo"]) sb.answers.set(fn, null);
    await sb.attach(page);
    const session = await signIn(page, "content@example.org");
    sb.token = session.access_token;
    const bearer = `Bearer ${session.access_token}`;
    const calls = (fn: string) => sb.calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`);

    await page.goto(`${mockUrl()}/speakers/1#guest`);
    const guest = speakerGuest(page);
    const photo = guest.locator("[data-photo-state]");
    const img = photo.getByRole("img", { name: "התמונה של ד״ר מרצה 01 לאתר האורחים" });
    // the stored photo: read once, as it is stored
    await expect(img).toHaveAttribute("src", PHOTO_DATA_PREFIX + photoBase64("clean"));
    await expect(photo).toHaveAttribute("data-photo-state", "stored");
    await expect(photo).toHaveAttribute("data-photo-dims", "32x16");
    await expect(photo).toContainText("הועלתה 1.11.2026");
    expect(sb.rpc.get("get_speaker_photo")).toEqual([{ p_speaker: 1 }]);

    // the box: set_public_ok by its parameters (what the next load_week says follows it)
    a1.public_ok = true;
    await guest.locator(`[data-public-ok="${a1.id}"]`).check();
    await expect(toast(page, "ד״ר מרצה 01 אושר להופיע באתר האורחים")).toBeVisible();
    expect(sb.rpc.get("set_public_ok")).toEqual([{ p_approach: a1.id, p_version: a1.version, p_ok: true }]);

    // the description for guests: update_speaker with public_bio alone — never the profile's fields
    const words = "תיאור לאורחים לדוגמה (נתון לדוגמה).";
    await guest.getByRole("button", { name: "עריכת התיאור" }).click();
    await guest.getByRole("form", { name: "תיאור לאורחים" }).getByRole("textbox").fill(words);
    s1.public_bio = words;
    await guest.getByRole("form", { name: "תיאור לאורחים" }).getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "התיאור לאורחים נשמר")).toBeVisible();
    expect(sb.rpc.get("update_speaker")).toEqual([{ p_edition: 7, p_speaker: 1, p_version: s1.version, p_patch: { public_bio: words } }]);

    // a 2400×1600 picture of noise: fitted to what the server takes (≤ 512px, ≤ 20KB, baseline, stripped), never sent
    // until «שמירת התמונה» — «ביטול» sends nothing and gives the picker the focus back
    await photo.locator("[data-photo-pick]").setInputFiles({ name: "רעש לדוגמה.png", mimeType: "image/png", buffer: await noisePng(page) });
    await expect(photo).toHaveAttribute("data-photo-state", "preview", { timeout: 30_000 });
    const noisy = bytesOf(await img.getAttribute("src"));
    servable(noisy);
    const dims = jpegSize(noisy)!;
    expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(PHOTO_LIMITS.maxSide);
    expect(Math.abs(dims.width / dims.height - 1.5) * dims.height).toBeLessThanOrEqual(1); // the picture's shape, within a pixel
    await expect(photo).toHaveAttribute("data-photo-dims", `${dims.width}x${dims.height}`);
    await photo.getByRole("button", { name: "ביטול" }).click();
    await expect(photo).toHaveAttribute("data-photo-state", "stored");
    await expect(photo.locator("[data-photo-pick]")).toBeFocused();
    await expect(img).toHaveAttribute("src", PHOTO_DATA_PREFIX + photoBase64("clean"));
    expect(sb.rpc.get("set_speaker_photo")).toBeUndefined();

    // replaced by a picture stored on its side: set_speaker_photo carries exactly the bytes previewed — upright
    await photo.locator("[data-photo-pick]").setInputFiles(sideways());
    await expect(photo).toHaveAttribute("data-photo-dims", "16x32");
    const previewSrc = (await img.getAttribute("src"))!;
    const loads = sb.count("/rest/v1/rpc/load_week");
    await photo.locator("[data-photo-save]").click();
    await expect(toast(page, "התמונה נשמרה")).toBeVisible();
    await expect.poll(() => sb.count("/rest/v1/rpc/load_week")).toBeGreaterThan(loads); // the week again
    const sent = sb.rpc.get("set_speaker_photo") as { p_edition: number; p_speaker: number; p_photo: string }[];
    expect(sent).toHaveLength(1);
    expect([sent[0].p_edition, sent[0].p_speaker]).toEqual([7, 1]);
    expect(PHOTO_DATA_PREFIX + sent[0].p_photo).toBe(previewSrc);
    const bytes = photoFromBase64(sent[0].p_photo)!;
    servable(bytes);
    expect(jpegSize(bytes)).toEqual({ width: 16, height: 32 });
    // the page shows what it sent — not read again
    await expect(img).toHaveAttribute("src", previewSrc);
    await expect(photo).toHaveAttribute("data-photo-state", "stored");
    expect(sb.rpc.get("get_speaker_photo")).toEqual([{ p_speaker: 1 }]);
    for (const fn of ["set_public_ok", "update_speaker", "set_speaker_photo", "get_speaker_photo"]) {
      expect(calls(fn).every((c) => c.auth === bearer), fn).toBe(true);
    }
    // nothing of the photos in the browser's storage (the offline copy holds the week: has_photo, never a photo)
    await noPhotoKept(page, sent[0].p_photo, photoBase64("clean"));
  });

  test("the lesson page's wire: update_lesson with public_note alone, set_public_ok on the speaker's row; a speaker with no photo is never read", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the wire is the same at every width: one run is enough");
    const sb = new FakeSupabase({ status: 200, body: whoami("content", 2) });
    const week = mockWeek(sb);
    sb.answers.set("update_lesson", null);
    sb.answers.set("set_public_ok", null);
    await sb.attach(page);
    const session = await signIn(page, "content@example.org");
    sb.token = session.access_token;
    const bearer = `Bearer ${session.access_token}`;
    const l = week.lessons.find((x) => x.id === lessonAt(0, 690))!; // Sunday 11:30, «הרב מרצה 05»
    const a5 = week.approaches.find((a) => a.speaker_id === 5)!;

    await page.goto(`${mockUrl()}/lesson/${l.id}#guest`);
    const guest = lessonGuest(page);
    await expect(guest).toBeFocused();
    const words = "שיעור לדוגמה (נתון לדוגמה).";
    await guest.getByRole("button", { name: "עריכת התיאור" }).click();
    await guest.getByRole("form", { name: "תיאור קצר לשיעור" }).getByRole("textbox").fill(words);
    l.public_note = words;
    await guest.getByRole("form", { name: "תיאור קצר לשיעור" }).getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "התיאור לשיעור נשמר")).toBeVisible();
    // only that key: «פרטי השיעור»'s four are never written over
    expect(sb.rpc.get("update_lesson")).toEqual([{ p_lesson: l.id, p_version: l.version, p_patch: { public_note: words } }]);

    a5.public_ok = true;
    await guest.locator(`[data-guest-speaker="5"] [data-public-ok="${a5.id}"]`).check();
    await expect(toast(page, "הרב מרצה 05 אושר להופיע באתר האורחים")).toBeVisible();
    expect(sb.rpc.get("set_public_ok")).toEqual([{ p_approach: a5.id, p_version: a5.version, p_ok: true }]);
    for (const fn of ["update_lesson", "set_public_ok"]) expect(sb.calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`).every((c) => c.auth === bearer), fn).toBe(true);

    // the folded card: their description, no photo to read (has_photo is false)
    await guest.locator("[data-guest-preview]").getByText("כך זה ייראה לאורחים").click();
    await expect(guest.locator("[data-guest-preview] [data-guest-note]")).toHaveText(words);
    expect(sb.rpc.get("get_speaker_photo")).toBeUndefined();
    expect(sb.rpc.get("update_speaker")).toBeUndefined();
    expect(sb.rpc.get("set_speaker_photo")).toBeUndefined();
  });

  test("the overview's wire: opening reads the week alone; a preview reads the approved speakers' photos only — and forgets them; a mark taken back is set_public_ok false", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the wire is the same at every width: one run is enough");
    const sb = new FakeSupabase({ status: 200, body: whoami("admin", 1) });
    const week = mockWeek(sb);
    // «ד״ר מרצה 01» approved with a photo; «מרצה 07» has a photo and is not approved — never read; «מרצה 16» approved, none
    for (const id of [1, 7]) week.speakers.find((s) => s.id === id)!.has_photo = true;
    for (const id of [1, 16]) week.approaches.find((a) => a.speaker_id === id)!.public_ok = true;
    sb.answers.set("get_speaker_photo", { photo: photoBase64("clean"), uploaded_at: "2026-11-01T08:00:00.000Z" });
    sb.answers.set("set_public_ok", null);
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;

    await page.goto(`${mockUrl()}/export/guests`);
    await expect(page.locator('[data-guests-count="photo"]')).toHaveText("עם תמונה 1/2");
    const rpcs = () => [...new Set(sb.calls.filter((c) => c.path.startsWith("/rest/v1/rpc/")).map((c) => c.path.slice("/rest/v1/rpc/".length)))].sort();
    expect(rpcs()).toEqual(["load_week", "whoami"]);

    const show = page.getByRole("button", { name: "תצוגה מקדימה לאורחים" });
    await show.click();
    await expect(page.locator('[data-guests-preview] [data-guest-lesson="0"]')).toBeVisible();
    await expect.poll(() => sb.rpc.get("get_speaker_photo")).toEqual([{ p_speaker: 1 }]);
    await page.locator('[data-guests-preview] [data-guest-lesson="0"]').click();
    await expect(page.locator("dialog[data-guest-card] img[data-guest-photo]")).toHaveAttribute("src", PHOTO_DATA_PREFIX + photoBase64("clean"));
    await page.keyboard.press("Escape");
    // closed, the photos are forgotten: opened again, read again
    await show.click();
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await show.click();
    await expect.poll(() => sb.rpc.get("get_speaker_photo")).toEqual([{ p_speaker: 1 }, { p_speaker: 1 }]);

    // a mark taken back: set_public_ok false on that approach's version
    const a16 = week.approaches.find((a) => a.speaker_id === 16)!;
    a16.public_ok = false;
    await page.locator(`[data-guests-unmark="${a16.id}"]`).click();
    await expect(toast(page, "מרצה 16 הוסרה מאתר האורחים")).toBeVisible();
    expect(sb.rpc.get("set_public_ok")).toEqual([{ p_approach: a16.id, p_version: a16.version, p_ok: false }]);
    expect(sb.calls.filter((c) => c.path === "/rest/v1/rpc/set_public_ok").every((c) => c.auth === `Bearer ${session.access_token}`)).toBe(true);
    await expect(page.locator('[data-guests-count="ok"]')).toHaveText("מרצים מאושרים להופיע 1/18");
    await noPhotoKept(page, photoBase64("clean"));
  });
});

test.describe("mock build — a practice week", () => {
  async function practice(page: Page, body: ReturnType<typeof whoami>) {
    const sb = new FakeSupabase({ status: 200, body });
    const week = mockWeek(sb);
    week.edition.kind = "practice";
    sb.answers.set("editions", [week.edition]);
    await sb.attach(page);
    sb.token = (await signIn(page, body.email)).access_token;
    return sb;
  }

  test("a trainee's claim publishes nothing: no box on the speaker page or the lesson page, nothing to write for guests", async ({ page }) => {
    const sb = await practice(page, whoami("content", 2));
    await page.goto(`${mockUrl()}/speakers/5#guest`);
    const guest = speakerGuest(page);
    await expect(guest).toBeFocused();
    await expect(guest.locator("p[data-public-ok-practice]")).toHaveText("במחזור תרגול לא מפרסמים מרצים לאורחים");
    await expect(guest.locator("[data-public-ok]")).toHaveCount(0);
    // the speaker's own record is not a practice week's to change (app.may_edit_speaker)
    await expect(guest.getByRole("button", { name: "עריכת התיאור" })).toHaveCount(0);
    await expect(guest.locator("[data-photo-pick]")).toHaveCount(0);
    await noSidewaysScroll(page);

    await page.goto(`${mockUrl()}/lesson/${lessonAt(0, 690)}#guest`);
    const lesson = lessonGuest(page);
    await expect(lesson.locator('[data-guest-speaker="5"] p[data-public-ok-practice]')).toBeVisible();
    await expect(lesson.locator("[data-public-ok]")).toHaveCount(0);
    await expect(lesson.getByText(/^מסמנים רק אחרי/)).toHaveCount(0); // no box, no hint
    await noSidewaysScroll(page);
    for (const fn of ["set_public_ok", "set_speaker_photo", "update_speaker"]) expect(sb.rpc.get(fn), fn).toBeUndefined();
  });

  test("a mark already there (a global admin's) is its owner's to take back — the box, not the practice line; set_public_ok false (the review)", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the wire is the same at every width: one run is enough");
    const sb = await practice(page, whoami("content", 2));
    sb.answers.set("set_public_ok", null);
    // «ד״ר מרצה 01» is member 2's — marked, as only a global admin could have in a practice week
    const a1 = (sb.answers.get("load_week") as ReturnType<typeof demoWeek>).approaches.find((a) => a.speaker_id === 1)!;
    a1.public_ok = true;
    await page.goto(`${mockUrl()}/speakers/1#guest`);
    const guest = speakerGuest(page);
    await expect(guest).toBeFocused();
    await expect(guest.locator("p[data-public-ok-practice]")).toHaveCount(0);
    const box = guest.locator(`[data-public-ok="${approachOf(1)}"]`);
    await expect(box).toBeChecked();
    await expect(box).toBeEnabled();
    a1.public_ok = false; // the server's answer once it is taken back
    await box.uncheck();
    await expect(toast(page, "ד״ר מרצה 01 הוסר מאתר האורחים")).toBeVisible();
    expect(sb.rpc.get("set_public_ok")).toEqual([{ p_approach: a1.id, p_version: a1.version, p_ok: false }]);
    // another of theirs, not marked: still nothing to mark in a practice week
    await page.goto(`${mockUrl()}/speakers/5#guest`);
    await expect(speakerGuest(page).locator("p[data-public-ok-practice]")).toBeVisible();
  });

  test("an edition's admin, not a global one: the overview says a practice week publishes nobody", async ({ page }) => {
    await practice(page, whoami("admin", 1));
    await page.goto(`${mockUrl()}/export/guests`);
    await expect(page.getByText("במחזור תרגול לא מפרסמים מרצים לאורחים.")).toBeVisible();
    await expect(page.locator("[data-guests-row]").first()).toBeVisible();
    await expect(page.locator("[data-guests-unmark]")).toHaveCount(0); // nobody is marked
    await noSidewaysScroll(page);
  });

  test("an edition's admin, a mark already there (a global admin's): the overview says it is on the link until taken back (the final review)", async ({ page }) => {
    const sb = new FakeSupabase({ status: 200, body: whoami("admin", 1) });
    const week = mockWeek(sb);
    week.edition.kind = "practice";
    week.approaches.find((a) => a.speaker_id === 1)!.public_ok = true;
    sb.answers.set("editions", [week.edition]);
    await sb.attach(page);
    sb.token = (await signIn(page, whoami("admin", 1).email)).access_token;
    await page.goto(`${mockUrl()}/export/guests`);
    await expect(page.locator("[data-guests-practice]")).toHaveText(
      "במחזור תרגול רק מי שמנהל/ת את כל המחזורים מסמן/ת מרצים לאורחים. מרצה שכבר מסומן/ת מופיע/ה בקישור עד שמבטלים את הסימון («ביטול»).",
    );
    await expect(page.getByText("במחזור תרגול לא מפרסמים מרצים לאורחים.")).toHaveCount(0);
    await expect(page.locator("[data-guests-unmark]").first()).toBeVisible();
    await noSidewaysScroll(page);
  });
});

