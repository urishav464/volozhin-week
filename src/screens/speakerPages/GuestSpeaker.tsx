// The speaker page's «לאתר האורחים» (#guest, the reset, phase 5): this edition's approval to appear (PublicOkSwitch —
// set_public_ok), the photo (set_speaker_photo: picked, fitted on a canvas — photoCanvas.ts — previewed as the very
// bytes to be sent, then saved) and the description for guests (`public_bio`, its own form: never mixed with the team's
// «תיאור קצר», and a profile save never touches it). After «שיעורים»; its root is the PageSection `id="guest"`.
// Everyone who opens the page sees it; writing follows mayEditSpeaker (the photo, the description) and set_public_ok's
// rule (the box). Every write is a port command through the page's `act` (the week again — has_photo, public_ok).
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { CommandError } from "../../data/commands";
import type { DataPort } from "../../data/port";
import { cleanPublicBio, LIMITS } from "../../data/speakerRules";
import { byGender, displayName } from "../../domain/names";
import { photoDataUrl, photoFromBase64 } from "../../domain/photo";
import { type FittedPhoto, jpegSize } from "../../domain/photoFit";
import type { Approach, Speaker, Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Chip } from "../../grid/bits";
import { Button, Confirm, INPUT, useFocusBack, useFocusRescue } from "../settings/kit";
import type { Notify } from "../speakers/parts";
import { PublicOkSwitch, publicOkDone } from "../speakers/PublicOk";
import type { Act } from "../stages/parts";
import type { Actor } from "../weekStore";
import { PageSection } from "./page";
import { PREPARE_TEXT, preparePhoto } from "./photoCanvas";

export interface GuestSpeakerProps {
  port: DataPort;
  week: Week;
  speaker: Speaker;
  /** This edition's approach (null: nobody approached them this edition). */
  approach: Approach | null;
  actor: Actor;
  /** mayEditSpeaker(actor, edition, handler) — the bio for guests and the photo. */
  mayEdit: boolean;
  /** The page's runner: which button is busy. */
  busy: string | null;
  /** The page's own: a command, then the week and the page's reads again. */
  act: Act;
  notify: Notify;
  clear: () => void;
}

export function GuestSpeaker({ port, week, speaker: s, approach: a, actor, mayEdit, busy, act }: GuestSpeakerProps) {
  const edition = week.edition;
  const chip = !a ? (
    <Chip>אין פנייה במחזור</Chip>
  ) : a.public_ok ? (
    <Chip tone="ok">{byGender(s.gender, "מאושר", "מאושרת")} להופיע במחזור הזה</Chip>
  ) : (
    <Chip>{byGender(s.gender, "לא מאושר", "לא מאושרת")} להופיע</Chip>
  );
  return (
    <div data-speaker-guest>
      <PageSection id="guest" title="לאתר האורחים" aside={chip}>
        <div className="space-y-4">
          {a ? (
            <PublicOkSwitch
              speaker={s}
              approach={a}
              actor={actor}
              edition={edition}
              busy={busy === "public-ok"}
              onSet={(ok) => act("public-ok", () => port.speakers.setPublicOk(edition.id, a.id, a.version, ok), publicOkDone(s, ok))}
            />
          ) : (
            <p className="text-sm text-ink-soft">אפשר לסמן אחרי שהמרצה {byGender(s.gender, "מסכים", "מסכימה")} ללמד</p>
          )}
          <div className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <PhotoBox port={port} week={week} s={s} mayEdit={mayEdit} busy={busy} act={act} />
            <BioBox port={port} week={week} s={s} mayEdit={mayEdit} busy={busy} act={act} />
          </div>
        </div>
      </PageSection>
    </div>
  );
}

// ------------------------------------------------------------------ the photo

const ISRAEL_DAY = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Jerusalem" });

/** «הועלתה 1.11.2026», or nothing for a date that does not read. */
function uploadedText(at: string | null): string | null {
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : `הועלתה ${ISRAEL_DAY.format(d)}`;
}

/** «512×384 · 18 KB» — the bytes as sent. */
const sizeText = (w: number, h: number, bytes: number) => `${w}×${h} · ${Math.max(1, Math.round(bytes / 1024))} KB`;

interface BoxProps {
  port: DataPort;
  week: Week;
  s: Speaker;
  mayEdit: boolean;
  busy: string | null;
  act: Act;
}

