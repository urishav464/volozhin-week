// «אישורים» — the vetting, a global admin's alone (public.vet_speakers; DECISIONS, milestone 2 §3): the speakers who
// agreed to teach and wait for the approval (v14: closing their time is the one step it holds up), then, folded, every
// other speaker waiting for it — the archive's batch approve among them. Each list: one tap to approve, a short note to
// reject, checkboxes to approve a batch. A speaker's name opens their page (/speakers/:id). An edition's admin who is not
// a global admin sees only how many wait (VettingCount).
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import type { DataPort } from "../../data/port";
import { LIMITS } from "../../data/speakerRules";
import { agreedPending, pendingSpeakers, pendingWhoTaught } from "../../domain/mine";
import { byGender, displayName } from "../../domain/names";
import { speakerPath } from "../../domain/routes";
import type { Edition, Speaker, Week } from "../../domain/types";
import { PageSection } from "../speakerPages/page";
import { Badge, Button, Confirm, Field, Fold, GENDER_LABEL, INPUT, useFocusBack, useFocusRescue } from "../settings/kit";
import type { Run } from "./Requests";

type Vet = (key: string, ids: number[], state: "approved" | "rejected", note: string | null, ok: string) => Promise<boolean>;

const approvedText = (n: number) => (n === 1 ? "מרצה אחד/ת אושר/ה" : `${n} מרצים אושרו`);

/** A speaker's name as a link to their page — the row's way in, 44px tall. */
const NAME_LINK = "inline-flex min-h-11 items-center gap-1.5 text-start font-bold text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-navy";

export function Vetting({
  port,
  week,
  editions,
  busy,
  run,
  reload,
}: {
  port: DataPort;
  week: Week;
  editions: readonly Edition[];
  busy: string | null;
  run: Run;
  reload: () => Promise<void>;
}) {
  // each list's note to its approvals (the archive's batch takes the folded list's)
  const [agreedNote, setAgreedNote] = useState("");
  const [restNote, setRestNote] = useState("");
  const rescue = useFocusRescue();
  const agreed = agreedPending(week);
  const agreedIds = new Set(agreed.map((s) => s.id));
  const rest = pendingSpeakers(week).filter((s) => !agreedIds.has(s.id));
  const vet: Vet = async (key, ids, state, withNote, ok) => {
    const done = await run(key, () => port.speakers.vet(ids, state, withNote), ok);
    await reload();
    // the row (and its buttons) left the list: the section takes the focus
    rescue(() => document.getElementById("vetting"));
    return done;
  };

  return (
    <>
      <PageSection id="vetting" title="מרצים שהסכימו — ממתינים לאישור" count={agreed.length === 1 ? "ממתין/ה אחד/ת" : `${agreed.length} ממתינים`}>
        {agreed.length === 0 ? (
          <p className="text-ink-soft">אין מרצים שהסכימו ומחכים לאישור.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">הסכימו ללמד במחזור הזה. את השעה סוגרים איתם/ן אחרי האישור.</p>
            <PendingList label="מרצים שהסכימו — ממתינים לאישור" batch="agreed" speakers={agreed} week={week} busy={busy} note={agreedNote} onNote={setAgreedNote} vet={vet} />
          </div>
        )}
      </PageSection>

      <div className="rounded-xl border border-line bg-card px-4 shadow-sm sm:px-5">
        <Fold title="עוד ממתינים לאישור" hint={rest.length}>
          {rest.length === 0 ? (
            <p className="pb-2 text-ink-soft">אין עוד מרצים שממתינים לאישור.</p>
          ) : (
            <div className="space-y-3 pb-2">
              <p className="text-sm text-ink-soft">מרצה שאושר/ה אפשר לסגור איתו/ה שעה. עד אז הצוות יכול להציע ולשוחח.</p>
              {editions
                .filter((e) => e.kind === "archive")
                .map((e) => (
                  <TaughtBatch
                    key={e.id}
                    port={port}
                    edition={e}
                    pending={rest}
                    busy={busy}
                    onApprove={async (ids) => {
                      const done = await vet(`taught:${e.id}`, ids, "approved", restNote.trim() || null, approvedText(ids.length));
                      if (done) setRestNote("");
                      return done;
                    }}
                  />
                ))}
              <PendingList label="עוד ממתינים לאישור" batch="rest" speakers={rest} week={week} busy={busy} note={restNote} onNote={setRestNote} vet={vet} />
            </div>
          )}
        </Fold>
      </div>
    </>
  );
}

/** An edition's admin (not a global admin): how many who agreed wait for the instructor — one line, nothing when none. */
export function VettingCount({ week }: { week: Week }) {
  const n = agreedPending(week).length;
  if (n === 0) return null;
  return (
    <p data-vetting-count className="text-sm text-ink-soft">
      {n === 1 ? "מרצה אחד/ת שהסכים/ה מחכה לאישור המדריך/ה." : `${n} מרצים שהסכימו מחכים לאישור המדריך/ה.`}
    </p>
  );
}

