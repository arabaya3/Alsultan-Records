import { isProduction } from "@/features/public-content/site";

/**
 * Neutral, clearly-identified placeholder for media that does not exist yet.
 * Only rendered outside production; production callers must hide the section instead
 * (use `showPlaceholders`).
 */
export const showPlaceholders = !isProduction;

export function PlaceholderMedia({
  tone = "ink",
  className = "",
}: {
  tone?: "ink" | "cream";
  className?: string;
}) {
  if (isProduction) return null;
  return (
    <div
      data-placeholder="true"
      className={`absolute inset-0 grid place-items-center ${
        tone === "ink" ? "bg-night-deep text-ivory-muted" : "bg-surface text-ivory-muted"
      } ${className}`}
    >
      <span className="rounded-sm border border-current/30 px-3 py-1 text-xs">
        صورة مؤقتة — بانتظار أعمال الاستوديو
      </span>
    </div>
  );
}
