// «אישורים» — «בקשות תשלום והסעה» (#requests): the requests waiting for a decision, for everyone the page opens to.
// Whoever decide_payments lets decide (src/domain/approvals.ts mayDecide: a global admin; an admin or a logistics member
// of the edition's real, live week) gets today's controls — one tap, a note to refuse, a batch; anyone else reads the
// rows and one line why. One approval is enough, and it decides the payment and the transport together. A request is
// decided at the version on screen: one changed or decided meanwhile is refused (`stale`), and the page reads again.
// The pickup comes from ONE transports read for the page (public.get_transports_for — never one per lesson), again
// when the pending rows change and after each decision; a failed read only leaves the pickups out.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { LessonTransport } from "../../data/commands";
import type { DataPort } from "../../data/port";
import { STAGE_LIMITS } from "../../data/stageRules";
import { type RequestRow, requestRows } from "../../domain/approvals";
import { displayName } from "../../domain/names";
import { lessonPath } from "../../domain/routes";
import { shekels, TRANSPORT_LABEL } from "../../domain/stages";
import { DAY_NAMES, fmtRange } from "../../domain/time";
import type { Lesson, Week } from "../../domain/types";
import { PageSection } from "../speakerPages/page";
import { Button, Field, INPUT, useFocusRescue } from "../settings/kit";

export type Run = (key: string, fn: () => Promise<unknown>, ok: string | null, onRefused?: (code: string | null) => boolean) => Promise<boolean>;

/** A lesson's link, 44px tall: the row's way to its pay step (/lesson/:id?step=pay). */
const ROW_LINK = "inline-flex min-h-11 items-center gap-1.5 text-start font-bold text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-navy";

/** The transports read: still loading (null), what came back, or «failed» (the rows stay, without pickups). */
type Pickups = LessonTransport[] | "failed" | null;

export function Requests({
  port,
  week,
  decides,
  busy,
  run,
  reload,
}: {
  port: DataPort;
  week: Week;
  /** May this viewer decide here (mayDecide)? Else the rows are read-only. */
  decides: boolean;
  busy: string | null;
  run: Run;
  reload: () => Promise<void>;
}) {
  const cmds = useMemo(() => port.commands(week.edition.id), [port, week.edition.id]);
  const [pickups, setPickups] = useState<Pickups>(null);
  const rescue = useFocusRescue();
  const rows = requestRows(week, Array.isArray(pickups) ? pickups : null);
  // the pending requests that ask for a transport, at their versions: what the read is for — read again whenever they
  // change (a decision takes its row away; a stale answer brings new versions), so after each decision too
  const transportKey = rows
    .filter((r) => r.lesson.transport !== "none")
    .map((r) => `${r.lesson.id}:${r.lesson.version}`)
    .join(",");
  useEffect(() => {
    if (!transportKey) {
      setPickups([]);
      return;
    }
    let live = true;
    cmds.transports().then(
      (list) => live && setPickups(list),
      () => live && setPickups("failed"),
    );
    return () => {
      live = false;
    };
  }, [cmds, transportKey]);

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
    // a stale answer (someone else decided first, or the request changed) says so in one line — the page reads again below
    const done = await run(k, () => cmds.decidePayments(lessons.map((l) => ({ lesson_id: l.id, version: l.version })), decision, withNote), ok);
    await reload();
    if (done && decision === "approved") setNote("");
    // the row (and its buttons) left the list: the section takes the focus
    rescue(() => document.getElementById("requests"));
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
    <PageSection id="requests" title="בקשות תשלום והסעה" count={rows.length === 1 ? "בקשה אחת ממתינה" : `${rows.length} בקשות ממתינות`}>
      {rows.length === 0 ? (
        <p className="text-ink-soft">אין בקשות שממתינות לאישור.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">מי שמטפל/ת במרצה ביקש/ה. אישור אחד מספיק — של צוות המחזור או של הצוות הלוגיסטי — והוא מחליט על התשלום ועל ההסעה יחד.</p>
          {decides ? (
            <>
              <Field id={noteId} label="הערה לאישור (לא חובה, גלויה לצוות)">
                <input id={noteId} value={note} maxLength={STAGE_LIMITS.decision_note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-bold">
                  <input
                    type="checkbox"
                    checked={all}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.size > 0 && !all;
                    }}
                    onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.lesson.id)))}
                    className="size-5 accent-navy"
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
            </>
          ) : (
            <p data-read-only className="rounded-lg bg-sand-soft px-3 py-2 text-sm">
              אישור תשלום והסעה פתוח רק במחזור האמיתי של השנה.
            </p>
          )}
          <ul aria-label="בקשות שממתינות לאישור" className="divide-y divide-sage/60 border-y border-sage/60">
            {rows.map((r) => (
              <RequestItem
                key={r.lesson.id}
                row={r}
                week={week}
                pickups={pickups}
                decides={decides}
                checked={selected.has(r.lesson.id)}
                onToggle={() => toggle(r.lesson.id)}
                busy={busy}
                onApprove={() => decide(`pay-approve:${r.lesson.id}`, [r.lesson], "approved", note.trim() || null, "הבקשה אושרה")}
                onReject={(why) => decide(`pay-reject:${r.lesson.id}`, [r.lesson], "rejected", why, "הבקשה לא אושרה")}
              />
            ))}
          </ul>
        </div>
      )}
    </PageSection>
  );
}

