"use client";

import Image from "next/image";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { SitePromoPlayer } from "@/components/media/promo/SitePromoPlayer";
import { PromoPlayer } from "@/components/media/youtube/PromoPlayer";
import { ActiveLogoImg } from "@/components/brand/ActiveLogoImg";
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
  /** Self-hosted studio promo (static asset in /public/promo) or a YouTube promo; null hides the card. */
  promo: { caption: string; coverSrc?: string | null; coverMobileSrc?: string | null; youtube?: { youtubeId: string; title: string } | null } | null;
  /** Active owner logo (/a/<id>); null = built-in logo. */
  logoSrc?: string | null;
  primaryLabel?: string;
  secondaryLabel?: string;
  /** The studio's own published YouTube works (i.ytimg thumbnails only). */
  strip: { youtubeId: string; title: string }[];
};

/**
 * Homepage hero (GSAP, progressive enhancement, ≈0.9 s; never hides text or CTAs).
 *
 * Everything is server-rendered in its FINAL layout, in the DOM, focusable and clickable from the first
 * frame. The timeline only animates opacity/transform (no layout properties → no layout shift) and never
 * uses visibility, so a click on a CTA works mid-animation. When the hero leaves the viewport the timeline
 * is paused (IntersectionObserver) and resumed when it returns; nothing loops after the intro.
 * Reduced motion → the static final state (matchMedia; no transforms). Cleanup: gsap.context().revert().
 *
 * No arming script any more: content is fully visible at first paint. The CSS failsafe for the old
 * intro-armed class (globals.css) is unused; disarm() stays as a harmless cleanup.
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
        // Text, logo and CTAs are never hidden or moved: they are readable and usable from the first paint.
        // Only the film card settles in and the decorative thumbnails unveil (≈0.9 s, opacity/transform/clip only).
        tl.fromTo(
          q("media"),
          { opacity: 0.55, y: 12 },
          { opacity: 1, y: 0, duration: 0.6, clearProps: "transform,opacity" },
          0.05,
        ).fromTo(
          q("thumb"),
          { opacity: 0, clipPath: "inset(0 0 100% 0)" },
          {
            opacity: 1,
            clipPath: "inset(0 0 0% 0)",
            duration: 0.5,
            stagger: 0.07,
            clearProps: "opacity,clipPath",
          },
          0.3,
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
      className="ink-texture relative isolate overflow-hidden hero-flow text-ivory"
    >
      {p.promo?.coverSrc ? (
        // Full-bleed cinematic backdrop: the owner's CMS cover photo, heavily dimmed (decorative, object-cover allowed
        // only for this backdrop) so wide screens are not empty and the text keeps AA contrast.
        <>
          {/* Phones get the small variant: dimmed and blurred, it is the page's LCP and needs no more. Both go through /p. */}
          {p.promo.coverMobileSrc ? <link rel="preload" as="image" href={p.promo.coverMobileSrc} media="(max-width: 767px)" fetchPriority="high" /> : null}
          <picture>
            {p.promo.coverMobileSrc ? <source media="(max-width: 767px)" srcSet={p.promo.coverMobileSrc} /> : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.promo.coverSrc} alt="" aria-hidden="true" decoding="async" className="absolute inset-0 -z-20 size-full object-cover opacity-35 blur-[2px]" />
          </picture>
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(to_left,rgb(13_12_11/0.92)_0%,rgb(13_12_11/0.78)_45%,rgb(13_12_11/0.6)_100%)]" />
        </>
      ) : null}
      <div className="mx-auto grid w-full max-w-[var(--content-max)] items-center gap-8 px-[var(--gutter)] py-10 md:py-12 lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:py-14">
        <div className="min-w-0">
          {/* Phones: the header already shows the logo, so only the gold name stays here (design audit #4). */}
          <div data-hero-mark className="flex items-center gap-4">
            {p.logoSrc ? (
              <ActiveLogoImg
                src={p.logoSrc}
                fallback="/brand/logo-main.webp"
                alt=""
                fetchPriority="high"
                data-intro="logo"
                className="h-16 w-auto max-w-40 origin-center object-contain max-md:hidden md:h-20 md:max-w-48"
              />
            ) : (
              <Image
                src="/brand/logo-main.webp"
                alt=""
                width={900}
                height={748}
                priority
                sizes="96px"
                data-intro="logo"
                className="h-16 w-auto origin-center max-md:hidden md:h-20"
              />
            )}
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
          <p className="mt-4 text-lg text-ivory/90 md:text-xl">
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
                {p.primaryLabel ?? "شاهد أعمالنا"}
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
                className="inline-flex min-h-14 items-center justify-center gap-3 rounded-sm border border-ivory/55 px-6 text-lg font-medium transition-colors hover:border-gold hover:text-gold"
              >
                <WhatsAppIcon size={22} />
                <span>{p.secondaryLabel ?? "تواصل عبر واتساب"}</span>
              </a>
            ) : (
              // No WhatsApp number configured: the hero must still offer a next step (gold when it is the only CTA).
              // Same fallback as the shared <WhatsAppCta> (→ /contact «تواصل معنا»).
              <Link
                href="/contact"
                data-intro="cta"
                data-hero-cta="contact"
                className={`inline-flex min-h-14 items-center justify-center rounded-sm px-7 text-lg font-medium transition-colors ${
                  p.workHref ? "border border-ivory/55 hover:border-gold hover:text-gold" : "bg-gold text-ink hover:bg-gold-press"
                }`}
              >
                تواصل معنا
              </Link>
            )}
          </div>
          {p.phone ? (
            <p data-intro="cta" className="mt-5">
              <a
                href={p.phone.href}
                className="inline-flex min-h-11 items-center gap-2 text-ivory/90 underline decoration-1 underline-offset-8 hover:decoration-gold"
              >
                <span className="text-ivory-muted">هاتف</span>
                <span dir="ltr">{p.phone.label}</span>
              </a>
            </p>
          ) : null}
        </div>

        <div className="min-w-0">
          {p.promo ? (
            <div data-intro="media">
              {p.promo.youtube ? (
                <PromoPlayer youtubeId={p.promo.youtube.youtubeId} title={p.promo.youtube.title} caption={p.promo.caption} />
              ) : (
                // Same video → same poster everywhere (home, أعمالنا, من نحن): the promo's own cover frames.
                // The owner's hero photo stays the hero backdrop above.
                <SitePromoPlayer caption={p.promo.caption} priority />
              )}
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
                  className="relative aspect-video overflow-hidden rounded-sm bg-surface ring-1 ring-hairline"
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
