// «היום שלי» and «השבוע» — the trainee's home and the week to read (the reset, phase 2), in a real browser. Demo build
// `?as=trainee` (src/data/demoPort.ts): «חניך/ה א׳» (member 2, content) owns Sunday with «חניך/ה ב׳» and Wednesday with
// «חניך/ה ג׳»; Monday is the other two's. Every width: the trainee's four links and nothing else, the day's slots in
// time order each with one next step, «חדש» on what someone else handles and «ראיתי», the speakers who can come, the
// week read-only with the trainee's days marked; staff keep the grid at «/», and «/myday» sends them to «ימים». Mock build: «ראיתי» and «הגדרות ← ימים» go
// out as mark_day_seen and set_day_owners by the contract's parameter names, with the member's token.
import { expect, type Page, test } from "@playwright/test";
import { demoDayOwners, demoWeek } from "../../src/data/demoWeek";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const slot = (page: Page, key: string) => page.locator(`[data-slot-card="${key}"]`);

test.describe("demo build — a trainee", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${demoUrl()}/?as=trainee`);
    await expect(page.getByRole("heading", { name: "היום שלי", level: 2 })).toBeVisible();
  });

  test("the home is «היום שלי»: four links, my two days, the partner, the day's balance — and it fits", async ({ page }) => {
    await expect(nav(page).getByRole("link")).toHaveText(["היום שלי", "מרצים", "השבוע", "עזרה"]);
    await expect(nav(page).getByRole("link", { name: "היום שלי" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("tablist", { name: "הימים שלי" }).getByRole("tab")).toHaveText(["יום ראשון", "יום רביעי"]);
    await expect(page.getByRole("tab", { name: "יום ראשון" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-partner]")).toHaveText("בזוג עם חניך/ה ב׳");
    // the balance counts the CLOSED lessons only (v18 phase 2 gender rule): one woman, four men on Sunday
    await expect(page.locator("[data-day-balance]")).toContainText("4 מרצים");
    // no lens, no warnings, no topic axis
    await expect(page.getByRole("radiogroup", { name: "עדשה" })).toHaveCount(0);
    await expect(page.getByRole("grid", { name: "רשת השבוע" })).toHaveCount(0);
    await noSidewaysScroll(page);

    await page.getByRole("tab", { name: "יום רביעי" }).click();
    await expect(page).toHaveURL(/[?&]day=3$/);
    await expect(page.locator("[data-partner]")).toHaveText("בזוג עם חניך/ה ג׳");
    await expect(page.locator("[data-myday]")).toHaveAttribute("data-myday", "3");
    await noSidewaysScroll(page);
  });

  test("the slots in time order, each with one next step: a free slot opens the speakers who fit it", async ({ page }) => {
    const starts = await page.locator("[data-slot-card]").evaluateAll((els) => els.map((e) => e.querySelector("bdi")?.textContent ?? ""));
    expect(starts.length).toBeGreaterThan(5);
    const minutes = starts.map((t) => {
      const [h, m] = t.split("–")[0].split(":").map(Number);
      return (h < 6 || (h === 6 && m < 30) ? 1440 : 0) + h * 60 + m;
    });
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
    // a lesson of mine waits for its summary message: to the lesson page, at that step
    const mine = page.locator('[data-slot-card][data-state="closed"]').filter({ hasText: "הרב מרצה 05" });
    await expect(mine).toContainText("לשלוח סיכום");
    await mine.getByRole("link", { name: "לשיעור" }).click();
    await expect(page).toHaveURL(/\/lesson\/\d+\?step=msg$/);
    await expect(page.locator('[data-page-step="msg"] h3 button')).toHaveAttribute("aria-expanded", "true");
    await page.goBack();

    const free = slot(page, "free:0:1050");
    await expect(free).toHaveAttribute("data-state", "free");
    await expect(free).toContainText("פנוי");
    await free.getByRole("link", { name: "לבחור מרצה" }).click();
    await expect(page).toHaveURL(/\/speakers\?slot=0:1050-1140$/);
    await expect(page.getByText("מרצים למשבצת: יום ראשון")).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("what someone else handles on my day: «חדש» until «ראיתי»", async ({ page }) => {
    const others = page.getByRole("region", { name: "משבצות ביום שלכם שמטופלות על ידי אחרים" });
    await expect(others.locator("[data-other-lesson]")).not.toHaveCount(0);
    await expect(others.locator("[data-fresh]").first()).toBeVisible();
    await expect(others).toContainText("בטיפול חניך/ה ג׳");
    await others.getByRole("button", { name: "ראיתי" }).click();
    await expect(others.locator("[data-fresh]")).toHaveCount(0);
    await expect(others.getByRole("button", { name: "ראיתי" })).toHaveCount(0);
    await expect(others.locator("[data-other-lesson]")).not.toHaveCount(0); // still listed, no longer new
    await noSidewaysScroll(page);
  });

  test("the speakers who can come to a free slot of my day, each to its page at «איפה אפשר לשבץ»", async ({ page }) => {
    const speakers = page.getByRole("region", { name: "מרצים שיכולים ביום שלכם" });
    await expect(speakers.locator("[data-day-speaker]")).toHaveCount(1);
    await expect(speakers.locator('[data-day-speaker="33"]')).toContainText("20:00–21:30");
    await page.getByRole("tab", { name: "יום רביעי" }).click();
    await speakers.locator('[data-day-speaker="41"]').getByRole("link").click();
    await expect(page).toHaveURL(/\/speakers\/41#placement$/);
    await expect(page.locator("#placement")).toBeFocused();
    await expect(page.locator('#placement [data-place-day="3"]')).toContainText("היום שלך, עם חניך/ה ג׳");
  });

  test("«השבוע» is the week to read: my days marked, nothing to place, a lesson opens its page", async ({ page }, info) => {
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    await expect(page.getByRole("heading", { name: "השבוע — לצפייה בלבד" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "מאגר" })).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: "עדשה" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "שבץ" })).toHaveCount(0);
    if (info.project.name === "desktop") {
      await expect(page.locator("[data-day-header][data-mine-day]")).toHaveCount(2);
      await expect(page.locator('[data-day-header="0"]')).toHaveAttribute("data-mine-day", "0");
      await expect(page.locator('[data-day-header="1"]')).not.toHaveAttribute("data-mine-day", /./);
    } else {
      // the day view: the tabs of my days carry the mark, and it opens on my first day
      await expect(page.locator("[data-mine-day]").first()).toBeVisible();
      await expect(page.locator('[data-day-header="0"]')).toHaveAttribute("data-mine-day", "0");
    }
    // the gender (everyone, phase 2): no free cell is tinted or says «דרושה מרצה» — the day's header says it once
    await expect(page.locator("[data-free-cell][data-need], [data-drop][data-need]")).toHaveCount(0);
    await expect(page.getByText(/^דרוש(ה)? מרצה$/)).toHaveCount(0);
    await expect(page.locator('[data-day-header="0"] [data-need]')).toHaveAttribute("data-need", "f");
    // no warnings' counts to read and nowhere to read them: not on a card, not in a day's header
    await expect(page.locator("[data-lesson-id]").first()).toBeVisible();
    await expect(page.locator("[data-warning-count]")).toHaveCount(0);
    if (info.project.name !== "desktop") {
      // the days' strip fits the screen: every day whole, Thursday too, without a swipe inside it (the ring marks my
      // days, not a word on the chip — a screen reader still hears it)
      const strip = page.getByRole("tablist", { name: "ימים" });
      const width = page.viewportSize()!.width;
      for (const box of await strip.getByRole("tab").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.right]))) {
        expect(box[0]).toBeGreaterThanOrEqual(0);
        expect(box[1]).toBeLessThanOrEqual(width);
      }
      await expect(strip.getByRole("tab", { name: /ראשון/ })).toHaveAccessibleName(/היום שלי/);
    }
    await noSidewaysScroll(page);

    await page.locator('[data-day="0"] [data-lesson-id], [data-lesson-id]').filter({ hasText: "מרצה 05" }).first().click();
    await expect(page).toHaveURL(/\/lesson\/\d+$/);
    await expect(page.locator("[data-lesson-header]")).toContainText("הרב מרצה 05");
  });
});

test.describe("demo build — «עזרה»", () => {
  test("a time range inside the guide's Hebrew reads left to right (17:00 before 19:00)", async ({ page }) => {
    await page.goto(`${demoUrl()}/help?as=trainee`);
    const line = page.getByRole("listitem").filter({ hasText: "עמוד מרצה" });
    const range = line.locator('bdi[dir="ltr"]', { hasText: "17:00–19:00" });
    await expect(range).toBeVisible();
    // drawn in order: the start on the left
    const [start, end] = await range.evaluate((el) => {
      const text = el.firstChild!;
      const at = (from: number, to: number) => {
        const r = document.createRange();
        r.setStart(text, from);
        r.setEnd(text, to);
        return r.getBoundingClientRect().left;
      };
      return [at(0, 5), at(6, 11)];
    });
    expect(start).toBeLessThan(end);
    // the rota's shifts too
    await expect(page.locator('bdi[dir="ltr"]', { hasText: "06:30–14:30" })).toBeVisible();
    await noSidewaysScroll(page);
  });
});

test.describe("demo build — staff", () => {
  test("the instructor keeps the week at «/» and the staff's header; «/myday» is a trainee's — staff land on «ימים»", async ({ page }) => {
    await page.goto(demoUrl());
    await expect(page.getByRole("radiogroup", { name: "עדשה" })).toBeVisible(); // the week that writes, with its lenses
    await expect(nav(page).getByRole("link", { name: "היום שלי" })).toHaveCount(0);
    // the reset, phase 3: «ימים» and «מרצים» after «השבוע»; «המרצים שלי» is gone
    await expect(nav(page).getByRole("link")).toHaveText(["השבוע", "ימים", "מרצים", /^אישורים/, "לוגיסטיקה", "תוצרים", "זמני זיכרון", "מכריכה לכריכה", "ידע", "הגדרות", "עזרה"]);
    await expect(nav(page).getByRole("link", { name: "השבוע" })).toHaveAttribute("aria-current", "page");
    // «/myday» was a preview of a trainee's day for staff: the staff's own «ימים» (any day, the pair named) replaced it
    await page.goto(`${demoUrl()}/myday`);
    await expect(page).toHaveURL(/\/day$/);
    await expect(page.getByRole("heading", { name: "ימים", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "היום שלי", level: 2 })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ראיתי" })).toHaveCount(0); // nobody's notices to clear but an owner's
    await noSidewaysScroll(page);
  });
});

test.describe("mock build", () => {
  /** The demo's week as edition 7 — real, with the trainee's day owners. */
  function traineeWeek() {
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.kind = "real";
    week.dayOwners = demoDayOwners();
    return week;
  }

  test("«ראיתי» is mark_day_seen of my day, by the contract's parameter names, with the member's token", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const week = traineeWeek();
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "trainee@example.org", display_name: "חניך/ה א׳", global_admin: false, memberships: [{ edition_id: 7, role: "content", member_id: 2 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("mark_day_seen", null);
    await sb.attach(page);
    const session = await signIn(page, "trainee@example.org");
    sb.token = session.access_token;
    await page.goto(mockUrl());
    await expect(nav(page).getByRole("link")).toHaveText(["היום שלי", "מרצים", "השבוע", "עזרה"]);
    await page.getByRole("region", { name: "משבצות ביום שלכם שמטופלות על ידי אחרים" }).getByRole("button", { name: "ראיתי" }).click();
    await expect.poll(() => sb.rpc.get("mark_day_seen")).toEqual([{ p_edition: 7, p_day: 0 }]);
    for (const c of sb.calls.filter((x) => x.path === "/rest/v1/rpc/mark_day_seen")) expect(c.auth).toBe(`Bearer ${session.access_token}`);
    await expect.poll(() => sb.count("/rest/v1/rpc/load_week")).toBeGreaterThanOrEqual(2); // the week is read again
  });

  test("«הגדרות ← צוות ← ימים» is set_day_owners: the day and its pair, replaced as a set", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const week = traineeWeek();
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "admin@example.org", display_name: "מדריך/ה לדוגמה", global_admin: true, memberships: [{ edition_id: null, role: "admin", member_id: 1 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("team", week.team);
    sb.answers.set("set_day_owners", null);
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;
    await page.goto(`${mockUrl()}/settings/team`);
    const days = page.getByRole("list", { name: "האחראים לכל יום" });
    const tuesday = days.locator('[data-day-owners="2"]');
    await expect(tuesday.getByLabel("אחראי/ת 1")).toHaveValue("");
    await expect(days.locator('[data-day-owners="0"]').getByLabel("אחראי/ת 1")).toHaveValue("2"); // what is saved
    await tuesday.getByLabel("אחראי/ת 1").selectOption({ label: "חניך/ה ג׳" });
    await tuesday.getByLabel("אחראי/ת 2").selectOption({ label: "חניך/ה א׳" });
    await tuesday.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "נשמר: יום שלישי")).toBeVisible();
    expect(sb.rpc.get("set_day_owners")).toEqual([{ p_edition: 7, p_day: 2, p_members: [2, 4] }]);
    for (const c of sb.calls.filter((x) => x.path === "/rest/v1/rpc/set_day_owners")) expect(c.auth).toBe(`Bearer ${session.access_token}`);
  });
});
