// The availability chips: five days × four parts of a day, each part a range
// of the grid's clock (src/domain/time.ts). public.set_availability holds the
// same four ranges; a chip covers its whole part.
import type { Day } from "./time";
import type { Availability } from "./types";

export type DayPart = "morning" | "afternoon" | "evening" | "night";

export const DAY_PARTS: readonly { part: DayPart; label: string; from: number; to: number }[] = [
  { part: "morning", label: "בוקר", from: 390, to: 780 }, // 06:30–13:00
  { part: "afternoon", label: "צהריים", from: 780, to: 1140 }, // 13:00–19:00
  { part: "evening", label: "ערב", from: 1140, to: 1440 }, // 19:00–24:00
  { part: "night", label: "לילה", from: 1440, to: 1830 }, // 00:00–06:30
];

export function dayPart(part: string): { from: number; to: number } | undefined {
  return DAY_PARTS.find((p) => p.part === part);
}

export interface Chip {
  day: Day;
  part: DayPart;
  /** null = nothing said about this part. «לא» wins over «יכול/ה» when rows of both overlap it. */
  kind: "can" | "cannot" | null;
  note: string | null;
  /** True when a row covers only some of the part (an older, hand-entered range). */
  partial: boolean;
}

/** The 5 × 4 chips of one approach's availability rows. */
export function chipsOf(rows: Availability[]): Chip[] {
  const out: Chip[] = [];
  for (const day of [0, 1, 2, 3, 4] as Day[]) {
    for (const p of DAY_PARTS) {
      const here = rows.filter((r) => r.day === day && r.from_min < p.to && r.to_min > p.from);
      const pick = here.find((r) => r.kind === "cannot") ?? here.find((r) => r.kind === "can");
      out.push({
        day,
        part: p.part,
        kind: pick?.kind ?? null,
        note: pick?.note ?? null,
        partial: !!pick && (pick.from_min > p.from || pick.to_min < p.to),
      });
    }
  }
  return out;
}
