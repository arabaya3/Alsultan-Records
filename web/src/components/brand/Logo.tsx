import Image from "next/image";
import Link from "next/link";
import { SITE_NAME_AR } from "@/features/public-content/site";

/**
 * The ORIGINAL logo file, rendered as-is (no recolor/crop/redraw).
 * Intrinsic size: logo-main.webp 900×748. Only the height is set; width follows the ratio.
 */
export function Logo({
  height = 72,
  priority = false,
  asLink = true,
  className = "",
}: {
  height?: number;
  priority?: boolean;
  asLink?: boolean;
  className?: string;
}) {
  const width = Math.round((height * 900) / 748);
  const img = (
    <Image
      src="/brand/logo-main.webp"
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
