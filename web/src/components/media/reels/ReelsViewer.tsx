"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isYouTubeId, youTubeThumbUrl } from "@/lib/youtube";
import { bidiDir } from "@/lib/bidi";

export type Reel = { id: string; youtubeId: string; title: string; inquiryHref: string | null };

/** Muted autoplay for the ONE visible reel; the JS API lets us pause, mute and unmute it (official IFrame API). */
const embedUrl = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1`;

function command(frame: HTMLIFrameElement | null, func: "pauseVideo" | "playVideo" | "mute" | "unMute") {
  frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), "https://www.youtube-nocookie.com");
}

/**
 * Promos as a vertical "reels" feed (owner request 2026-10-28), opened from the promos tab.
 *
 * - State lives in the URL (`?tab=promos&reel=<id>`): direct links open the same reel; Back closes the viewer
 *   (open = push, switching reels = replace, so Back never walks through every reel).
 * - Native vertical scroll-snap: swipe/scroll between reels; ↑/↓ and the buttons do the same. No touch handlers,
 *   so page scrolling and the edge back gesture are never intercepted.
 * - Only the visible reel mounts an iframe (muted autoplay); the rest are thumbnails, so opening the page loads no
 *   player. Leaving a reel unmounts its player; hiding the tab pauses it. If the browser refuses autoplay, YouTube's
 *   own play button stays on the frame (never a blank screen).
 * - Our sources are YouTube links with no stored orientation, so every clip is fitted WHOLE inside the stage
 *   (16:9 letterboxed on a phone) — never cropped to 9:16. Native vertical files are a separate, documented step.
 */
export function ReelsViewer({ reels }: { reels: Reel[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("reel");
  const valid = useMemo(() => reels.filter((r) => isYouTubeId(r.youtubeId)), [reels]);
  const openIndex = requested ? valid.findIndex((r) => r.id === requested) : -1;
  const open = openIndex >= 0;

  const [active, setActive] = useState(Math.max(openIndex, 0));
  const [muted, setMuted] = useState(true);
  const [copied, setCopied] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);
  // Landed on a shared reel link (no site page under the viewer in history) → closing drops the param instead of Back.
  const landedOpen = useRef(open);
  useEffect(() => {
    if (!open) landedOpen.current = false;
  }, [open]);

  const hrefFor = useCallback(
    (id: string | null) => {
      const p = new URLSearchParams(params.toString());
      if (id) p.set("reel", id);
      else p.delete("reel");
      return `${pathname}?${p.toString()}`;
    },
    [params, pathname],
  );

  // Opening: remember the opener, jump to the requested reel, focus the dialog, lock the page behind it.
  useEffect(() => {
    if (!open) return;
    openerRef.current ??= document.activeElement;
    // `active` follows the observer below, which reports the reel scrolled into view here.
    const el = feedRef.current?.children[openIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "start" });
    closeRef.current?.focus();
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on open/close only; scrolling updates `active`
  }, [open]);

  // Closing (Back, Esc or ✕): return focus to where the visitor was.
  useEffect(() => {
    if (open) return;
    const el = openerRef.current as HTMLElement | null;
    openerRef.current = null;
    el?.focus?.();
  }, [open]);

  // The reel that fills the stage becomes active; the URL follows with replace (shareable, no history spam).
  useEffect(() => {
    if (!open || !feedRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = Number((e.target as HTMLElement).dataset.reelIndex);
          setActive(i);
          setMuted(true);
          window.history.replaceState(window.history.state, "", hrefFor(valid[i]!.id));
        }
      },
      { root: feedRef.current, threshold: 0.6 },
    );
    for (const c of Array.from(feedRef.current.children)) io.observe(c);
    return () => io.disconnect();
  }, [open, valid, hrefFor]);

  // Hidden tab → pause; back → resume (still muted unless the visitor unmuted).
  useEffect(() => {
    if (!open) return;
    const onVis = () => command(frameRef.current, document.hidden ? "pauseVideo" : "playVideo");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [open]);

  const close = useCallback(() => {
    // Opened from inside the site → Back restores the exact previous page; opened from a shared link → drop the param.
    if (!landedOpen.current) router.back();
    else router.replace(hrefFor(null), { scroll: false });
  }, [router, hrefFor]);

  const go = useCallback(
    (d: 1 | -1) => {
      const i = Math.min(valid.length - 1, Math.max(0, active + d));
      (feedRef.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [active, valid.length],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "PageDown") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowUp" || e.key === "PageUp") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "Tab") {
      // Keep focus inside the dialog (the player iframe is reachable too).
      const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), iframe"));
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  const share = async (r: Reel) => {
    const url = new URL(hrefFor(r.id), window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title: r.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* the visitor cancelled the share sheet */
    }
  };

  if (!open) return null;
  const btn =
    "inline-flex size-12 items-center justify-center rounded-full bg-night/70 text-ivory ring-1 ring-ivory/25 backdrop-blur hover:text-gold focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-40";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="البروموهات بعرض عمودي"
      data-reels-viewer
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[80] bg-night-deep text-ivory"
    >
      <div ref={feedRef} data-reels-feed className="h-dvh snap-y snap-mandatory overflow-y-auto overscroll-contain">
        {valid.map((r, i) => {
          const isActive = i === active;
          return (
            <section
              key={r.id}
              data-reel={r.id}
              data-reel-index={i}
              data-active={isActive ? "1" : "0"}
              aria-roledescription="مقطع"
              aria-label={`${i + 1} من ${valid.length}: ${r.title}`}
              className="relative flex h-dvh snap-start snap-always items-center justify-center"
            >
              {/* Fit the whole 16:9 clip inside the stage; never crop it. */}
              <div className="relative aspect-video w-full max-w-[min(100vw,calc(100dvh*16/9))] bg-black">
                {isActive ? (
                  <iframe
                    ref={frameRef}
                    src={embedUrl(r.youtubeId)}
                    title={r.title}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    className="absolute inset-0 size-full"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={youTubeThumbUrl(r.youtubeId)} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-contain" />
                )}
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-night-deep via-night-deep/70 to-transparent px-4 pt-16 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <p dir={bidiDir(r.title)} className="line-clamp-2 max-w-[calc(100%-4rem)] text-lg font-medium [overflow-wrap:anywhere]">
                  {r.title}
                </p>
                <p className="mt-1 text-sm text-ivory/75">
                  {i + 1} / {valid.length}
                </p>
              </div>
            </section>
          );
        })}
      </div>

      {/* Controls float above the feed; they are real buttons (no gestures needed). */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <button ref={closeRef} type="button" onClick={close} aria-label="إغلاق العرض" data-reels-close className={`pointer-events-auto ${btn}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <button
            type="button"
            data-reels-mute
            aria-pressed={!muted}
            onClick={() => {
              command(frameRef.current, muted ? "unMute" : "mute");
              setMuted(!muted);
            }}
            className={`pointer-events-auto ${btn} w-auto gap-2 px-4`}
          >
            <span aria-hidden="true">{muted ? "🔇" : "🔊"}</span>
            <span className="text-sm">{muted ? "تشغيل الصوت" : "كتم الصوت"}</span>
          </button>
        </div>
        <div className="flex flex-col items-end gap-3 self-end pb-24">
          <button type="button" onClick={() => go(-1)} disabled={active === 0} aria-label="المقطع السابق" data-reels-prev className={`pointer-events-auto ${btn}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 15l6-6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={active === valid.length - 1}
            aria-label="المقطع التالي"
            data-reels-next
            className={`pointer-events-auto ${btn}`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <button type="button" onClick={() => share(valid[active]!)} data-reels-share className={`pointer-events-auto ${btn}`} aria-label="مشاركة المقطع">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M12 3v12M7 8l5-5 5 5" />
            </svg>
          </button>
          {valid[active]?.inquiryHref ? (
            <a
              href={valid[active]!.inquiryHref!}
              target="_blank"
              rel="noopener noreferrer"
              data-reels-inquiry
              className="pointer-events-auto inline-flex min-h-12 items-center rounded-full bg-gold px-4 text-sm font-medium text-ink hover:bg-gold-press"
            >
              استفسر عن هذا
            </a>
          ) : null}
          <p role="status" aria-live="polite" className="min-h-5 text-sm">
            {copied ? "نُسخ الرابط" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
