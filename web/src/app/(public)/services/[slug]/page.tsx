import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MediaFrame } from "@/components/media/MediaFrame";
import { ButtonLink } from "@/components/ui/Button";
import { Section } from "@/components/ui/Layout";
import { PageHero } from "@/components/ui/PageHero";
import { ErrorState } from "@/components/ui/States";
import { AlbumCard } from "@/components/media/gallery/AlbumCard";
import { YouTubeCard } from "@/components/media/youtube/YouTubeCard";
import { getServiceLinks } from "@/features/public-content/cms-queries";
import { toCardVideo } from "@/features/public-content/gallery-model";
import { getPublishedAlbums, getVideoGallery } from "@/features/public-content/gallery-queries";
import { durationLabel } from "@/features/public-content/labels";
import { getServiceBySlug } from "@/features/public-content/queries";
import { JsonLd } from "@/components/ui/JsonLd";
import { breadcrumbJsonLd, metaDescription, pageMetadata } from "@/features/public-content/seo";

export async function generateMetadata({ params }: PageProps<"/services/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const res = await getServiceBySlug(slug);
  const s = res.status === "ok" ? res.data : null;
  if (!s) return { title: "الخدمات", robots: { index: false } };
  return pageMetadata({
    title: s.title,
    description: metaDescription(s.summary, `${s.title} — ستوديو وتسجيلات السلطان.`),
    path: `/services/${s.slug}`,
    image: s.coverPhotoSrc ?? (s.cover?.kind === "image" ? s.cover.src : null),
  });
}

async function ServiceView({ params }: { params: PageProps<"/services/[slug]">["params"] }) {
  const { slug } = await params;
  const res = await getServiceBySlug(slug);
  if (res.status === "unavailable") {
    return (
      <Section>
        <ErrorState action={<ButtonLink href="/services">كل الخدمات</ButtonLink>} />
      </Section>
    );
  }
  const s = res.data;
  if (!s) notFound();
  // Linked works/albums (service_links); anon RLS returns only links whose target is public, and the
  // targets are re-resolved against the published lists so nothing private can render.
  const [links, gallery, albums] = await Promise.all([getServiceLinks(), getVideoGallery(), getPublishedAlbums()]);
  const mine = links.filter((l) => l.service_id === s.id);
  const vids = gallery.status === "ok" ? gallery.data.videos : [];
  const albs = albums.status === "ok" ? albums.data.filter((a) => a.photoCount > 0) : [];
  const linkedVideos = mine.filter((l) => l.kind === "video").flatMap((l) => vids.filter((v) => v.id === l.target_id));
  const linkedAlbums = mine.filter((l) => l.kind === "album").flatMap((l) => albs.filter((a) => a.id === l.target_id));
  return (
    <article>
      <JsonLd data={breadcrumbJsonLd([{ name: "الرئيسية", path: "/" }, { name: "الخدمات", path: "/services" }, { name: s.title, path: `/services/${s.slug}` }])} />
      <PageHero
        align="start"
        breadcrumb={[{ label: "الخدمات", href: "/services" }, { label: s.title }]}
        title={
          <>
            <bdi dir="auto">{s.title}</bdi>
            <span className="text-gold">.</span>
          </>
        }
        lead={s.summary ?? undefined}
      />
      <Section>
        <div className={`grid gap-10 ${s.coverPhotoSrc || s.cover ? "lg:grid-cols-[1.2fr_1fr]" : ""}`}>
          <div className="prose-ar max-w-2xl whitespace-pre-line text-lg leading-loose text-ivory">{s.body}</div>
          {s.coverPhotoSrc ? (
            <div className="self-start overflow-hidden rounded-lg border border-hairline-gold bg-night-deep">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.coverPhotoSrc} alt="" decoding="async" data-service-cover className="mx-auto max-h-[80vh] w-auto max-w-full object-contain" />
            </div>
          ) : s.cover ? (
            <div className="self-start overflow-hidden rounded-lg border border-hairline-gold">
              <MediaFrame media={s.cover} alt={s.title} ratio="4/3" playable />
            </div>
          ) : null}
        </div>
        {linkedVideos.length ? (
          <section aria-labelledby="service-videos" className="mt-16">
            <h2 id="service-videos" className="text-h3 font-bold">من أعمالنا في هذه الخدمة</h2>
            <span aria-hidden="true" className="gold-rule mt-3 mb-8" />
            <ul data-service-videos className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {linkedVideos.map((v) => (
                <li key={v.id} className="h-full">
                  <YouTubeCard video={toCardVideo(v, durationLabel(v.duration_seconds))} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {linkedAlbums.length ? (
          <section aria-labelledby="service-albums" className="mt-16">
            <h2 id="service-albums" className="text-h3 font-bold">ألبومات صور</h2>
            <span aria-hidden="true" className="gold-rule mt-3 mb-8" />
            <ul data-service-albums className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {linkedAlbums.map((a) => (
                <li key={a.id} className="h-full">
                  <AlbumCard album={a} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="mt-14 flex flex-wrap gap-4">
          <WhatsAppCta />
          <ButtonLink href="/packages" variant="outline">
            البكجات
          </ButtonLink>
        </div>
      </Section>
    </article>
  );
}

// Resolve the slug BEFORE streaming starts so unknown slugs get a real HTTP 404
// (notFound() after the first streamed chunk would leave the status at 200).
export const instant = false;

export default async function Page({ params }: PageProps<"/services/[slug]">) {
  return <ServiceView params={params} />;
}
