import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MediaFrame } from "@/components/media/MediaFrame";
import { ButtonLink } from "@/components/ui/Button";
import { Container, Section } from "@/components/ui/Layout";
import { ErrorState } from "@/components/ui/States";
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
    image: s.cover?.kind === "image" ? s.cover.src : null,
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
          {s.cover ? <MediaFrame media={s.cover} alt={s.title} ratio="4/3" playable /> : null}
        </div>
        <div className="mt-12">
          <ButtonLink href="/book">احجز مناسبتك</ButtonLink>
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
