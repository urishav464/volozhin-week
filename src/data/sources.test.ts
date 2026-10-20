// The sources' files outside the database: the path convention and its twin
// in schema.sql, the stored name (never the Hebrew original), the type and size
// checks, the rule that turns a lesson's reader on; SupabaseSources on the wire
// (the real supabase-js client and a stub fetch, a stub upload): the upload to
// /storage/v1/object/sources/<path> with the member's bearer, register by its
// parameter names, a refused registration that cleans the object up, removal
// in its order, signed URLs; and DemoSources running the same rules.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { CommandError } from "./commands";
import { DemoPort } from "./demoPort";
import {
  arrived, checkPicked, cleanDisplayName, DOCX, MAX_SOURCE_BYTES, mimeMatches, mimeOfFile, pagesFor, parseSourcePath, safeName, SOURCE_PATH_RE, sourcePath,
} from "./sourceRules";
import { SupabaseSources, uploadRefusal, type UploadRequest } from "./supabaseSources";

const code = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("the path convention", () => {
  it("is the same pattern as app.source_path_re in schema.sql", () => {
    const sql = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
    const m = /create or replace function app\.source_path_re\(\)[\s\S]*?select '([^']+)'/.exec(sql);
    expect(m?.[1]).toBe(SOURCE_PATH_RE.source.replaceAll("\\/", "/"));
  });

  it("stores a safe ASCII name — never the original, which stays the display name", () => {
    expect(safeName("מקורות לשיעור.pdf", "application/pdf")).toBe("file.pdf");
    expect(safeName("Sources 2027 (final).PDF", "application/pdf")).toBe("Sources-2027-final.pdf");
    expect(safeName("a.b.c.docx", DOCX)).toBe("a-b-c.docx");
    expect(safeName("צילום IMG_0042.jpeg", "image/jpeg")).toBe("IMG_0042.jpg");
    expect(safeName(`${"x".repeat(80)}.png`, "image/png")).toBe(`${"x".repeat(60)}.png`);
    expect(safeName("---.pdf", "application/pdf")).toBe("file.pdf");
    const p = sourcePath(7, 42, UUID.toUpperCase(), "מקורות.pdf", "application/pdf");
    expect(p).toBe(`7/42/${UUID}-file.pdf`);
    expect(SOURCE_PATH_RE.test(p)).toBe(true);
    expect(parseSourcePath(p)).toEqual({ edition: 7, lesson: 42, ext: "pdf" });
    expect(parseSourcePath(sourcePath(7, null, UUID, "poster.png", "image/png"))).toEqual({ edition: 7, lesson: null, ext: "png" });
    for (const bad of [`7/42/${UUID}-מקורות.pdf`, `7/42/x-file.pdf`, `07/42/${UUID}-a.pdf`, `7/42/9/${UUID}-a.pdf`, `7/42/${UUID}-a.exe`]) expect(parseSourcePath(bad), bad).toBeNull();
  });

  it("takes PDF, Word, PNG and JPEG up to 25 MB — by the browser's type, or the name when the browser gives none", async () => {
    expect(mimeOfFile({ name: "a.pdf", type: "application/pdf" })).toBe("application/pdf");
    expect(mimeOfFile({ name: "a.docx", type: "" })).toBe(DOCX);
    expect(mimeOfFile({ name: "a.JPG", type: "application/octet-stream" })).toBe("image/jpeg");
    expect(mimeOfFile({ name: "a.pdf", type: "text/plain" })).toBeNull();
    expect(mimeOfFile({ name: "a.exe", type: "" })).toBeNull();
    expect(checkPicked({ name: "a.pdf", type: "application/pdf", size: MAX_SOURCE_BYTES }, false)).toBe("application/pdf");
    expect(await code(() => checkPicked({ name: "a.pdf", type: "application/pdf", size: MAX_SOURCE_BYTES + 1 }, false))).toBe("bad_file");
    expect(await code(() => checkPicked({ name: "a.docx", type: DOCX, size: 10 }, true))).toBe("bad_file"); // never a Word poster
    expect(mimeMatches("image/jpeg", "jpeg")).toBe(true);
    expect(mimeMatches("image/png", "pdf")).toBe(false);
  });

  it("counts pages as register_source_file does, and cleans the display name", async () => {
    expect(pagesFor("application/pdf", 12)).toBe(12);
    expect(pagesFor("application/pdf", null)).toBeNull();
    expect(pagesFor("image/png", 9)).toBe(1);
    expect(pagesFor(DOCX, 9)).toBeNull();
    expect(await code(() => pagesFor("application/pdf", 0))).toBe("bad_value");
    expect(await code(() => pagesFor("application/pdf", 5001))).toBe("bad_value");
    expect(cleanDisplayName("  דף   מקורות.pdf ")).toBe("דף מקורות.pdf");
    expect(await code(() => cleanDisplayName("   "))).toBe("bad_value");
  });

  it("turns a lesson's reader on with the speaker's first file — never a presentation alone, never against a later «off»", () => {
    expect(arrived({ sources_kind: "pending", in_reader: false }, true)).toEqual({ sources_kind: "sheet", in_reader: true });
    expect(arrived({ sources_kind: "sheet_video", in_reader: false }, true)).toEqual({ sources_kind: "sheet_video", in_reader: true });
    expect(arrived({ sources_kind: "sheet", in_reader: false }, false)).toEqual({ sources_kind: "sheet", in_reader: false });
    expect(arrived({ sources_kind: "presentation", in_reader: false }, true)).toEqual({ sources_kind: "presentation", in_reader: false });
    expect(arrived({ sources_kind: "none", in_reader: false }, true)).toEqual({ sources_kind: "none", in_reader: false });
  });
});

