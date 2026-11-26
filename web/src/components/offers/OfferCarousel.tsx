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
const SLIDE_MS = 600;

function Diamond({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 56" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M14 4h36l12 14L32 52 2 18 14 4Z" />
      <path d="M2 18h60M14 4l10 14 8-14 8 14 10-14M24 18l8 34 8-34" />
    </svg>
  );
}

function Gift() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className="shrink-0">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13M5 12v9h14v-9M12 8c-2-4-6-4-6-1.5S10 8 12 8Zm0 0c2-4 6-4 6-1.5S14 8 12 8Z" />
    </svg>
  );
}

function Chevron({ dir }: { dir: "prev" | "next" }) {
  // RTL: «السابق» sits on the right and points right; «التالي» on the left points left.
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d={dir === "prev" ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
    </svg>
  );
}

type Move = { from: number; dir: "next" | "prev" } | null;

/**
 * Active offers as one compact strip under the home hero (owner design). Several offers: every 6 s the current one
 * slides out sideways while the next slides in from the other side (600 ms, title and icon a beat later), with a thin
 * progress line, arrows and touch swipe. Hover, keyboard focus inside the strip or a touch pauses it; it resumes when the
 * interaction ends. Reduced motion: a short fade, no sliding. One offer: no arrows, dots or motion. None: nothing.
 * Both slides share one grid cell, so the strip never changes height while it moves.
 */
