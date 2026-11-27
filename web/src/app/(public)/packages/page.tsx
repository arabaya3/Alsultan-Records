import { PackageCard, type PackageOffer } from "@/components/packages/PackageCard";
import { PackageTabs } from "@/components/packages/PackageTabs";
import { FadeRise } from "@/components/motion/Reveal";
import { PageHero } from "@/components/ui/PageHero";
import { Section } from "@/components/ui/Layout";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { getActiveOffers, getPublishedPackages } from "@/features/public-content/cms-queries";
import { groupPackages, type Package } from "@/features/public-content/cms-model";
import { pageMetadata } from "@/features/public-content/seo";
import { offerPath } from "@/lib/site-targets";

export const metadata = pageMetadata({
  title: "البكجات",
  description: "باقات خدمات ستوديو وتسجيلات السلطان للأعراس والمناسبات: تصوير، أفلام، وDJ.",
  path: "/packages",
});

function Grid({ items, offers, group }: { items: Package[]; offers: Map<string, PackageOffer>; group: string }) {
  return (
    <ul data-package-grid data-package-group={group} className="grid items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
      {items.map((p, i) => (
        <FadeRise as="li" key={p.id} delay={(i % 3) * 80} className="h-full">
          <PackageCard pkg={p} offer={offers.get(p.id) ?? null} />
        </FadeRise>
      ))}
    </ul>
  );
}

export default async function PackagesPage() {
  const [res, offersRes] = await Promise.all([getPublishedPackages(), getActiveOffers()]);
  const groups = res.status === "ok" ? groupPackages(res.data) : [];
  // An active offer linked to a package is shown on that package's card (first in the owner's order wins).
  const offers = new Map<string, PackageOffer>();
  for (const o of offersRes.status === "ok" ? offersRes.data : []) {
    if (o.package_id && !offers.has(o.package_id)) offers.set(o.package_id, { title: o.title, href: offerPath(o.slug), endsOn: o.ends_on });
  }
  // Tabs only when the owner grouped the packages: one group (or none) is a single grid as before.
  const tabbed = groups.length > 1 && groups.some((g) => g.label);
  return (
    <>
      <PageHero
        compact
        eyebrow={<span aria-hidden="true">البكجات</span>}
        title={
          <>
            <span className="sr-only">البكجات: </span>بكج يناسب مناسبتك<span className="text-gold">.</span>
          </>
        }
        lead="خدمات واضحة وأسعار بالشيكل. للعروض المؤقتة شوف صفحة العروض، وللتفاصيل حسب مناسبتك راسلنا على واتساب."
      />
      {res.status === "unavailable" ? (
        <Section tone="ivory" containerClassName="max-w-[76rem]">
          <ErrorState title="تعذّر تحميل البكجات الآن" action={<WhatsAppCta />} />
        </Section>
      ) : res.data.length === 0 ? (
        <Section tone="ivory" containerClassName="max-w-[76rem]">
          <EmptyState
            title="لا توجد بكجات منشورة حالياً"
            body="راسلنا على واتساب ونحكي معك عن مناسبتك والخدمات اللي بتناسبك."
            action={<WhatsAppCta />}
          />
        </Section>
      ) : tabbed ? (
        // Ivory content band (owner design): the sticky tab row and the cards share it.
        <div data-tone="ivory" className="tone-ivory bg-ivory-band text-on-cream">
          <PackageTabs
          tabs={groups.map((g, gi) => ({
            key: g.label ?? `other-${gi}`,
            label: g.label ?? "بكجات أخرى",
            count: g.items.length,
            panel: (
              <Section tone="ivory" className="!pt-6 md:!pt-8" containerClassName="max-w-[76rem]">
                <h2 className="sr-only">{g.label ?? "بكجات أخرى"}</h2>
                <Grid items={g.items} offers={offers} group={g.label ?? ""} />
              </Section>
            ),
          }))}
          />
        </div>
      ) : (
        <Section tone="ivory" containerClassName="max-w-[76rem]">
          <h2 className="sr-only">{groups[0]?.label ?? "البكجات"}</h2>
          <Grid items={res.data} offers={offers} group={groups[0]?.label ?? ""} />
        </Section>
      )}
    </>
  );
}
