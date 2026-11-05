// «הצעה הוגנת» over the board (src/domain/rotaSuggest.ts — pure, deterministic): first a preview, its chips dashed with
// «מוצע» on the board and its status said («הוצעו N · M לא התמלאו · עומס X–Y»), then «החלת ההצעה» — ONE insert of
// every row, all or nothing (a row taken meanwhile: `stale`, the rota read again and the suggestion made again from it)
// — or «ביטול». The preview lives in this screen only: a reload discards it, a hand edit makes it again around the edit.
// «ניקוי השיבוצים המוצעים (N)» — ONE delete of the rows still «suggested» (an edited one is «hand» and stays) — is an
// occasional act: behind «פעולות נוספות» and a Confirm, whose «ביטול» gives its button the focus back.
import { useState } from "react";
import type { GroupLoad } from "../../../domain/rota";
import type { RotaSuggestion } from "../../../domain/rotaSuggest";
import { Badge, Button, Confirm, Fold, useFocusBack } from "../../settings/kit";
import type { RotaCtx } from "./parts";

/** The loads' range over the groups whose cohort is on campus at all: [fewest, most] shifts; null with none. */
export function loadRange(loads: ReadonlyMap<number, GroupLoad>): [number, number] | null {
  const xs = [...loads.values()].filter((l) => l.present > 0).map((l) => l.shifts);
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
}

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

export function SuggestBar({ ctx, suggestion, onStart, onStop }: { ctx: RotaCtx; suggestion: RotaSuggestion | null; onStart: () => void; onStop: () => void }) {
  const { port, week, data, busy, act, notify } = ctx;
  const focusBack = useFocusBack();
  const [clearing, setClearing] = useState(false);
  const stored = data.assignments.filter((a) => a.source === "suggested").length;
  if (!ctx.mayWrite) return null;

  const apply = async (s: RotaSuggestion) => {
    const n = s.add.length;
    // a refusal (`stale`: a row taken meanwhile) keeps the preview on: it is made again from the rota read again
    const ok = await act("apply", () => port.rota.applySuggestion(week.edition.id, s.add), `${count(n, "נוסף שיבוץ מוצע אחד", "שיבוצים מוצעים נוספו")}. אפשר לשנות כל אחד ביד.`);
    if (ok) {
      onStop();
      focusBack.back("suggest");
    }
  };

  const clear = async () => {
    let gone = 0;
    const ok = await act(
      "clear",
      async () => {
        gone = await port.rota.clearSuggested(week.edition.id);
      },
      null,
    );
    setClearing(false);
    if (ok) notify("ok", gone === 1 ? "שיבוץ מוצע אחד נמחק." : `${gone} שיבוצים מוצעים נמחקו.`);
    focusBack.back("clear");
  };

  const unfilled = suggestion ? suggestion.unfilled.reduce((s, u) => s + u.missing, 0) : 0;
  const range = suggestion ? loadRange(suggestion.loads) : null;

  return (
    <div data-rota-suggest className="space-y-2 rounded-xl border border-line bg-card p-3 shadow-sm">
      {suggestion ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p role="status" data-suggest-status className="min-w-0 basis-full text-sm font-bold text-navy sm:basis-auto">
            הוצעו {suggestion.add.length} · {unfilled} לא התמלאו · עומס{" "}
            {range ? (
              <bdi dir="ltr">
                {range[0]}–{range[1]}
              </bdi>
            ) : (
              "—"
            )}
          </p>
          <div className="flex flex-wrap gap-2 sm:ms-auto">
            <Button kind="primary" busy={busy === "apply"} busyLabel="מחיל…" disabled={suggestion.add.length === 0} onClick={() => void apply(suggestion)}>
              החלת ההצעה
            </Button>
            <Button
              onClick={() => {
                onStop();
                focusBack.back("suggest");
              }}
            >
              ביטול
            </Button>
          </div>
          <p className="basis-full text-xs text-ink-soft">
            המוצעים מקווקווים בלוח ומסומנים «מוצע». ההצעה ממלאת רק מקומות ריקים, רק במכינות שסומנו בקמפוס, ולא נוגעת בשיבוצים שכבר יש. «לא התמלאו» — מקומות שלא נמצאה להם קבוצה פנויה.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button kind="primary" ref={focusBack.ref("suggest")} onClick={onStart}>
            הצעה הוגנת
          </Button>
          <p className="min-w-0 flex-1 basis-56 text-xs text-ink-soft">
            ממלאת את המקומות הריקים לפי העומס של כל קבוצה ביחס למשמרות שהמכינה שלה בקמפוס, ומשתדלת שלא יהיו משמרות צמודות. קודם רואים אותה, ואז מחליטים. <Badge tone="accent">הצעה</Badge>
          </p>
        </div>
      )}
      <Fold title="פעולות נוספות" size="sm">
        {clearing ? (
          <Confirm
            text={
              <>
                למחוק את {count(stored, "השיבוץ המוצע", "השיבוצים המוצעים")}? שיבוצים שנעשו ביד, או ששונו ביד, נשארים.
              </>
            }
            confirm="ניקוי"
            busy={busy === "clear"}
            onConfirm={() => void clear()}
            onCancel={() => {
              setClearing(false);
              focusBack.back("clear");
            }}
          />
        ) : (
          <Button kind="danger" ref={focusBack.ref("clear")} keepFocus disabled={stored === 0} onClick={() => setClearing(true)}>
            ניקוי השיבוצים המוצעים ({stored})
          </Button>
        )}
      </Fold>
    </div>
  );
}
