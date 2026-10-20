// The links, מכריכה לכריכה and the public pages' ports. On the wire: the
// public path sends the publishable key alone — an `apikey` header and never an
// Authorization header, even with a team member's session stored in the same
// browser — calls only the six anon functions, by their parameter names, with
// the token in the body and never in the URL; a refusal comes back as its code.
// The signed-in ports call their functions by name and read share_links by
// column, never the hash. In the demo: seeded links open their pages, a token
// issued elsewhere still opens (it says what it opens), a revoked one does not,
// the class signs up through its link, ticks reach the team's Week, and
// deleting a trainee takes their link, sign-ups and ticks along.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { CommandError } from "./commands";
import { demoToken } from "./demoLinks";
import { DemoPort } from "./demoPort";
import { cleanGroupFields } from "./kk";
import { linkExpiry, linkState, linkUrl, randomToken, tokenShape } from "./links";
import { PUBLIC_FUNCTIONS, SupabaseKk, SupabaseLinks, SupabasePublic } from "./supabaseLinks";
import { PortError } from "./types";

interface Sent {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

function wire(answers: [number, unknown][]) {
  const sent: Sent[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const text = await req.text();
    const u = new URL(req.url);
    sent.push({ method: req.method, url: req.url, path: u.pathname, headers: Object.fromEntries(req.headers.entries()), body: text ? JSON.parse(text) : null });
    const [status, body] = answers.shift() ?? [404, {}];
    return new Response(status === 204 ? null : typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, sent };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : e instanceof PortError ? `port:${e.code}` : `raw:${String(e)}`;
  }
};

const TOKEN = "Zm9yLXRoZS10ZXN0LW9ubHk";
const KEY = "sb_publishable_stub";

describe("the public pages on the wire", () => {
  it("send the publishable key alone — no Authorization — the token in the body, to the six anon functions only", async () => {
    const ticks = { reminded: null, met: "2027-02-15T08:00:00.000Z", introduced: null, gift: null };
    const { fetch, sent } = wire([[200, { lessons: [] }], [200, ticks], [204, null], [200, { tracks: [] }], [200, { status: "received" }], [200, { rows: [] }]]);
    const p = new SupabasePublic("https://stub.supabase.co", KEY, fetch);
    await p.escortView(TOKEN);
    expect(await p.escortTick(TOKEN, 41, "met", true)).toEqual(ticks);
    await p.escortPickup(TOKEN, 41, "כתובת לדוגמה");
    await p.kkForm(TOKEN);
    await p.kkSignup(TOKEN, 3, 9);
    await p.scheduleView(TOKEN);
    expect(sent.map((r) => [r.method, r.path, r.body])).toEqual([
      ["POST", "/rest/v1/rpc/escort_view", { p_token: TOKEN }],
      ["POST", "/rest/v1/rpc/escort_tick", { p_token: TOKEN, p_lesson: 41, p_item: "met", p_on: true }],
      ["POST", "/rest/v1/rpc/escort_pickup", { p_token: TOKEN, p_lesson: 41, p_address: "כתובת לדוגמה" }],
      ["POST", "/rest/v1/rpc/kk_form", { p_token: TOKEN }],
      ["POST", "/rest/v1/rpc/kk_signup", { p_token: TOKEN, p_roster: 3, p_group: 9 }],
      ["POST", "/rest/v1/rpc/schedule_view", { p_token: TOKEN }],
    ]);
    for (const r of sent) {
      expect(r.headers.apikey).toBe(KEY);
      expect(r.headers.authorization).toBeUndefined();
      expect(r.url).not.toContain(TOKEN);
      expect(PUBLIC_FUNCTIONS).toContain(r.path.replace("/rest/v1/rpc/", ""));
    }
  });

  it("turn the database's one refusal into its code; anything else stays a port error", async () => {
    const { fetch } = wire([
      [400, { code: "P0001", message: "link_invalid", details: null, hint: null }],
      [400, { code: "P0001", message: "no_transport" }],
      [404, { code: "PGRST202", message: "Could not find the function" }],
      [502, "<html>bad gateway</html>"],
    ]);
    const p = new SupabasePublic("https://stub.supabase.co", KEY, fetch);
    expect(await code(p.escortView(TOKEN))).toBe("link_invalid");
    expect(await code(p.escortPickup(TOKEN, 1, "כתובת"))).toBe("no_transport");
    expect(await code(p.kkForm(TOKEN))).toBe("port:PGRST202");
    expect(await code(p.scheduleView(TOKEN))).toBe("port:502");
  });
});

describe("the links and מכריכה לכריכה on the wire (signed in)", () => {
  function client(answers: [number, unknown][]) {
    const { fetch, sent } = wire(answers);
    const sb = createClient("https://stub.supabase.co", KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch } });
    return { sb, sent };
  }

