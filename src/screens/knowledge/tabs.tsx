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
    <nav aria-label="ידע" className="flex flex-wrap gap-1.5 print:hidden">
      {items.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          end
          className={({ isActive }) =>
            `inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-bold transition-colors duration-150 ${isActive ? "border-navy bg-navy text-white shadow-sm" : "border-line bg-card text-navy hover:border-navy/50 hover:bg-accent-soft"}`
          }
        >
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
