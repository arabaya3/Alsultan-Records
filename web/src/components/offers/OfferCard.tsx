import Link from "next/link";
import { offerDatesLabel, offerPeriodLabel, offerPriceLabel, type Offer } from "@/features/public-content/cms-model";
import { photoUrl } from "@/features/public-content/gallery-model";
import { offerPath } from "@/lib/site-targets";

/**
 * Offer tile (dark surface, gold hairline): optional real image (whole picture, object-contain), title, period,
 * short description, linked package, price only if shown, dates. `tone` is kept for compatibility (both dark now).
 */
export function OfferCard({ offer, packageTitle }: { offer: Offer; tone?: "light" | "dark"; packageTitle?: string | null }) {
  const price = offerPriceLabel(offer);
  const period = offerPeriodLabel(offer);
  const dates = offerDatesLabel(offer);
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
          <bdi>{offer.title}</bdi>
        </span>
        {period ? <span data-offer-period className="mt-1 text-sm font-medium text-gold">{period}</span> : null}
        {offer.description ? <span className="mt-2 line-clamp-3 break-words text-ivory-muted">{offer.description}</span> : null}
        {packageTitle ? (
          <span data-offer-package className="mt-2 text-sm text-ivory-muted">
            على بكج: <bdi>{packageTitle}</bdi>
          </span>
        ) : null}
        <span className="mt-auto flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-hairline pt-4 text-sm">
          {price ? <span data-offer-price className="text-lg font-bold text-gold">{price}</span> : null}
          {dates ? <span className="text-ivory-muted">{dates}</span> : null}
          <span className="ms-auto underline decoration-1 underline-offset-4 group-hover:decoration-gold">التفاصيل</span>
        </span>
      </span>
    </Link>
  );
}
