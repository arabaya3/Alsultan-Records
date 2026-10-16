import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlbumGallery } from "@/components/media/gallery/AlbumGallery";
import { photoCountLabel } from "@/components/media/gallery/AlbumCard";
import { ButtonLink } from "@/components/ui/Button";
import { Container, Section } from "@/components/ui/Layout";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { photoUrl } from "@/features/public-content/gallery-model";
import { getAlbumBySlug } from "@/features/public-content/gallery-queries";
import { formatDateAr } from "@/features/public-content/labels";
import { pageMetadata, safeHttp } from "@/features/public-content/seo";
import { projectText } from "@/lib/whatsapp";

const SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;

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

async function AlbumView({ params }: { params: PageProps<"/work/albums/[slug]">["params"] }) {
  const { slug } = await params;
  if (!SLUG.test(slug) || slug.length > 120) notFound();
  const res = await getAlbumBySlug(slug);
  if (res.status === "unavailable") {
    return (
      <Section>
        <ErrorState title="تعذّر تحميل الألبوم الآن" action={<ButtonLink href="/work?tab=photos">العودة إلى الصور</ButtonLink>} />
      </Section>
    );
  }
  if (!res.data) notFound();
  const { album, photos } = res.data;
  const sourceUrl = safeHttp(album.source_url);
  const meta = [formatDateAr(album.event_date), photoCountLabel(photos.length)].filter(Boolean);

  return (
    <article data-album-page={album.slug}>
      <div className="bg-ink text-on-dark">
        <Container className="pb-10 pt-10 md:pb-14 md:pt-14">
          <nav aria-label="مسار التصفح" className="mb-5 text-sm text-muted">
            <Link href="/work?tab=photos" className="inline-flex min-h-11 items-center hover:text-gold">
              الصور
            </Link>
          </nav>
          <h1 className="text-3xl font-bold leading-tight break-words md:text-5xl">
            <bdi dir="auto">{album.title}</bdi>
            <span className="text-gold">.</span>
          </h1>
          <p className="mt-3 text-muted">{meta.join(" · ")}</p>
          {album.description ? <p className="mt-5 max-w-3xl whitespace-pre-line text-lg text-on-dark/90">{album.description}</p> : null}
          {album.source_label ? (
            <p data-album-source className="mt-4 text-sm text-muted">
              المصدر:{" "}
              {sourceUrl ? (
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-on-dark underline underline-offset-4 hover:decoration-gold">
                  {album.source_label}
                </a>
              ) : (
                album.source_label
              )}
            </p>
          ) : null}
        </Container>
      </div>
      <Section>
        <h2 className="sr-only">صور الألبوم</h2>
        {photos.length === 0 ? (
          <EmptyState title="لا توجد صور منشورة في هذا الألبوم بعد" />
        ) : (
          <AlbumGallery
            albumTitle={album.title}
            sourceLabel={album.source_label}
            sourceUrl={sourceUrl}
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
        <div className="mt-12 flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
          <p className="font-display text-2xl font-semibold">بدك نوثّق مناسبتك بنفس الطريقة؟</p>
          <WhatsAppCta text={projectText(album.title)} />
        </div>
      </Section>
    </article>
  );
}

// Resolve before streaming so unknown / unpublished albums get a real HTTP 404.
export const instant = false;

export default async function Page({ params }: PageProps<"/work/albums/[slug]">) {
  return <AlbumView params={params} />;
}
