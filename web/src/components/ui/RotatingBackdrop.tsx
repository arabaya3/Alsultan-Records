"use client";

import { useEffect, useState } from "react";

const EVERY_MS = 8000;

/**
 * Decorative: fades through the other published covers above a hero's first image, which stays the page's LCP. A photo
 * is fetched only when its turn comes, and shows only once loaded. Stops for reduced motion and while the tab is hidden.
 */
export function RotatingBackdrop({ srcs, mobileSrcs, className }: { srcs: string[]; mobileSrcs?: string[]; className: string }) {
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (srcs.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const use = mobileSrcs && matchMedia("(max-width: 767px)").matches ? mobileSrcs : srcs;
    let next = 1;
    const id = setInterval(() => {
      if (document.hidden) return;
      const src = use[next];
      const img = new window.Image();
      img.onload = () => setShown(src);
      img.src = src;
      next = (next + 1) % use.length;
    }, EVERY_MS);
    return () => clearInterval(id);
  }, [srcs, mobileSrcs]);

  if (!shown) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img key={shown} src={shown} alt="" aria-hidden="true" decoding="async" className={`${className} animate-[backdrop-in_1s_ease-out]`} />;
}
