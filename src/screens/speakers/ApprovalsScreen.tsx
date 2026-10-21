// The approvals queue (/approvals) — a global admin's: only they vet speakers
// (DECISIONS, milestone 2 §3) and decide payment and transport requests
// (milestone 3). Each list: one tap to approve, a short note to reject,
// checkboxes to approve a batch. A request is decided at the version on
// screen: one changed meanwhile is refused (`stale`) and read again, never
// approved unseen. The header's badge counts both lists.
import { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { DataPort } from "../../data/port";
import { LIMITS } from "../../data/speakerRules";
import type { Me } from "../../data/types";
import { type PaymentRow, pendingPayments, pendingSpeakers, pendingWhoTaught } from "../../domain/mine";
import { requestText } from "../../domain/stages";
import { DAY_NAMES, fmtRange } from "../../domain/time";
import { STAGE_LIMITS } from "../../data/stageRules";
import { byGender, displayName } from "../../domain/names";
import type { Edition, Lesson, Speaker, Week } from "../../domain/types";
import { useMedia } from "../../lib/useMedia";
import { Badge, Button, Confirm, Field, GENDER_LABEL, INPUT, Panel, useFocusBack, useRunner } from "../settings/kit";
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
            {store.editions
              .filter((e) => e.kind === "archive")
              .map((e) => (
                <TaughtBatch
                  key={e.id}
                  port={port}
                  edition={e}
                  pending={pending}
                  busy={busy}
                  onApprove={(ids) => vet(`taught:${e.id}`, ids, "approved", note.trim() || null, ids.length === 1 ? "מרצה אחד/ת אושר/ה" : `${ids.length} מרצים אושרו`)}
                />
              ))}
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

      <Payments port={port} week={week} busy={busy} run={run} reload={store.reload} />

      {open != null && (
        <SpeakerSheet key={open} port={port} me={me} week={week} speakerId={open} wide={wide} onClose={() => setOpen(null)} notify={notify} clear={clear} reload={store.reload} />
      )}
      {node}
    </div>
  );
}

/**
 * «אישור באצווה: מי שלימד/ה ב-<archive>» («הצעה»): one confirm approves every waiting speaker who taught a closed lesson
 * in that archive edition (the import of last year's tracking sheet) — the same vet_speakers as one tap, all or nothing.
 */
