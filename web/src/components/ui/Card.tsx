import type { ReactNode } from "react";

/**
 * Dark surface card with a hairline border.
 *   as?      — "div" (default) | "article" | "li"
 *   media?   — node rendered edge-to-edge on top (e.g. a dark frame with an object-contain image — album/work
 *              images must show the WHOLE picture, never cropped)
 *   border?  — "neutral" (default hairline) | "gold" (gold hairline, for featured items)
 *   interactive? — hover: border turns gold + slightly raised surface (no transform, no zoom)
 *   padded?  — inner padding for the body (default true)
 *   className?, bodyClassName?, plus any data-* attribute (e.g. data-package-card) via `data`.
 */
export function Card({
  as: Tag = "div",
  media,
  border = "neutral",
  interactive = false,
  padded = true,
  className = "",
  bodyClassName = "",
  data,
  children,
}: {
  as?: "div" | "article" | "li";
  media?: ReactNode;
  border?: "neutral" | "gold";
  interactive?: boolean;
  padded?: boolean;
  className?: string;
  bodyClassName?: string;
  data?: Record<`data-${string}`, string | boolean | undefined>;
  children?: ReactNode;
}) {
  return (
    <Tag
      {...data}
      className={`flex flex-col overflow-hidden rounded-lg border bg-surface text-ivory ${
        border === "gold" ? "border-hairline-gold" : "border-hairline"
      } ${interactive ? "transition-colors duration-200 hover:border-gold/70 hover:bg-surface-2 focus-within:border-gold/70" : ""} ${className}`}
    >
      {media ? <div className="relative bg-night-deep">{media}</div> : null}
      {children ? <div className={`flex flex-1 flex-col ${padded ? "p-5 md:p-6" : ""} ${bodyClassName}`}>{children}</div> : null}
    </Tag>
  );
}
