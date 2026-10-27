// What the parts of «מכריכה לכריכה» (/kk) share: the one staff action, the groups' order, and the words for a count.
import type { KkGroup } from "../../data/kk";

/** One staff action: progress on its button, a toast, then the screen read again. `onRefused` takes a refusal in place of the toast. */
export type Act = (key: string, fn: () => Promise<unknown>, ok: string | null, onRefused?: (code: string | null) => boolean) => Promise<boolean>;

/** The groups as the screen lists them: those with a book by title, then those still waiting for one, by id (the order they were made). */
export function byBook<G extends Pick<KkGroup, "id" | "title">>(groups: readonly G[]): G[] {
  return [...groups].sort((a, b) =>
    a.title != null && b.title != null ? a.title.localeCompare(b.title, "he") || a.id - b.id : a.title != null ? -1 : b.title != null ? 1 : a.id - b.id,
  );
}

/** «קבוצה אחת», «3 קבוצות». */
export const groupsWord = (n: number) => (n === 1 ? "קבוצה אחת" : `${n} קבוצות`);
