// Draws markdown-lite (src/domain/markdown.ts) as React elements — text nodes
// only, never HTML from a string: a note that holds «<script>» shows it.
import { Fragment } from "react";
import { type Line, parseMarkdown } from "../domain/markdown";

function Text({ line }: { line: Line }) {
  return (
    <>
      {line.map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <Fragment key={i}>{p.text}</Fragment>))}
    </>
  );
}

const HEADING_CLASS = ["font-display text-2xl font-extrabold", "mt-5 font-display text-lg font-semibold", "mt-3 font-semibold"];

/** `top`: the heading level a «#» becomes (the page around it has its own title). */
export function Markdown({ source, top = 3 }: { source: string; top?: 2 | 3 | 4 }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading": {
            const level = Math.min(6, top + b.level - 1);
            const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
            return (
              <Tag key={i} className={HEADING_CLASS[b.level - 1]}>
                <Text line={b.line} />
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={i}>
                {b.lines.map((l, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    <Text line={l} />
                  </Fragment>
                ))}
              </p>
            );
          case "bullets":
            return (
              <ul key={i} className="list-disc space-y-1 ps-5">
                {b.items.map((l, j) => (
                  <li key={j}>
                    <Text line={l} />
                  </li>
                ))}
              </ul>
            );
          case "numbers":
            return (
              <ol key={i} className="list-decimal space-y-1 ps-5">
                {b.items.map((l, j) => (
                  <li key={j}>
                    <Text line={l} />
                  </li>
                ))}
              </ol>
            );
        }
      })}
    </div>
  );
}
