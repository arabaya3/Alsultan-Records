import Link from "next/link";
import { AlbumCard } from "@/components/media/gallery/AlbumCard";
import { ProjectTile } from "@/components/media/ProjectTile";
import { SitePromoPlayer } from "@/components/media/promo/SitePromoPlayer";
import { PROMO_CAPTION } from "@/components/media/promo/promo-seo";
import { YouTubeCard } from "@/components/media/youtube/YouTubeCard";
import { FadeRise } from "@/components/motion/Reveal";
import { buttonClasses } from "@/components/ui/Button";
import { Section, SectionHeading } from "@/components/ui/Layout";
import { PageHero } from "@/components/ui/PageHero";
import { YouTubeIcon } from "@/components/ui/SocialIcons";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { getAlbumCategories } from "@/features/public-content/cms-queries";
import { filterVideos, isWork, promoVideos, paginate, parseWorkQuery, toCardVideo, workHref, type WorkQuery } from "@/features/public-content/gallery-model";
import { getPublishedAlbums, getVideoGallery } from "@/features/public-content/gallery-queries";
import { durationLabel, eventTypeLabel, formatDateAr } from "@/features/public-content/labels";
import { getBusinessSettings, getPublishedProjects } from "@/features/public-content/queries";
import { IconLink } from "@/components/ui/IconLink";
import { ChipScroller } from "@/components/ui/ChipScroller";
import { pageMetadata, safeHttp } from "@/features/public-content/seo";
import { STUDIO_ENABLED } from "@/features/studio/config";
import { StudioWall } from "@/features/studio/StudioWall";

export const metadata = pageMetadata({
  title: "أعمالنا",
  description: "فيديوهات وألبومات صور من أعراس ومناسبات وثّقها ستوديو وتسجيلات السلطان.",
  path: "/work",
});

// Lead per tab: guidance only where it applies (categories and clips belong to videos, not to albums or promos).
const LEAD: Record<WorkQuery["tab"], string> = {
  videos: "فيديوهات من أعراس ومناسبات وثّقناها. اختر تصنيفاً، واضغط على أي مقطع لمشاهدته هنا.",
  photos: "ألبومات صور من أعراس ومناسبات وثّقناها. افتح أي ألبوم لتصفّح صوره كاملة.",
  promos: "فيديوهات تعريفية قصيرة بستوديو وتسجيلات السلطان.",
};

/* Segmented tabs (gold = active) and category chips. Each is a real, shareable URL (server-rendered). */
const tabCls = (active: boolean) =>
  `inline-flex min-h-12 items-center justify-center gap-2 rounded-sm px-5 text-base font-semibold transition-colors duration-200 sm:px-7 ${
    active ? "bg-gold text-ink" : "text-ivory-muted hover:bg-surface-2 hover:text-ivory"
  }`;
const chipCls = (active: boolean) =>
  `inline-flex min-h-11 items-center gap-2 rounded-sm border px-4 text-base transition-colors duration-200 ${
    active ? "border-gold bg-gold text-ink" : "border-hairline bg-surface text-ivory hover:border-gold/70 hover:text-gold"
  }`;
const linkCls = buttonClasses({ variant: "link" });
/** Smooth swap when the category / page changes: the keyed list fades and rises in (CSS @starting-style;
 *  neutralized by prefers-reduced-motion in globals.css). */
const swapCls = "transition-[opacity,translate] duration-500 ease-out starting:translate-y-2 starting:opacity-0";

function VideoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <path d="M17 10l4-2.5v9L17 14" />
    </svg>
  );
}
function PhotoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-9 9" />
    </svg>
  );
}

