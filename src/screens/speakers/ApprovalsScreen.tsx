// The approvals queue (/approvals) — a global admin's: only they vet speakers
// (DECISIONS, milestone 2 §3). Speakers waiting for approval, one tap to
// approve, a short note to reject, checkboxes to approve a batch. The header's
// badge counts the same list. Payment and transport join here in milestone 3.
import { useEffect, useId, useState } from "react";
import type { DataPort } from "../../data/port";
import { LIMITS } from "../../data/speakerRules";
import type { Me } from "../../data/types";
import { pendingSpeakers } from "../../domain/mine";
import { byGender, displayName } from "../../domain/names";
import type { Speaker, Week } from "../../domain/types";
import { useMedia } from "../../lib/useMedia";
import { Button, Field, GENDER_LABEL, INPUT, Panel, useRunner } from "../settings/kit";
import { useWeekStore } from "../weekStore";
import { useToast } from "./parts";
import { SpeakerSheet } from "./SpeakerSheet";

export function ApprovalsScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const wide = useMedia("(min-width: 1024px)");
  const { notify, clear, node } = useToast();
  const { busy, run } = useRunner(notify, clear);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const noteId = useId();
  const pending = week ? pendingSpeakers(week) : [];
  const pendingKey = pending.map((s) => s.id).join(",");

  // A speaker someone else approved meanwhile leaves the selection too.
  useEffect(() => {
    const ids = new Set(pendingKey ? pendingKey.split(",").map(Number) : []);
    setSelected((cur) => {
      const next = new Set([...cur].filter((id) => ids.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [pendingKey]);

  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const vet = async (key: string, ids: number[], state: "approved" | "rejected", withNote: string | null, ok: string) => {
    const done = await run(key, () => port.speakers.vet(ids, state, withNote), ok);
    await store.reload();
    if (done && state === "approved") setNote("");
    return done;
  };
  const all = pending.length > 0 && selected.size === pending.length;
  const toggle = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-20">
      <h2 className="font-display text-2xl font-extrabold">אישורים</h2>

      <Panel title="מרצים שממתינים לאישור" aside={pending.length === 1 ? "ממתין/ה אחד/ת" : `${pending.length} ממתינים`}>
        {pending.length === 0 ? (
          <p className="text-ink-soft">אין מרצים שממתינים לאישור.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">מרצה שאושר/ה אפשר לסגור איתו/ה שיעור. עד אז הצוות יכול להציע, אבל רק כמועמד/ת.</p>
            <Field id={noteId} label="הערה לאישור (לא חובה, גלויה לצוות)">
              <input id={noteId} value={note} maxLength={LIMITS.vetted_note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.size > 0 && !all;
                  }}
                  onChange={() => setSelected(all ? new Set() : new Set(pending.map((s) => s.id)))}
                  className="size-5 accent-ink"
                />
                סימון הכול
              </label>
              <Button
                kind="primary"
                className="ms-auto"
                disabled={selected.size === 0}
                busy={busy === "batch"}
                onClick={() => void vet("batch", [...selected], "approved", note.trim() || null, selected.size === 1 ? "מרצה אחד/ת אושר/ה" : `${selected.size} מרצים אושרו`)}
              >
                {selected.size > 0 ? `אישור ${selected.size} מסומנים` : "אישור המסומנים"}
              </Button>
            </div>
            <ul aria-label="ממתינים לאישור" className="divide-y divide-line border-y border-line">
              {pending.map((s) => (
                <PendingItem
                  key={s.id}
                  s={s}
                  week={week}
                  checked={selected.has(s.id)}
                  onToggle={() => toggle(s.id)}
                  onOpen={() => setOpen(s.id)}
                  busy={busy}
                  onApprove={() => vet(`approve:${s.id}`, [s.id], "approved", note.trim() || null, `${displayName(s)} ${byGender(s.gender, "אושר", "אושרה")}`)}
                  onReject={(why) => vet(`reject:${s.id}`, [s.id], "rejected", why, `${displayName(s)} ${byGender(s.gender, "לא אושר", "לא אושרה")}`)}
                />
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <Panel title="תשלום והסעה" aside="אבן דרך 3">
        <p className="text-ink-soft">בקשות לתשלום ולהסעה יגיעו לכאן לאישור, יחד עם השיעור שהן שייכות לו.</p>
      </Panel>

      {open != null && (
        <SpeakerSheet key={open} port={port} me={me} week={week} speakerId={open} wide={wide} onClose={() => setOpen(null)} notify={notify} clear={clear} reload={store.reload} />
      )}
      {node}
    </div>
  );
}

function PendingItem({
  s,
  week,
  checked,
  onToggle,
  onOpen,
  busy,
  onApprove,
  onReject,
}: {
  s: Speaker;
  week: Week;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
  busy: string | null;
  onApprove: () => Promise<boolean>;
  onReject: (note: string | null) => Promise<boolean>;
}) {
  const id = useId();
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");
  const a = week.approaches.find((x) => x.speaker_id === s.id);
  const handler = a?.owner_member_id != null ? week.team.find((t) => t.id === a.owner_member_id)?.display_name : undefined;
  const facts = [
    s.affiliation,
    s.gender ? GENDER_LABEL[s.gender] : "מגדר לא ידוע",
    s.topics.slice(0, 3).join(", ") || null,
    handler ? `בטיפול ${handler}` : null,
  ].filter(Boolean);
  return (
    <li data-speaker-id={s.id} className="py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center">
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`סימון ${displayName(s)}`} className="size-5 accent-ink" />
        </label>
        <div className="min-w-0 flex-1 basis-40">
          <button type="button" onClick={onOpen} className="inline-flex min-h-11 items-center gap-1.5 text-start font-semibold underline decoration-ink-faint underline-offset-4 hover:decoration-ink">
            <span>
              {displayName(s)}
              {s.disambiguator && <span className="font-normal text-ink-soft">&nbsp;({s.disambiguator})</span>}
            </span>
            <span aria-hidden className="inline-block text-ink-soft">
              ‹
            </span>
          </button>
          <p className="text-sm text-ink-soft break-words">{facts.join(" · ")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button kind="primary" busy={busy === `approve:${s.id}`} onClick={() => void onApprove()} aria-label={`אישור ${displayName(s)}`}>
            אישור
          </Button>
          <Button kind="quiet" onClick={() => setRejecting((v) => !v)} aria-expanded={rejecting} aria-label={`דחייה ${displayName(s)}`}>
            דחייה
          </Button>
        </div>
      </div>
      {rejecting && (
        <div role="group" aria-label={`דחיית ${displayName(s)}`} className="mt-2 space-y-2 rounded-lg border border-line bg-paper p-3">
          <Field id={id} label="למה? (לא חובה, גלוי לצוות)">
            <input id={id} value={why} maxLength={LIMITS.vetted_note} onChange={(e) => setWhy(e.target.value)} className={INPUT} autoFocus />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              kind="dangerSolid"
              busy={busy === `reject:${s.id}`}
              onClick={async () => {
                if (await onReject(why.trim() || null)) setRejecting(false);
              }}
            >
              {byGender(s.gender, "לא לאשר אותו", "לא לאשר אותה", "לא לאשר")}
            </Button>
            <Button onClick={() => setRejecting(false)}>ביטול</Button>
          </div>
        </div>
      )}
    </li>
  );
}
