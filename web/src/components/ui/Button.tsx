import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "link";
type Tone = "dark" | "light";

const base =
  "inline-flex items-center justify-center gap-3 font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60";

function classes(variant: Variant, tone: Tone, size: "md" | "lg", extra?: string) {
  const v =
    variant === "primary"
      ? `rounded-sm bg-gold text-ink hover:bg-gold-press active:bg-gold-press ${
          size === "lg" ? "min-h-14 px-8 text-lg" : "min-h-11 px-6 text-base"
        }`
      : `min-h-11 underline decoration-1 underline-offset-[10px] hover:decoration-gold ${
          tone === "dark"
            ? "text-on-dark decoration-on-dark/60"
            : "text-on-cream decoration-on-cream/50"
        }`;
  return [base, v, extra].filter(Boolean).join(" ");
}

type CommonProps = {
  variant?: Variant;
  /** Surface the button sits on (affects link color). */
  tone?: Tone;
  size?: "md" | "lg";
  className?: string;
  children: ReactNode;
};

/** The single gold primary action, or an underlined secondary text link. */
export function ButtonLink({
  variant = "primary",
  tone = "dark",
  size = "md",
  className,
  ...props
}: CommonProps & Omit<ComponentProps<typeof Link>, "className">) {
  return <Link className={classes(variant, tone, size, className)} {...props} />;
}

export function Button({
  variant = "primary",
  tone = "light",
  size = "md",
  className,
  type = "button",
  ...props
}: CommonProps & Omit<ComponentProps<"button">, "className">) {
  return <button type={type} className={classes(variant, tone, size, className)} {...props} />;
}

/** Play glyph inside a gold ring, as in the approved reference. */
export function PlayBadge({ className = "", size = 36 }: { className?: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center rounded-full border-2 border-gold ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.42} height={size * 0.42} fill="currentColor">
        {/* Points right (play direction is universal, not mirrored in RTL) */}
        <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" />
      </svg>
    </span>
  );
}
