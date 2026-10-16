"use client";

import Image from "next/image";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { PromoPlayer } from "@/components/media/youtube/PromoPlayer";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { gsap, MOTION_OK } from "@/components/motion/gsap";
import { youTubeThumbUrl } from "@/lib/youtube";

export type HeroIntroProps = {
  brand: string;
  title: string;
  sub: string;
  services: readonly string[];
  /** null when nothing is published yet (no dead-end link). */
  workHref: string | null;
  whatsappHref: string | null;
  phone: { label: string; href: string } | null;
  promo: {
    youtubeId: string;
    title: string;
    caption: string;
    duration: string | null;
  } | null;
  /** The studio's own published YouTube works (i.ytimg thumbnails only). */
  strip: { youtubeId: string; title: string }[];
};

/**
 * Homepage intro (≈2.1 s, GSAP, progressive enhancement).
 *
 * Everything is server-rendered in its FINAL layout, in the DOM, focusable and clickable from the first
 * frame. The timeline only animates opacity/transform (no layout properties → no layout shift) and never
 * uses visibility, so a click on a CTA works mid-animation. When the hero leaves the viewport the timeline
 * is paused (IntersectionObserver) and resumed when it returns; nothing loops after the intro.
 * Reduced motion → the static final state (matchMedia; no transforms). Cleanup: gsap.context().revert().
 *
 * The inline arming script (rendered before the markup) hides intro targets for the first paint only
 * when motion is allowed, so there is no flash of final content before the timeline starts; a CSS
 * failsafe (globals.css) reveals them at 2.6 s if scripts never run.
 */
