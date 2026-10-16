import Link from "next/link";
import { Suspense } from "react";
import { AlbumCard } from "@/components/media/gallery/AlbumCard";
import { ProjectTile } from "@/components/media/ProjectTile";
import { YouTubeCard } from "@/components/media/youtube/YouTubeCard";
import { PageIntro, Section } from "@/components/ui/Layout";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { filterVideos, paginate, parseWorkQuery, toCardVideo, workHref, type WorkQuery } from "@/features/public-content/gallery-model";
import { getPublishedAlbums, getVideoGallery } from "@/features/public-content/gallery-queries";
import { durationLabel, eventTypeLabel, formatDateAr } from "@/features/public-content/labels";
import { getBusinessSettings, getPublishedProjects } from "@/features/public-content/queries";
import { pageMetadata, safeHttp } from "@/features/public-content/seo";

export const metadata = pageMetadata({
  title: "أعمالنا",
  description: "فيديوهات وصور من أعراس ومناسبات وثّقها ستوديو وتسجيلات السلطان، مصنّفة حسب نوع المناسبة.",
  path: "/work",
});

const tabCls = (active: boolean) =>
  `inline-flex min-h-12 items-center border-b-2 px-1 text-lg font-semibold transition-colors ${
    active ? "border-gold text-on-cream" : "border-transparent text-on-cream-muted hover:text-on-cream"
  }`;
const chipCls = (active: boolean) =>
  `inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-base transition-colors ${
    active ? "border-on-cream bg-on-cream text-cream" : "border-cream-line hover:border-gold-press"
  }`;
const linkCls = "inline-flex min-h-11 items-center underline decoration-1 underline-offset-8 hover:decoration-gold";

function Tabs({ tab }: { tab: WorkQuery["tab"] }) {
  // Two links styled as tabs: each tab is a real, shareable URL (server-rendered; back/refresh work).
  return (
    <nav aria-label="نوع الأعمال" className="mb-8 border-b border-cream-line">
      <ul className="flex gap-8">
        <li>
          <Link href={workHref({ tab: "videos" })} aria-current={tab === "videos" ? "page" : undefined} data-work-tab="videos" className={tabCls(tab === "videos")}>
            الفيديوهات
          </Link>
        </li>
        <li>
          <Link href={workHref({ tab: "photos" })} aria-current={tab === "photos" ? "page" : undefined} data-work-tab="photos" className={tabCls(tab === "photos")}>
            الصور
          </Link>
        </li>
      </ul>
    </nav>
  );
}

