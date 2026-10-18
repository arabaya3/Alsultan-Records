import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlbumGallery } from "@/components/media/gallery/AlbumGallery";
import { photoCountLabel } from "@/components/media/gallery/AlbumCard";
import { ButtonLink } from "@/components/ui/Button";
import { Container, Section } from "@/components/ui/Layout";
import { PageHero } from "@/components/ui/PageHero";
import { PhoneIcon } from "@/components/ui/SocialIcons";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { telHref } from "@/features/public-content/contact";
import { photoUrl, workHref } from "@/features/public-content/gallery-model";
import { getAlbumBySlug } from "@/features/public-content/gallery-queries";
import { formatDateAr } from "@/features/public-content/labels";
import { getBusinessSettings } from "@/features/public-content/queries";
import { pageMetadata, safeHttp } from "@/features/public-content/seo";
import { projectText } from "@/lib/whatsapp";

const SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;
const ALBUMS = workHref({ tab: "photos" });

export async function generateMetadata({ params }: PageProps<"/work/albums/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const res = SLUG.test(slug) ? await getAlbumBySlug(slug) : null;
  const a = res?.status === "ok" ? res.data?.album : null;
  if (!a) return { title: "ألبومات الصور", robots: { index: false } };
  return pageMetadata({
    title: a.title,
    description: a.description?.slice(0, 160) || `${a.title} — ألبوم صور من ستوديو وتسجيلات السلطان.`,
    path: `/work/albums/${a.slug}`,
  });
}

/** Compact light band (as in the reference): WhatsApp + phone from settings. */
async function ContactBand({ title }: { title: string }) {
  const settings = await getBusinessSettings();
  const phone = settings.status === "ok" ? (settings.data?.phone ?? null) : null;
  return (
    <section aria-labelledby="album-cta-title" data-tone="ivory" className="tone-ivory bg-ivory-band py-12 text-on-cream md:py-14">
      <Container className="flex flex-col items-center text-center">
        <h2 id="album-cta-title" className="text-h3 font-bold">
          احكِ لنا عن مناسبتك
        </h2>
        <span aria-hidden="true" className="gold-rule mx-auto mt-3" />
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          <WhatsAppCta text={projectText(title)} label="تواصل عبر واتساب" tone="light" />
          {phone ? (
            <a
              href={telHref(phone)}
              dir="ltr"
              className="inline-flex min-h-11 items-center gap-2 text-lg font-semibold text-on-cream underline-offset-8 hover:text-gold-text hover:underline"
            >
              <PhoneIcon size={18} />
              {phone}
            </a>
          ) : null}
        </div>
      </Container>
    </section>
  );
}

async function AlbumView({ params }: { params: PageProps<"/work/albums/[slug]">["params"] }) {
  const { slug } = await params;
  if (!SLUG.test(slug) || slug.length > 120) notFound();
  const res = await getAlbumBySlug(slug);
  if (res.status === "unavailable") {
    return (
      <Section>
        <ErrorState title="تعذّر تحميل الألبوم الآن" action={<ButtonLink href={ALBUMS}>العودة للألبومات</ButtonLink>} />
      </Section>
    );
  }
  if (!res.data) notFound();
  const { album, photos } = res.data;
  const sourceUrl = safeHttp(album.source_url);
  const meta = [formatDateAr(album.event_date), photoCountLabel(photos.length)].filter(Boolean);

  return (
    <article data-album-page={album.slug}>
      <PageHero
        breadcrumb={[{ label: "أعمالنا", href: "/work" }, { label: "ألبومات الصور", href: ALBUMS }]}
        title={<bdi dir="auto">{album.title}</bdi>}
        lead={
          <>
            <span className="block">{meta.join(" · ")}</span>
            {album.description ? <span className="mt-3 block whitespace-pre-line">{album.description}</span> : null}
            {album.source_label ? (
              <span data-album-source className="mt-3 block text-sm">
                المصدر:{" "}
                {sourceUrl ? (
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-ivory underline underline-offset-4 hover:decoration-gold">
                    {album.source_label}
                  </a>
                ) : (
                  album.source_label
                )}
              </span>
            ) : null}
          </>
        }
      />
      <Section className="pt-10! md:pt-12!">
        <h2 className="sr-only">صور الألبوم</h2>
        {photos.length === 0 ? (
          <EmptyState title="لا توجد صور منشورة في هذا الألبوم بعد" action={<ButtonLink href={ALBUMS} variant="outline">العودة للألبومات</ButtonLink>} />
        ) : (
          <AlbumGallery
            albumTitle={album.title}
            sourceLabel={album.source_label}
            sourceUrl={sourceUrl}
            backHref={ALBUMS}
            photos={photos.map((p) => ({
              id: p.id,
              thumb: photoUrl(p.id, "thumb"),
              display: photoUrl(p.id, "display"),
              width: p.width,
              height: p.height,
              alt: p.alt_text ?? "",
            }))}
          />
        )}
      </Section>
      <ContactBand title={album.title} />
    </article>
  );
}

// Resolve before streaming so unknown / unpublished albums get a real HTTP 404.
export const instant = false;

export default async function Page({ params }: PageProps<"/work/albums/[slug]">) {
  return <AlbumView params={params} />;
}
