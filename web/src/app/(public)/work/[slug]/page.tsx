import { WhatsAppCta } from "@/components/ui/WhatsAppCta";
import { projectText } from "@/lib/whatsapp";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MediaFrame } from "@/components/media/MediaFrame";
import { Reveal } from "@/components/motion/Reveal";
import { ButtonLink } from "@/components/ui/Button";
import { JsonLd } from "@/components/ui/JsonLd";
import { Container, Section } from "@/components/ui/Layout";
import { ErrorState } from "@/components/ui/States";
import { eventTypeLabel, formatDateAr } from "@/features/public-content/labels";
import { getProjectBySlug } from "@/features/public-content/queries";
import { breadcrumbJsonLd, metaDescription, pageMetadata, projectJsonLd } from "@/features/public-content/seo";
import { bidiDir } from "@/lib/bidi";

export async function generateMetadata({ params }: PageProps<"/work/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const res = await getProjectBySlug(slug);
  const p = res.status === "ok" ? res.data : null;
  if (!p) return { title: "أعمالنا", robots: { index: false } };
  const image = p.cover ? (p.cover.kind === "image" ? p.cover.src : p.cover.poster) : null;
  return pageMetadata({
    title: p.seo_title ?? p.title,
    description: metaDescription(p.seo_description ?? p.highlight, `${p.title} — من أعمال ستوديو وتسجيلات السلطان.`),
    path: `/work/${p.public_slug}`,
    image,
  });
}


async function ProjectView({ params }: { params: PageProps<"/work/[slug]">["params"] }) {
  const { slug } = await params;
  const res = await getProjectBySlug(slug);
  if (res.status === "unavailable") {
    return (
      <Section>
        <ErrorState action={<ButtonLink href="/work">العودة إلى الأعمال</ButtonLink>} />
      </Section>
    );
  }
  const p = res.data;
  if (!p) notFound();

  const meta = [eventTypeLabel(p.event_type), p.city, formatDateAr(p.event_date)].filter(Boolean);
  const details = [
    { title: "عن المناسبة", body: p.highlight },
    { title: "ما وثّقناه", body: p.coverage_notes },
  ].filter((d): d is { title: string; body: string } => Boolean(d.body));
  const gallery = p.media.slice(1);

  return (
    <article>
      <JsonLd data={projectJsonLd(p)} />
      <JsonLd data={breadcrumbJsonLd([{ name: "الرئيسية", path: "/" }, { name: "أعمالنا", path: "/work" }, { name: p.title, path: `/work/${p.public_slug}` }])} />
      <div className="ink-texture border-b border-hairline text-ivory">
        <Container className="pb-10 pt-12 md:pt-16">
          <nav aria-label="مسار التنقل" className="mb-6 text-sm text-ivory-muted">
            <Link href="/work" className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-gold">
              أعمالنا
            </Link>
          </nav>
          <Reveal>
            <h1 data-reveal className="text-h1 font-bold tracking-tight">
              <bdi dir={bidiDir(p.title)}>{p.title}</bdi>
              
            </h1>
            {meta.length ? (
              <p data-reveal className="mt-4 text-lead text-ivory-muted">
                {meta.join(" · ")}
              </p>
            ) : null}
          </Reveal>
        </Container>
        <Container className="pb-12">
          <MediaFrame media={p.cover} alt={p.title} ratio="16/9" sizes="100vw" priority playable className="border border-hairline-gold" />
        </Container>
      </div>

      {details.length ? (
        <Section>
          <div className="grid gap-6 md:grid-cols-2">
            {details.map((d) => (
              <div key={d.title} className="rounded-lg border border-hairline bg-surface p-6 md:p-8">
                <h2 className="text-h3 font-semibold">{d.title}</h2>
                <span aria-hidden="true" className="gold-rule mt-3" />
                <p className="mt-3 whitespace-pre-line text-lg text-ivory-muted">{d.body}</p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {gallery.length ? (
        <Section tone="darker" labelledBy="gallery-title">
          <h2 id="gallery-title" className="sr-only">
            صور وفيديو من المناسبة
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.map((m) => (
              <li key={m.id}>
                <MediaFrame
                  media={m}
                  alt={p.title}
                  ratio="4/3"
                  playable
                  className="border border-hairline"
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section>
        <div className="flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
          <p className="font-display text-h3 font-semibold">بدك نوثّق مناسبتك بنفس الطريقة؟</p>
          <WhatsAppCta text={projectText(p.title)} />
        </div>
      </Section>
    </article>
  );
}

// Resolve the slug BEFORE streaming starts so unknown slugs get a real HTTP 404
// (notFound() after the first streamed chunk would leave the status at 200).
export const instant = false;

export default async function Page({ params }: PageProps<"/work/[slug]">) {
  return <ProjectView params={params} />;
}
