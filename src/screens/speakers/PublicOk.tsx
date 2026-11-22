// The guests' site on the team's pages (the reset, phase 5) — what the speaker page's and the lesson page's «לאתר
// האורחים» and «תוצרים ← אתר האורחים» share: the box «מאושר/ת להופיע באתר האורחים» (set_public_ok — the owner's decision,
// 22.11: the speaker's handler or the staff, as the database allows; offered once the speaker agreed, or to take a mark
// back; never in a practice or demo week but to a global admin), its words, and the photos a preview reads.
import { useEffect, useId, useRef, useState } from "react";
import type { DataPort } from "../../data/port";
import { type GuestActor, mayMarkPublic, mayUnmarkPublic, publicOkOffered, readPhotos } from "../../domain/guestSite";
import { byGender, displayName } from "../../domain/names";
import type { Approach, Edition, Gender, Speaker } from "../../domain/types";
import { useFocusRescue } from "../settings/kit";

/** The box's hint: when to mark, and what taking it back does. */
export const publicOkHint = (g: Gender | null | undefined) =>
  `מסמנים רק אחרי שהמרצה ${byGender(g, "הסכים", "הסכימה")} שהשם, התיאור והתמונה יופיעו באתר. ביטול מוריד אותם מהאתר מיד.`;

/** The toast after a change — the words of the activity log («אושר/ה להופיע באתר האורחים», «הוסר/ה מאתר האורחים»). */
export const publicOkDone = (s: Pick<Speaker, "title" | "name" | "gender">, ok: boolean) =>
  ok ? `${displayName(s)} ${byGender(s.gender, "אושר", "אושרה")} להופיע באתר האורחים` : `${displayName(s)} ${byGender(s.gender, "הוסר", "הוסרה")} מאתר האורחים`;

/** «מאושר/ת להופיע» as a state, in the speaker's gender. */
export const approvedWord = (g: Gender | null | undefined) => byGender(g, "מאושר", "מאושרת");

/** A practice or demo week: only a global admin's mark counts there (app.may_edit_speaker) — nobody else is offered the box. */
export const practiceWeek = (actor: Pick<GuestActor, "global">, edition: Pick<Edition, "kind">) => !actor.global && (edition.kind === "practice" || edition.kind === "demo");

/**
 * «מאושר/ת להופיע באתר האורחים» for one approach: a real checkbox, each change ONE `onSet` (the page's setPublicOk,
 * then the week again). Before the speaker agreed: a line instead. Not this viewer's to change: the state, read-only.
 * `hint` false where the page says it once for several speakers (the lesson page).
 */
export function PublicOkSwitch({
  speaker: s,
  approach: a,
  actor,
  edition,
  busy,
  onSet,
  hint = true,
}: {
  speaker: Pick<Speaker, "gender">;
  approach: Approach;
  actor: GuestActor;
  edition: Pick<Edition, "kind" | "status">;
  busy: boolean;
  onSet: (ok: boolean) => Promise<unknown>;
  hint?: boolean;
}) {
  const id = useId();
  const [want, setWant] = useState<boolean | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const rescue = useFocusRescue();
  if (practiceWeek(actor, edition)) {
    return (
      <p className="text-sm text-ink-soft" data-public-ok-practice>
        במחזור תרגול לא מפרסמים מרצים לאורחים
      </p>
    );
  }
  if (!publicOkOffered(a)) {
    return <p className="text-sm text-ink-soft">אפשר לסמן אחרי שהמרצה {byGender(s.gender, "מסכים", "מסכימה")} ללמד</p>;
  }
  const may = a.public_ok ? mayUnmarkPublic(actor, a) : mayMarkPublic(actor, edition, a);
  const checked = want ?? a.public_ok === true;
  const change = async (v: boolean) => {
    if (busy || !may) return;
    // taking back a mark on an approach that is no longer «positive» takes the box away: the focus stays in its section
    const home = box.current?.closest<HTMLElement>("section[id]") ?? null;
    setWant(v);
    try {
      await onSet(v);
    } finally {
      setWant(null);
      rescue(() => box.current?.querySelector<HTMLElement>("input:not([disabled])") ?? box.current ?? home);
    }
  };
  return (
    <div ref={box} tabIndex={-1} className="space-y-1 outline-none">
      <label className={`inline-flex min-h-11 items-center gap-2 font-bold ${may ? "cursor-pointer text-ink" : "text-ink-soft"}`}>
        <input
          type="checkbox"
          data-public-ok={a.id}
          checked={checked}
          disabled={!may}
          aria-disabled={busy || undefined}
          aria-describedby={hint && may ? `${id}-hint` : undefined}
          onChange={(e) => void change(e.target.checked)}
          className="size-5 shrink-0 accent-navy"
        />
        {approvedWord(s.gender)} להופיע באתר האורחים
      </label>
      {!may && <p className="text-xs text-ink-soft">מסמנים מי שמטפל/ת במרצה או הצוות.</p>}
      {hint && may && (
        <p id={`${id}-hint`} className="max-w-prose text-xs text-ink-soft">
          {publicOkHint(s.gender)}
        </p>
      )}
    </div>
  );
}

/**
 * The stored photos of `ids` while `on` (a preview is open), read on demand at most four at a time (readPhotos) — and
 * forgotten when it closes: photo bytes live in React state only, never in the browser's storage. An id that joins
 * (the week reloaded) is read then; one already read is not read again.
 */
export function useGuestPhotos(port: DataPort, ids: readonly number[], on: boolean): { photos: ReadonlyMap<number, string>; loading: boolean; failed: number } {
  const [photos, setPhotos] = useState<ReadonlyMap<number, string>>(() => new Map());
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const tried = useRef(new Set<number>());
  const key = ids.join(",");
  useEffect(() => {
    if (!on) {
      tried.current = new Set();
      setPhotos(new Map());
      setFailed(0);
      return;
    }
    const missing = (key === "" ? [] : key.split(",").map(Number)).filter((id) => !tried.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) tried.current.add(id);
    let settled = false;
    let cancelled = false;
    setPending((n) => n + 1);
    void readPhotos(missing, (id) => port.speakers.photo(id)).then(({ photos: got, failed: f }) => {
      if (cancelled) return;
      settled = true;
      setPhotos((m) => new Map([...m, ...got]));
      setFailed((x) => x + f);
      setPending((n) => n - 1);
    });
    // left before the answer (closed, the page left, or a second run in development): those ids are read again next time
    return () => {
      if (settled) return;
      cancelled = true;
      for (const id of missing) tried.current.delete(id);
      setPending((n) => n - 1);
    };
  }, [port, key, on]);
  return { photos, loading: on && pending > 0, failed };
}
