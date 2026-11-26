"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

export type CarouselOffer = {
  slug: string;
  href: string;
  title: string;
  /** The offer's own first line (description or first item); never invented. */
  sub: string | null;
  /** The offer's own image (through /p), or null: then a drawn diamond stands in, never a stock photo. */
  image: string | null;
};

const INTERVAL = 6000;

function Diamond({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 56" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M14 4h36l12 14L32 52 2 18 14 4Z" />
      <path d="M2 18h60M14 4l10 14 8-14 8 14 10-14M24 18l8 34 8-34" />
    </svg>
  );
}

function Chevron({ dir }: { dir: "prev" | "next" }) {
  // RTL: "previous" sits on the right and points right; "next" on the left points left.
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d={dir === "prev" ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
    </svg>
  );
}

/**
 * Active offers on the home page as one navy card with a gold frame (owner's design): «عرض لفترة محدودة», the offer
 * name and its first line, «شاهد العرض», the offer's own image on the far side. With more than one offer: arrows, dots
 * and a progress line; it advances every 6 s, pauses on hover or keyboard focus, and never moves under reduced motion.
 */
export function OfferCarousel({ offers }: { offers: CarouselOffer[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [tick, setTick] = useState(0); // restarts the progress line
  const many = offers.length > 1;
  const go = useCallback((n: number) => {
    setI((n + offers.length) % offers.length);
    setTick((t) => t + 1);
  }, [offers.length]);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setReduced(m.matches);
    set();
    m.addEventListener("change", set);
    return () => m.removeEventListener("change", set);
  }, []);

  // Progress line: empty at the start of each slide, then a CSS transition fills it over the slide's time.
  const [fill, setFill] = useState(false);
  useEffect(() => {
    if (!many || paused || reduced) return;
    const r1 = window.requestAnimationFrame(() => {
      setFill(false);
      window.requestAnimationFrame(() => setFill(true));
    });
    const t = window.setTimeout(() => go(i + 1), INTERVAL);
    return () => {
      window.cancelAnimationFrame(r1);
      window.clearTimeout(t);
    };
  }, [i, many, paused, reduced, go, tick]);

  if (!offers.length) return null;
  const o = offers[i];

  return (
    <section
      ref={root}
      aria-roledescription="carousel"
      aria-label="عروض لفترة محدودة"
      data-offer-carousel
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node)) setPaused(false);
      }}
      className="relative overflow-hidden rounded-3xl border-2 border-gold/80 bg-navy text-ivory shadow-[0_18px_40px_-24px_rgb(0_0_0/0.6)]"
    >
      <div
        key={o.slug}
        role="group"
        aria-roledescription="slide"
        aria-label={`${(i + 1).toLocaleString("ar-PS")} من ${offers.length.toLocaleString("ar-PS")}`}
        data-offer-slide={o.slug}
        className="grid min-h-56 md:grid-cols-[1.35fr_1fr]"
      >
        <div className={`relative flex flex-col justify-center gap-3 py-7 ${many ? "px-6 md:ps-20 md:pe-6" : "px-6 md:ps-12"} md:py-9`}>
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-gold sm:text-base">
            <Diamond className="h-5 w-6 text-gold" />
            عرض لفترة محدودة
          </p>
          <h2 className="font-display text-2xl leading-snug font-bold break-words sm:text-[2.25rem]">
            <bdi>{o.title}</bdi>
          </h2>
          {o.sub ? <p className="line-clamp-2 text-base text-ivory/85 sm:text-lg">{o.sub}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-6">
            <Link
              href={o.href}
              data-offer-carousel-link={o.slug}
              className="inline-flex min-h-12 items-center rounded-full border-2 border-gold px-7 text-base font-semibold text-gold transition-colors hover:bg-gold hover:text-ink"
            >
              شاهد العرض
            </Link>
            {many ? (
              <span className="flex items-center gap-4">
                {/* Phones: the arrows sit here, next to the dots, so they never cover the text. */}
                <span className="flex items-center gap-2 md:hidden">
                  <button type="button" aria-label="العرض السابق" onClick={() => go(i - 1)} className="grid size-11 place-items-center rounded-full border border-gold text-gold">
                    <Chevron dir="prev" />
                  </button>
                  <button type="button" aria-label="العرض التالي" onClick={() => go(i + 1)} className="grid size-11 place-items-center rounded-full border border-gold text-gold">
                    <Chevron dir="next" />
                  </button>
                </span>
                <span className="-mx-2 flex items-center">
                  {offers.map((x, n) => (
                    <button
                      key={x.slug}
                      type="button"
                      aria-label={`العرض ${(n + 1).toLocaleString("ar-PS")}`}
                      aria-current={n === i ? "true" : undefined}
                      onClick={() => go(n)}
                      className="grid size-11 place-items-center"
                    >
                      <span className={`block size-2.5 rounded-full ${n === i ? "bg-gold" : "bg-ivory/35"}`} />
                    </button>
                  ))}
                </span>
                <span aria-hidden="true" className="relative hidden h-0.5 w-40 overflow-hidden rounded-full bg-ivory/20 sm:block">
                  <span
                    className="absolute inset-y-0 start-0 bg-gold ease-linear"
                    style={
                      paused || reduced
                        ? { width: "100%" }
                        : { width: fill ? "100%" : "0%", transitionProperty: "width", transitionDuration: fill ? `${INTERVAL}ms` : "0ms" }
                    }
                  />
                </span>
              </span>
            ) : null}
          </div>
        </div>
        <div className="relative hidden md:block">
          {o.image ? (
            // The offer's own picture, cut on a slant with a gold edge like the home hero.
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={o.image} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover [clip-path:polygon(0_0,100%_0,82%_100%,0_100%)]" />
              <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full text-gold">
                <line x1="100" y1="0" x2="82" y2="100" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
              </svg>
            </>
          ) : (
            <div className="absolute inset-0 grid place-items-center">
              <Diamond className="h-24 w-28 text-gold/35" />
            </div>
          )}
        </div>
      </div>
      {many ? (
        <>
          <button type="button" aria-label="العرض السابق" onClick={() => go(i - 1)} className="absolute top-1/2 start-5 hidden size-11 -translate-y-1/2 place-items-center rounded-full border border-gold text-gold transition-colors hover:bg-gold hover:text-ink md:grid">
            <Chevron dir="prev" />
          </button>
          <button type="button" aria-label="العرض التالي" onClick={() => go(i + 1)} className="absolute top-1/2 end-5 hidden size-11 -translate-y-1/2 place-items-center rounded-full border border-gold text-gold transition-colors hover:bg-gold hover:text-ink md:grid">
            <Chevron dir="next" />
          </button>
        </>
      ) : null}
    </section>
  );
}
