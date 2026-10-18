import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MediaFrame } from "@/components/media/MediaFrame";
import { ButtonLink } from "@/components/ui/Button";
import { Container, Section } from "@/components/ui/Layout";
import { ErrorState } from "@/components/ui/States";
import { AlbumCard } from "@/components/media/gallery/AlbumCard";
import { YouTubeCard } from "@/components/media/youtube/YouTubeCard";
import { getServiceLinks } from "@/features/public-content/cms-queries";
import { toCardVideo } from "@/features/public-content/gallery-model";
import { getPublishedAlbums, getVideoGallery } from "@/features/public-content/gallery-queries";
import { durationLabel } from "@/features/public-content/labels";
import { getServiceBySlug } from "@/features/public-content/queries";
import { pageMetadata } from "@/features/public-content/seo";

export async function generateMetadata({ params }: PageProps<"/services/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const res = await getServiceBySlug(slug);
  const s = res.status === "ok" ? res.data : null;
  if (!s) return { title: "الخدمات", robots: { index: false } };
  return pageMetadata({
    title: s.title,
    description: s.summary ?? `${s.title} — ستوديو وتسجيلات السلطان.`,
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
      <div className="bg-ink text-on-dark">
        <Container className="py-12 md:py-16">
          <nav aria-label="مسار التصفح" className="mb-6 text-sm text-muted">
            <Link href="/services" className="hover:text-gold">
              الخدمات
            </Link>
          </nav>
          <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
            <bdi dir="auto">{s.title}</bdi>
            <span className="text-gold">.</span>
          </h1>
          {s.summary ? <p className="mt-4 max-w-2xl text-lg text-muted md:text-xl">{s.summary}</p> : null}
        </Container>
      </div>
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
          <div className="prose-ar max-w-2xl whitespace-pre-line text-lg">{s.body}</div>
          {s.coverPhotoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.coverPhotoSrc} alt="" decoding="async" data-service-cover className="w-full rounded-sm object-cover" />
          ) : s.cover ? (
            <MediaFrame media={s.cover} alt={s.title} ratio="4/3" playable />
          ) : null}
        </div>
        {linkedVideos.length ? (
          <section aria-labelledby="service-videos" className="mt-14">
            <h2 id="service-videos" className="mb-6 text-2xl font-semibold">من أعمالنا في هذه الخدمة</h2>
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
          <section aria-labelledby="service-albums" className="mt-14">
            <h2 id="service-albums" className="mb-6 text-2xl font-semibold">ألبومات صور</h2>
            <ul data-service-albums className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {linkedAlbums.map((a) => (
                <li key={a.id} className="h-full">
                  <AlbumCard album={a} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="mt-12">
          <WhatsAppCta />
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
