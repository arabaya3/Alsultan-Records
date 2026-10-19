import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Button / ButtonLink
 *   variant: "primary" (gold, ink text — the main action) · "outline" (ivory hairline, for dark surfaces)
 *            · "ghost" (text only, subtle hover surface) · "link" (underlined text link)
 *   tone:    surface the control sits on — "dark" (default on public pages) or "light" (ivory band / admin).
 *            Affects outline/ghost/link colors only.
 *   size:    "md" (min 44px) · "lg" (min 56px)
 * All variants are ≥44px tall, have hover/press states and use the global gold focus ring.
 */
export type ButtonVariant = "primary" | "outline" | "ghost" | "link";
export type ButtonTone = "dark" | "light";
export type ButtonSize = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-3 font-medium transition-[color,background-color,border-color,transform] duration-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60";

export function buttonClasses({
  variant = "primary",
  tone = "dark",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  tone?: ButtonTone;
  size?: ButtonSize;
  className?: string;
}) {
  const box = size === "lg" ? "min-h-14 px-8 text-lg" : "min-h-11 px-6 text-base";
  const dark = tone === "dark";
  let v: string;
  switch (variant) {
    case "outline":
      v = `rounded-sm border ${box} ${
        dark
          ? "border-ivory/55 text-ivory hover:border-gold hover:text-gold"
          : "border-on-cream/50 text-on-cream hover:border-gold-text hover:text-gold-text"
      }`;
      break;
    case "ghost":
      v = `rounded-sm ${box} ${dark ? "text-ivory hover:bg-surface-2 hover:text-gold" : "text-on-cream hover:bg-cream-2"}`;
      break;
    case "link":
      v = `min-h-11 underline decoration-1 underline-offset-[10px] hover:decoration-gold ${
        dark ? "text-ivory decoration-ivory/60" : "text-on-cream decoration-on-cream/50"
      }`;
      break;
    default:
      v = `rounded-sm bg-gold text-ink hover:bg-gold-press active:bg-gold-press ${box}`;
  }
  return [base, v, className].filter(Boolean).join(" ");
}

type CommonProps = {
  variant?: ButtonVariant;
  tone?: ButtonTone;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
};

/** Internal navigation styled as a button. Props: CommonProps + next/link props (href …). */
export function ButtonLink({
  variant = "primary",
  tone = "dark",
  size = "md",
  className,
  ...props
}: CommonProps & Omit<ComponentProps<typeof Link>, "className">) {
  return <Link className={buttonClasses({ variant, tone, size, className })} {...props} />;
}

/** Native <button> (type="button" by default). Props: CommonProps + button props. */
export function Button({
  variant = "primary",
  tone = "dark",
  size = "md",
  className,
  type = "button",
  ...props
}: CommonProps & Omit<ComponentProps<"button">, "className">) {
  return <button type={type} className={buttonClasses({ variant, tone, size, className })} {...props} />;
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
