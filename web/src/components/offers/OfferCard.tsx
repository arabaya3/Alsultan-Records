import Link from "next/link";
import { offerDatesLabel, offerPriceLabel, type Offer } from "@/features/public-content/cms-model";
import { photoUrl } from "@/features/public-content/gallery-model";
import { offerPath } from "@/lib/site-targets";

/** Offer tile: optional image (gated /p route), title, short description, dates, price only if shown. */
export function OfferCard({ offer, tone = "light" }: { offer: Offer; tone?: "light" | "dark" }) {
  const price = offerPriceLabel(offer);
  const dates = offerDatesLabel(offer);
  const muted = tone === "dark" ? "text-muted" : "text-on-cream-muted";
  return (
    <Link href={offerPath(offer.slug)} data-offer-card={offer.slug} className="group flex h-full flex-col">
      {offer.image_photo_id ? (
        <span className="relative block aspect-[4/3] overflow-hidden rounded-sm bg-cream-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl(offer.image_photo_id, "thumb")}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        </span>
      ) : null}
      <span className={`${offer.image_photo_id ? "mt-3" : "border-t-2 border-gold pt-4"} line-clamp-2 font-display text-xl font-semibold leading-snug break-words group-hover:text-gold-press`}>
        <bdi>{offer.title}</bdi>
      </span>
      {offer.description ? <span className={`mt-2 line-clamp-3 break-words ${muted}`}>{offer.description}</span> : null}
      <span className="mt-auto flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-3 text-sm">
        {price ? <span data-offer-price className="text-base font-semibold">{price}</span> : null}
        {dates ? <span className={muted}>{dates}</span> : null}
        <span className="ms-auto underline decoration-1 underline-offset-4">التفاصيل</span>
      </span>
    </Link>
  );
}
