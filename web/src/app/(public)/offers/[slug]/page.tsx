import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/Button";
import { JsonLd } from "@/components/ui/JsonLd";
import { Section } from "@/components/ui/Layout";
import { PageHero } from "@/components/ui/PageHero";
import { ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { offerDatesLabel, offerPeriodLabel, offerPriceLabel, offerWhatsappText, type Offer } from "@/features/public-content/cms-model";
import { getOfferBySlug, getPublishedPackages } from "@/features/public-content/cms-queries";
import { photoUrl } from "@/features/public-content/gallery-model";
import { breadcrumbJsonLd, metaDescription, pageMetadata } from "@/features/public-content/seo";
import { SITE_NAME_AR, siteUrl } from "@/features/public-content/site";
import { OFFER_SLUG, offerPath, packagePath } from "@/lib/site-targets";

async function load(slug: string) {
  return OFFER_SLUG.test(slug) ? getOfferBySlug(slug) : ({ status: "ok", data: null } as const);
}

export async function generateMetadata({ params }: PageProps<"/offers/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const res = await load(slug);
  const o = res.status === "ok" ? res.data : null;
  if (!o) return { title: "العروض", robots: { index: false } };
  return pageMetadata({
    title: o.title,
    description: metaDescription(o.description, `${o.title} — عرض من ${SITE_NAME_AR}.`),
    path: offerPath(o.slug),
    image: o.image_photo_id ? photoUrl(o.image_photo_id, "display") : null,
  });
}

/** schema.org Offer — only when the owner shows a price (never an invented one). */
function offerJsonLd(o: Offer): Record<string, unknown> | null {
  if (!o.show_price || o.display_price_minor == null) return null;
  return {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: o.title,
    ...(o.description ? { description: o.description } : {}),
    url: new URL(offerPath(o.slug), siteUrl()).toString(),
    price: (o.display_price_minor / 100).toFixed(2),
    priceCurrency: o.currency,
    ...(o.starts_on ? { validFrom: o.starts_on } : {}),
    ...(o.ends_on ? { validThrough: o.ends_on } : {}),
    seller: { "@type": "LocalBusiness", name: SITE_NAME_AR },
  };
}

async function OfferView({ params }: { params: PageProps<"/offers/[slug]">["params"] }) {
  const { slug } = await params;
  const res = await load(slug);
  if (res.status === "unavailable") {
    return (
      <Section>
        <ErrorState action={<ButtonLink href="/offers">كل العروض</ButtonLink>} />
      </Section>
    );
  }
  const o = res.data;
  if (!o) notFound(); // draft, archived, expired or not started → 404
  const price = offerPriceLabel(o);
  const dates = offerDatesLabel(o);
  const period = offerPeriodLabel(o);
  const pk = o.package_id ? await getPublishedPackages() : null;
  const pkg = pk?.status === "ok" ? pk.data.find((p) => p.id === o.package_id) : undefined;
  const ld = offerJsonLd(o);
  return (
    <article data-offer={o.slug}>
      {ld ? <JsonLd data={ld} /> : null}
      <JsonLd data={breadcrumbJsonLd([{ name: "الرئيسية", path: "/" }, { name: "العروض", path: "/offers" }, { name: o.title, path: offerPath(o.slug) }])} />
      <PageHero
        align="start"
        breadcrumb={[{ label: "العروض", href: "/offers" }, { label: o.title }]}
        title={
          <>
            <bdi className="break-words">{o.title}</bdi>
            <span className="text-gold">.</span>
          </>
        }
        lead={o.description ? <span className="whitespace-pre-line">{o.description}</span> : undefined}
      >
        {period || price || dates ? (
          <div className="flex flex-col gap-2">
            {period ? <p data-offer-period className="text-lg font-medium text-gold">{period}</p> : null}
            {price || dates ? (
              <p className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                {price ? <span data-offer-price className="text-2xl font-bold text-gold">{price}</span> : null}
                {dates ? <span data-offer-dates className="text-ivory-muted">{dates}</span> : null}
              </p>
            ) : null}
          </div>
        ) : null}
      </PageHero>
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div className="min-w-0">
            {o.items.length ? (
              <>
                <h2 className="text-h3 font-bold">يشمل العرض</h2>
                <span aria-hidden="true" className="gold-rule mt-3" />
                <ul data-offer-items className="mt-5 space-y-3">
                  {o.items.map((it, i) => (
                    <li key={i} className="flex items-start gap-3 text-lg break-words">
                      <span aria-hidden="true" className="mt-2.5 size-2 shrink-0 rounded-full bg-gold" />
                      <span className="min-w-0">{it}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {o.terms ? (
              <div className="mt-10 rounded-lg border border-hairline bg-surface p-5">
                <h2 className="text-xl font-semibold">الشروط</h2>
                <p data-offer-terms className="mt-3 whitespace-pre-line break-words text-ivory-muted">
                  {o.terms}
                </p>
              </div>
            ) : null}
            {pkg ? (
              <p data-offer-package className="mt-8">
                العرض على بكج:{" "}
                <Link href={packagePath(pkg.slug)} className="font-medium text-gold underline underline-offset-4">
                  <bdi>{pkg.title}</bdi>
                </Link>
              </p>
            ) : null}
            <div className="mt-10">
              <WhatsAppCta text={offerWhatsappText(o)} label="اسأل عن العرض على واتساب" size="lg" />
            </div>
          </div>
          {o.image_photo_id ? (
            <div className="self-start overflow-hidden rounded-lg border border-hairline-gold bg-night-deep">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl(o.image_photo_id, "display")} alt="" decoding="async" className="mx-auto max-h-[80vh] w-auto max-w-full object-contain" />
            </div>
          ) : null}
        </div>
      </Section>
    </article>
  );
}

// Resolve before streaming so expired/unknown offers get a real 404 (the proxy guard also checks).
export const instant = false;

export default async function Page({ params }: PageProps<"/offers/[slug]">) {
  return <OfferView params={params} />;
}
