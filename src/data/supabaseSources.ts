// The sources' files against the real project (milestone 5ב-1): the bytes go
// straight to Supabase Storage — a POST to /storage/v1/object/sources/<path>
// with the member's own session token (never a service key), so the policies
// on storage.objects decide — and the row through register_source_file. The
// upload is an XMLHttpRequest, for its progress events (fetch has none for a
// request body). Reading is by signed URL, a few minutes long — the bucket is
// private, there is no public URL to give. Removing: the stored object first,
// then remove_source_file (which refuses while the object is still there).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceFile } from "../domain/types";
import { CommandError } from "./commands";
import { checkPicked, SOURCES_BUCKET, sourcePath } from "./sourceRules";
import { SIGNED_URL_SECONDS, type SourcesPort, type UploadOptions } from "./sources";
import { callRpc } from "./supabaseCommands";

export interface UploadRequest {
  url: string;
  headers: Record<string, string>;
  body: Blob;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** One HTTP upload: the status and the body the Storage API answered. */
export type Send = (req: UploadRequest) => Promise<{ status: number; body: string }>;

/** The browser's XMLHttpRequest, with upload progress and abort. */
export const xhrSend: Send = (req) =>
  new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", req.url);
    for (const [k, v] of Object.entries(req.headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => {
      if (e.lengthComputable) req.onProgress?.(e.loaded / e.total);
    };
    x.onload = () => resolve({ status: x.status, body: x.responseText });
    x.onerror = () => reject(new CommandError("upload_failed"));
    x.onabort = () => reject(new DOMException("aborted", "AbortError"));
    req.signal?.addEventListener("abort", () => x.abort(), { once: true });
    x.send(req.body);
  });

/**
 * What the Storage API's refusal means (its body is {statusCode, error, message}, sent under HTTP 400 by older
 * versions): 403 — the policies said no (upload_refused); 413 / 415 — the bucket's size or types (bad_file);
 * anything else — the upload did not complete (upload_failed).
 */
export function uploadRefusal(status: number, body: string): string {
  let code = status;
  try {
    const j = JSON.parse(body) as { statusCode?: string | number; error?: string; message?: string };
    if (j.statusCode != null && Number(j.statusCode) > 0) code = Number(j.statusCode);
    if (/row-level security/i.test(j.message ?? "")) code = 403;
  } catch {
    // not JSON — the HTTP status says it
  }
  if (code === 401 || code === 403) return "upload_refused";
  if (code === 413 || code === 415) return "bad_file";
  return "upload_failed";
}

const toFile = (r: Record<string, unknown>): SourceFile => ({
  id: Number(r.id),
  lesson_id: r.lesson_id == null ? null : Number(r.lesson_id),
  cover: r.cover === true,
  speaker_id: r.speaker_id == null ? null : Number(r.speaker_id),
  storage_path: String(r.storage_path),
  display_name: String(r.display_name),
  mime: r.mime as SourceFile["mime"],
  size_bytes: Number(r.size_bytes),
  page_count: r.page_count == null ? null : Number(r.page_count),
  uploaded_by: r.uploaded_by == null ? null : Number(r.uploaded_by),
  uploaded_at: String(r.uploaded_at),
});

export class SupabaseSources implements SourcesPort {
  constructor(
    private readonly sb: SupabaseClient,
    private readonly url: string,
    private readonly key: string,
    private readonly send: Send = xhrSend,
    private readonly uuid: () => string = () => crypto.randomUUID(),
    /** The member's own access token (supabase-js refreshes it) — never a service key. */
    private readonly token: () => Promise<string | null> = async () => (await sb.auth.getSession()).data.session?.access_token ?? null,
  ) {}

  private bucket() {
    return this.sb.storage.from(SOURCES_BUCKET);
  }

  async upload(editionId: number, lessonId: number | null, file: File, opts: UploadOptions): Promise<SourceFile> {
    const mime = checkPicked(file, lessonId == null);
    const path = sourcePath(editionId, lessonId, this.uuid(), file.name, mime);
    const token = await this.token();
    if (!token) throw new CommandError("not_member");
    const res = await this.send({
      url: `${this.url.replace(/\/+$/, "")}/storage/v1/object/${SOURCES_BUCKET}/${path}`,
      headers: { authorization: `Bearer ${token}`, apikey: this.key, "content-type": mime, "x-upsert": "false", "cache-control": "max-age=3600" },
      body: file,
      onProgress: opts.onProgress,
      signal: opts.signal,
    });
    if (res.status < 200 || res.status >= 300) throw new CommandError(uploadRefusal(res.status, res.body));
    try {
      const row = await callRpc(this.sb, "register_source_file", {
        p_edition: editionId, p_lesson: lessonId, p_path: path, p_display_name: file.name, p_pages: opts.pages,
      });
      return toFile(row as Record<string, unknown>);
    } catch (e) {
      // the row was refused: the stored object is the uploader's to delete (app.may_delete_source) — leave nothing behind
      await this.bucket().remove([path]).catch(() => undefined);
      throw e;
    }
  }

  async remove(_editionId: number, file: Pick<SourceFile, "id" | "storage_path">): Promise<void> {
    const { error } = await this.bucket().remove([file.storage_path]);
    if (error) throw new CommandError("remove_failed");
    await callRpc(this.sb, "remove_source_file", { p_file: file.id });
  }

  async urls(_editionId: number, paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (paths.length === 0) return out;
    const { data, error } = await this.bucket().createSignedUrls(paths, SIGNED_URL_SECONDS);
    if (error) throw new CommandError("read_failed");
    for (const r of data ?? []) if (r.path && r.signedUrl && !r.error) out.set(r.path, r.signedUrl);
    return out;
  }

  async setHeaders(editionId: number, left: string | null, right: string | null): Promise<void> {
    await callRpc(this.sb, "set_reader_headers", { p_edition: editionId, p_left: left, p_right: right });
  }

  async setCover(editionId: number, fileId: number | null): Promise<void> {
    await callRpc(this.sb, "set_reader_cover", { p_edition: editionId, p_file: fileId });
  }
}
