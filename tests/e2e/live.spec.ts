// The signed-in path against a fake Supabase: the week comes from rpc/load_week
// and a placement goes out as rpc/propose with the contract's parameter names
// (tests/sql/grid.test.ts pins the same names on the database side).
import { expect, test } from "@playwright/test";
import { demoWeek } from "../../src/data/demoWeek";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { FakeSupabase, signIn } from "./mock";

const mockUrl = () => process.env.E2E_MOCK_URL!;

test("a member's week loads from load_week; «שבץ» sends propose with the contract's parameters", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
  const week = demoWeek();
  week.edition.id = 7;
  const sb = new FakeSupabase({
    status: 200,
    body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "member@example.org", display_name: "חבר/ת צוות", global_admin: false, memberships: [{ edition_id: 7, role: "content", member_id: 2 }] },
  });
  sb.answers.set("editions", [week.edition]);
  sb.answers.set("load_week", week);
  sb.answers.set("propose", { lesson_id: 999, pitch_id: 998 });
  await sb.attach(page);
  await signIn(page);
  await page.goto(mockUrl());

  await expect(page.getByRole("grid", { name: "רשת השבוע" })).toBeVisible();
  expect(sb.rpc.get("load_week")).toEqual([{ p_edition: 7 }]);

  await page.locator('[data-speaker-id="41"]').getByRole("button", { name: "שבץ" }).click();
  await page.locator('[data-drop="cell:4:510:600"]').click();
  await expect.poll(() => sb.rpc.get("propose")?.length ?? 0).toBe(1);
  expect(sb.rpc.get("propose")![0]).toEqual({
    p_edition: 7, p_speaker: 41, p_lesson: null, p_day: 4, p_start: 510, p_end: 600, p_room: null, p_mode: "self",
  });
  await expect.poll(() => sb.rpc.get("load_week")?.length ?? 0).toBe(2); // reloaded after the command
});
