import Link from "next/link";
import { YouTubeCard } from "@/components/media/youtube/YouTubeCard";
import { MaskReveal } from "@/components/motion/ScrollEffects";
import { PageIntro, Section } from "@/components/ui/Layout";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { durationLabel, formatDateAr, videoCategoryLabel } from "@/features/public-content/labels";
import { getBusinessSettings, getShowcaseVideos } from "@/features/public-content/queries";
import { pageMetadata, safeHttp } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "أعمالنا",
  description: "مقاطع من أعراس ومناسبات وثّقها ستوديو وتسجيلات السلطان، تُشاهد مباشرة داخل الموقع.",
  path: "/work",
});

export default async function WorkPage() {
  const [videos, settings] = await Promise.all([getShowcaseVideos(), getBusinessSettings()]);
  const channel = settings.status === "ok" ? safeHttp(settings.data?.youtube_url ?? null) : null;
  const list = videos.status === "ok" ? videos.data : [];
  const promo = list.find((v) => v.is_promo) ?? null;
  const rest = list.filter((v) => v !== promo);
  const card = (v: (typeof list)[number]) => ({
    youtubeId: v.youtube_id,
    title: v.title,
    duration: durationLabel(v.duration_seconds),
    meta: [videoCategoryLabel(v.category), formatDateAr(v.published_at)].filter(Boolean).join(" · ") || null,
  });

  return (
    <>
      <PageIntro title="أعمالنا" lead="مقاطع من أعراس ومناسبات وثّقناها. اضغط على أي مقطع لمشاهدته هنا." />
      <Section>
        {videos.status === "unavailable" ? (
          <ErrorState action={<WhatsAppCta />} />
        ) : list.length === 0 ? (
          <EmptyState
            title="نجهّز معرض الأعمال"
            body="ننشر مقاطع من أعمالنا هنا قريباً. إلى ذلك الحين، يسعدنا نحكي معك عن مناسبتك."
            action={<WhatsAppCta />}
          />
        ) : (
          <>
            {promo ? (
              <div className="mb-12 grid items-center gap-6 lg:grid-cols-[1.6fr_1fr] lg:gap-10">
                <MaskReveal>
                  <YouTubeCard video={card(promo)} priority sizes="(min-width: 1024px) 60vw, 100vw" />
                </MaskReveal>
                <div>
                  <p className="text-sm font-semibold text-gold-text">مقطع مختار</p>
                  {promo.description ? <p className="mt-2 text-lg text-on-cream-muted">{promo.description}</p> : null}
                </div>
              </div>
            ) : null}
            <ul className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((v, i) => (
                <li key={v.id}>
                  <MaskReveal index={i % 3}>
                    <YouTubeCard video={card(v)} priority={!promo && i < 3} />
                  </MaskReveal>
                </li>
              ))}
            </ul>
            {channel ? (
              <p className="mt-10">
                <Link
                  href={channel}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-8 hover:decoration-gold"
                >
                  المزيد على قناتنا في YouTube
                </Link>
              </p>
            ) : null}
          </>
        )}
      </Section>
    </>
  );
}