function GridSkeleton({ ratio = "aspect-video" }: { ratio?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label="جارِ التحميل" className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i}>
          <Skeleton className={ratio} />
          <Skeleton className="mt-3 h-5 w-3/4" />
        </div>
      ))}
    </div>
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
  const list = filterVideos(g, active ? active.slug : null);
  const { shown, page, hasMore, total } = paginate(q.cat && !active ? [] : list, q.page);
  const promo = !q.cat ? g.promo : null;

  return (
    <>
      {g.categories.length ? (
        <nav aria-label="تصنيفات الفيديو" className="mb-8">
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link href={workHref({})} aria-current={!q.cat ? "page" : undefined} data-cat-chip="" className={chipCls(!q.cat)}>
                الكل
              </Link>
            </li>
            {g.categories.map((c) => (
              <li key={c.slug}>
                <Link href={workHref({ cat: c.slug })} aria-current={active?.slug === c.slug ? "page" : undefined} data-cat-chip={c.slug} className={chipCls(active?.slug === c.slug)}>
                  {c.title}
                  <span className="text-sm opacity-70">{c.count.toLocaleString("ar-PS")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {promo && page === 1 ? (
        <div className="mb-12 grid items-start gap-6 lg:grid-cols-[1.6fr_1fr] lg:gap-10">
          <YouTubeCard video={toCardVideo(promo, durationLabel(promo.duration_seconds))} priority sizes="(min-width: 1024px) 60vw, 100vw" />
          <div>
            <p className="text-sm font-semibold text-gold-text">مقطع مختار</p>
            {promo.description ? <p className="mt-2 line-clamp-6 whitespace-pre-line text-lg text-on-cream-muted">{promo.description}</p> : null}
          </div>
        </div>
      ) : null}

      <h2 className="sr-only">{active ? `فيديوهات: ${active.title}` : "كل الفيديوهات"}</h2>
      {shown.length === 0 ? (
        <EmptyState title="لا توجد فيديوهات في هذا التصنيف" body="جرّب تصنيفاً آخر أو اعرض كل الأعمال." action={<Link href="/work" className={linkCls}>عرض الكل</Link>} />
      ) : (
        <ul data-video-grid className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((v, i) => (
            <li key={v.id} className="h-full">
              <YouTubeCard video={toCardVideo(v, durationLabel(v.duration_seconds))} priority={!promo && i < 3} />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <p role="status" className="text-on-cream-muted" data-shown-count={shown.length}>
          {total ? `عرض ${shown.length.toLocaleString("ar-PS")} من ${total.toLocaleString("ar-PS")}` : ""}
        </p>
        {hasMore ? (
          <Link
            href={workHref({ cat: active?.slug ?? null, page: page + 1 })}
            scroll={false}
            data-load-more
            className="inline-flex min-h-12 items-center rounded-sm border border-on-cream px-6 font-medium hover:border-gold-press hover:text-gold-press"
          >
            تحميل المزيد
          </Link>
        ) : null}
      </div>
      {channel ? (
        <p className="mt-6">
          <a href={channel} target="_blank" rel="noopener noreferrer" className={linkCls}>
            المزيد على قناتنا في YouTube
          </a>
        </p>
      ) : null}
    </>
  );
}

async function Albums() {
  const res = await getPublishedAlbums();
  if (res.status === "unavailable") return <ErrorState title="تعذّر تحميل الألبومات الآن" action={<WhatsAppCta />} />;
  const albums = res.data.filter((a) => a.photoCount > 0);
  if (!albums.length) return <EmptyState title="لا توجد ألبومات منشورة بعد" body="ننشر ألبومات صور من مناسباتنا هنا حال جاهزيتها." />;
  return (
    <>
      <h2 className="sr-only">ألبومات الصور</h2>
      <ul data-album-grid className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {albums.map((a, i) => (
          <li key={a.id} className="h-full">
            <AlbumCard album={a} priority={i < 3} />
          </li>
        ))}
      </ul>
    </>
  );
}

async function WorkBody({ searchParams }: { searchParams: PageProps<"/work">["searchParams"] }) {
  const q = parseWorkQuery(await searchParams);
  return (
    <>
      <Tabs tab={q.tab} />
      {q.tab === "photos" ? (
        <Suspense fallback={<GridSkeleton ratio="aspect-[4/3]" />}>
          <Albums />
        </Suspense>
      ) : (
        <Suspense fallback={<GridSkeleton />}>
          <Videos q={q} />
        </Suspense>
      )}
    </>
  );
}

async function Projects() {
  const projects = await getPublishedProjects();
  if (projects.status === "unavailable") {
    return (
      <Section tone="cream-2">
        <p role="status" className="text-on-cream-muted">تعذّر تحميل المشاريع المختارة الآن.</p>
      </Section>
    );
  }
  if (!projects.data.length) return null;
  return (
    <Section tone="cream-2" labelledBy="projects-title">
      <h2 id="projects-title" className="mb-8 text-3xl font-bold tracking-tight md:text-[2.5rem]">مشاريع مختارة</h2>
      <ul className="grid gap-6 md:grid-cols-2">
        {projects.data.map((p) => (
          <li key={p.id}>
            <ProjectTile
              href={`/work/${p.public_slug}`}
              title={p.title}
              meta={[eventTypeLabel(p.event_type), p.city, formatDateAr(p.event_date)].filter(Boolean).join(" · ") || null}
              media={p.cover}
              ratioClassName="aspect-[4/3]"
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

export default function WorkPage(props: PageProps<"/work">) {
  return (
    <>
      <PageIntro title="أعمالنا" lead="فيديوهات وصور من أعراس ومناسبات وثّقناها. اختر تصنيفاً، واضغط على أي مقطع لمشاهدته هنا." />
      <Section>
        <Suspense fallback={<GridSkeleton />}>
          <WorkBody searchParams={props.searchParams} />
        </Suspense>
      </Section>
      {/* Published + consented event case studies; hidden when there are none. */}
      <Projects />
    </>
  );
}