export function HeroIntro(p: HeroIntroProps) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const disarm = () =>
      document.documentElement.classList.remove("intro-armed");
    let io: IntersectionObserver | null = null;
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const q = (s: string) =>
          root.querySelectorAll<HTMLElement>(`[data-intro~="${s}"]`);
        const tl = gsap.timeline({
          defaults: { ease: "power3.out" },
          onStart: () => root.setAttribute("data-intro-state", "running"),
          onComplete: () => {
            root.setAttribute("data-intro-state", "done");
            io?.disconnect();
          },
        });
        // Inline from-states take over before the CSS arming class is removed (same frame → no flash).
        tl.fromTo(
          q("logo"),
          { opacity: 0, scale: 0.94 },
          {
            opacity: 1,
            scale: 1,
            duration: 0.6,
            clearProps: "transform,opacity",
          },
          0,
        )
          .fromTo(
            q("brand"),
            { opacity: 0, y: 8 },
            {
              opacity: 1,
              y: 0,
              duration: 0.45,
              clearProps: "transform,opacity",
            },
            0.15,
          )
          .fromTo(
            q("word"),
            { opacity: 0, y: 18 },
            {
              opacity: 1,
              y: 0,
              duration: 0.55,
              stagger: 0.07,
              clearProps: "transform,opacity",
            },
            0.3,
          )
          .fromTo(
            q("sub"),
            { opacity: 0, y: 12 },
            {
              opacity: 1,
              y: 0,
              duration: 0.5,
              stagger: 0.035,
              clearProps: "transform,opacity",
            },
            0.75,
          )
          .fromTo(
            q("service"),
            { opacity: 0, y: 10 },
            {
              opacity: 1,
              y: 0,
              duration: 0.4,
              stagger: 0.1,
              clearProps: "transform,opacity",
            },
            1.05,
          )
          .fromTo(
            q("media"),
            { opacity: 0, y: 16 },
            {
              opacity: 1,
              y: 0,
              duration: 0.7,
              clearProps: "transform,opacity",
            },
            0.35,
          )
          .fromTo(
            q("thumb"),
            { opacity: 0, clipPath: "inset(0 0 100% 0)", x: -14 },
            {
              opacity: 1,
              clipPath: "inset(0 0 0% 0)",
              x: 0,
              duration: 0.6,
              stagger: 0.08,
              clearProps: "transform,opacity,clipPath",
            },
            1.0,
          )
          .fromTo(
            q("cta"),
            { opacity: 0, y: 10 },
            {
              opacity: 1,
              y: 0,
              duration: 0.45,
              stagger: 0.08,
              clearProps: "transform,opacity",
            },
            1.35,
          );
        disarm();

        io = new IntersectionObserver(([e]) => {
          if (tl.progress() >= 1) return;
          if (e.isIntersecting) {
            tl.resume();
            root.setAttribute("data-intro-state", "running");
          } else {
            tl.pause();
            root.setAttribute("data-intro-state", "paused");
          }
        });
        io.observe(root);
        return () => {
          io?.disconnect();
          io = null;
        };
      });
      mm.add("(prefers-reduced-motion: reduce)", () => {
        disarm();
        root.setAttribute("data-intro-state", "static");
      });
    }, root);
    return () => {
      ctx.revert();
      disarm();
    };
  }, []);

  const words = p.title.split(" ");
  const subWords = p.sub.split(" ");

  return (
    <section
      ref={ref}
      aria-labelledby="hero-title"
      data-hero-intro
      data-intro-state="idle"
      className="ink-texture relative isolate overflow-hidden text-on-dark"
    >
      <div className="mx-auto grid w-full max-w-[var(--content-max)] items-center gap-8 px-[var(--gutter)] py-10 md:py-12 lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:py-14">
        <div className="min-w-0">
          <div data-hero-mark className="flex items-center gap-4">
            <Image
              src="/brand/logo-main.webp"
              alt=""
              width={900}
              height={748}
              priority
              sizes="96px"
              data-intro="logo"
              className="h-16 w-auto origin-center md:h-20"
            />
            <p
              data-intro="brand"
              className="font-display text-lg font-semibold text-gold md:text-xl"
            >
              {p.brand}
            </p>
          </div>
          <h1
            id="hero-title"
            className="mt-5 text-[2.5rem] font-bold leading-[1.15] tracking-tight sm:text-5xl lg:text-[clamp(3.25rem,4.4vw,4.5rem)]"
          >
            {words.map((w, i) => (
              <span key={i}>
                <span data-intro="word" data-reveal className="inline-block">
                  {w}
                </span>
                {i < words.length - 1 ? " " : null}
              </span>
            ))}
            <span
              data-intro="word"
              data-reveal
              className="inline-block text-gold"
            >
              .
            </span>
          </h1>
          <p className="mt-4 text-lg text-on-dark/90 md:text-xl">
            {subWords.map((w, i) => (
              <span key={i}>
                <span data-intro="sub" className="inline-block">
                  {w}
                </span>
                {i < subWords.length - 1 ? " " : null}
              </span>
            ))}
          </p>
          <ul
            aria-label="خدماتنا"
            className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-base md:text-lg"
          >
            {p.services.map((s, i) => (
              <li
                key={s}
                data-intro="service"
                className="flex items-center gap-5"
              >
                {i > 0 ? (
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-gold"
                  />
                ) : null}
                <span>{s}</span>
              </li>
            ))}
          </ul>
          <div className="mt-7 flex flex-wrap items-center gap-3 sm:gap-4">
            {p.workHref ? (
              <Link
                href={p.workHref}
                data-intro="cta"
                data-hero-cta="work"
                className="inline-flex min-h-14 min-w-52 items-center justify-center rounded-sm bg-gold px-7 text-lg font-medium text-ink transition-colors hover:bg-gold-press"
              >
                شاهد أعمالنا
              </Link>
            ) : null}
            {p.whatsappHref ? (
              <a
                href={p.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                data-whatsapp-cta
                data-intro="cta"
                data-hero-cta="whatsapp"
                className="inline-flex min-h-14 items-center justify-center gap-3 rounded-sm border border-on-dark/40 px-6 text-lg font-medium transition-colors hover:border-gold hover:text-gold"
              >
                <WhatsAppIcon size={22} />
                <span>تواصل عبر واتساب</span>
              </a>
            ) : null}
          </div>
          {p.phone ? (
            <p data-intro="cta" className="mt-5">
              <a
                href={p.phone.href}
                className="inline-flex min-h-11 items-center gap-2 text-on-dark/90 underline decoration-1 underline-offset-8 hover:decoration-gold"
              >
                <span className="text-muted">هاتف</span>
                <span dir="ltr">{p.phone.label}</span>
              </a>
            </p>
          ) : null}
        </div>

        <div className="min-w-0">
          {p.promo ? (
            <div data-intro="media">
              <PromoPlayer
                youtubeId={p.promo.youtubeId}
                title={p.promo.title}
                caption={p.promo.caption}
                duration={p.promo.duration}
              />
            </div>
          ) : null}
          {p.strip.length >= 3 ? (
            // Decorative glimpse of the studio's own published works; it reveals once and then stays still.
            <ul
              aria-hidden="true"
              className="mt-3 hidden grid-cols-4 gap-2 sm:grid"
            >
              {p.strip.slice(0, 4).map((v) => (
                <li
                  key={v.youtubeId}
                  data-intro="thumb"
                  className="relative aspect-video overflow-hidden rounded-sm bg-ink-2 ring-1 ring-ink-line"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={youTubeThumbUrl(v.youtubeId)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 size-full object-cover opacity-80"
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
