import type { ReactNode } from "react";
import { PageHero } from "./PageHero";

/** Centered content column with the site gutter. Props: children, className?. */
export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mx-auto w-full max-w-[var(--content-max)] px-[var(--gutter)] ${className}`}>
      {children}
    </div>
  );
}

/**
 * Section tones (public, black cinematic):
 *   "dark"   — default, night background
 *   "darker" — deeper band to separate consecutive sections
 *   "ivory"  — light band, use sparingly (like the references' light CTA / "how we work" band)
 * Legacy values still accepted while pages migrate: "cream" → dark, "cream-2" / "ink" → darker.
 */
export type SectionTone = "dark" | "darker" | "ivory" | "cream" | "cream-2" | "ink";

type SectionProps = {
  children: ReactNode;
  tone?: SectionTone;
  className?: string;
  /** Extra classes for the inner Container. */
  containerClassName?: string;
  id?: string;
  /** id of the section's heading (sets aria-labelledby). */
  labelledBy?: string;
  /** Render children without the Container (full-bleed content). */
  bleed?: boolean;
};

const TONE: Record<SectionTone, string> = {
  dark: "tone-dark bg-night text-ivory",
  cream: "tone-dark bg-night text-ivory",
  darker: "tone-darker bg-night-deep text-ivory",
  "cream-2": "tone-darker bg-night-deep text-ivory",
  ink: "tone-darker bg-night-deep text-ivory",
  ivory: "tone-ivory bg-ivory-band text-on-cream",
};

export function Section({
  children,
  tone = "dark",
  className = "",
  containerClassName = "",
  id,
  labelledBy,
  bleed = false,
}: SectionProps) {
  return (
    <section id={id} aria-labelledby={labelledBy} data-tone={tone} className={`${TONE[tone]} py-section ${className}`}>
      {bleed ? children : <Container className={containerClassName}>{children}</Container>}
    </section>
  );
}

/**
 * Heading block: title, short gold rule, optional lead; optional action on the end (left) side.
 *   as: "h1" | "h2" (default) | "h3" · align: "start" (default) | "center"
 *   id goes on the heading element (use it as the Section's labelledBy).
 */
export function SectionHeading({
  id,
  title,
  lead,
  action,
  eyebrow,
  as: Tag = "h2",
  align = "start",
  className = "",
}: {
  id?: string;
  title: ReactNode;
  lead?: ReactNode;
  action?: ReactNode;
  /** Small gold label above the title (e.g. "01"). */
  eyebrow?: ReactNode;
  as?: "h1" | "h2" | "h3";
  align?: "start" | "center";
  className?: string;
}) {
  const center = align === "center";
  const size = Tag === "h1" ? "text-h1" : Tag === "h3" ? "text-h3" : "text-h2";
  return (
    <div
      className={`mb-stack flex gap-x-8 gap-y-4 ${center ? "flex-col items-center text-center" : "flex-wrap items-end justify-between"} ${className}`}
    >
      <div className={`max-w-2xl ${center ? "mx-auto" : ""}`}>
        {eyebrow ? <p className="mb-2 text-sm font-medium tracking-wide text-tone-accent">{eyebrow}</p> : null}
        <Tag id={id} className={`${size} font-bold tracking-tight`}>
          {title}
        </Tag>
        <span aria-hidden="true" className={`gold-rule mt-4 ${center ? "mx-auto" : ""}`} />
        {lead ? <p className="mt-4 text-lead text-tone-muted">{lead}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** @deprecated Use PageHero. Kept so existing pages render in the new style until migrated. */
export function PageIntro({ title, lead, eyebrow }: { title: string; lead?: string; eyebrow?: string }) {
  return <PageHero title={title} lead={lead} eyebrow={eyebrow} />;
}
