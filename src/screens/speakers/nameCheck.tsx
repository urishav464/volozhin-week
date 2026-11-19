// Search first: the name typed is looked up in the pool as it is typed (the same name key, or a similar one: pg_trgm
// ≥ 0.6, «הצעה»), and the matches show as «ייתכן שזה…» — the first five, the rest behind one tap. «מרצה חדש/ה»
// (/speakers/new, src/screens/speakerPages/NewSpeakerScreen.tsx) reads it; the grid's old side sheet went in phase 3.
import { useEffect, useState } from "react";
import type { DataPort } from "../../data/port";
import type { SpeakerMatch } from "../../data/speakers";
import { nameKey } from "../../domain/nameKey";
import { byGender, displayName } from "../../domain/names";
import { Chip } from "../../grid/bits";
import { vettingLabel } from "../../lib/labels";
import { Button } from "../settings/kit";

/** The field a create's refusal is about. */
export const FIELD_OF: Record<string, "name" | "disambiguator"> = { name_required: "name", disambiguator_required: "disambiguator", speaker_exists: "disambiguator" };

/** How many matches show before «עוד N שמות דומים»: «זה מישהו אחר — להמשיך» stays on the first screen. */
export const MATCHES_SHOWN = 5;

/**
 * The pool's matches for a name, as it is typed (a short pause first; a late answer for an older name is dropped).
 * `current` is null while the search for this very name runs; `again` searches once more (someone added a similar
 * name meanwhile: the database said `speaker_similar`).
 */
export function useNameCheck(port: DataPort, name: string): { key: string; current: SpeakerMatch[] | null; sameName: boolean; again: () => void } {
  const key = nameKey(name);
  const [found, setFound] = useState<{ name: string; matches: SpeakerMatch[] } | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!key) {
      setFound({ name, matches: [] });
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      port.speakers
        .matches(name)
        .then((matches) => live && setFound({ name, matches }))
        .catch(() => live && setFound({ name, matches: [] }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [port, key, name, n]);
  const current = found && found.name === name ? found.matches : null;
  return { key, current, sameName: !!current?.some((m) => m.match === "same"), again: () => setN((x) => x + 1) };
}

/**
 * «ייתכן שזה…»: one short line for a screen reader (not the whole list after every pause in typing) that is also the
 * list's heading, then the matches with «פתיחה». `folded`: the matches were seen before «להמשיך» — one line, «הצגה»
 * opens them (`onUnfold`); `onFold` hides them again.
 */
export function MatchList({
  name,
  nameKey: key,
  current,
  folded,
  onUnfold,
  onFold,
  onOpen,
}: {
  name: string;
  nameKey: string;
  current: SpeakerMatch[] | null;
  folded: boolean;
  onUnfold: () => void;
  onFold?: () => void;
  onOpen: (m: SpeakerMatch) => void;
}) {
  const [allFor, setAllFor] = useState<string | null>(null);
  const sameName = !!current?.some((m) => m.match === "same");
  const shown = current && allFor !== name ? current.slice(0, MATCHES_SHOWN) : current;
  return (
    <section aria-label="ייתכן שזה…" className="space-y-1.5">
      <p role="status" className={current?.length && !folded ? "font-semibold" : folded ? "sr-only" : "text-sm text-ink-soft"}>
        {!key ? "" : current == null ? "מחפשים במאגר…" : current.length === 0 ? "אין במאגר שם דומה." : sameName ? "אותו שם כבר במאגר." : current.length === 1 ? "נמצא במאגר שם דומה אחד." : `נמצאו במאגר ${current.length} שמות דומים.`}
      </p>
      {current && current.length > 0 && folded && (
        <Button kind="quiet" aria-expanded={false} onClick={onUnfold}>
          {current.length === 1 ? "שם דומה אחד במאגר" : `${current.length} שמות דומים במאגר`} — הצגה
        </Button>
      )}
      {current && shown && current.length > 0 && !folded && (
        <>
          <ul className="space-y-1.5">
            {shown.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-line bg-card px-3 py-2 shadow-sm">
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block font-bold text-navy break-words">
                    {displayName(m)}
                    {m.disambiguator && <span className="font-normal text-ink-soft"> ({m.disambiguator})</span>}
                  </span>
                  <span className="flex flex-wrap items-center gap-1 text-xs text-ink-soft">
                    {m.affiliation && <span className="break-words">{m.affiliation}</span>}
                    {/* a similar name needs no chip: the list is the similar names */}
                    {m.match === "same" && <Chip tone="warn">אותו שם</Chip>}
                    {m.vetted !== "approved" && <Chip>{vettingLabel(m.vetted, m.gender)}</Chip>}
                    {m.retired && <Chip>{byGender(m.gender, "לא פעיל", "לא פעילה")}</Chip>}
                  </span>
                </span>
                <Button onClick={() => onOpen(m)} aria-label={`פתיחת ${displayName(m)}`}>
                  פתיחה
                </Button>
              </li>
            ))}
          </ul>
          {current.length > MATCHES_SHOWN && (
            <Button kind="quiet" aria-expanded={allFor === name} onClick={() => setAllFor(allFor === name ? null : name)}>
              {allFor === name ? (
                <>
                  פחות <span aria-hidden>▴</span>
                </>
              ) : (
                <>
                  {current.length - MATCHES_SHOWN === 1 ? "עוד שם דומה אחד" : `עוד ${current.length - MATCHES_SHOWN} שמות דומים`} <span aria-hidden>▾</span>
                </>
              )}
            </Button>
          )}
          {onFold && (
            <Button kind="quiet" aria-expanded onClick={onFold}>
              הסתרת השמות הדומים
            </Button>
          )}
        </>
      )}
    </section>
  );
}
