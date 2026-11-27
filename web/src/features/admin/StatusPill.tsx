import type { ReactNode } from "react";
import type { Tone } from "./ui";

/** Status as a soft pill with a dot («● منشور»), as in the designs. */
export function StatusPill({ label, tone = "neutral", icon }: { label: string; tone?: Tone; icon?: ReactNode }) {
  const cls =
    tone === "success"
      ? "border-success/30 bg-success/10 text-success"
      : tone === "gold"
        ? "border-gold/60 bg-gold/20 text-gold-text"
        : tone === "danger"
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-cream-line bg-cream-2 text-on-cream-muted";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {icon ?? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {label}
    </span>
  );
}
