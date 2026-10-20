// What the archive reads before it zips (src/exports/archive.ts), through the
// port: the week, the outputs' extras, מכריכה לכריכה, the fallen the caller
// reads (names only — an admin: the whole cross-year list) and — one fallen at a
// time, admins only — the families' contact persons of the fallen THIS edition
// has a plan for, never another year's (as the speakers' contacts are only the
// speakers the edition touched); and, when «כולל קבצי המקורות» is asked for, the sources' bytes
// through signed URLs a batch at a time (a file that cannot be read is skipped
// and named, never silently left out). A cancel stops between files.
import type { DataPort } from "../data/port";
import type { Week } from "../domain/types";
import type { ArchiveExtras } from "../data/outputs";
import { type ArchiveMore, plannedFallen } from "./archive";

export async function gatherArchive(port: DataPort, editionId: number, touchedSpeakers: (w: Week) => number[]): Promise<{ week: Week; extras: ArchiveExtras; more: ArchiveMore }> {
  const week = await port.loadWeek(editionId);
  const extras = await port.outputs.archiveExtras(editionId, touchedSpeakers(week), week.lessons.map((l) => l.id));
  const kk = await port.kk.load(editionId);
  const fallen = await port.memorial.fallen();
  const fallenContacts: ArchiveMore["fallenContacts"] = [];
  for (const id of plannedFallen(week)) {
    const c = await port.memorial.contacts(id); // null: not the caller's to see
    if (c && Object.values(c).some((v) => v != null)) fallenContacts.push({ fallen_id: id, ...c });
  }
  return { week, extras, more: { kk, fallen, fallenContacts, sources: null } };
}


export interface SourcesProgress {
  done: number;
  total: number;
}

/** The sources' bytes by file id, and the files that could not be read. Throws an AbortError when cancelled. */
export async function fetchSources(port: DataPort, week: Week, signal: AbortSignal, onProgress: (p: SourcesProgress) => void): Promise<NonNullable<ArchiveMore["sources"]>> {
  const files = [...(week.sourceFiles ?? [])].sort((a, b) => a.id - b.id);
  const bytes = new Map<number, Uint8Array>();
  const skipped: { id: number; name: string }[] = [];
  const stop = () => {
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");
  };
  let done = 0;
  onProgress({ done, total: files.length });
  for (let i = 0; i < files.length; i += 20) {
    stop();
    const batch = files.slice(i, i + 20);
    let urls = new Map<string, string>();
    try {
      urls = await port.sources.urls(week.edition.id, batch.map((f) => f.storage_path));
    } catch {
      // no addresses for this batch: each of its files is named as not read
    }
    for (const f of batch) {
      stop();
      const url = urls.get(f.storage_path);
      try {
        if (!url) throw new Error("no url");
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(String(res.status));
        bytes.set(f.id, new Uint8Array(await res.arrayBuffer()));
      } catch {
        stop();
        skipped.push({ id: f.id, name: f.display_name });
      }
      onProgress({ done: ++done, total: files.length });
    }
  }
  return { bytes, skipped };
}