/**
 * The pickup line of a transport request: what the read gave (the time as written, the address), «not sent yet» when it
 * gave nothing though this viewer may read the row, «not visible» when the rule hides it (a demo or practice week's team
 * — app.may_see_transport: in a live real edition its admins and logistics read a request's pickup); nothing while the
 * read is on its way or failed, and nothing for a payment alone.
 */
function PickupLine({ row, pickups, visible }: { row: RequestRow; pickups: Pickups; visible: boolean }) {
  if (row.lesson.transport === "none" || !Array.isArray(pickups)) return null;
  const p = row.pickup;
  const text =
    p && (p.pickup_time || p.pickup_address) ? (
      <>
        איסוף: {p.pickup_time && <bdi dir="ltr">{p.pickup_time}</bdi>}
        {p.pickup_time && p.pickup_address && " · "}
        {p.pickup_address && <bdi>{p.pickup_address}</bdi>}
      </>
    ) : visible || p ? (
      "פרטי האיסוף עוד לא נשלחו."
    ) : (
      "פרטי האיסוף לא גלויים לך."
    );
  return (
    <p data-pickup className="text-sm break-words">
      {text}
    </p>
  );
}

function RequestItem({
  row,
  week,
  pickups,
  decides,
  checked,
  onToggle,
  busy,
  onApprove,
  onReject,
}: {
  row: RequestRow;
  week: Week;
  pickups: Pickups;
  decides: boolean;
  checked: boolean;
  onToggle: () => void;
  busy: string | null;
  onApprove: () => Promise<boolean>;
  onReject: (note: string | null) => Promise<boolean>;
}) {
  const id = useId();
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");
  // «ביטול» closes the reason: «דחייה» takes the focus back
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { lesson: l, speaker } = row;
  const name = speaker ? displayName(speaker) : "שיעור";
  const handler = row.handler != null ? week.team.find((t) => t.id === row.handler)?.display_name : undefined;
  const facts = [
    l.title ?? "כותרת: TBD",
    handler ? `בטיפול: ${handler}` : null,
    l.pay_amount != null ? shekels(l.pay_amount) : "בלי תשלום",
    TRANSPORT_LABEL[l.transport],
  ].filter(Boolean);
  return (
    <li data-request-row data-lesson-id={l.id} className="py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {decides && (
          <label className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center">
            <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`סימון הבקשה של ${name}`} className="size-5 accent-navy" />
          </label>
        )}
        <div className="min-w-0 flex-1 basis-48">
          <Link to={lessonPath(l.id, "pay")} className={ROW_LINK}>
            <span>
              {name} · יום {DAY_NAMES[l.day]} <bdi dir="ltr">{fmtRange(l.start_min, l.end_min)}</bdi>
            </span>
            <span aria-hidden className="inline-block text-navy">
              ‹
            </span>
          </Link>
          <p className="text-sm text-ink-soft break-words">{facts.join(" · ")}</p>
          {/* the viewers of this page read a request's pickup exactly where they may decide it (app.may_see_transport) */}
          <PickupLine row={row} pickups={pickups} visible={decides} />
        </div>
        {decides && (
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Button kind="primary" busy={busy === `pay-approve:${l.id}`} onClick={() => void onApprove()} aria-label={`אישור הבקשה של ${name}`}>
              אישור
            </Button>
            <Button ref={toggleRef} kind="quiet" onClick={() => setRejecting((v) => !v)} aria-expanded={rejecting} aria-label={`דחיית הבקשה של ${name}`}>
              דחייה
            </Button>
          </div>
        )}
      </div>
      {decides && rejecting && (
        <div role="group" aria-label={`דחיית הבקשה של ${name}`} className="mt-2 space-y-2 rounded-xl bg-sand-soft p-3">
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
