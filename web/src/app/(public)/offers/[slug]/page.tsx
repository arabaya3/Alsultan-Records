import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/Button";
import { JsonLd } from "@/components/ui/JsonLd";
import { Container, Section } from "@/components/ui/Layout";
import { ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { offerDatesLabel, offerPriceLabel, offerWhatsappText, type Offer } from "@/features/public-content/cms-model";
import { getOfferBySlug } from "@/features/public-content/cms-queries";
import { photoUrl } from "@/features/public-content/gallery-model";
import { pageMetadata } from "@/features/public-content/seo";
import { SITE_NAME_AR, siteUrl } from "@/features/public-content/site";
import { OFFER_SLUG, offerPath } from "@/lib/site-targets";

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
    description: o.description ?? `${o.title} — عرض من ${SITE_NAME_AR}.`,
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
  const ld = offerJsonLd(o);
  return (
    <article data-offer={o.slug}>
      {ld ? <JsonLd data={ld} /> : null}
      <div className="bg-ink text-on-dark">
        <Container className="py-12 md:py-16">
          <nav aria-label="مسار التصفح" className="mb-6 text-sm text-muted">
            <Link href="/offers" className="inline-flex min-h-11 items-center hover:text-gold">
              العروض
            </Link>
          </nav>
          <h1 className="text-4xl font-bold tracking-tight break-words md:text-6xl">
            <bdi>{o.title}</bdi>
            <span className="text-gold">.</span>
          </h1>
          {o.description ? <p className="mt-4 max-w-2xl text-lg whitespace-pre-line text-muted md:text-xl">{o.description}</p> : null}
          {price || dates ? (
            <p className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2">
              {price ? <span data-offer-price className="text-2xl font-semibold text-gold">{price}</span> : null}
              {dates ? <span data-offer-dates className="text-muted">{dates}</span> : null}
            </p>
          ) : null}
        </Container>
      </div>
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div className="min-w-0">
            {o.items.length ? (
              <>
                <h2 className="text-2xl font-semibold">يشمل العرض</h2>
                <ul data-offer-items className="mt-4 divide-y divide-cream-line border-y border-cream-line">
                  {o.items.map((it, i) => (
                    <li key={i} className="py-3 text-lg break-words">
                      {it}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {o.terms ? (
              <div className="mt-8">
                <h2 className="text-xl font-semibold">الشروط</h2>
                <p data-offer-terms className="mt-3 whitespace-pre-line break-words text-on-cream-muted">
                  {o.terms}
                </p>
              </div>
            ) : null}
            <div className="mt-10">
              <WhatsAppCta text={offerWhatsappText(o)} label="اسأل عن العرض على واتساب" />
            </div>
          </div>
          {o.image_photo_id ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl(o.image_photo_id, "display")} alt="" decoding="async" className="w-full rounded-sm object-cover" />
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