/** One list of speakers waiting for approval: its note, «סימון הכול» and the batch, and a row each. */
function PendingList({
  label,
  batch,
  speakers,
  week,
  busy,
  note,
  onNote,
  vet,
}: {
  label: string;
  /** Tells this list's batch from the other's (the runner's busy key). */
  batch: string;
  speakers: Speaker[];
  week: Week;
  busy: string | null;
  note: string;
  onNote: (note: string) => void;
  vet: Vet;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const noteId = useId();
  const ids = speakers.map((s) => s.id).join(",");
  // A speaker someone else approved meanwhile (or who moved to the other list) leaves the selection too.
  useEffect(() => {
    const here = new Set(ids ? ids.split(",").map(Number) : []);
    setSelected((cur) => {
      const next = new Set([...cur].filter((id) => here.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [ids]);
  const approve = async (key: string, list: number[], ok: string) => {
    if (await vet(key, list, "approved", note.trim() || null, ok)) onNote("");
  };
  const all = speakers.length > 0 && selected.size === speakers.length;
  const toggle = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div role="group" aria-label={label} className="space-y-3">
      <Field id={noteId} label="הערה לאישור (לא חובה, גלויה לצוות)">
        <input id={noteId} value={note} maxLength={LIMITS.vetted_note} onChange={(e) => onNote(e.target.value)} className={INPUT} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-bold">
          <input
            type="checkbox"
            checked={all}
            ref={(el) => {
              if (el) el.indeterminate = selected.size > 0 && !all;
            }}
            onChange={() => setSelected(all ? new Set() : new Set(speakers.map((s) => s.id)))}
            className="size-5 accent-navy"
          />
          סימון הכול
        </label>
        <Button
          kind="primary"
          className="ms-auto"
          disabled={selected.size === 0}
          busy={busy === `batch:${batch}`}
          onClick={() => void approve(`batch:${batch}`, [...selected], approvedText(selected.size))}
        >
          {selected.size > 0 ? `אישור ${selected.size} מסומנים` : "אישור המסומנים"}
        </Button>
      </div>
      <ul className="divide-y divide-sage/60 border-y border-sage/60">
        {speakers.map((s) => (
          <PendingItem
            key={s.id}
            s={s}
            week={week}
            checked={selected.has(s.id)}
            onToggle={() => toggle(s.id)}
            busy={busy}
            onApprove={() => approve(`approve:${s.id}`, [s.id], `${displayName(s)} ${byGender(s.gender, "אושר", "אושרה")}`)}
            onReject={(why) => vet(`reject:${s.id}`, [s.id], "rejected", why, `${displayName(s)} ${byGender(s.gender, "לא אושר", "לא אושרה")}`)}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * «אישור באצווה: מי שלימד/ה ב-<archive>» («הצעה»): one confirm approves every waiting speaker who taught a closed lesson
 * in that archive edition (the import of last year's tracking sheet) — the same vet_speakers as one tap, all or nothing.
 * It reads the archive's week (port.loadWeek), which only a global admin may (can_see_edition): the vetting's own reader.
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
    <div role="group" aria-label={`אישור באצווה: מי שלימד/ה ב-${edition.label}`} className="rounded-xl bg-sage-soft p-3">
      <p className="text-sm">
        <b>אישור באצווה: מי שלימד/ה ב-{edition.label}</b> <Badge tone="accent">הצעה</Badge>
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
  busy,
  onApprove,
  onReject,
}: {
  s: Speaker;
  week: Week;
  checked: boolean;
  onToggle: () => void;
  busy: string | null;
  onApprove: () => Promise<void>;
  onReject: (note: string | null) => Promise<boolean>;
}) {
  const id = useId();
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");
  // «ביטול» closes the reason: «דחייה» takes the focus back
  const toggleRef = useRef<HTMLButtonElement>(null);
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
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`סימון ${displayName(s)}`} className="size-5 accent-navy" />
        </label>
        <div className="min-w-0 flex-1 basis-40">
          <Link to={speakerPath(s.id)} className={NAME_LINK}>
            <span>
              {displayName(s)}
              {s.disambiguator && <span className="font-normal text-ink-soft">&nbsp;({s.disambiguator})</span>}
            </span>
            <span aria-hidden className="inline-block text-navy">
              ‹
            </span>
          </Link>
          <p className="text-sm text-ink-soft break-words">{facts.join(" · ")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button kind="primary" busy={busy === `approve:${s.id}`} onClick={() => void onApprove()} aria-label={`אישור ${displayName(s)}`}>
            אישור
          </Button>
          <Button ref={toggleRef} kind="quiet" onClick={() => setRejecting((v) => !v)} aria-expanded={rejecting} aria-label={`דחייה ${displayName(s)}`}>
            דחייה
          </Button>
        </div>
      </div>
      {rejecting && (
        <div role="group" aria-label={`דחיית ${displayName(s)}`} className="mt-2 space-y-2 rounded-xl bg-sand-soft p-3">
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
            <Button
              onClick={() => {
                setRejecting(false);
                toggleRef.current?.focus();
              }}
            >
              ביטול
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
