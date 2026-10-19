import { offerPriceLabel, packageWhatsappText, type Package } from "@/features/public-content/cms-model";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" className="mt-0.5 shrink-0 text-gold">
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="var(--color-ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-gold">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M12 8v13M12 8S10.5 3.5 8 4.5 8.5 8 12 8Zm0 0s1.5-4.5 4-3.5S15.5 8 12 8Z" />
    </svg>
  );
}

/**
 * Package card (no image — packages are text + price): title, «N شيكل», items with gold checks, gift row,
 * WhatsApp naming the package. The first <p> in the card is the description (verify-packages relies on it).
 */
export function PackageCard({ pkg }: { pkg: Package }) {
  const price = offerPriceLabel(pkg);
  return (
    <article
      id={pkg.slug}
      data-package-card={pkg.slug}
      data-featured={pkg.featured ? "1" : undefined}
      className={`flex h-full min-w-0 scroll-mt-24 flex-col rounded-lg border bg-surface p-5 text-ivory transition-colors duration-200 md:p-6 ${
        pkg.featured ? "border-gold/80 shadow-[0_0_0_1px_rgb(233_185_73/0.25)]" : "border-hairline-gold hover:border-gold/70"
      }`}
    >
      <h3 className="flex flex-wrap items-center gap-2 font-display text-xl font-semibold leading-snug break-words [overflow-wrap:anywhere]">
        <bdi>{pkg.title}</bdi>
        {pkg.featured ? <span data-package-featured className="rounded-sm bg-gold px-2 py-0.5 text-xs font-medium text-ink">مميّز</span> : null}
      </h3>
      {price ? (
        <span data-package-price className="mt-2 block text-2xl font-bold text-gold">
          {price}
        </span>
      ) : null}
      {pkg.description ? <p className="mt-3 whitespace-pre-line break-words text-ivory-muted">{pkg.description}</p> : null}
      {pkg.items.length ? (
        <ul data-package-items className="mt-4 space-y-2.5 border-t border-hairline pt-4 text-[0.95rem]">
          {pkg.items.map((it, i) => (
            <li key={i} className="flex items-start gap-2.5 break-words">
              <CheckIcon />
              <span className="min-w-0 [overflow-wrap:anywhere]">{it}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto pt-5">
        {pkg.gift ? (
          <div className="mb-4 flex items-center gap-2.5 rounded-sm bg-night-deep px-3 py-2.5 text-sm">
            <GiftIcon />
            <p data-package-gift className="min-w-0 break-words [overflow-wrap:anywhere]">
              <span className="font-semibold text-gold">الهدية:</span> {pkg.gift}
            </p>
          </div>
        ) : null}
        <WhatsAppCta text={packageWhatsappText(pkg)} label="استفسر عبر واتساب" className="w-full" />
      </div>
    </article>
  );
}
