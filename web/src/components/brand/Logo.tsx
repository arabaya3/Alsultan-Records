import Image from "next/image";
import Link from "next/link";
import { SITE_NAME_AR } from "@/features/public-content/site";
import { ActiveLogoImg } from "./ActiveLogoImg";

export const DEFAULT_LOGO = "/brand/logo-main.webp";

/** `/a/<id>` when the owner activated an uploaded logo, else null (built-in logo). */
export function activeLogoSrc(activeLogoId: string | null | undefined): string | null {
  return activeLogoId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeLogoId) ? `/a/${activeLogoId}` : null;
}

/**
 * The ORIGINAL logo file, rendered as-is (no recolor/crop/redraw), unless the owner activated an
 * uploaded logo (`src` = /a/<id>), which is rendered at the same height with its own ratio.
 * Intrinsic size: logo-main.webp 900×748. Only the height is set; width follows the ratio.
 */
export function Logo({
  height = 72,
  priority = false,
  asLink = true,
  className = "",
  src = null,
}: {
  height?: number;
  priority?: boolean;
  asLink?: boolean;
  className?: string;
  src?: string | null;
}) {
  const width = Math.round((height * 900) / 748);
  const img = src ? (
    // Gated same-origin bytes with short cache: plain <img>, no optimizer cache in the rollback path.
    <ActiveLogoImg
      src={src}
      fallback={DEFAULT_LOGO}
      alt={SITE_NAME_AR}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      style={{ height, width: "auto", maxWidth: Math.round(height * 2.4) }}
      className={`object-contain ${className}`}
    />
  ) : (
    <Image
      src={DEFAULT_LOGO}
      alt={SITE_NAME_AR}
      width={900}
      height={748}
      priority={priority}
      sizes={`${width}px`}
      style={{ height, width: "auto" }}
      className={className}
    />
  );
  if (!asLink) return img;
  return (
    <Link href="/" aria-label={`${SITE_NAME_AR} — الرئيسية`} className="inline-block shrink-0">
      {img}
    </Link>
  );
}