function TaughtBatch({
  port,
  edition,
  pending,
  busy,
  onApprove,
}: {
  port: DataPort;
  edition: Edition;
  pending: Speaker[];
  busy: string | null;
  onApprove: (ids: number[]) => Promise<boolean>;
}) {
  const [archive, setArchive] = useState<Week | null>(null);
  const [asking, setAsking] = useState(false);
  const focusBack = useFocusBack();
  useEffect(() => {
    let live = true;
    port.loadWeek(edition.id).then(
      (w) => live && setArchive(w),
      () => live && setArchive(null),
    );
    return () => {
      live = false;
    };
  }, [port, edition.id]);
  const who = archive ? pendingWhoTaught(pending, archive) : [];
  if (who.length === 0) return null;
  const one = who.length === 1;
  const count = one ? "מרצה אחד/ת" : `${who.length} מרצים`;
  const taught = one ? "לימד/ה" : "לימדו";
  // a lesson closes only with a speaker's gender (gender_unknown): the import takes it from הרב / הרבנית alone
  const noGender = who.filter((s) => s.gender == null).length;
  const genderNote =
    noGender === 0 ? "" : noGender === 1 && one ? " (חסר/ה לו/ה מגדר — משלימים בפרופיל לפני סגירה)" : ` (ל-${noGender} מהם חסר מגדר — משלימים בפרופיל לפני סגירה)`;
  return (
    <div role="group" aria-label={`אישור באצווה: מי שלימד/ה ב-${edition.label}`} className="rounded-lg border border-line bg-paper p-3">
      <p className="text-sm">
        <b>
          אישור באצווה: מי שלימד/ה ב-{edition.label}
        </b>{" "}
        <Badge tone="accent">הצעה</Badge>
      </p>
      <p className="mb-2 text-sm text-ink-soft">
        {count} {one ? "שממתין/ה" : "שממתינים"} לאישור {taught} שיעור במחזור «{edition.label}»: {who.map((s) => displayName(s)).join(", ")}.
      </p>
      {asking ? (
        <Confirm
          danger={false}
          text={`לאשר ${count} ש${taught} ב-${edition.label}? אחר כך אפשר לסגור ${one ? "איתו/ה" : "איתם/ן"} שיעורים${genderNote}.`}
          confirm={`אישור ${count}`}
          busy={busy === `taught:${edition.id}`}
          onConfirm={async () => {
            if (await onApprove(who.map((s) => s.id))) setAsking(false);
          }}
          onCancel={() => {
            setAsking(false);
            focusBack.back();
          }}
        />
      ) : (
        <Button ref={focusBack.ref()} kind="primary" onClick={() => setAsking(true)}>
          אישור {count} ש{taught} ב-{edition.label}
        </Button>
      )}
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

// ------------------------------------------------------------------ payment and transport

type Run = (key: string, fn: () => Promise<unknown>, ok: string | null) => Promise<boolean>;

/** The requests waiting for the instructor: one tap, a note to reject, a batch to approve. */
function Payments({ port, week, busy, run, reload }: { port: DataPort; week: Week; busy: string | null; run: Run; reload: () => Promise<void> }) {
  const cmds = useMemo(() => port.commands(week.edition.id), [port, week.edition.id]);
  const navigate = useNavigate();
  const rows = pendingPayments(week);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const noteId = useId();
  const key = rows.map((r) => `${r.lesson.id}:${r.lesson.version}`).join(",");
  // A request decided or changed meanwhile leaves the selection (a changed one is seen again before it is approved).
  useEffect(() => {
    const ids = new Set(key ? key.split(",").map((x) => Number(x.split(":")[0])) : []);
    setSelected((cur) => {
      const next = new Set([...cur].filter((id) => ids.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [key]);

  const decide = async (k: string, lessons: Lesson[], decision: "approved" | "rejected", withNote: string | null, ok: string) => {
    const done = await run(k, () => cmds.decidePayments(lessons.map((l) => ({ lesson_id: l.id, version: l.version })), decision, withNote), ok);
    await reload();
    if (done && decision === "approved") setNote("");
    return done;
  };
  const all = rows.length > 0 && selected.size === rows.length;
  const toggle = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const picked = rows.filter((r) => selected.has(r.lesson.id)).map((r) => r.lesson);

  return (
    <Panel title="תשלום והסעה" aside={rows.length === 1 ? "בקשה אחת ממתינה" : `${rows.length} בקשות ממתינות`}>
      {rows.length === 0 ? (
        <p className="text-ink-soft">אין בקשות לתשלום או להסעה שממתינות לאישור.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">מי שמטפל/ת במרצה ביקש/ה. אחרי האישור אפשר לשלוח למרצה את הודעת הסיכום, והצוות הלוגיסטי רואה את פרטי ההסעה.</p>
          <Field id={noteId} label="הערה לאישור (לא חובה, גלויה לצוות)">
            <input id={noteId} value={note} maxLength={STAGE_LIMITS.decision_note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={all}
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && !all;
                }}
                onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.lesson.id)))}
                className="size-5 accent-ink"
              />
              סימון כל הבקשות
            </label>
            <Button
              kind="primary"
              className="ms-auto"
              disabled={picked.length === 0}
              busy={busy === "pay-batch"}
              onClick={() => void decide("pay-batch", picked, "approved", note.trim() || null, picked.length === 1 ? "בקשה אחת אושרה" : `${picked.length} בקשות אושרו`)}
            >
              {picked.length === 1 ? "אישור בקשה מסומנת" : picked.length > 1 ? `אישור ${picked.length} בקשות מסומנות` : "אישור המסומנות"}
            </Button>
          </div>
          <ul aria-label="בקשות שממתינות לאישור" className="divide-y divide-line border-y border-line">
            {rows.map((r) => (
              <PaymentItem
                key={r.lesson.id}
                row={r}
                week={week}
                checked={selected.has(r.lesson.id)}
                onToggle={() => toggle(r.lesson.id)}
                onOpen={() => navigate("/", { state: { lesson: r.lesson.id, stage: "pay" } })}
                busy={busy}
                onApprove={() => decide(`pay-approve:${r.lesson.id}`, [r.lesson], "approved", note.trim() || null, "הבקשה אושרה")}
                onReject={(why) => decide(`pay-reject:${r.lesson.id}`, [r.lesson], "rejected", why, "הבקשה לא אושרה")}
              />
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function PaymentItem({
  row,
  week,
  checked,
  onToggle,
  onOpen,
  busy,
  onApprove,
  onReject,
}: {
  row: PaymentRow;
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
  const { lesson: l, speaker } = row;
  const name = speaker ? displayName(speaker) : "שיעור";
  const handler = row.handler != null ? week.team.find((t) => t.id === row.handler)?.display_name : undefined;
  const facts = [requestText(l), l.title ?? "כותרת: TBD", handler ? `בטיפול: ${handler}` : null].filter(Boolean);
  return (
    <li data-lesson-id={l.id} className="py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center">
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`סימון הבקשה של ${name}`} className="size-5 accent-ink" />
        </label>
        <div className="min-w-0 flex-1 basis-40">
          <button type="button" onClick={onOpen} className="inline-flex min-h-11 items-center gap-1.5 text-start font-semibold underline decoration-ink-faint underline-offset-4 hover:decoration-ink">
            <span>
              {name} · {DAY_NAMES[l.day]} <bdi>{fmtRange(l.start_min, l.end_min)}</bdi>
            </span>
            <span aria-hidden className="inline-block text-ink-soft">
              ‹
            </span>
          </button>
          <p className="text-sm text-ink-soft break-words">{facts.join(" · ")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button kind="primary" busy={busy === `pay-approve:${l.id}`} onClick={() => void onApprove()} aria-label={`אישור הבקשה של ${name}`}>
            אישור
          </Button>
          <Button kind="quiet" onClick={() => setRejecting((v) => !v)} aria-expanded={rejecting} aria-label={`דחיית הבקשה של ${name}`}>
            דחייה
          </Button>
        </div>
      </div>
      {rejecting && (
        <div role="group" aria-label={`דחיית הבקשה של ${name}`} className="mt-2 space-y-2 rounded-lg border border-line bg-paper p-3">
          <Field id={id} label="למה? (לא חובה, גלוי לצוות)">
            <input id={id} value={why} maxLength={STAGE_LIMITS.decision_note} onChange={(e) => setWhy(e.target.value)} className={INPUT} autoFocus />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              kind="dangerSolid"
              busy={busy === `pay-reject:${l.id}`}
              onClick={async () => {
                if (await onReject(why.trim() || null)) setRejecting(false);
              }}
            >
              לא לאשר
            </Button>
            <Button onClick={() => setRejecting(false)}>ביטול</Button>
          </div>
        </div>
      )}
    </li>
  );
}
