import { PlainTextBlocks } from "@/components/ui/PlainTextBlocks";
import { detailSections, type DetailSection } from "@/lib/text-blocks";

function Dot() {
  return <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-gold" />;
}

function SectionCard({ s }: { s: DetailSection }) {
  const wide = s.accent || !s.title;
  return (
    <section
      data-offer-section={s.title ?? ""}
      data-accent={s.accent ? "1" : undefined}
      className={`min-w-0 rounded-lg border p-5 md:p-6 ${wide ? "sm:col-span-2" : ""} ${
        s.accent ? "border-gold/70 bg-gold/[0.06]" : s.title ? "border-hairline-gold bg-surface" : "border-transparent px-0 md:px-0"
      }`}
    >
      {s.title ? (
        <h3 className="flex items-baseline gap-3 font-display text-lg font-semibold leading-snug text-ivory">
          {s.number ? (
            <span aria-hidden="true" className="font-bold text-gold">
              {s.number.toLocaleString("ar-PS")}.
            </span>
          ) : null}
          <span className="min-w-0">{s.title}</span>
        </h3>
      ) : null}
      {s.lines.length ? <p className="whitespace-pre-line text-ivory-muted">{s.lines.join("\n")}</p> : null}
      {s.items.length ? (
        <ul className={`space-y-2 text-ivory-muted ${s.title ? "mt-4 border-t border-hairline pt-4" : ""} ${s.accent && s.items.length > 3 ? "sm:grid sm:grid-cols-2 sm:gap-x-8 sm:space-y-0 sm:gap-y-2" : ""}`}>
          {s.items.map((it, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <Dot />
              <span className="min-w-0">{it}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * The offer's own description, laid out as titled cards when the owner wrote it in sections (numbered services with
 * their details, «التسليمات والهدايا» with its list); otherwise the plain structured text. Same words, same order —
 * every line of the stored text is shown (see detailSections). Two columns from sm up, one on phones; a deliveries/
 * gifts section and untitled text take the full row so the reading order never jumps between columns.
 */
export function OfferDetails({ text }: { text: string }) {
  const sections = detailSections(text);
  const titled = sections.filter((s) => s.title).length;
  if (titled < 2) return <PlainTextBlocks text={text} data-offer-description="" className="max-w-3xl text-lg text-ivory-muted" />;
  return (
    <div data-offer-description="" className="grid gap-4 break-words [overflow-wrap:anywhere] sm:grid-cols-2 md:gap-5">
      {sections.map((s, i) => (
        <SectionCard key={i} s={s} />
      ))}
    </div>
  );
}
