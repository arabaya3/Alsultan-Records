import { offerPriceLabel, packageWhatsappText, type Package } from "@/features/public-content/cms-model";
import { photoUrl } from "@/features/public-content/gallery-model";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";

/** Package tile: optional image (gated /p route), title, included services, price only if shown, WhatsApp naming the package. */
export function PackageCard({ pkg }: { pkg: Package }) {
  const price = offerPriceLabel(pkg);
  return (
    <article id={pkg.slug} data-package-card={pkg.slug} data-featured={pkg.featured ? "1" : undefined} className={`flex h-full scroll-mt-24 flex-col rounded-sm ${pkg.featured ? "border-2 border-gold p-4" : ""}`}>
      {pkg.image_photo_id ? (
        <span className="relative block aspect-[4/3] overflow-hidden rounded-sm bg-cream-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl(pkg.image_photo_id, "thumb")} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
        </span>
      ) : null}
      <h3 className={`${pkg.image_photo_id ? "mt-3" : pkg.featured ? "" : "border-t-2 border-gold pt-4"} flex flex-wrap items-baseline gap-2 font-display text-xl font-semibold leading-snug break-words`}>
        <bdi>{pkg.title}</bdi>
        {pkg.featured ? <span data-package-featured className="rounded-sm bg-gold px-2 py-0.5 text-xs font-medium text-ink">مميّز</span> : null}
      </h3>
      {pkg.description ? <p className="mt-2 whitespace-pre-line break-words text-on-cream-muted">{pkg.description}</p> : null}
      {pkg.items.length ? (
        <ul data-package-items className="mt-3 divide-y divide-cream-line border-y border-cream-line text-sm">
          {pkg.items.map((it, i) => (
            <li key={i} className="py-2 break-words">
              {it}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-3 pt-4">
        {price ? <span data-package-price className="text-lg font-semibold">{price}</span> : null}
        <WhatsAppCta text={packageWhatsappText(pkg)} label={`اسأل عن ${pkg.title}`} />
      </div>
    </article>
  );
}
