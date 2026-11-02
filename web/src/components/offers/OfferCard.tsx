import Link from "next/link";
import { offerDatesLabel, offerPeriodLabel, offerPriceLabel, type Offer } from "@/features/public-content/cms-model";
import { photoUrl } from "@/features/public-content/gallery-model";
import { offerPath } from "@/lib/site-targets";
import { listPreview } from "@/lib/text-blocks";
import { bidiDir } from "@/lib/bidi";
import { CheckIcon } from "@/components/packages/PackageCard";

/**
 * Offer tile (dark surface, gold hairline): optional real image (whole picture, object-contain), title, period,
 * price only if shown, short description, linked package, then one footer row (dates + details) that lines up across a
 * row of cards whether or not each offer shows a price. `tone` is kept for compatibility (both dark now).
 */
export function OfferCard({ offer, packageTitle }: { offer: Offer; tone?: "light" | "dark"; packageTitle?: string | null }) {
  const price = offerPriceLabel(offer);
  const period = offerPeriodLabel(offer);
  const dates = offerDatesLabel(offer);
  // A list-shaped description shows its first items (never merged into one run-on line); the full text is on the page.
  const preview = listPreview(offer.description, 4);
  return (
    <Link
      href={offerPath(offer.slug)}
      data-offer-card={offer.slug}
      className="group flex h-full flex-col overflow-hidden rounded-lg border border-hairline-gold bg-surface text-ivory transition-colors duration-200 hover:border-gold/80 hover:bg-surface-2"
    >
      {offer.image_photo_id ? (
        <span className="relative block aspect-[4/3] bg-night-deep">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl(offer.image_photo_id, "thumb")} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-contain" />
        </span>
      ) : null}
      <span className="flex flex-1 flex-col p-5 md:p-6">
        <span className="line-clamp-2 font-display text-xl font-semibold leading-snug break-words transition-colors group-hover:text-gold">
          <bdi dir={bidiDir(offer.title)}>{offer.title}</bdi>
        </span>
        {period ? (
          <span data-offer-period className="mt-2 inline-flex w-fit items-center rounded-full border border-hairline-gold px-3 py-0.5 text-xs font-medium text-gold">
            {period}
          </span>
        ) : null}
        {price ? <span data-offer-price className="mt-3 block text-2xl font-bold text-gold">{price}</span> : null}
        {preview ? (
          <span data-offer-preview className="mt-3 block text-ivory-muted">
            <ul className="space-y-2 border-t border-hairline pt-4 text-[0.95rem]">
              {preview.items.map((it, i) => (
                <li key={i} className="flex items-start gap-2.5 break-words">
                  <CheckIcon />
                  <span className="line-clamp-2 min-w-0 text-ivory">{it}</span>
                </li>
              ))}
            </ul>
            {preview.more ? <span data-offer-more className="mt-3 block text-sm text-ivory-muted">+ {preview.more.toLocaleString("ar-PS")} بنود أخرى في التفاصيل</span> : null}
          </span>
        ) : offer.description ? (
          <span className="mt-2 line-clamp-4 whitespace-pre-line break-words text-ivory-muted">{offer.description}</span>
        ) : null}
        {packageTitle ? (
          <span data-offer-package className="mt-2 text-sm text-ivory-muted">
            على بكج: <bdi dir={bidiDir(packageTitle)}>{packageTitle}</bdi>
          </span>
        ) : null}
        <span className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5 text-sm">
          {dates ? <span data-offer-dates-short className="text-ivory-muted">{dates}</span> : null}
          <span className="ms-auto inline-flex min-h-10 items-center gap-1.5 rounded-sm border border-hairline-gold px-3 font-medium transition-colors group-hover:border-gold group-hover:bg-gold group-hover:text-ink">
            التفاصيل
            <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </span>
        </span>
      </span>
    </Link>
  );
}
