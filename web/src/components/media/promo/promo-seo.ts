import { arNum } from "@/features/public-content/labels";
import { siteUrl } from "@/features/public-content/site";
import { PROMO_ASSETS } from "./promo-assets";

const SECONDS = PROMO_ASSETS.landscape.durationSeconds;

/** «فيديو تعريفي · ٢٨ ث» */
export const PROMO_CAPTION = `فيديو تعريفي · ${arNum(SECONDS)} ث`;

/** schema.org VideoObject for the self-hosted promo (absolute URLs). */
export function promoVideoJsonLd(): Record<string, unknown> {
  const abs = (p: string) => new URL(p, siteUrl()).toString();
  const L = PROMO_ASSETS.landscape;
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: "فيديو تعريفي بستوديو وتسجيلات السلطان",
    description: "جولة قصيرة في أعمال ستوديو وتسجيلات السلطان في ميثلون – جنين: تصوير الأعراس والمناسبات، أفلام الأعراس وDJ.",
    thumbnailUrl: [abs(L.coverJpg), abs(PROMO_ASSETS.portrait.coverJpg)],
    contentUrl: abs(L.video),
    uploadDate: "2026-10-17",
    duration: `PT${SECONDS}S`,
    width: L.width,
    height: L.height,
    inLanguage: "ar",
  };
}