  it("issue and revoke by function, list by column — never the hash", async () => {
    const { sb, sent } = client([
      [200, { link_id: "5", token: TOKEN, expires_at: "2027-02-18T22:00:00.000Z" }],
      [204, null],
      [200, [{ id: "5", scope: "escort", subject_id: "2", created_by: "1", created_at: "2026-11-01T10:00:00Z", expires_at: "2027-02-18T22:00:00.000Z", revoked_at: null }]],
    ]);
    const l = new SupabaseLinks(sb);
    expect(await l.issue(7, "escort", 2)).toEqual({ link_id: 5, token: TOKEN, expires_at: "2027-02-18T22:00:00.000Z" });
    await l.revoke(5);
    expect(await l.list(7)).toEqual([
      { id: 5, scope: "escort", subject_id: 2, created_by: 1, created_at: "2026-11-01T10:00:00Z", expires_at: "2027-02-18T22:00:00.000Z", revoked_at: null },
    ]);
    expect(sent.map((r) => [r.path, r.body])).toEqual([
      ["/rest/v1/rpc/issue_link", { p_edition: 7, p_scope: "escort", p_subject: 2 }],
      ["/rest/v1/rpc/revoke_link", { p_link: 5 }],
      ["/rest/v1/share_links", null],
    ]);
    const select = new URL(sent[2].url).searchParams.get("select")!;
    expect(select.split(",")).toEqual(["id", "scope", "subject_id", "created_by", "created_at", "expires_at", "revoked_at"]);
  });

  it("call every kk function by its parameter names", async () => {
    const { sb, sent } = client([[200, { tracks: [], groups: [], leaders: [], signups: [], orders: [] }], [200, 12], [204, null], [204, null], [204, null], [204, null], [204, null], [204, null]]);
    const k = new SupabaseKk(sb);
    await k.load(7);
    expect(await k.addGroup(7, 1, 1290, { title: "ספר לדוגמה", capacity: 8, leaders: [{ kind: "trainee", roster_id: 3 }] })).toBe(12);
    await k.updateGroup(12, { open: false });
    await k.deleteGroup(12);
    await k.place(12, 3);
    await k.unplace(4, 3);
    await k.setWindow(7, "2027-01-01T08:00:00.000Z", "2027-01-15T20:00:00.000Z");
    await k.setBookOrder(12, 8, true);
    expect(sent.map((r) => [r.path.replace("/rest/v1/rpc/", ""), r.body])).toEqual([
      ["load_kk", { p_edition: 7 }],
      ["kk_add_group", { p_edition: 7, p_day: 1, p_start: 1290, p_fields: { title: "ספר לדוגמה", capacity: 8, leaders: [{ kind: "trainee", roster_id: 3 }] } }],
      ["kk_update_group", { p_group: 12, p_patch: { open: false } }],
      ["kk_delete_group", { p_group: 12 }],
      ["kk_place", { p_group: 12, p_roster: 3 }],
      ["kk_unplace", { p_track: 4, p_roster: 3 }],
      ["kk_set_window", { p_edition: 7, p_opens: "2027-01-01T08:00:00.000Z", p_closes: "2027-01-15T20:00:00.000Z" }],
      ["set_book_order", { p_group: 12, p_copies: 8, p_ordered: true }],
    ]);
  });
});

