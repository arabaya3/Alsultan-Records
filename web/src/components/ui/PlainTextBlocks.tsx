import { parseTextBlocks } from "@/lib/text-blocks";

/**
 * Owner text with its structure: paragraphs, numbered lists (with sub-bullets) and bullet lists — as text nodes only
 * (no HTML from the data). Long words wrap instead of overflowing.
 */
export function PlainTextBlocks({ text, className = "", ...rest }: { text: string; className?: string } & Record<`data-${string}`, string>) {
  const blocks = parseTextBlocks(text);
  return (
    <div className={`space-y-4 break-words [overflow-wrap:anywhere] ${className}`} {...rest}>
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i} className="whitespace-pre-line">
            {b.lines.join("\n")}
          </p>
        ) : b.kind === "ol" ? (
          <ol key={i} className="list-decimal space-y-3 ps-6 marker:font-semibold marker:text-gold">
            {b.items.map((it, j) => (
              <li key={j} className="ps-1">
                <span className="font-medium text-ivory">{it.text}</span>
                {it.children.length ? (
                  <ul className="mt-2 list-disc space-y-1.5 ps-5 marker:text-gold/70">
                    {it.children.map((c, k) => (
                      <li key={k}>{c}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1.5 ps-6 marker:text-gold">
            {b.items.map((c, k) => (
              <li key={k}>{c}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
