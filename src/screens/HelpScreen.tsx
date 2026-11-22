// «עזרה» (/help, every member): the team's guide — docs/GUIDE.he.md itself, bundled at build time and drawn by the same
// markdown-lite renderer as the knowledge base, so the page in the repository and the page on the site can never say
// different things. The reset, phase 5: each member reads their own part first (src/domain/guide.ts — the title,
// their intro, their sections in the file's order); «כל המדריך» (`?all=1`) is the whole file, «רק מה שרלוונטי לי» back.
import { Link, useLocation } from "react-router";
import guide from "../../docs/GUIDE.he.md?raw";
import type { Persona } from "../data/gate";
import { GUIDE_INTRO, guidePartsFor, wantsWholeGuide } from "../domain/guide";
import { Markdown } from "./Markdown";
import { LINK_BUTTON } from "./stages/parts";

export function HelpScreen({ persona }: { persona: Persona | null }) {
  const all = wantsWholeGuide(useLocation().search);
  const { head, sections } = guidePartsFor(guide, persona, all);
  return (
    <article
      aria-label="מדריך קצר לצוות"
      data-help-persona={persona ?? undefined}
      data-help-view={all || persona == null ? "all" : "mine"}
      className="mx-auto max-w-3xl rounded-xl border border-line bg-card p-4 pb-8 shadow-sm sm:p-8"
    >
      <Markdown source={head} top={2} />
      {persona != null && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-soft">
          {all ? (
            <>
              <span>מוצג המדריך כולו.</span>
              <Link to="/help" data-help-all="mine" className={LINK_BUTTON}>
                רק מה שרלוונטי לי
              </Link>
            </>
          ) : (
            <>
              <span>מוצג מה שרלוונטי {GUIDE_INTRO[persona]}.</span>
              <Link to="/help?all=1" data-help-all="all" className={LINK_BUTTON}>
                כל המדריך
              </Link>
            </>
          )}
        </p>
      )}
      {sections.map((s) => (
        <section key={s.heading} data-help-section={s.heading}>
          <Markdown source={s.text} top={2} />
        </section>
      ))}
    </article>
  );
}