describe("the links' rules", () => {
  it("expire with the week in Israel, 30 days after issue while TBD, the sign-up link with its window", () => {
    const at = "2026-11-01T10:00:00.000Z";
    expect(linkExpiry({ start_date: "2027-02-14", settings: {} }, "escort", at)).toBe("2027-02-18T22:00:00.000Z");
    expect(linkExpiry({ start_date: null, settings: {} }, "schedule", at)).toBe("2026-12-01T10:00:00.000Z");
    expect(linkExpiry({ start_date: "2027-02-14", settings: {} }, "kk_signup", at)).toBe("2026-12-01T10:00:00.000Z");
    expect(linkExpiry({ start_date: null, settings: { kk_window: { opens_at: at, closes_at: "2027-01-15T20:00:00.000Z" } } }, "kk_signup", at)).toBe("2027-01-15T20:00:00.000Z");
    expect(linkState({ expires_at: "2027-01-01T00:00:00Z", revoked_at: null }, "2026-12-31T23:59:59Z")).toBe("live");
    expect(linkState({ expires_at: "2027-01-01T00:00:00Z", revoked_at: null }, "2027-01-01T00:00:00Z")).toBe("expired");
    expect(linkState({ expires_at: "2027-01-01T00:00:00Z", revoked_at: "2026-12-01T00:00:00Z" }, "2026-12-02T00:00:00Z")).toBe("revoked");
  });

  it("make 128-bit base64url tokens and put them after '#'", () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomToken()).not.toBe(t);
    expect(tokenShape(t)).toBe(true);
    expect(tokenShape("short")).toBe(false);
    expect(tokenShape(null)).toBe(false);
    expect(linkUrl("https://volozhin-week.pages.dev", "escort", t)).toBe(`https://volozhin-week.pages.dev/e#${t}`);
    expect(linkUrl("https://x.example", "kk_signup", t)).toBe(`https://x.example/k#${t}`);
    expect(linkUrl("https://x.example", "schedule", t)).toBe(`https://x.example/s#${t}`);
  });

  it("clean a group's fields as the database does", () => {
    const yes = () => true;
    expect(cleanGroupFields({ title: " ספר  א ", author: "", capacity: 3, ignored: 1 }, yes, yes)).toEqual({ title: "ספר א", author: null, capacity: 3 });
    const fails = (f: unknown, room = yes, trainee = yes) => {
      try {
        cleanGroupFields(f, room, trainee);
        return "ok";
      } catch (e) {
        return (e as CommandError).code;
      }
    };
    expect(fails({ title: " " })).toBe("title_required");
    expect(fails({ title: 5 })).toBe("title_required");
    expect(fails({ capacity: 0 })).toBe("bad_value");
    expect(fails({ room_id: 4 }, () => false)).toBe("bad_value");
    expect(fails({ leaders: [{ kind: "trainee", roster_id: 3 }] }, yes, () => false)).toBe("bad_trainee");
    expect(fails({ leaders: [{ kind: "staff", label: "א".repeat(81) }] })).toBe("bad_value");
    expect(fails([])).toBe("bad_value");
  });
});

