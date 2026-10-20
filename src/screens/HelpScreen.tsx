// «עזרה» (/help, every member): the team's one-page guide — docs/GUIDE.he.md
// itself, bundled at build time and drawn by the same markdown-lite renderer as
// the knowledge base, so the page in the repository and the page on the site
// can never say different things.
import guide from "../../docs/GUIDE.he.md?raw";
import { Markdown } from "./Markdown";

export function HelpScreen() {
  return (
    <article aria-label="מדריך קצר לצוות" className="mx-auto max-w-3xl rounded-xl border border-line bg-card p-4 pb-8 shadow-sm sm:p-6">
      <Markdown source={guide} top={2} />
    </article>
  );
}
