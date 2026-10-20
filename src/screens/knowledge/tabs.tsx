// «ידע» has two tabs: the knowledge base and milestones (/knowledge), and «סיכום המחזור» (/knowledge/summary) — the
// second for the edition's admins and content members only (it lists «איך עבר», opinions about people). Its own
// file, so the knowledge screen does not load the summary's writers.
import { NavLink } from "react-router";
import type { Actor } from "../weekStore";

/** «ידע ואבני דרך» and «סיכום המחזור» — the second for the edition's admins and content members only. */
export function KnowledgeTabs({ actor }: { actor: Actor }) {
  const items = [{ to: "/knowledge", label: "ידע ואבני דרך" }, ...(actor.role !== "logistics" ? [{ to: "/knowledge/summary", label: "סיכום המחזור" }] : [])];
  if (items.length < 2) return null;
  return (
    <nav aria-label="ידע" className="flex flex-wrap gap-1 print:hidden">
      {items.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          end
          className={({ isActive }) =>
            `inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold ${isActive ? "bg-ink text-paper" : "border border-line bg-card text-ink hover:bg-line/50"}`
          }
        >
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