describe("the demo's links, sign-ups and public pages", () => {
  it("open a seeded link's page, refuse a revoked one, and open a token issued in another tab", async () => {
    const p = new DemoPort();
    const w = await p.loadWeek(1);
    const escort = w.lessons.find((l) => l.state === "closed" && l.escort_roster_id != null)!.escort_roster_id!;
    const seeded = demoToken("escort", 1, escort, true);
    const v = await p.public.escortView(seeded);
    expect(v.lessons.length).toBeGreaterThan(0);
    expect(v.lessons.every((l) => l.phone === null)).toBe(true); // the demo's week is TBD
    const links = await p.links.list(1);
    expect(links.filter((l) => l.scope === "escort").length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(links)).not.toContain("dugma");
    const issued = await p.links.issue(1, "escort", escort);
    expect(await code(p.public.escortView(seeded))).toBe("link_invalid"); // replaced
    expect((await p.public.escortView(issued.token)).escort.full_name).toBe(v.escort.full_name);
    await p.links.revoke(issued.link_id);
    expect(await code(p.public.escortView(issued.token))).toBe("link_invalid");
    // a fresh demo (another tab) never saw it issued: the token says what it opens
    const elsewhere = new DemoPort();
    expect((await elsewhere.public.escortView(issued.token)).escort.full_name).toBe(v.escort.full_name);
    expect(await code(elsewhere.public.escortView("demo-e-1-999-abcdefghij"))).toBe("link_invalid");
    expect(await code(elsewhere.public.escortView("garbage-garbage-garbage"))).toBe("link_invalid");
  });

  it("let the class sign up once through its link, and reach the team's Week with the ticks", async () => {
    const p = new DemoPort();
    const k = demoToken("kk_signup", 1, null, true);
    const f = await p.public.kkForm(k);
    expect(f.open).toBe(true);
    const free = f.roster.find((r) => !(p.shared.kk.signups.some((s) => s.roster_id === r.id)))!;
    const [first, second] = f.tracks[0].groups;
    await p.public.kkSignup(k, free.id, first.id);
    await p.public.kkSignup(k, free.id, second.id); // never changed through the link
    expect(p.shared.kk.signups.filter((s) => s.roster_id === free.id).map((s) => s.group_id)).toEqual([first.id]);
    expect((await p.kk.load(1)).signups.some((s) => s.roster_id === free.id && s.via === "link")).toBe(true);
    const w = await p.loadWeek(1);
    const l = w.lessons.find((x) => x.state === "closed" && x.escort_roster_id != null)!;
    await p.public.escortTick(demoToken("escort", 1, l.escort_roster_id, true), l.id, "introduced", true);
    expect((await p.loadWeek(1)).escortTicks.some((t) => t.lesson_id === l.id && t.item === "introduced")).toBe(true);
    const s = await p.public.scheduleView(demoToken("schedule", 1, null, true));
    expect(s.rows.length).toBeGreaterThan(0);
  });

  it("take a deleted trainee's link, sign-ups and ticks along; a new date moves the links' expiry", async () => {
    const p = new DemoPort();
    const w = await p.loadWeek(1);
    const r = w.escortTicks[0] ? w.lessons.find((l) => l.id === w.escortTicks[0].lesson_id)!.escort_roster_id! : 1;
    expect(p.shared.links.some((l) => l.subject_id === r && l.revoked_at == null)).toBe(true);
    await p.settings.deleteRoster(r);
    const after = await p.loadWeek(1);
    expect(after.escortTicks.filter((t) => w.lessons.find((l) => l.id === t.lesson_id)?.escort_roster_id === r)).toEqual([]);
    expect(p.shared.links.some((l) => l.subject_id === r)).toBe(false);
    expect(p.shared.kk.signups.some((s) => s.roster_id === r)).toBe(false);
    expect(await code(p.public.escortView(demoToken("escort", 1, r, true)))).toBe("link_invalid");
    // the demo edition is a demo: its date may change only through a real edition's tab — start one and date it
    const id = await p.settings.startEdition({ label: "תשפ״ח לדוגמה", start_date: null, first_day_from: null });
    await p.settings.addRoster(id, [{ full_name: "חניך/ה לדוגמה", gender: null }]);
    const trainee = (await p.settings.roster(id))[0].id;
    const link = await p.links.issue(id, "escort", trainee);
    await p.settings.updateEdition(id, { start_date: "2027-02-14" });
    expect((await p.links.list(id)).find((l) => l.id === link.link_id)!.expires_at).toBe("2027-02-18T22:00:00.000Z");
  });
});
