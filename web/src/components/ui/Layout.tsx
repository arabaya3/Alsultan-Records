import type { ReactNode } from "react";

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mx-auto w-full max-w-[var(--content-max)] px-[var(--gutter)] ${className}`}>
      {children}
    </div>
  );
}

type SectionProps = {
  children: ReactNode;
  tone?: "cream" | "ink" | "cream-2";
  className?: string;
  id?: string;
  labelledBy?: string;
};

export function Section({ children, tone = "cream", className = "", id, labelledBy }: SectionProps) {
  const toneClass =
    tone === "ink"
      ? "bg-ink text-on-dark"
      : tone === "cream-2"
        ? "bg-cream-2 text-on-cream"
        : "bg-cream text-on-cream";
  return (
    <section id={id} aria-labelledby={labelledBy} className={`${toneClass} py-14 md:py-20 ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

/** Section heading row: title on the start (right) side, optional action on the end (left). */
export function SectionHeading({
  id,
  title,
  lead,
  action,
}: {
  id?: string;
  title: string;
  lead?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 md:mb-10">
      <div className="max-w-2xl">
        <h2 id={id} className="text-3xl font-bold tracking-tight md:text-[2.5rem]">
          {title}
        </h2>
        {lead ? <p className="mt-3 text-lg opacity-80">{lead}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Page intro band (dark), used by inner pages. */
export function PageIntro({ title, lead, eyebrow }: { title: string; lead?: string; eyebrow?: string }) {
  return (
    <div className="bg-ink text-on-dark">
      <Container className="py-14 md:py-20">
        {eyebrow ? <p className="mb-3 text-sm text-gold">{eyebrow}</p> : null}
        <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
          {title}
          <span className="text-gold">.</span>
        </h1>
        {lead ? <p className="mt-5 max-w-2xl text-lg text-muted md:text-xl">{lead}</p> : null}
      </Container>
    </div>
  );
}
