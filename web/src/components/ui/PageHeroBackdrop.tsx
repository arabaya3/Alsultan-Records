"use client";

/**
 * Client component on purpose: an <img> in a Server Component puts a preload hint in the route's prefetch payload, so
 * merely having a link to the page downloaded this photo on the home page. The page's own HTML still preloads it.
 */
export function PageHeroBackdrop({ src }: { src: string }) {
  return (
    // Decorative backdrop: gated same-origin variant, plain <img> as elsewhere for /p/<id>.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" aria-hidden="true" decoding="async" fetchPriority="high" className="absolute inset-0 -z-20 size-full object-cover opacity-60" />
  );
}
