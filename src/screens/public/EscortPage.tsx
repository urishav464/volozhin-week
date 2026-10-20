// An escort's page (/e#token): their own closed lessons in the week, and nothing
// else — day, date or TBD, the teaching time, the room, the speaker, the title,
// who introduces the speaker, «משהו שחשוב לדעת»; the speaker's phone only from
// W−7 (public.escort_view decides — the page shows what came); the driver once
// the transport is arranged; the four ticks; and, for a lesson whose transport
// was approved, a pickup address the escort may send — write-only, never shown
// back. Phone first: one card per lesson.
import { type FormEvent, useId, useState } from "react";
import { CommandError } from "../../data/commands";
import type { EscortLesson, EscortView, PublicPort } from "../../data/publicPort";
import { STAGE_LIMITS } from "../../data/stageRules";
import { telHref, waHref } from "../../domain/contactLinks";
import { TICK_LABEL } from "../../domain/escorts";
import { israelDate, israelMoment } from "../../domain/israelTime";
import { fmtDate } from "../../domain/milestones";
import { byGender } from "../../domain/names";
import { dateOf } from "../../domain/time";
import { TICK_ITEMS, type TickItem } from "../../domain/types";
import { errorMessage } from "../../errors";
import { introOf } from "../../exports/escorts";
import { Button, INPUT } from "../settings/kit";
import { LinkInvalid, LoadFailed, Loading, useLinkLoad, whenOf } from "./parts";

const dmy = (date: string) => fmtDate(dateOf(date, 0)!);

export function EscortPage({ port, token }: { port: PublicPort; token: string }) {
  const { load, reload, set } = useLinkLoad(() => port.escortView(token));
  const [refreshing, setRefreshing] = useState(false);

  if (load.state === "loading") return <Loading />;
  if (load.state === "invalid") return <LinkInvalid />;
  if (load.state === "error") return <LoadFailed onRetry={() => void reload().catch(() => {})} />;
  const v = load.data;

  const refresh = async () => {
    setRefreshing(true);
    await reload().catch(() => {});
    setRefreshing(false);
  };
  /** A lesson's write was refused as `link_invalid`: the link or the lesson is no longer this escort's — read again. */
  const lost = () => void reload().catch(() => {});

  return (
    <>
      <div className="space-y-1">
        <h2 className="font-display text-2xl font-extrabold">שלום, {v.escort.full_name}</h2>
        <p className="text-ink-soft">
          הדף שלך כמלווה בשבוע וולוז'ין {v.edition.label}.{" "}
          {v.edition.start_date ? `השבוע נפתח ביום ראשון, ${dmy(v.edition.start_date)}.` : "תאריך השבוע עוד לא נקבע (TBD)."}
        </p>
      </div>
      <PhonesNote view={v} />
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-ink-soft" aria-live="polite">
          {v.lessons.length === 0 ? "" : v.lessons.length === 1 ? "שיעור אחד" : `${v.lessons.length} שיעורים`}
        </p>
        <Button onClick={() => void refresh()} busy={refreshing} busyLabel="טוען…">
          טעינה מחדש
        </Button>
      </div>
      {v.lessons.length === 0 ? (
        <p className="rounded-xl border border-line bg-card p-4 text-ink-soft">עוד לא שובצו לך שיעורים. כשהצוות ישבץ, הם יופיעו כאן.</p>
      ) : (
        <ol className="space-y-3" aria-label="השיעורים שלי">
          {v.lessons.map((l) => (
            <li key={l.lesson_id}>
              <LessonCard
                view={v}
                lesson={l}
                port={port}
                token={token}
                onTicks={(ticks) => set((d) => ({ ...d, lessons: d.lessons.map((x) => (x.lesson_id === l.lesson_id ? { ...x, ticks } : x)) }))}
                onLost={lost}
              />
            </li>
          ))}
        </ol>
      )}
      <p className="text-sm text-ink-soft">
        זה דף אישי: לא מעבירים את הקישור הלאה. הוא מפסיק לעבוד בסוף השבוע, או כשהצוות מחליף אותו בקישור חדש.
      </p>
    </>
  );
}

