import Link from "next/link";
import type { ReactNode } from "react";
import { photoUrl } from "@/features/public-content/gallery-model";
import { getBusinessSettings } from "@/features/public-content/queries";

export type Crumb = { label: string; href?: string };

/**
 * Inner-page hero (renders the page's h1).
 *   title    — h1 text
 *   lead?    — short intro line under the gold rule
 *   eyebrow? — small gold label above the title
 *   breadcrumb? — [{label, href?}] ; last item = current page (no href)
 *   photoId? — a REAL album photo id chosen in the CMS (e.g. business_settings.hero_cover_photo_id). Shown as a
 *              decorative backdrop (object-cover is allowed ONLY here) under a dark gradient for legibility.
 *              Omitted (undefined) → the CMS cover photo (business_settings.hero_cover_photo_id) if set; pass
 *              null to force no photo (e.g. an album page, so another event's photo never sits behind its title).
 *              Without a photo the CSS ink texture is used. Never pass stock/generated images.
 *   align?   — "center" (default, as in the references) | "start"
 *   children? — optional actions row (e.g. ButtonLink / WhatsAppCta)
 */
export async function PageHero({
  title,
  lead,
  eyebrow,
  breadcrumb,
  photoId,
  align = "center",
  children,
}: {
  title: ReactNode;
  lead?: ReactNode;
  eyebrow?: ReactNode;
  breadcrumb?: Crumb[];
  photoId?: string | null;
  align?: "center" | "start";
  children?: ReactNode;
}) {
  if (photoId === undefined) {
    const s = await getBusinessSettings(); // cached + tagged (admin saves expire it)
    photoId = s.status === "ok" ? (s.data?.hero_cover_photo_id ?? null) : null;
  }
  const center = align === "center";
  return (
    <div className={`relative isolate overflow-hidden border-b border-hairline text-ivory ${photoId ? "bg-night-deep" : "ink-texture"}`}>
      {photoId ? (
        <>
          {/* Decorative backdrop: gated same-origin variant, plain <img> as elsewhere for /p/<id>. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl(photoId, "display")}
            alt=""
            aria-hidden="true"
            decoding="async"
            fetchPriority="high"
            className="absolute inset-0 -z-20 size-full object-cover opacity-60"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,var(--color-night)_0%,rgb(13_12_11/0.82)_45%,rgb(13_12_11/0.55)_100%)]"
          />
        </>
      ) : null}
      <div
        className={`mx-auto flex w-full max-w-[var(--content-max)] flex-col px-[var(--gutter)] py-16 md:py-24 ${center ? "items-center text-center" : "items-start"}`}
      >
        {breadcrumb?.length ? (
          <nav aria-label="مسار التنقل" className="mb-5 text-sm text-ivory-muted">
            <ol className={`flex flex-wrap items-center gap-x-2 ${center ? "justify-center" : ""}`}>
              {breadcrumb.map((c, i) => (
                <li key={`${c.label}-${i}`} className="flex items-center gap-x-2">
                  {i > 0 ? <span aria-hidden="true" className="text-gold">/</span> : null}
                  {c.href ? (
                    <Link href={c.href} className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-gold">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-ivory">
                      {c.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        {eyebrow ? <p className="mb-3 text-sm font-medium text-gold">{eyebrow}</p> : null}
        <h1 className="max-w-4xl text-h1 font-bold tracking-tight">{title}</h1>
        <span aria-hidden="true" className={`gold-rule mt-5 ${center ? "mx-auto" : ""}`} />
        {lead ? <p className="mt-5 max-w-2xl text-lead text-ivory-muted">{lead}</p> : null}
        {children ? (
          <div className={`mt-8 flex flex-wrap items-center gap-4 ${center ? "justify-center" : ""}`}>{children}</div>
        ) : null}
      </div>
    </div>
  );
}
