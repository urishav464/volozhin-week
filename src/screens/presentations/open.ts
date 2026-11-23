// Opening an uploaded file (the reset, phase 5) — the presentations' and every file row's (SourceFiles.tsx FileRow): a
// PDF or a picture opens in a new tab from a signed URL, as it always did; a PowerPoint or a Word file is fetched and
// handed over under its own name (`display_name`), so it lands as «המצגת של פלונית.pptx» and opens in PowerPoint —
// not as the stored ASCII name a signed URL would save it under. Nothing is kept: the Blob is dropped once the browser
// has taken it.
import { CommandError } from "../../data/commands";
import type { DataPort } from "../../data/port";
import { parseSourcePath, printableMime } from "../../data/sourceRules";
import type { SourceFile } from "../../domain/types";
import { download, storedFileName } from "../../exports/download";

/** What the file's button does: «פתיחה» (a PDF or a picture, in a new tab) or «הורדה» (pptx, docx). */
export function fileAction(f: Pick<SourceFile, "mime">): "open" | "download" {
  return printableMime(f.mime) ? "open" : "download";
}

/** Opens or downloads one file; refused or unread: a CommandError («read_failed»). */
export async function openOrDownload(port: Pick<DataPort, "sources">, editionId: number, f: Pick<SourceFile, "storage_path" | "mime" | "display_name">): Promise<"open" | "download"> {
  const url = (await port.sources.urls(editionId, [f.storage_path])).get(f.storage_path);
  if (!url) throw new CommandError("read_failed");
  if (fileAction(f) === "open") {
    window.open(url, "_blank", "noopener,noreferrer");
    return "open";
  }
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new CommandError("read_failed");
  }
  if (!res.ok) throw new CommandError("read_failed");
  // its own name, with the extension of what is stored (a display name's own extension, or none, is never trusted)
  download(storedFileName(f.display_name, parseSourcePath(f.storage_path)?.ext), await res.blob(), f.mime);
  return "download";
}
