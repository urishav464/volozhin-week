// A file's place on the hall's computer (v20): its folder and its name in the week's zip — the ONE naming
// (`presentationEntries`) the zip writes. Shown on «מצגות» (what came since the download, what did not come, a part too big
// for one file), beside each deck of the week and on the lesson page. `EntryList`'s «הורדה» saves a file under that very
// name, so a file copied on its own lands beside the others as the zip would have put it.
import { useId, useState } from "react";
import { CommandError } from "../../data/commands";
import type { DataPort } from "../../data/port";
import { splitEntry } from "../../domain/presentationNames";
import type { SourceFile, Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Button } from "../settings/kit";
import type { Notify } from "../speakers/parts";
import { downloadAs } from "./open";

/** «2-שני / 1030_בית מדרש_שקפים.pdf» — each part isolated (a room or a name may be in Latin letters). */
export function HallPath({ path, id }: { path: string; id?: string }) {
  const { folder, name } = splitEntry(path);
  return (
    <span id={id} data-hall-path={path} className="min-w-0 break-words">
      {folder && (
        <>
          <bdi>{folder}</bdi>
          {" / "}
        </>
      )}
      <bdi className="font-semibold">{name}</bdi>
    </span>
  );
}

export interface EntryListProps {
  port: DataPort;
  week: Week;
  /** The files to list, in the zip's order. */
  ids: readonly number[];
  /** presentationEntries(week). */
  entries: ReadonlyMap<number, string>;
  label: string;
  notify: Notify;
  clear: () => void;
}

/** Files of the week's zip, each with its folder, its name and «הורדה» under that name. */
export function EntryList({ port, week, ids, entries, label, notify, clear }: EntryListProps) {
  const files = new Map((week.sourceFiles ?? []).map((f) => [f.id, f]));
  const rows = ids.flatMap((id) => {
    const file = files.get(id);
    const path = entries.get(id);
    return file && path ? [{ file, path }] : [];
  });
  if (rows.length === 0) return null;
  return (
    <ul aria-label={label} className="divide-y divide-line">
      {rows.map(({ file, path }) => (
        <EntryRow key={file.id} port={port} editionId={week.edition.id} file={file} path={path} notify={notify} clear={clear} />
      ))}
    </ul>
  );
}

function EntryRow({ port, editionId, file, path, notify, clear }: { port: DataPort; editionId: number; file: SourceFile; path: string; notify: Notify; clear: () => void }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    clear();
    setBusy(true);
    try {
      await downloadAs(port, editionId, file, splitEntry(path).name);
    } catch (e) {
      notify("error", errorMessage(e instanceof CommandError ? e.code : "read_failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li data-entry-row={file.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm">
      <span className="min-w-0 flex-1 basis-48">
        <HallPath id={`${id}-path`} path={path} />
      </span>
      <Button data-entry-download={file.id} aria-describedby={`${id}-path`} busy={busy} busyLabel="מוריד…" onClick={() => void save()}>
        הורדה
      </Button>
    </li>
  );
}
