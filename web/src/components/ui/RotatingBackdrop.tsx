"use client";

import { useEffect, useRef, useState } from "react";
import { useAmbientMotion } from "@/components/motion/useAmbientMotion";

const EVERY_MS = 8000;

/**
 * Decorative: fades through the other published covers above a hero's first image, which stays the page's LCP. A photo
 * is fetched only when its turn comes, and shows only once loaded. Never moves under reduced motion or Save-Data; pauses
 * (no photo is loaded) while the tab is hidden, while the hero is off screen, and after a long stretch with no visitor
 * activity (useAmbientMotion). The empty sentinel covers the hero box so its visibility can be observed.
 */
export function RotatingBackdrop({ srcs, mobileSrcs, className }: { srcs: string[]; mobileSrcs?: string[]; className: string }) {
  const [shown, setShown] = useState<string | null>(null);
  const area = useRef<HTMLSpanElement>(null);
  const { running, stepped } = useAmbientMotion(area, srcs.length >= 2);
  const next = useRef(1);

  useEffect(() => {
    if (!running) return;
    const use = mobileSrcs && matchMedia("(max-width: 767px)").matches ? mobileSrcs : srcs;
    const id = setInterval(() => {
      const src = use[next.current % use.length];
      const img = new window.Image();
      img.onload = () => {
        setShown(src);
        stepped();
      };
      img.src = src;
      next.current = (next.current + 1) % use.length;
    }, EVERY_MS);
    return () => clearInterval(id);
  }, [running, srcs, mobileSrcs, stepped]);

  return (
    <>
      <span ref={area} aria-hidden="true" data-rotating-backdrop-area={running ? "1" : "0"} className="pointer-events-none absolute inset-0 -z-30" />
      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={shown} src={shown} alt="" aria-hidden="true" decoding="async" data-rotating-backdrop className={`${className} animate-[backdrop-in_1s_ease-out]`} />
      ) : null}
    </>
  );
}