interface Sent {
  method: string;
  path: string;
  body: unknown;
  auth: string | null;
}

function wire(answers: [number, unknown][], upload: { status: number; body: string } = { status: 200, body: "{}" }) {
  const sent: Sent[] = [];
  const uploads: UploadRequest[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const text = await req.text();
    sent.push({ method: req.method, path: new URL(req.url).pathname, body: text ? JSON.parse(text) : null, auth: req.headers.get("authorization") });
    const [status, body] = answers.shift() ?? [404, {}];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  const sb = createClient("https://stub.supabase.co", "stub-publishable-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch } });
  const sources = new SupabaseSources(sb, "https://stub.supabase.co", "stub-publishable-key", async (r) => (uploads.push(r), upload), () => UUID, async () => "member-access-token");
  return { sources, sent, uploads };
}

const ROW = { id: "5", lesson_id: "42", cover: false, speaker_id: "9", storage_path: `7/42/${UUID}-file.pdf`, display_name: "מקורות.pdf", mime: "application/pdf", size_bytes: "1234", page_count: 3, uploaded_by: "2", uploaded_at: "2026-11-01T10:00:00.000Z" };
const pdf = (name = "מקורות.pdf", size = 1234) => new File([new Uint8Array(size)], name, { type: "application/pdf" });

describe("SupabaseSources on the wire", () => {
  it("uploads to the private bucket at the convention's path with the member's token, then registers it by name", async () => {
    const { sources, sent, uploads } = wire([[200, ROW]]);
    const seen: number[] = [];
    const row = await sources.upload(7, 42, pdf(), { pages: 3, onProgress: (f) => seen.push(f) });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].url).toBe(`https://stub.supabase.co/storage/v1/object/sources/7/42/${UUID}-file.pdf`);
    expect(uploads[0].headers).toMatchObject({ authorization: "Bearer member-access-token", apikey: "stub-publishable-key", "content-type": "application/pdf", "x-upsert": "false" });
    expect(sent.map((r) => [r.method, r.path, r.body])).toEqual([
      ["POST", "/rest/v1/rpc/register_source_file", { p_edition: 7, p_lesson: 42, p_path: `7/42/${UUID}-file.pdf`, p_display_name: "מקורות.pdf", p_pages: 3 }],
    ]);
    expect(row).toEqual({ ...ROW, id: 5, lesson_id: 42, speaker_id: 9, size_bytes: 1234, uploaded_by: 2 });
  });

  it("checks the file before sending it, and reads the Storage API's refusals", async () => {
    const { sources, uploads } = wire([]);
    expect(await code(sources.upload(7, 42, new File(["x"], "a.exe", { type: "application/x-msdownload" }), { pages: null }))).toBe("bad_file");
    expect(uploads).toHaveLength(0);
    expect(uploadRefusal(400, JSON.stringify({ statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" }))).toBe("upload_refused");
    expect(uploadRefusal(403, "")).toBe("upload_refused");
    expect(uploadRefusal(413, JSON.stringify({ statusCode: "413", error: "Payload too large" }))).toBe("bad_file");
    expect(uploadRefusal(400, JSON.stringify({ statusCode: "415", error: "invalid_mime_type" }))).toBe("bad_file");
    expect(uploadRefusal(500, "oops")).toBe("upload_failed");
    const refused = wire([], { status: 400, body: JSON.stringify({ statusCode: "403", message: "new row violates row-level security policy" }) });
    expect(await code(refused.sources.upload(7, 42, pdf(), { pages: 1 }))).toBe("upload_refused");
    expect(refused.sent).toHaveLength(0); // nothing registered
  });

  it("deletes its own upload when the database refuses the registration, and says why", async () => {
    const { sources, sent } = wire([[400, { code: "P0001", message: "not_closed" }], [200, [{ name: `7/42/${UUID}-file.pdf` }]]]);
    expect(await code(sources.upload(7, 42, pdf(), { pages: 1 }))).toBe("not_closed");
    expect(sent.map((r) => [r.method, r.path, r.body])).toEqual([
      ["POST", "/rest/v1/rpc/register_source_file", expect.anything()],
      ["DELETE", "/storage/v1/object/sources", { prefixes: [`7/42/${UUID}-file.pdf`] }],
    ]);
  });

  it("removes the stored object first, then the row; reads by signed URL; sets the reader's headers and cover", async () => {
    const { sources, sent } = wire([
      [200, [{ name: ROW.storage_path }]],
      [200, null],
      [200, [{ error: null, path: ROW.storage_path, signedURL: `/object/sign/sources/${ROW.storage_path}?token=t` }]],
      [200, null],
      [200, null],
    ]);
    await sources.remove(7, { id: 5, storage_path: ROW.storage_path });
    const urls = await sources.urls(7, [ROW.storage_path]);
    expect(urls.get(ROW.storage_path)).toBe(`https://stub.supabase.co/storage/v1/object/sign/sources/${ROW.storage_path}?token=t`);
    await sources.setHeaders(7, "שמאל", null);
    await sources.setCover(7, null);
    expect(sent.map((r) => [r.method, r.path, r.body])).toEqual([
      ["DELETE", "/storage/v1/object/sources", { prefixes: [ROW.storage_path] }],
      ["POST", "/rest/v1/rpc/remove_source_file", { p_file: 5 }],
      ["POST", "/storage/v1/object/sign/sources", { expiresIn: 600, paths: [ROW.storage_path] }],
      ["POST", "/rest/v1/rpc/set_reader_headers", { p_edition: 7, p_left: "שמאל", p_right: null }],
      ["POST", "/rest/v1/rpc/set_reader_cover", { p_edition: 7, p_file: null }],
    ]);
  });
});

describe("DemoSources", () => {
  const closedPending = (port: DemoPort) => {
    const w = port.engine(1).week;
    return w.lessons.find((l) => l.state === "closed" && l.kind === "lesson" && l.sources_kind === "pending" && !w.sourceFiles.some((f) => f.lesson_id === l.id))!;
  };

  it("uploads into the engine's bucket and registers — the lesson's sources arrive and it goes into the reader", async () => {
    const port = new DemoPort();
    const l = closedPending(port);
    const v0 = l.version;
    const row = await port.sources.upload(1, l.id, pdf("דף.pdf", 2048), { pages: 2 });
    expect(row).toMatchObject({ lesson_id: l.id, display_name: "דף.pdf", page_count: 2, size_bytes: 2048, uploaded_by: 1, cover: false });
    expect(parseSourcePath(row.storage_path)).toEqual({ edition: 1, lesson: l.id, ext: "pdf" });
    const after = (await port.loadWeek(1)).lessons.find((x) => x.id === l.id)!;
    expect(after).toMatchObject({ sources_kind: "sheet", in_reader: true, version: v0 + 1 });
    expect((await port.loadWeek(1)).sourceFiles.some((f) => f.id === row.id)).toBe(true);
    // removal: the object, then the row
    await port.sources.remove(1, row);
    expect((await port.loadWeek(1)).sourceFiles.some((f) => f.id === row.id)).toBe(false);
  });

  it("refuses what production refuses: a draft, logistics, another member's file", async () => {
    const port = new DemoPort();
    const w = port.engine(1).week;
    const draft = w.lessons.find((l) => l.state === "draft" && l.kind === "lesson")!;
    expect(await code(port.sources.upload(1, draft.id, pdf(), { pages: 1 }))).toBe("upload_refused");
    const logistics = new DemoPort({ memberId: 5, role: "logistics" });
    expect(await code(logistics.sources.upload(1, closedPending(logistics).id, pdf(), { pages: 1 }))).toBe("upload_refused");
    const member = new DemoPort({ memberId: 3, role: "content" });
    const seeded = member.engine(1).week.sourceFiles.find((f) => f.uploaded_by === 2)!;
    expect(await code(member.sources.remove(1, seeded))).toBe("not_uploader");
    expect(member.engine(1).week.sourceFiles.some((f) => f.id === seeded.id)).toBe(true);
    expect(await code(member.sources.setHeaders(1, "x", "y"))).toBe("forbidden");
  });

  it("keeps the reader's headers and cover as the admin set them", async () => {
    const port = new DemoPort();
    await port.sources.setHeaders(1, "  שמאל ", "");
    expect((await port.loadWeek(1)).edition.settings.reader_headers).toEqual(["שמאל", ""]);
    await port.sources.setHeaders(1, null, null);
    expect((await port.loadWeek(1)).edition.settings.reader_headers).toBeUndefined();
    const poster = await port.sources.upload(1, null, new File([new Uint8Array(10)], "poster.png", { type: "image/png" }), { pages: null });
    expect(poster).toMatchObject({ cover: true, lesson_id: null, page_count: 1 });
    expect((await port.loadWeek(1)).edition.settings.reader_cover).toBe(poster.id);
    expect(await code(port.sources.setCover(1, port.engine(1).week.sourceFiles[0].id))).toBe("bad_value"); // a lesson's file is not a poster
  });
});
