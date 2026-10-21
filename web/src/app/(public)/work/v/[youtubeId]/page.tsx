import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InlinePlayer } from "@/components/media/youtube/InlinePlayer";
import { YouTubeCard } from "@/components/media/youtube/YouTubeCard";
import { FadeRise } from "@/components/motion/Reveal";
import { ButtonLink, buttonClasses } from "@/components/ui/Button";
import { Container, Section, SectionHeading } from "@/components/ui/Layout";
import { YouTubeIcon } from "@/components/ui/SocialIcons";
import { ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { relatedVideos, toCardVideo, workHref } from "@/features/public-content/gallery-model";
import { getVideoGallery } from "@/features/public-content/gallery-queries";
import { durationLabel, formatDateAr } from "@/features/public-content/labels";
import { JsonLd } from "@/components/ui/JsonLd";
import { breadcrumbJsonLd, metaDescription, pageMetadata, youTubeVideoJsonLd } from "@/features/public-content/seo";
import { projectText } from "@/lib/whatsapp";
import { isYouTubeId, youTubeThumbUrl, youTubeWatchUrl } from "@/lib/youtube";

async function findVideo(youtubeId: string) {
  if (!isYouTubeId(youtubeId)) return { status: "ok" as const, video: null, gallery: null };
  const res = await getVideoGallery();
  if (res.status !== "ok") return { status: "unavailable" as const, video: null, gallery: null };
  return { status: "ok" as const, video: res.data.videos.find((v) => v.youtube_id === youtubeId) ?? null, gallery: res.data };
}

export async function generateMetadata({ params }: PageProps<"/work/v/[youtubeId]">): Promise<Metadata> {
  const { youtubeId } = await params;
  const { video } = await findVideo(youtubeId);
  if (!video) return { title: "أعمالنا", robots: { index: false } };
  return pageMetadata({
    title: video.title,
    description: metaDescription(video.description, `${video.title} — من أعمال ستوديو وتسجيلات السلطان.`),
    path: `/work/v/${video.youtube_id}`,
    image: youTubeThumbUrl(video.youtube_id),
  });
}

async function VideoView({ params }: { params: PageProps<"/work/v/[youtubeId]">["params"] }) {
  const { youtubeId } = await params;
  const { status, video, gallery } = await findVideo(youtubeId);
  if (status === "unavailable") {
    return (
      <Section>
        <ErrorState action={<ButtonLink href="/work">العودة إلى الأعمال</ButtonLink>} />
      </Section>
    );
  }
  if (!video || !gallery) notFound();
  const related = relatedVideos(gallery, video);
  const meta = [durationLabel(video.duration_seconds), formatDateAr(video.published_at)].filter(Boolean);

  const videoLd = youTubeVideoJsonLd(video);
  return (
    <article data-video-page={video.youtube_id}>
      {videoLd ? <JsonLd data={videoLd} /> : null}
      <JsonLd data={breadcrumbJsonLd([{ name: "الرئيسية", path: "/" }, { name: "أعمالنا", path: "/work" }, { name: video.title, path: `/work/v/${video.youtube_id}` }])} />
      <div className="ink-texture hero-flow relative text-ivory">
        <Container className="flex flex-col items-center pb-14 pt-12 text-center md:pb-20 md:pt-16">
          <nav aria-label="مسار التنقل" className="mb-4 text-sm text-ivory-muted">
            <ol className="flex flex-wrap items-center justify-center gap-x-2">
              <li>
                <Link href="/work" className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-gold">
                  أعمالنا
                </Link>
              </li>
              {video.primary ? (
                <li className="flex items-center gap-x-2">
                  <span aria-hidden="true" className="text-gold">/</span>
                  <Link href={workHref({ cat: video.primary.slug })} className="inline-flex min-h-11 items-center text-gold transition-colors hover:text-ivory">
                    {video.primary.title}
                  </Link>
                </li>
              ) : null}
            </ol>
          </nav>
          <h1 data-video-title className="max-w-4xl text-h2 font-bold leading-snug break-words">
            <bdi dir="auto">{video.title}</bdi>
          </h1>
          <span aria-hidden="true" className="gold-rule mx-auto mt-4" />
          {meta.length ? <p className="mt-4 text-ivory-muted">{meta.join(" · ")}</p> : null}

          <div className="mt-8 w-full max-w-5xl text-start">
            <InlinePlayer youtubeId={video.youtube_id} title={video.title} />
          </div>

          {video.description ? (
            <p data-video-description className="mt-8 max-w-3xl whitespace-pre-line break-words text-lead text-ivory-muted">
              {video.description}
            </p>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <WhatsAppCta text={projectText(video.title)} label="استفسر عن تصوير مناسبتك" />
            <a
              href={youTubeWatchUrl(video.youtube_id)}
              target="_blank"
              rel="noopener noreferrer"
              data-youtube-fallback
              className={buttonClasses({ variant: "outline" })}
            >
              <YouTubeIcon size={20} />
              <span>شاهد على YouTube</span>
            </a>
          </div>

          {video.categories.length ? (
            <ul aria-label="التصنيفات" className="mt-8 flex flex-wrap justify-center gap-2">
              {video.categories.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={workHref({ cat: c.slug })}
                    data-category-chip={c.slug}
                    className="inline-flex min-h-11 items-center rounded-full border border-hairline px-4 text-sm text-ivory-muted transition-colors hover:border-gold hover:text-gold"
                  >
                    {c.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </Container>
      </div>

      {related.length ? (
        <Section labelledBy="related-title">
          <SectionHeading id="related-title" title="أعمال مشابهة" align="center" lead={video.primary?.title} />
          <ul data-related className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((v, i) => (
              <FadeRise as="li" key={v.id} delay={i * 80} className="h-full">
                <YouTubeCard video={toCardVideo(v, durationLabel(v.duration_seconds))} />
              </FadeRise>
            ))}
          </ul>
        </Section>
      ) : null}
    </article>
  );
}

// Resolve before streaming so unknown / unpublished ids get a real HTTP 404.
export const instant = false;

export default async function Page({ params }: PageProps<"/work/v/[youtubeId]">) {
  return <VideoView params={params} />;
}