function PhotoBox({ port, week, s, mayEdit, busy, act }: BoxProps) {
  const id = useId();
  const edition = week.edition;
  const name = displayName(s);
  /** The photo on screen: read (get_speaker_photo, only when has_photo), or the bytes this page just sent. */
  const [photo, setPhoto] = useState<{ b64: string; at: string | null } | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  /** has_photo said yes and the read found none (removed meanwhile). */
  const [gone, setGone] = useState(false);
  const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState<FittedPhoto | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const shown = useRef(photo);
  shown.current = photo;
  /** The bytes being sent: once has_photo turns true, they are the photo — no second read. */
  const sending = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const back = useFocusBack();
  const rescue = useFocusRescue();
  const hasPhoto = s.has_photo === true;

  useEffect(() => {
    setReadFailed(false);
    setGone(false);
    if (!hasPhoto) {
      setPhoto(null);
      return;
    }
    if (sending.current) {
      setPhoto({ b64: sending.current, at: new Date().toISOString() });
      return;
    }
    if (shown.current) return;
    let live = true;
    port.speakers.photo(s.id).then(
      (p) => {
        if (!live) return;
        if (p) setPhoto({ b64: p.photo, at: p.uploaded_at });
        else setGone(true);
      },
      () => live && setReadFailed(true),
    );
    return () => {
      live = false;
    };
  }, [port, s.id, hasPhoto, retry]);

  const storedSize = useMemo(() => {
    const b = photo ? photoFromBase64(photo.b64) : null;
    const dims = b ? jpegSize(b) : null;
    return b && dims ? { ...dims, bytes: b.length } : null;
  }, [photo]);

  const pick = async (file: File) => {
    setProblem(null);
    setWorking(true);
    const r = await preparePhoto(file);
    setWorking(false);
    if (typeof r === "string") {
      setProblem(PREPARE_TEXT[r]);
      rescue(() => input.current);
      return;
    }
    setPreview(r);
    rescue(() => saveButton.current);
  };

  const save = async () => {
    if (!preview) return;
    const sent = preview;
    sending.current = sent.base64;
    const ok = await act("photo", () => port.speakers.setPhoto(edition.id, s.id, sent.base64), "התמונה נשמרה", (code) => {
      if (code !== "bad_file") return false;
      setProblem("השרת לא קיבל את התמונה. אפשר לנסות שוב, או בדפדפן אחר.");
      return true;
    });
    sending.current = null;
    if (!ok) {
      // refused while the week came back with a photo (someone else's, at the same moment): read the one stored
      if (shown.current?.b64 === sent.base64) {
        setPhoto(null);
        setRetry((n) => n + 1);
      }
      return;
    }
    setPhoto({ b64: sent.base64, at: new Date().toISOString() });
    setPreview(null);
    rescue(() => input.current);
  };

  const remove = async () => {
    const ok = await act("photo-remove", () => port.speakers.setPhoto(edition.id, s.id, null), "התמונה הוסרה");
    setConfirming(false);
    if (ok) {
      setPhoto(null);
      rescue(() => input.current);
    } else back.back("remove");
  };

  const state = working ? "working" : preview ? "preview" : hasPhoto ? "stored" : "none";
  const src = preview ? photoDataUrl(preview.base64) : photo ? photoDataUrl(photo.b64) : null;
  const size = preview ? { width: preview.width, height: preview.height, bytes: preview.bytes.length } : storedSize;
  const locked = working || preview != null || busy != null;

  return (
    <div className="min-w-0 space-y-2" data-photo-state={state} data-photo-size={size?.bytes} data-photo-dims={size ? `${size.width}x${size.height}` : undefined}>
      <h4 className="font-bold text-navy">תמונה</h4>
      <div className="flex size-32 items-center justify-center overflow-hidden rounded-xl border border-line bg-sand-soft sm:size-44">
        {src ? (
          // the whole box, a small picture scaled up too: the guests' card draws it larger than it is stored
          <img src={src} alt={`התמונה של ${name} לאתר האורחים`} className="size-full object-contain" />
        ) : hasPhoto && !readFailed && !gone ? (
          <span className="text-sm text-ink-soft">טוען…</span>
        ) : (
          <span className="text-sm text-ink-soft">{hasPhoto && readFailed ? "התמונה לא נטענה" : "אין תמונה"}</span>
        )}
      </div>
      {preview ? (
        <p className="text-sm text-ink">
          <bdi dir="ltr" className="tabular-nums">
            {sizeText(preview.width, preview.height, preview.bytes.length)}
          </bdi>
        </p>
      ) : (
        photo && uploadedText(photo.at) && <p className="text-xs text-ink-soft">{uploadedText(photo.at)}</p>
      )}
      {readFailed && hasPhoto && !photo && (
        <p role="alert" className="text-sm text-bad">
          לא הצלחנו לטעון את התמונה.{" "}
          <button type="button" className="inline-flex min-h-11 items-center font-bold text-navy underline underline-offset-4" onClick={() => setRetry((n) => n + 1)}>
            לנסות שוב
          </button>
        </p>
      )}
      {working && (
        <p className="text-sm text-ink-soft" aria-live="polite">
          מכינים את התמונה…
        </p>
      )}
      {problem && (
        <p role="alert" className="text-sm text-bad">
          {problem}
        </p>
      )}
      {mayEdit && (
        <div className="space-y-2">
          {preview ? (
            <div className="flex flex-wrap gap-2">
              <Button ref={saveButton} kind="primary" data-photo-save busy={busy === "photo"} busyLabel="שומר…" onClick={() => void save()}>
                שמירת התמונה
              </Button>
              <Button
                onClick={() => {
                  setPreview(null);
                  back.back("pick");
                }}
              >
                ביטול
              </Button>
            </div>
          ) : confirming ? (
            <Confirm
              text={`להסיר את התמונה של ${name}? היא תרד גם מאתר האורחים.`}
              confirm="הסרה"
              busy={busy === "photo-remove"}
              onConfirm={() => void remove()}
              onCancel={() => {
                setConfirming(false);
                back.back("remove");
              }}
            />
          ) : (
            !working && (
              <div className="flex flex-wrap gap-2">
                <input
                  ref={(el) => {
                    input.current = el;
                    back.ref("pick")(el);
                  }}
                  id={`${id}-pick`}
                  data-photo-pick
                  type="file"
                  accept="image/*"
                  className="peer sr-only"
                  disabled={locked}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void pick(file);
                  }}
                />
                {/* the input is 1px and clipped: the focus ring is drawn on the label that looks like the button (its sibling) */}
                <label
                  htmlFor={`${id}-pick`}
                  className={`inline-flex min-h-11 items-center rounded-full border border-navy bg-card px-4 font-bold text-navy transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${locked ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-accent-soft"}`}
                >
                  {hasPhoto ? "החלפת התמונה" : "העלאת תמונה"}
                </label>
                {hasPhoto && (
                  <Button ref={back.ref("remove")} kind="danger" data-photo-remove disabled={busy != null} onClick={() => setConfirming(true)}>
                    הסרת התמונה
                  </Button>
                )}
              </div>
            )
          )}
          {!preview && !confirming && !working && <p className="text-xs text-ink-soft">הדפדפן מקטין את התמונה ומוריד ממנה את פרטי המצלמה והמיקום.</p>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the description for guests

const BIO_REFUSAL: Record<string, string> = {
  contact_in_text: "יש כאן טלפון או מייל. האורחים קוראים את התיאור — מסירים ומנסים שוב.",
  bad_value: `עד ${LIMITS.public_bio} תווים.`,
};

const refusalText = (code: string | null): string | null => (code == null ? null : (BIO_REFUSAL[code] ?? (code === "stale" ? errorMessage("stale") : null)));

function BioBox({ port, week, s, mayEdit, busy, act }: BoxProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const rescue = useFocusRescue();
  const bio = s.public_bio?.trim() ? s.public_bio : null;
  const max = LIMITS.public_bio;

  const open = (on: boolean) => {
    setProblem(null);
    setDraft(on ? (s.public_bio ?? "") : null);
    rescue(() => (on ? area.current : editButton.current));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (draft == null) return;
    setProblem(null);
    let text: string | null;
    try {
      text = cleanPublicBio(draft);
    } catch (err) {
      const code = err instanceof CommandError ? err.code : null;
      setProblem(refusalText(code) ?? errorMessage(code));
      return;
    }
    if (text === (s.public_bio ?? null)) return open(false);
    const ok = await act("bio", () => port.speakers.update(week.edition.id, s.id, s.version, { public_bio: text }), "התיאור לאורחים נשמר", (code) => {
      const t = refusalText(code);
      if (!t) return false;
      setProblem(t);
      return true;
    });
    if (ok) open(false);
  };

  return (
    <div className="min-w-0 space-y-2" data-bio-state={bio ? "y" : "-"}>
      <div className="flex min-h-11 flex-wrap items-center gap-2">
        <h4 className="font-bold text-navy">תיאור לאורחים</h4>
        {mayEdit && draft == null && (
          <Button ref={editButton} kind="quiet" className="ms-auto" onClick={() => open(true)}>
            עריכת התיאור
          </Button>
        )}
      </div>
      {draft == null ? (
        bio ? <p className="max-w-prose whitespace-pre-line break-words leading-relaxed">{bio}</p> : <p className="text-sm text-ink-soft">עוד אין תיאור לאורחים.</p>
      ) : (
        <form onSubmit={(e) => void submit(e)} aria-label="תיאור לאורחים" className="space-y-2 rounded-xl bg-sand-soft p-3" noValidate>
          <label htmlFor={`${id}-bio`} className="block text-sm font-bold text-ink">
            תיאור לאורחים
          </label>
          <textarea
            ref={area}
            id={`${id}-bio`}
            rows={5}
            maxLength={max}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-describedby={`${id}-hint ${id}-count`}
            aria-invalid={problem ? true : undefined}
            className={`${INPUT} py-2 leading-relaxed`}
          />
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <p id={`${id}-hint`} className="min-w-0 flex-1 text-xs text-ink-soft">
              מה שהאורחים קוראים: בגוף שלישי, בלי טלפון ובלי מייל. נשמר עם המרצה גם לשנים הבאות.
            </p>
            <span id={`${id}-count`} data-bio-count className="shrink-0 text-xs tabular-nums text-ink-soft">
              <bdi dir="ltr">{`${draft.length}/${max}`}</bdi>
            </span>
          </div>
          {problem && (
            <p role="alert" className="text-sm font-semibold text-bad">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button kind="primary" type="submit" busy={busy === "bio"} busyLabel="שומר…">
              שמירה
            </Button>
            <Button onClick={() => open(false)}>ביטול</Button>
          </div>
        </form>
      )}
    </div>
  );
}
