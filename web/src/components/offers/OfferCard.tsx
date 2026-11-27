import Link from "next/link";
import { offerDatesLabel, offerPeriodLabel, offerPriceLabel, type Offer } from "@/features/public-content/cms-model";
import { photoUrl } from "@/features/public-content/gallery-model";
import { offerPath } from "@/lib/site-targets";
import { listPreview } from "@/lib/text-blocks";
import { bidiDir } from "@/lib/bidi";
import { CheckIcon } from "@/components/packages/PackageCard";

function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

/**
 * Offer tile: optional real image (whole picture, object-contain), title, period, price only if shown, short
 * description, linked package, then one footer row (dates + details) that lines up across a row of cards whether or not
 * each offer shows a price. The whole card is one link to the offer page.
 *   tone="dark"  (default): dark surface with a gold hairline (home, admin preview);
 *   tone="light": the /offers page design — ivory card, soft gold border, a «عرض مميز» badge for the owner's pinned
 *                 offers («عرض محدود» for the others: every offer here has an end), month with a calendar icon.
 */
export function OfferCard({ offer, packageTitle, tone = "dark" }: { offer: Offer; tone?: "light" | "dark"; packageTitle?: string | null }) {
  const price = offerPriceLabel(offer);
  const period = offerPeriodLabel(offer);
  const dates = offerDatesLabel(offer);
  // A list-shaped description shows its first items (never merged into one run-on line); the full text is on the page.
  const preview = listPreview(offer.description, 4);
  const light = tone === "light";
  const c = light
    ? {
        card: "border-gold/45 bg-[#fffdf8] text-on-cream shadow-[0_10px_28px_-20px_rgb(60_45_20/0.45)] hover:border-gold",
        media: "bg-cream-2",
        title: "font-bold group-hover:text-gold-text",
        muted: "text-on-cream-muted",
        item: "text-on-cream",
        rule: "border-cream-line",
        price: "text-gold-text",
        button: "rounded-lg border-gold/70 px-4 font-semibold group-hover:border-gold group-hover:bg-gold group-hover:text-ink",
      }
    : {
        card: "border-hairline-gold bg-surface text-ivory hover:border-gold/80 hover:bg-surface-2",
        media: "bg-night-deep",
        title: "font-semibold group-hover:text-gold",
        muted: "text-ivory-muted",
        item: "text-ivory",
        rule: "border-hairline",
        price: "text-gold",
        button: "rounded-sm border-hairline-gold px-3 font-medium group-hover:border-gold group-hover:bg-gold group-hover:text-ink",
      };
  return (
    <Link
      href={offerPath(offer.slug)}
      data-offer-card={offer.slug}
      className={`group flex h-full flex-col overflow-hidden rounded-2xl border transition-colors duration-200 ${c.card}`}
    >
      {offer.image_photo_id ? (
        <span className={`relative block aspect-[4/3] ${c.media}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl(offer.image_photo_id, "thumb")} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-contain" />
        </span>
      ) : null}
      <span className="flex flex-1 flex-col p-5 md:p-6">
        <span className="flex items-start justify-between gap-3">
          <span className={`line-clamp-2 min-w-0 font-display text-xl leading-snug break-words transition-colors ${c.title}`}>
            <bdi dir={bidiDir(offer.title)}>{offer.title}</bdi>
          </span>
          {light ? (
            <span data-offer-badge className="shrink-0 rounded-full bg-gold/30 px-3 py-1 text-xs font-bold text-on-cream">
              {offer.pinned_home ? "عرض مميز" : "عرض محدود"}
            </span>
          ) : null}
        </span>
        {period ? (
          light ? (
            <span data-offer-period className="mt-2 inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-on-cream">
              <CalendarIcon />
              {period}
            </span>
          ) : (
            <span data-offer-period className="mt-2 inline-flex w-fit items-center rounded-full border border-hairline-gold px-3 py-0.5 text-xs font-medium text-gold">
              {period}
            </span>
          )
        ) : null}
        {price ? <span data-offer-price className={`mt-3 block text-2xl font-bold ${c.price}`}>{price}</span> : null}
        {preview ? (
          <span data-offer-preview className={`mt-3 block ${c.muted}`}>
            <ul className={`space-y-2 border-t pt-4 text-[0.95rem] ${c.rule}`}>
              {preview.items.map((it, i) => (
                <li key={i} className="flex items-start gap-2.5 break-words">
                  <CheckIcon />
                  <span className={`line-clamp-2 min-w-0 ${c.item}`}>{it}</span>
                </li>
              ))}
            </ul>
            {preview.more ? <span data-offer-more className={`mt-3 block text-sm ${c.muted}`}>+ {preview.more.toLocaleString("ar-PS")} بنود أخرى في التفاصيل</span> : null}
          </span>
        ) : offer.description ? (
          <span className={`mt-2 line-clamp-4 whitespace-pre-line break-words ${c.muted}`}>{offer.description}</span>
        ) : null}
        {packageTitle ? (
          <span data-offer-package className={`mt-2 text-sm ${c.muted}`}>
            على بكج: <bdi dir={bidiDir(packageTitle)}>{packageTitle}</bdi>
          </span>
        ) : null}
        <span className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5 text-sm">
          {dates ? <span data-offer-dates-short className={c.muted}>{dates}</span> : null}
          <span className={`ms-auto inline-flex min-h-11 items-center gap-1.5 border transition-colors ${c.button}`}>
            {light ? "عرض التفاصيل" : "التفاصيل"}
            <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </span>
        </span>
      </span>
    </Link>
  );
}