function Tabs({ tab, promos }: { tab: WorkQuery["tab"]; promos: boolean }) {
  return (
    <nav aria-label="نوع الأعمال" className="mb-8 flex justify-center">
      <ul className="inline-flex flex-wrap justify-center gap-1 rounded-md border border-hairline bg-surface p-1">
        <li>
          <Link href={workHref({ tab: "videos" })} aria-current={tab === "videos" ? "page" : undefined} data-work-tab="videos" className={tabCls(tab === "videos")}>
            <VideoIcon />
            الفيديوهات
          </Link>
        </li>
        <li>
          <Link href={workHref({ tab: "photos" })} aria-current={tab === "photos" ? "page" : undefined} data-work-tab="photos" className={tabCls(tab === "photos")}>
            <PhotoIcon />
            ألبومات الصور
          </Link>
        </li>
        {promos || tab === "promos" ? (
          <li>
            <Link href={workHref({ tab: "promos" })} aria-current={tab === "promos" ? "page" : undefined} data-work-tab="promos" className={tabCls(tab === "promos")}>
              البروموهات
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

async function Videos({ q }: { q: WorkQuery }) {
  const [res, settings] = await Promise.all([getVideoGallery(), getBusinessSettings()]);
  if (res.status === "unavailable") return <ErrorState action={<WhatsAppCta />} />;
  const g = res.data;
  if (g.videos.length === 0) {
    return (
      <EmptyState
        title="نجهّز معرض الأعمال"
        body="ننشر مقاطع من أعمالنا هنا قريباً. إلى ذلك الحين، يسعدنا نحكي معك عن مناسبتك."
        action={<WhatsAppCta />}
      />
    );
  }
  const channel = settings.status === "ok" ? safeHttp(settings.data?.youtube_url ?? null) : null;
  const active = q.cat ? (g.categories.find((c) => c.slug === q.cat) ?? null) : null;
  // Unfiltered: every published YouTube work, including the one flagged is_promo (a real work, no
  // longer featured; the highlight slot belongs to the self-hosted studio promo).
  const list = active ? filterVideos(g, active.slug) : g.videos.filter(isWork);
  const { shown, page, hasMore, total } = paginate(q.cat && !active ? [] : list, q.page);
  const featured = !q.cat && page === 1;

  return (
    <>
      {g.categories.length ? (
        <nav aria-label="تصنيفات الفيديو" className="mb-10">
          <ChipScroller>
            <li>
              <Link href={workHref({})} scroll={false} aria-current={!q.cat ? "page" : undefined} data-cat-chip="" className={chipCls(!q.cat)}>
                الكل
              </Link>
            </li>
            {g.categories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={workHref({ cat: c.slug })}
                  scroll={false}
                  aria-current={active?.slug === c.slug ? "page" : undefined}
                  data-cat-chip={c.slug}
                  className={chipCls(active?.slug === c.slug)}
                >
                  {c.title}
                  <span className="text-sm opacity-70">{c.count.toLocaleString("ar-PS")}</span>
                </Link>
              </li>
            ))}
          </ChipScroller>
        </nav>
      ) : null}

      {featured ? (
        // Featured slot: the self-hosted studio film (large, gold frame), then the YouTube works grid.
        <div data-work-promo className="mx-auto mb-14 max-w-5xl">
          <div className="rounded-lg border border-hairline-gold p-1 shadow-[0_24px_60px_-30px_rgb(233_185_73/0.45)]">
            <SitePromoPlayer label="فيديو تعريفي بالاستوديو" caption={PROMO_CAPTION} priority sizes="(min-width: 1024px) 64rem, 100vw" />
          </div>
          <div className="mt-4 text-center">
            <p className="font-display text-lg font-semibold text-ivory">فيديو تعريفي بالاستوديو</p>
            <p className="mt-1 text-ivory-muted">لمحة سريعة عن شغلنا في الأعراس والمناسبات: تصوير، أفلام وDJ.</p>
          </div>
        </div>
      ) : null}

      <h2 className="sr-only">{active ? `فيديوهات: ${active.title}` : "كل الفيديوهات"}</h2>
      <div key={`${active?.slug ?? "all"}-${page}`} className={swapCls}>
        {shown.length === 0 ? (
          <EmptyState title="لا توجد فيديوهات في هذا التصنيف" body="جرّب تصنيفاً آخر أو اعرض كل الأعمال." action={<Link href="/work" className={linkCls}>عرض الكل</Link>} />
        ) : (
          <ul data-video-grid className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((v, i) => (
              <li key={v.id} className="h-full">
                <YouTubeCard video={toCardVideo(v, durationLabel(v.duration_seconds))} priority={!featured && i < 3} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-12 flex flex-col items-center gap-4">
        {hasMore ? (
          <Link href={workHref({ cat: active?.slug ?? null, page: page + 1 })} scroll={false} data-load-more className={buttonClasses({ variant: "outline" })}>
            تحميل المزيد
          </Link>
        ) : null}
        <p role="status" className="text-sm text-ivory-muted" data-shown-count={shown.length}>
          {total ? `عرض ${shown.length.toLocaleString("ar-PS")} من ${total.toLocaleString("ar-PS")}` : ""}
        </p>
        {channel ? (
          <IconLink href={channel} external label="المزيد على قناتنا في YouTube">
            <YouTubeIcon size={18} />
          </IconLink>
        ) : null}
      </div>
    </>
  );
}

/** Promos (role promo/both), separate from the occasion categories. Pinned first (query order). */
async function Promos() {
  const res = await getVideoGallery();
  if (res.status === "unavailable") return <ErrorState action={<WhatsAppCta />} />;
  const list = promoVideos(res.data);
  if (!list.length) {
    return <EmptyState title="لا توجد بروموهات منشورة بعد" body="ننشر البروموهات هنا حال جاهزيتها." action={<Link href="/work" className={linkCls}>كل الأعمال</Link>} />;
  }
  return (
    <>
      <h2 className="sr-only">البروموهات</h2>
      <ul data-promo-grid className={`grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 ${swapCls}`}>
        {list.map((v, i) => (
          <li key={v.id} className="h-full">
            <YouTubeCard video={{ ...toCardVideo(v, durationLabel(v.duration_seconds)), categories: [] }} priority={i < 3} />
          </li>
        ))}
      </ul>
    </>
  );
}

async function Albums({ cat }: { cat: string | null }) {
  const [res, categories] = await Promise.all([getPublishedAlbums(), getAlbumCategories()]);
  if (res.status === "unavailable") return <ErrorState title="تعذّر تحميل الألبومات الآن" action={<WhatsAppCta />} />;
  const all = res.data.filter((a) => a.photoCount > 0);
  if (!all.length) return <EmptyState title="لا توجد ألبومات منشورة بعد" body="ننشر ألبومات صور من مناسباتنا هنا حال جاهزيتها." />;
  const used = categories.filter((c) => all.some((a) => a.category_id === c.id));
  const active = cat ? (used.find((c) => c.slug === cat) ?? null) : null;
  const albums = active ? all.filter((a) => a.category_id === active.id) : cat ? [] : all;
  return (
    <>
      {used.length ? (
        <nav aria-label="تصنيفات الألبومات" className="mb-10">
          <ChipScroller>
            <li>
              <Link href={workHref({ tab: "photos" })} scroll={false} aria-current={!cat ? "page" : undefined} data-album-cat-chip="" className={chipCls(!cat)}>
                الكل
              </Link>
            </li>
            {used.map((c) => (
              <li key={c.id}>
                <Link
                  href={workHref({ tab: "photos", cat: c.slug })}
                  scroll={false}
                  aria-current={active?.id === c.id ? "page" : undefined}
                  data-album-cat-chip={c.slug}
                  className={chipCls(active?.id === c.id)}
                >
                  {c.title}
                  <span className="text-sm opacity-70">{all.filter((a) => a.category_id === c.id).length.toLocaleString("ar-PS")}</span>
                </Link>
              </li>
            ))}
          </ChipScroller>
        </nav>
      ) : null}
      <h2 className="sr-only">ألبومات الصور</h2>
      <div key={active?.slug ?? "all"} className={swapCls}>
        {!albums.length ? (
          <EmptyState
            title="لا توجد ألبومات في هذا التصنيف"
            body="جرّب تصنيفاً آخر أو اعرض كل الألبومات."
            action={<Link href={workHref({ tab: "photos" })} className={linkCls}>عرض الكل</Link>}
          />
        ) : null}
        {STUDIO_ENABLED ? (
          // the studio's photo wall: same cards, in list order, hung in groups on wide screens with the scene
          <StudioWall albums={albums.map((a) => ({ slug: a.slug, coverId: a.coverId, title: a.title }))} className="studio-wall__grid grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-6 md:grid-cols-3 lg:grid-cols-4">
            {albums.map((a, i) => (
              <li key={a.id} className="studio-wall__item h-full">
                <AlbumCard album={a} priority={i < 4} />
              </li>
            ))}
          </StudioWall>
        ) : (
          <ul data-album-grid className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 md:grid-cols-3 lg:grid-cols-4">
            {albums.map((a, i) => (
              <li key={a.id} className="h-full">
                <AlbumCard album={a} priority={i < 4} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

async function WorkBody({ searchParams }: { searchParams: PageProps<"/work">["searchParams"] }) {
  const q = parseWorkQuery(await searchParams);
  const gallery = await getVideoGallery();
  const hasPromos = gallery.status === "ok" && promoVideos(gallery.data).length > 0;
  return (
    <>
      <Tabs tab={q.tab} promos={hasPromos} />
      {q.tab === "photos" ? <Albums cat={q.cat} /> : q.tab === "promos" ? <Promos /> : <Videos q={q} />}
    </>
  );
}

async function Projects() {
  const projects = await getPublishedProjects();
  if (projects.status === "unavailable") {
    return (
      <Section tone="darker">
        <p role="status" className="text-ivory-muted">
          تعذّر تحميل المشاريع المختارة الآن.
        </p>
      </Section>
    );
  }
  if (!projects.data.length) return null;
  return (
    <Section tone="darker" labelledBy="projects-title">
      <SectionHeading id="projects-title" title="مشاريع مختارة" align="center" />
      <ul className="grid gap-6 md:grid-cols-2">
        {projects.data.map((p, i) => (
          <FadeRise as="li" key={p.id} delay={(i % 2) * 80}>
            <ProjectTile
              href={`/work/${p.public_slug}`}
              title={p.title}
              meta={[eventTypeLabel(p.event_type), p.city, formatDateAr(p.event_date)].filter(Boolean).join(" · ") || null}
              media={p.cover}
              ratioClassName="aspect-[4/3]"
            />
          </FadeRise>
        ))}
      </ul>
    </Section>
  );
}

/** Hero with the CMS-chosen real photo (business_settings.hero_cover_photo_id) when set, else the ink texture. */
async function WorkHero({ searchParams }: { searchParams: PageProps<"/work">["searchParams"] }) {
  const [settings, sp] = await Promise.all([getBusinessSettings(), searchParams]);
  const photoId = settings.status === "ok" ? (settings.data?.hero_cover_photo_id ?? null) : null;
  return <PageHero title="أعمالنا" lead={LEAD[parseWorkQuery(sp).tab]} photoId={photoId} />;
}

// Resolved on the server before the response (no streamed fallbacks): the lists and links are in the HTML itself,
// so /work is complete without JavaScript. The data comes from cached, tagged queries — this is fast.
export const instant = false;

export default function WorkPage(props: PageProps<"/work">) {
  return (
    <>
      <WorkHero searchParams={props.searchParams} />
      <Section className="pt-10! md:pt-12!">
        <WorkBody searchParams={props.searchParams} />
      </Section>
      {/* Published + consented event case studies; hidden when there are none. */}
      <Projects />
    </>
  );
}
