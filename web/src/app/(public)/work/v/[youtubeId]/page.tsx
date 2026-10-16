import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InlinePlayer } from "@/components/media/youtube/InlinePlayer";
import { YouTubeCard } from "@/components/media/youtube/YouTubeCard";
import { ButtonLink } from "@/components/ui/Button";
import { Container, Section } from "@/components/ui/Layout";
import { ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { relatedVideos, toCardVideo } from "@/features/public-content/gallery-model";
import { getVideoGallery } from "@/features/public-content/gallery-queries";
import { durationLabel, formatDateAr } from "@/features/public-content/labels";
import { pageMetadata } from "@/features/public-content/seo";
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
    description: video.description?.slice(0, 160) || `${video.title} — من أعمال ستوديو وتسجيلات السلطان.`,
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

  return (
    <article data-video-page={video.youtube_id}>
      <div className="bg-ink text-on-dark">
        <Container className="pb-12 pt-10 md:pt-14">
          <nav aria-label="مسار التصفح" className="mb-5 text-sm text-muted">
            <Link href="/work" className="inline-flex min-h-11 items-center hover:text-gold">
              أعمالنا
            </Link>
          </nav>
          <div className="grid gap-8 lg:grid-cols-[1.7fr_1fr] lg:gap-12">
            <div className="min-w-0">
              <InlinePlayer youtubeId={video.youtube_id} title={video.title} />
              <p className="mt-3 text-sm text-muted">
                <a
                  href={youTubeWatchUrl(video.youtube_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-youtube-fallback
                  className="inline-flex min-h-11 items-center text-on-dark underline decoration-1 underline-offset-4 hover:decoration-gold"
                >
                  شاهد على YouTube
                </a>
              </p>
            </div>
            <div className="min-w-0">
              <h1 data-video-title className="text-2xl font-bold leading-snug break-words md:text-3xl">
                <bdi dir="auto">{video.title}</bdi>
              </h1>
              {meta.length ? <p className="mt-3 text-muted">{meta.join(" · ")}</p> : null}
              {video.categories.length ? (
                <ul aria-label="التصنيفات" className="mt-5 flex flex-wrap gap-2">
                  {video.categories.map((c) => (
                    <li key={c.slug}>
                      <Link
                        href={`/work?cat=${c.slug}`}
                        data-category-chip={c.slug}
                        className="inline-flex min-h-11 items-center rounded-full border border-ink-line px-4 hover:border-gold"
                      >
                        {c.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              {video.description ? (
                <p data-video-description className="mt-6 whitespace-pre-line break-words text-on-dark/90">
                  {video.description}
                </p>
              ) : null}
              <div className="mt-8">
                <WhatsAppCta text={projectText(video.title)} label="اسأل عن مناسبتك" />
              </div>
            </div>
          </div>
        </Container>
      </div>

      {related.length ? (
        <Section labelledBy="related-title">
          <h2 id="related-title" className="mb-8 text-2xl font-bold md:text-3xl">
            أعمال مشابهة{video.primary ? `: ${video.primary.title}` : ""}
          </h2>
          <ul data-related className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((v) => (
              <li key={v.id} className="h-full">
                <YouTubeCard video={toCardVideo(v, durationLabel(v.duration_seconds))} />
              </li>
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
