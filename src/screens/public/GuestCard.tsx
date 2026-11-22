// The guests' card (/s, the reset, phase 5): a lesson opened from the schedule — its short description and, per speaker
// approved to appear, the description and the photo. `CardBody` is pure (also the team's preview: «תוצרים ← אתר
// האורחים», the lesson page's «כך זה ייראה לאורחים»); `GuestCardDialog` is the guest's: a native modal <dialog>.
//
// Text nodes only: every word here is React's string child — never dangerouslySetInnerHTML, never markdown-lite on what
// the team wrote for guests. A photo is drawn only when guestPhotoSrc accepts it (a JPEG inside the answer); a person
// with neither a description nor such a photo is not listed (their name stays in the names line, as on the poster).
//
// The dialog adds no history entry, no hash and nothing to storage: the address's hash IS the link's token (src/Root.tsx
// reads every hashchange as a new one), and a Back after a pushState would open the page without it.
import { useEffect, useId, useLayoutEffect, useRef, type MouseEvent, type PointerEvent } from "react";
import type { PublicPerson, PublicScheduleRow } from "../../data/publicPort";
import { designerRow } from "../../exports/designer";
import { messageDate } from "../../domain/message";
import { guestPhotoSrc } from "../../domain/photo";
import { DAY_NAMES, fmtRange } from "../../domain/time";
import { dayLabel } from "./parts";

export interface CardBodyProps {
  row: PublicScheduleRow;
  /** The answer's whole `people` (row.people indexes into it). */
  people: readonly PublicPerson[];
  /** The edition's start_date (null: TBD) — the card's date. */
  startDate: string | null;
  /** The heading's id, for the dialog's aria-labelledby. */
  titleId?: string;
  /** The title's heading level: 2 in the guests' dialog; 4 inside a team page's section (its h3), each person one below. */
  level?: 2 | 4;
}

/** Guest text: its own lines kept, a long word broken rather than the page widened, its direction its own. */
const GUEST_TEXT = "whitespace-pre-line [overflow-wrap:anywhere] [unicode-bidi:plaintext]";

const filled = (v: string | null | undefined): v is string => !!v && v.trim() !== "";

/** The card's content: the title, when and where, the names, the lesson's description, then each person shown. */
export function CardBody({ row, people, startDate, titleId, level = 2 }: CardBodyProps) {
  const Title = level === 4 ? "h4" : "h2";
  const Person = level === 4 ? "h5" : "h3";
  const r = designerRow(row, 0);
  // the calendar's date (a night lesson's is the next morning's); omitted while the week's date is TBD
  const date = messageDate(startDate, row.day, row.start_min);
  const night = row.start_min >= 1440 && row.day < 4;
  const where = [r.room, r.category, r.parallel ? "במקביל" : ""].filter(Boolean).join(" · ");
  const shown = row.people
    .map((k) => ({ k, p: people[k], src: guestPhotoSrc(people[k]?.photo) }))
    .filter((x) => !!x.p && (filled(x.p.bio) || x.src != null));
  return (
    <div className="space-y-3">
      <Title id={titleId} className={`font-display text-xl font-extrabold text-navy ${GUEST_TEXT}`}>
        {r.title}
      </Title>
      <p className="text-ink-soft">
        {night ? dayLabel(row.day, row.start_min) : `יום ${DAY_NAMES[row.day]}`} · <bdi dir="ltr">{fmtRange(row.start_min, row.end_min)}</bdi>
        {date && ` · ${date}`}
      </p>
      {where && <p className="text-sm text-ink-soft">{where}</p>}
      {r.speaker && <p className={`font-bold ${GUEST_TEXT}`}>{r.speaker}</p>}
      {filled(row.note) && (
        <p data-guest-note className={`rounded-lg bg-paper-light p-3 ${GUEST_TEXT}`}>
          {row.note}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="space-y-3 border-t border-line pt-3">
          {shown.map(({ k, p, src }) => (
            <li key={k} data-guest-person={k} className="flex items-start gap-3">
              {src && (
                <img
                  data-guest-photo
                  src={src}
                  alt={`תמונה של ${p!.label}`}
                  width={96}
                  height={96}
                  decoding="async"
                  className="size-20 shrink-0 rounded-full bg-sand-soft object-cover object-top sm:size-24"
                />
              )}
              <div className="min-w-0 flex-1">
                <Person className={`font-bold text-navy ${GUEST_TEXT}`}>{p!.label}</Person>
                {filled(p!.bio) && <p className={`text-sm ${GUEST_TEXT}`}>{p!.bio}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CLOSE = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full font-bold text-navy hover:bg-accent-soft";

/**
 * The card on the guest's page: `showModal` (the page behind inert, Escape closes it natively), a click on the backdrop
 * closes it, «סגירה» (× at the top, and on a phone a button at the bottom too). A phone sees a sheet from the bottom, a
 * wider screen a box in the middle. Where `showModal` is missing (an old phone) the `open` attribute and a window Escape
 * listener stand in. `onClose` runs once the dialog has closed — the page gives the row's button its focus back.
 */
export function GuestCardDialog({ onClose, ...body }: Omit<CardBodyProps, "titleId"> & { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const modal = useRef(false);
  const downOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();

  useLayoutEffect(() => {
    const d = ref.current;
    // a second run on the same element (StrictMode's) finds it shown already
    if (!d || d.hasAttribute("open")) return;
    try {
      if (typeof d.showModal === "function") {
        d.showModal();
        modal.current = true;
      }
    } catch {
      modal.current = false;
    }
    if (!modal.current) d.setAttribute("open", "");
    closeRef.current?.focus();
  }, []);

  // without showModal nothing closes the card on Escape but this
  useEffect(() => {
    if (modal.current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = () => {
    const d = ref.current;
    if (modal.current && d?.open) d.close(); // → the close event → onClose
    else onCloseRef.current();
  };
  // a click whose press and release both landed outside the box (on the backdrop, which belongs to the dialog itself)
  const onPointerDown = (e: PointerEvent<HTMLDialogElement>) => {
    downOnBackdrop.current = e.target === e.currentTarget;
  };
  const onClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget && downOnBackdrop.current) close();
    downOnBackdrop.current = false;
  };

  return (
    <dialog
      ref={ref}
      data-guest-card
      aria-labelledby={titleId}
      onClose={() => onCloseRef.current()}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className="fixed inset-0 z-30 m-0 mt-auto hidden h-fit max-h-[88dvh] w-full max-w-none flex-col overflow-hidden rounded-t-2xl bg-card p-0 text-ink shadow-2xl open:flex backdrop:bg-navy-900/40 sm:m-auto sm:max-h-[85dvh] sm:max-w-lg sm:rounded-2xl print:hidden"
    >
      <div className="flex shrink-0 justify-end px-2 pt-2">
        <button ref={closeRef} type="button" aria-label="סגירה" onClick={close} className={`${CLOSE} text-2xl leading-none`}>
          <span aria-hidden>×</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6">
        <CardBody {...body} titleId={titleId} />
        <div className="mt-4 flex justify-center sm:hidden">
          <button type="button" onClick={close} className={`${CLOSE} border border-navy bg-card px-6`}>
            סגירה
          </button>
        </div>
      </div>
    </dialog>
  );
}
