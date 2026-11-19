// «נשלח לדפוס» (v19, public.set_reader_sent): what the reader's panel says and who may press it — pure, unit-tested.
// The mark is the edition's settings.reader_sent {at, by}; files uploaded after it are filesAfterSent
// (src/reader/model.ts). Who may mark it is app.require_logistics: the edition's logistics team and its admins; an
// archived edition (or an archive) its admins only. Everyone else who opens /reader reads the state.
import { israelDate, israelMoment } from "../../domain/israelTime";
import type { Edition, TeamMember, Week } from "../../domain/types";
import type { Actor } from "../weekStore";

/** app.require_logistics in the browser. */
export function maySendReader(actor: Pick<Actor, "isAdmin" | "role">, edition: Pick<Edition, "kind" | "status">): boolean {
  if (actor.isAdmin) return true;
  return actor.role === "logistics" && edition.kind !== "archive" && edition.status !== "archived";
}

/** «7.2.2027» and «18:05», in Israel. */
function dayAndTime(iso: string): { day: string; time: string } {
  const [y, m, d] = israelDate(iso).split("-").map(Number);
  return { day: `${d}.${m}.${y}`, time: israelMoment(iso).split(" ")[1] ?? "" };
}

/** The panel's line: not marked, or when and by whom (a member who left the team: no name). */
export function sentLine(week: Pick<Week, "edition" | "team">, team: readonly Pick<TeamMember, "id" | "display_name">[] = week.team): string {
  const sent = week.edition.settings?.reader_sent;
  if (!sent?.at || !Number.isFinite(Date.parse(sent.at))) return "עוד לא סומן שהמקראה נשלחה לדפוס.";
  const { day, time } = dayAndTime(sent.at);
  const who = sent.by != null ? team.find((m) => m.id === sent.by)?.display_name : undefined;
  return who ? `נשלחה לדפוס ב-${day} בשעה ${time} · סימן/ה: ${who}.` : `נשלחה לדפוס ב-${day} בשעה ${time}.`;
}

/** «נוספו N קבצים אחרי השליחה — אולי צריך לשלוח שוב.»; null when none. */
export function afterSentLine(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? "נוסף קובץ אחד אחרי השליחה — אולי צריך לשלוח שוב." : `נוספו ${n} קבצים אחרי השליחה — אולי צריך לשלוח שוב.`;
}
