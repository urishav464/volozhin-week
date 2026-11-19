// `?as=trainee` (the reset, phase 2): the demo acts as a trainee who owns days — content, not an admin, in a `real`
// edition — and the default demo stays the global admin's, with no day owners.
import { describe, expect, it } from "vitest";
import { CommandError } from "./commands";
import { DEMO_TRAINEE, DemoPort } from "./demoPort";
import { buildModel } from "../grid/model";
import { myDay } from "../domain/myDay";
import { demoDayOwners } from "./demoWeek";
import { personaOf } from "./gate";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};

describe("the trainee's demo", () => {
  it("signs in as «חניך/ה א׳»: content, member 2, of edition 1 — a trainee", async () => {
    const port = new DemoPort(DEMO_TRAINEE, { trainee: true });
    const w = await port.whoami();
    if (w.status !== "ok") throw new Error(w.status);
    expect(w).toMatchObject({ email: "demo@example.org", display_name: "חניך/ה א׳", global_admin: false });
    expect(w.memberships).toEqual([{ edition_id: 1, role: "content", member_id: 2 }]);
    expect(personaOf(w, 1)).toBe("trainee");
    // the instructor kept their place in the team, with the address the trainee had
    expect(port.members.find((m) => m.id === 1)).toMatchObject({ email: "team.a@example.org", role: "admin", edition_id: null });
    expect(new Set(port.members.map((m) => m.email)).size).toBe(port.members.length);
  });

  it("the week is a real edition with its day owners, nobody having looked yet", async () => {
    const port = new DemoPort(DEMO_TRAINEE, { trainee: true });
    const week = await port.loadWeek(1);
    expect(week.edition.kind).toBe("real");
    expect(week.dayOwners).toEqual(demoDayOwners());
    const byDay = (d: number) => week.dayOwners.filter((o) => o.day === d).map((o) => o.member_id);
    expect(byDay(0)).toEqual([2, 3]);
    expect(byDay(1)).toEqual([3, 4]);
    expect(byDay(3)).toEqual([2, 4]);
    expect(byDay(2)).toEqual([]);
    expect(week.dayOwners.every((o) => o.seen_at === null)).toBe(true);
    // every owner is on the team and handles speakers
    for (const o of week.dayOwners) expect(week.team.find((t) => t.id === o.member_id)?.role).toBe("content");
  });

  it("«היום שלי» has something in every part: slots of mine, others' lessons, speakers who can come", async () => {
    const port = new DemoPort(DEMO_TRAINEE, { trainee: true });
    const m = buildModel(await port.loadWeek(1));
    const sunday = myDay(m, 0, 2);
    expect(sunday.partners).toEqual([3]);
    expect(sunday.slots.some((s) => s.step.kind === "lesson")).toBe(true);
    expect(sunday.slots.some((s) => s.step.kind === "speaker")).toBe(true);
    expect(sunday.slots.some((s) => s.step.kind === "choose")).toBe(true);
    expect(sunday.others.length).toBeGreaterThan(0);
    expect(sunday.speakers.map((s) => s.speakerId)).toEqual([33]);
    const wednesday = myDay(m, 3, 2);
    expect(wednesday.speakers.map((s) => [s.speakerId, s.mine])).toEqual([
      [9, true],
      [41, false],
    ]);
    // the default demo has none of it
    expect((await new DemoPort().loadWeek(1)).slotAvailability.some((v) => v.speaker_id === 33)).toBe(false);
  });

  it("marks only its own days seen, and may not set owners (an admin's)", async () => {
    const port = new DemoPort(DEMO_TRAINEE, { trainee: true });
    const cmds = port.commands(1);
    await cmds.markDaySeen(0);
    const week = await port.loadWeek(1);
    expect(week.dayOwners.find((o) => o.day === 0 && o.member_id === 2)?.seen_at).not.toBeNull();
    expect(week.dayOwners.find((o) => o.day === 0 && o.member_id === 3)?.seen_at).toBeNull();
    expect(await code(cmds.markDaySeen(1))).toBe("forbidden");
    expect(await code(cmds.setDayOwners(2, [2]))).toBe("forbidden");
  });
});

describe("the default demo", () => {
  it("is unchanged: the global admin, a demo edition, no day owners", async () => {
    const port = new DemoPort();
    const w = await port.whoami();
    if (w.status !== "ok") throw new Error(w.status);
    expect(w.global_admin).toBe(true);
    expect(w.memberships).toEqual([{ edition_id: null, role: "admin", member_id: 1 }]);
    expect(personaOf(w, 1)).toBe("staff");
    const week = await port.loadWeek(1);
    expect(week.edition.kind).toBe("demo");
    expect(week.dayOwners).toEqual([]);
    expect(port.members.find((m) => m.id === 2)?.email).toBe("team.a@example.org");
  });

  it("an admin sets a day's owners there", async () => {
    const port = new DemoPort();
    await port.commands(1).setDayOwners(2, [3, 2]);
    expect((await port.loadWeek(1)).dayOwners).toEqual([
      { day: 2, member_id: 2, seen_at: null },
      { day: 2, member_id: 3, seen_at: null },
    ]);
  });
});
