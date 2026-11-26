// One presentation in a list (the reset, phase 5 — the week's deck, the lesson page, the presentations without a lesson): its
// name, its type and size, who uploaded it and when, its place on the hall's computer (v20: its folder and name in the week's
// zip), «חדש מאז ההורדה» when this device's last download did not hold it,
// «פתיחה» (a PDF or a picture, in a new tab) or «הורדה» (PowerPoint or Word, under its own name), and «הסרה» for whoever
// may remove it (the uploader, or an admin — mayRemove ≡ remove_source_file), asked once.
import { type ReactNode, useState } from "react";
import { CommandError } from "../../data/commands";
import type { DataPort } from "../../data/port";
import { DOCX, PPTX, sizeText } from "../../data/sourceRules";
import type { PresentationState } from "../../domain/presentations";
import type { SourceFile, Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Badge, Button, Confirm, useFocusBack } from "../settings/kit";
import type { Notify } from "../speakers/parts";
import { LINK_BUTTON, memberName, whenText } from "../stages/parts";
import { mayRemove } from "../stages/SourceFiles";
import type { Actor } from "../weekStore";
import { HallPath } from "./HallPath";
import { fileAction, openOrDownload } from "./open";

/** The state's chip (PRESENTATION_STATE_LABEL) — on the lesson page and «חסרות» alike. */
export const PRESENTATION_TONE: Record<PresentationState, "ok" | "accent" | "bad" | "muted" | "neutral"> = { file: "ok", link: "accent", missing: "bad", none: "muted", memorial: "neutral" };

/** A lesson's link (`presentation_url`, http(s) only): «פתיחת הקישור» in a new tab, and the address itself. */
export function PresentationLink({ href }: { href: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
        פתיחת הקישור
      </a>
      <bdi dir="ltr" className="min-w-0 break-all text-xs text-ink-soft">
        {href}
      </bdi>
    </div>
  );
}

/** «PowerPoint», «PDF», «תמונה», «Word». */
export function presentationType(mime: SourceFile["mime"]): string {
  return mime === PPTX ? "PowerPoint" : mime === DOCX ? "Word" : mime === "application/pdf" ? "PDF" : "תמונה";
}

export interface PresentationFileProps {
  port: DataPort;
  week: Week;
  file: SourceFile;
  actor: Actor;
  notify: Notify;
  clear: () => void;
  reload: () => Promise<void>;
  /** Not in this device's last download of the week. */
  isNew?: boolean;
  /** Its path in the week's zip (presentationEntries): «במחשב של האולם: …». None: a file the zip does not hold. */
  path?: string;
  /** Before the name (an orphan's lesson and why). */
  before?: ReactNode;
  /** After a removal, once the list was read again: the row is gone, the list takes the focus. */
  onRemoved?: () => void;
}

export function PresentationFile({ port, week, file: f, actor, notify, clear, reload, isNew = false, path, before, onRemoved }: PresentationFileProps) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<"open" | "remove" | null>(null);
  const focusBack = useFocusBack();
  const action = fileAction(f);
  const open = async () => {
    clear();
    setBusy("open");
    try {
      await openOrDownload(port, week.edition.id, f);
    } catch (e) {
      notify("error", errorMessage(e instanceof CommandError ? e.code : "read_failed"));
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    clear();
    setBusy("remove");
    try {
      await port.sources.remove(week.edition.id, f);
      notify("ok", "המצגת הוסרה");
      await reload();
      onRemoved?.();
    } catch (e) {
      notify("error", errorMessage(e instanceof CommandError ? e.code : null));
      focusBack.back();
    } finally {
      setBusy(null);
      setAsking(false);
    }
  };
  const by = memberName(week, f.uploaded_by);
  return (
    <li data-file-row={f.id} className="space-y-1 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {before}
        <span className="min-w-0 flex-1 basis-40 break-words font-semibold">
          <bdi>{f.display_name}</bdi>
        </span>
        {isNew && (
          <span data-new-since>
            <Badge tone="accent">חדש מאז ההורדה</Badge>
          </span>
        )}
        <Button data-presentation-file={f.id} data-action={action} busy={busy === "open"} busyLabel={action === "open" ? "פותח…" : "מוריד…"} onClick={() => void open()}>
          {action === "open" ? "פתיחה" : "הורדה"}
        </Button>
        {mayRemove(actor, week, f) && !asking && (
          <Button ref={focusBack.ref()} kind="danger" onClick={() => setAsking(true)}>
            הסרה
          </Button>
        )}
      </div>
      <p className="text-xs text-ink-soft">
        {[presentationType(f.mime), sizeText(f.size_bytes), by && `העלה/תה: ${by}`, whenText(f.uploaded_at)].filter(Boolean).map((part, i) => (
          <span key={i}>
            {i > 0 && " · "}
            <bdi>{part}</bdi>
          </span>
        ))}
      </p>
      {path && (
        <p data-hall-line className="text-xs text-ink-soft">
          במחשב של האולם: <HallPath path={path} />
        </p>
      )}
      {asking && (
        <Confirm
          text={
            <>
              להסיר את המצגת «<bdi>{f.display_name}</bdi>»?
            </>
          }
          confirm="כן, להסיר"
          busy={busy === "remove"}
          onConfirm={() => void remove()}
          onCancel={() => {
            setAsking(false);
            focusBack.back();
          }}
        />
      )}
    </li>
  );
}