/** When the speakers' phones appear (W−7 of a week with a date); nothing once they do. */
function PhonesNote({ view: v }: { view: EscortView }) {
  const today = israelDate(new Date().toISOString());
  if (v.phones_from && today >= v.phones_from) return null;
  return (
    <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm">
      {v.phones_from
        ? `הטלפון של כל מרצה יופיע כאן מ-${dmy(v.phones_from)}, שבוע לפני השבוע.`
        : v.edition.start_date
          ? "בשבוע הזה הטלפונים של המרצים לא מוצגים בקישור." // a practice week: never
          : "הטלפון של כל מרצה יופיע כאן שבוע לפני השבוע, אחרי שייקבע לו תאריך."}
    </p>
  );
}

function LessonCard({
  view,
  lesson: l,
  port,
  token,
  onTicks,
  onLost,
}: {
  view: EscortView;
  lesson: EscortLesson;
  port: PublicPort;
  token: string;
  onTicks: (t: EscortLesson["ticks"]) => void;
  onLost: () => void;
}) {
  const id = useId();
  const when = whenOf(view.edition.start_date, l.day, l.start_min, l.end_min);
  const memorial = l.kind === "memorial";
  const intro = memorial ? null : introOf(l.self_intro, l.speaker?.gender ?? null, view.escort.gender);
  const notes = [...l.duty_notes, ...(l.escort_note ? [l.escort_note] : [])];
  const title = l.title ?? (memorial ? "זמן זיכרון" : "כותרת TBD");
  return (
    <article aria-labelledby={`${id}-h`} data-escort-lesson={l.lesson_id} className="space-y-3 rounded-xl border border-line bg-card p-4 shadow-sm">
      <div>
        <h3 id={`${id}-h`} className="font-display text-lg font-semibold">
          {when.day} <bdi dir="ltr">{when.time}</bdi>
        </h3>
        <p className="text-sm text-ink-soft">
          {when.date} · {l.room}
          {memorial && " · זמן זיכרון"}
        </p>
      </div>
      <div>
        <p className="font-semibold break-words">{l.speaker?.name ?? "המרצה: TBD"}</p>
        <p className="break-words">{title}</p>
        {intro && (
          <p className="text-sm">
            <b>{intro.intro}</b> — {intro.detail}
          </p>
        )}
      </div>
      {(l.phone || l.driver) && (
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-sm">
          {l.phone && (
            <>
              <dt className="text-ink-soft">טלפון המרצה</dt>
              <dd className="min-w-0">
                <Phone phone={l.phone} whatsapp />
              </dd>
            </>
          )}
          {l.driver && (
            <>
              <dt className="text-ink-soft">נהג/ת</dt>
              <dd className="min-w-0 break-words">
                {l.driver.name ?? "—"}
                {l.driver.phone && (
                  <>
                    {" · "}
                    <Phone phone={l.driver.phone} />
                  </>
                )}
              </dd>
            </>
          )}
        </dl>
      )}
      {notes.length > 0 && (
        <div className="text-sm">
          <p className="font-semibold">משהו שחשוב לדעת</p>
          <ul className="list-disc space-y-0.5 ps-5">
            {notes.map((n, i) => (
              <li key={i} className="whitespace-pre-line break-words">
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Ticks lesson={l} port={port} token={token} onTicks={onTicks} onLost={onLost} />
      {l.transport && <Pickup lesson={l} port={port} token={token} onLost={onLost} />}
    </article>
  );
}

/** A phone as a call link (and WhatsApp) when it has enough digits; as typed otherwise. */
function Phone({ phone, whatsapp = false }: { phone: string; whatsapp?: boolean }) {
  const tel = telHref(phone);
  const wa = whatsapp ? waHref(phone) : null;
  if (!tel) return <bdi>{phone}</bdi>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3">
      <a href={tel} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
        <bdi dir="ltr">{phone}</bdi>
      </a>
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">
          WhatsApp
        </a>
      )}
    </span>
  );
}

/** The four ticks: on keeps the first time; off clears it. Each answer is the lesson's four, as stored. */
function Ticks({
  lesson: l,
  port,
  token,
  onTicks,
  onLost,
}: {
  lesson: EscortLesson;
  port: PublicPort;
  token: string;
  onTicks: (t: EscortLesson["ticks"]) => void;
  onLost: () => void;
}) {
  // the box shows what was asked at once; the answer (the four as stored) replaces it
  const [busy, setBusy] = useState<{ item: TickItem; on: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const toggle = async (item: TickItem, on: boolean) => {
    setBusy({ item, on });
    setProblem(null);
    try {
      onTicks(await port.escortTick(token, l.lesson_id, item, on));
    } catch (e) {
      const code = e instanceof CommandError ? e.code : null;
      setProblem(code === "link_invalid" ? "הסימון לא נשמר: השיעור כבר לא מופיע בקישור הזה. הדף נטען מחדש." : "הסימון לא נשמר. אפשר לנסות שוב.");
      if (code === "link_invalid") onLost();
    } finally {
      setBusy(null);
    }
  };
  return (
    <fieldset className="min-w-0 rounded-lg border border-line p-3">
      <legend className="px-1 text-sm font-semibold">מה כבר עשיתי</legend>
      <ul className="grid gap-x-4 sm:grid-cols-2">
        {TICK_ITEMS.map((item) => {
          const at = l.ticks[item];
          return (
            <li key={item}>
              <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={busy?.item === item ? busy.on : at != null}
                  disabled={busy != null}
                  onChange={(e) => void toggle(item, e.target.checked)}
                  className="size-5 shrink-0 accent-ink"
                />
                <span>
                  {TICK_LABEL[item]}
                  {at && <span className="block text-xs text-ink-soft">סומן ב-{israelMoment(at)}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {problem && (
        <p role="alert" className="mt-1 text-sm text-bad">
          {problem}
        </p>
      )}
    </fieldset>
  );
}

/** The pickup address: sent to the team, never read back through the link. */
function Pickup({ lesson: l, port, token, onLost }: { lesson: EscortLesson; port: PublicPort; token: string; onLost: () => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const g = l.speaker?.gender ?? null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    setSent(false);
    if (!text.trim()) return setProblem("צריך לכתוב כתובת.");
    setBusy(true);
    try {
      await port.escortPickup(token, l.lesson_id, text);
      setText("");
      setSent(true);
    } catch (err) {
      const code = err instanceof CommandError ? err.code : null;
      if (code === "bad_value") setProblem(`צריך לכתוב את הכתובת בשורה אחת, עד ${STAGE_LIMITS.pickup_address} תווים.`);
      else if (code === "link_invalid") {
        setProblem("הכתובת לא נשלחה: השיעור כבר לא מופיע בקישור הזה. הדף נטען מחדש.");
        onLost();
      } else setProblem(code ? errorMessage(code) : "הכתובת לא נשלחה. אפשר לנסות שוב.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} aria-label="כתובת איסוף" className="space-y-2 rounded-lg border border-line p-3" noValidate>
      <label htmlFor={`${id}-a`} className="block text-sm font-semibold">
        כתובת איסוף למרצה
      </label>
      <p id={`${id}-hint`} className="text-xs text-ink-soft">
        ההסעה אושרה. אם {byGender(g, "המרצה מסר לך מאיפה לאסוף אותו", "המרצה מסרה לך מאיפה לאסוף אותה", "המרצה מסר/ה לך מאיפה לאסוף אותו/ה")}, כותבים
        כאן. הכתובת עוברת לצוות, ולא מוצגת בדף הזה שוב.
      </p>
      <input
        id={`${id}-a`}
        value={text}
        maxLength={STAGE_LIMITS.pickup_address}
        onChange={(e) => setText(e.target.value)}
        aria-describedby={`${id}-hint`}
        autoComplete="off"
        className={INPUT}
      />
      <Button kind="primary" type="submit" busy={busy} busyLabel="שולח…">
        שליחה לצוות
      </Button>
      {sent && (
        <p role="status" className="text-sm text-ok">
          הכתובת נשלחה לצוות. היא לא מוצגת כאן, כדי לשמור על פרטיות המרצה.
        </p>
      )}
      {problem && (
        <p role="alert" className="text-sm text-bad">
          {problem}
        </p>
      )}
    </form>
  );
}
