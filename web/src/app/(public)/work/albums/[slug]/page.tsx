import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlbumActions, AlbumGallery } from "@/components/media/gallery/AlbumGallery";
import { photoCountLabel } from "@/components/media/gallery/AlbumCard";
import { ButtonLink } from "@/components/ui/Button";
import { Container, Section } from "@/components/ui/Layout";
import { PageHero } from "@/components/ui/PageHero";
import { PhoneIcon } from "@/components/ui/SocialIcons";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { telHref } from "@/features/public-content/contact";
import { photoUrl, workHref } from "@/features/public-content/gallery-model";
import { getAlbumBySlug, getPublishedAlbums } from "@/features/public-content/gallery-queries";
import Link from "next/link";
import { STUDIO_ENABLED } from "@/features/studio/config";
import { StudioPage } from "@/features/studio/StudioProvider";
import { AlbumSwipe } from "@/features/studio/AlbumSwipe";
import { formatDateAr } from "@/features/public-content/labels";
import { getBusinessSettings } from "@/features/public-content/queries";
import { JsonLd } from "@/components/ui/JsonLd";
import { breadcrumbJsonLd, metaDescription, pageMetadata, safeHttp } from "@/features/public-content/seo";
import { projectText } from "@/lib/whatsapp";
import { bidiDir } from "@/lib/bidi";

const SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;
const ALBUMS = workHref({ tab: "photos" });

export async function generateMetadata({ params }: PageProps<"/work/albums/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const res = SLUG.test(slug) ? await getAlbumBySlug(slug) : null;
  const a = res?.status === "ok" ? res.data?.album : null;
  if (!a) return { title: "ألبومات الصور", robots: { index: false } };
  return pageMetadata({
    title: a.title,
    description: metaDescription(a.description, `${a.title} — ألبوم صور من ستوديو وتسجيلات السلطان.`),
    path: `/work/albums/${a.slug}`,
    // share image: the album's published cover through the public route (never a storage URL / original)
    image: a.coverId ? photoUrl(a.coverId, "display") : null,
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

/**
 * «الألبوم السابق / التالي» with the destination's name, in the public list order (same as the albums page),
 * bounded (no wrap-around). In the studio the book on the table closes, slides away and the neighbour opens.
 */
async function AlbumNeighbors({ slug, cover, inner }: { slug: string; cover: string | null; inner: string | null }) {
  const res = await getPublishedAlbums();
  if (res.status !== "ok") return null;
  const list = res.data.filter((a) => a.photoCount > 0);
  const i = list.findIndex((a) => a.slug === slug);
  if (i < 0) return null;
  const prev = list[i - 1];
  const next = list[i + 1];
  const scene = STUDIO_ENABLED ? <StudioPage station="album" album={{ image: { key: slug, cover: cover ? photoUrl(cover, "display") : null, inner: inner ? photoUrl(inner, "display") : null }, index: i }} /> : null;
  if (!prev && !next) return scene;
  // compact: the action is the label, the destination's name a quiet second line (never dominating the scene)
  const cls = "group inline-flex min-h-11 max-w-[15rem] items-center gap-2.5 rounded-sm px-1 py-1 text-start transition-colors hover:text-gold";
  const arrow = "grid size-9 shrink-0 place-items-center rounded-full border border-hairline-gold text-gold transition-colors group-hover:border-gold group-hover:bg-gold group-hover:text-ink";
  return (
    <nav aria-label="التنقل بين الألبومات" data-album-nav="" className="flex w-full flex-wrap items-center justify-center gap-x-6 gap-y-2">
      {prev ? (
        <Link href={`/work/albums/${prev.slug}`} data-album-prev={prev.slug} className={cls}>
          <span aria-hidden="true" className={arrow}>→</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">الألبوم السابق</span>
            <bdi dir={bidiDir(prev.title)} className="block truncate text-xs text-ivory-muted">{prev.title}</bdi>
          </span>
        </Link>
      ) : null}
      {next ? (
        <Link href={`/work/albums/${next.slug}`} data-album-next={next.slug} className={cls}>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">الألبوم التالي</span>
            <bdi dir={bidiDir(next.title)} className="block truncate text-xs text-ivory-muted">{next.title}</bdi>
          </span>
          <span aria-hidden="true" className={arrow}>←</span>
        </Link>
      ) : null}
      {scene}
      {STUDIO_ENABLED ? <AlbumSwipe /> : null}
    </nav>
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
      <JsonLd data={breadcrumbJsonLd([{ name: "الرئيسية", path: "/" }, { name: "أعمالنا", path: "/work" }, { name: album.title, path: `/work/albums/${album.slug}` }])} />
      <PageHero
        photoId={null}
        breadcrumb={[{ label: "أعمالنا", href: "/work" }, { label: "ألبومات الصور", href: ALBUMS }]}
        title={<bdi dir={bidiDir(album.title)}>{album.title}</bdi>}
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
      >
        {/* Actions live in the hero so the photos start right after it. */}
        <AlbumActions backHref={ALBUMS} title={album.title} canSlideshow={photos.length > 1} />
        {/* the open album on the studio table shows its cover and the next photo of the album */}
        <AlbumNeighbors slug={album.slug} cover={album.coverId} inner={photos.find((p) => p.id !== album.coverId)?.id ?? null} />
      </PageHero>
      <Section>
        <h2 className="sr-only">صور الألبوم</h2>
        {photos.length === 0 ? (
          <EmptyState title="لا توجد صور منشورة في هذا الألبوم بعد" action={<ButtonLink href={ALBUMS} variant="outline">العودة للألبومات</ButtonLink>} />
        ) : (
          <AlbumGallery
            albumTitle={album.title}
            sourceLabel={album.source_label}
            sourceUrl={sourceUrl}
            actions={false}
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