export function OfferCarousel({ offers }: { offers: CarouselOffer[] }) {
  const [i, setI] = useState(0);
  const [move, setMove] = useState<Move>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [touch, setTouch] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [cycle, setCycle] = useState(0); // restarts the timer and the progress line
  const [fill, setFill] = useState(false);
  const root = useRef<HTMLElement>(null);
  const startX = useRef<number | null>(null);
  const many = offers.length > 1;
  const paused = hover || focus || touch;

  const go = useCallback(
    (to: number, dir: "next" | "prev") => {
      setI((cur) => {
        const n = (to + offers.length) % offers.length;
        if (n !== cur) setMove({ from: cur, dir });
        return n;
      });
      setCycle((c) => c + 1);
    },
    [offers.length],
  );

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setReduced(m.matches);
    set();
    m.addEventListener("change", set);
    return () => m.removeEventListener("change", set);
  }, []);

  // The leaving slide is dropped once its animation is over.
  useEffect(() => {
    if (!move) return;
    const t = window.setTimeout(() => setMove(null), reduced ? 250 : SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [move, reduced]);

  // Autoplay + progress line (empty at the start of a slide, then a CSS transition fills it over the slide's time).
  useEffect(() => {
    if (!many || paused) {
      window.requestAnimationFrame(() => setFill(false));
      return;
    }
    const r = window.requestAnimationFrame(() => {
      setFill(false);
      window.requestAnimationFrame(() => setFill(true));
    });
    const t = window.setTimeout(() => go(i + 1, "next"), INTERVAL);
    return () => {
      window.cancelAnimationFrame(r);
      window.clearTimeout(t);
    };
  }, [i, many, paused, go, cycle]);

  if (!offers.length) return null;

  // RTL: «next» leaves to the right and enters from the left; «prev» the other way round.
  const enter = move ? (reduced ? "offer-fade-in" : move.dir === "next" ? "offer-in-from-left" : "offer-in-from-right") : "";
  const leave = move ? (reduced ? "offer-fade-out" : move.dir === "next" ? "offer-out-to-right" : "offer-out-to-left") : "";
  const stagger = move && !reduced;

  const slide = (n: number, role: "current" | "leaving") => {
    const o = offers[n];
    const current = role === "current";
    return (
      <div
        key={`${o.slug}-${role}`}
        role={current ? "group" : undefined}
        aria-roledescription={current ? "slide" : undefined}
        aria-label={current ? `${(n + 1).toLocaleString("ar-PS")} من ${offers.length.toLocaleString("ar-PS")}` : undefined}
        aria-hidden={current ? undefined : true}
        inert={current ? undefined : true}
        data-offer-slide={current ? o.slug : undefined}
        className={`[grid-area:1/1] flex flex-col items-center gap-3 sm:flex-row sm:gap-6 ${current ? enter : leave}`}
      >
        <span className="inline-flex shrink-0 items-center gap-2 bg-gold px-4 py-1.5 text-sm font-bold text-ink [clip-path:polygon(0_0,100%_0,94%_100%,0_100%)] sm:text-base rtl:[clip-path:polygon(6%_0,100%_0,100%_100%,0_100%)]">
          <Gift />
          عرض لفترة محدودة
        </span>
        <span className="flex min-w-0 flex-1 items-center justify-center gap-4 sm:justify-start">
          <span className={`min-w-0 text-center sm:text-start ${current && stagger ? "offer-rise-1" : ""}`}>
            <span className="block font-display text-xl leading-snug font-bold break-words sm:text-2xl lg:text-[1.75rem]">
              <bdi>{o.title}</bdi>
            </span>
            {o.sub ? <span className="mt-0.5 block line-clamp-1 text-sm text-ivory/80 sm:text-base">{o.sub}</span> : null}
          </span>
          {o.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={o.image} alt="" loading="lazy" decoding="async" className={`hidden size-14 shrink-0 rounded-lg border border-gold/60 object-cover sm:block ${current && stagger ? "offer-rise-2" : ""}`} />
          ) : (
            <Diamond className={`hidden h-10 w-12 shrink-0 text-gold sm:block ${current && stagger ? "offer-rise-2" : ""}`} />
          )}
        </span>
        <span aria-hidden="true" className="hidden h-10 w-px bg-gold/60 lg:block" />
        <Link
          href={o.href}
          tabIndex={current ? undefined : -1}
          data-offer-carousel-link={current ? o.slug : undefined}
          className="home-pill inline-flex min-h-11 shrink-0 items-center rounded-full bg-gold px-8 text-base font-bold text-ink transition-colors hover:bg-gold-press"
        >
          شاهد العرض
        </Link>
      </div>
    );
  };

  return (
    <section
      ref={root}
      aria-roledescription="carousel"
      aria-label="عروض لفترة محدودة"
      data-offer-carousel
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node)) setFocus(false);
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        setTouch(true);
        startX.current = e.clientX;
      }}
      onPointerUp={(e) => {
        if (e.pointerType !== "touch") return;
        const dx = startX.current === null ? 0 : e.clientX - startX.current;
        startX.current = null;
        setTouch(false);
        // RTL: a swipe to the right brings the next offer (it enters from the left), to the left the previous one.
        if (many && Math.abs(dx) > 40) go(dx > 0 ? i + 1 : i - 1, dx > 0 ? "next" : "prev");
      }}
      onPointerCancel={() => {
        startX.current = null;
        setTouch(false);
      }}
      className="relative overflow-hidden rounded-2xl border-2 border-gold/90 bg-navy-deep text-ivory [touch-action:pan-y]"
    >
      <div className={`flex items-center gap-3 py-4 sm:min-h-[6.5rem] sm:py-3 ${many ? "px-3 sm:px-5" : "px-5 sm:px-8"}`}>
        {many ? (
          <button type="button" aria-label="العرض السابق" onClick={() => go(i - 1, "prev")} className="grid size-11 shrink-0 place-items-center rounded-full border border-ivory/70 text-ivory transition-colors hover:border-gold hover:text-gold">
            <Chevron dir="prev" />
          </button>
        ) : null}
        <div className="grid min-w-0 flex-1 overflow-hidden">
          {move ? slide(move.from, "leaving") : null}
          {slide(i, "current")}
        </div>
        {many ? (
          <button type="button" aria-label="العرض التالي" onClick={() => go(i + 1, "next")} className="grid size-11 shrink-0 place-items-center rounded-full border border-ivory/70 text-ivory transition-colors hover:border-gold hover:text-gold">
            <Chevron dir="next" />
          </button>
        ) : null}
      </div>
      {many ? (
        <>
          <div className="-mt-2 flex justify-center pb-1 sm:-mt-4">
            {offers.map((x, n) => (
              <button
                key={x.slug}
                type="button"
                aria-label={`العرض ${(n + 1).toLocaleString("ar-PS")}`}
                aria-current={n === i ? "true" : undefined}
                onClick={() => go(n, n > i ? "next" : "prev")}
                className="grid size-11 place-items-center sm:size-8"
              >
                <span className={`block size-2 rounded-full transition-colors ${n === i ? "bg-gold" : "bg-ivory/35"}`} />
              </button>
            ))}
          </div>
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-ivory/10">
            <span
              data-offer-progress
              className="absolute inset-y-0 start-0 bg-gold ease-linear"
              style={{ width: fill ? "100%" : "0%", transitionProperty: "width", transitionDuration: fill ? `${INTERVAL}ms` : "0ms" }}
            />
          </span>
        </>
      ) : null}
    </section>
  );
}
