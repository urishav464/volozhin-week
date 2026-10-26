// The call (v14): the first step after a speaker is proposed. Shared by the lesson panel's candidate card and the
// speaker sheet — the points to say (the instructor's text, src/domain/callPoints.ts) and the call's result, which is
// the approach's status (set_approach_status, with a note: the lesson's topic, what was said about volunteering).
import { useId, useState } from "react";
import { composeCallPoints } from "../../domain/callPoints";
import { byGender } from "../../domain/names";
import type { ApproachStatus, Gender, Week } from "../../domain/types";
import { statusLabel } from "../../lib/labels";
import { LIMITS } from "../../data/speakerRules";
import { Button, INPUT } from "../settings/kit";

/** The points, as the instructor wrote them (asterisks and all), addressed by the speaker's gender; the caller's name for X. */
export function CallPoints({ week, speakerGender, memberId }: { week: Week; speakerGender: Gender | null; memberId: number | null }) {
  const caller = week.team.find((t) => t.id === memberId) ?? null;
  const c = composeCallPoints({
    template: week.edition.settings.call_template,
    speakerGender,
    caller: caller ? { name: caller.display_name, gender: caller.gender } : null,
  });
  return (
    <div className="space-y-1.5">
      <p className="whitespace-pre-line rounded-lg bg-card px-3 py-2.5 text-[15px] leading-relaxed" data-call-points>
        {c.text}
      </p>
      {c.problems.length > 0 && (
        <ul className="list-disc ps-5 text-xs text-ink-soft" aria-label="מה חסר בנקודות">
          {c.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The results a call can have, in the order a caller reaches for them. */
const RESULTS: ApproachStatus[] = ["positive", "approached", "no_answer", "declined"];

/** How the call went: one tap records it on the approach, with what was said. The current status is not offered again. */
export function CallResults({
  status,
  gender,
  busy,
  onResult,
}: {
  status: ApproachStatus;
  gender: Gender | null;
  busy: boolean;
  /** Resolves false when the result was refused: the typed note stays for another try. */
  onResult: (status: ApproachStatus, note: string | null) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const id = useId();
  const said = byGender(gender, "אמר", "אמרה", "אמר/ה");
  return (
    <div role="group" aria-label="תוצאת השיחה" className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        מה נאמר בשיחה <span className="font-normal text-ink-soft">(לא חובה)</span>
      </label>
      <input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={LIMITS.note} placeholder={`למשל: נושא השיעור, מה ${said} על התנדבות`} className={INPUT} />
      <div className="flex flex-wrap gap-1.5">
        {RESULTS.filter((r) => r !== status).map((r) => (
          <Button
            key={r}
            kind={r === "positive" ? "primary" : r === "declined" ? "quiet" : "secondary"}
            busy={busy}
            onClick={async () => {
              if (await onResult(r, note.trim() || null)) setNote("");
            }}
          >
            {statusLabel(r, gender)}
          </Button>
        ))}
      </div>
    </div>
  );
}
