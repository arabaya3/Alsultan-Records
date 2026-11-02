"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isYouTubeId, youTubeThumbUrl } from "@/lib/youtube";
import { bidiDir } from "@/lib/bidi";

/** `file` = the studio's own file on our storage (site player); otherwise the reel plays from YouTube with its own UI. */
export type Reel = { id: string; youtubeId: string; title: string; inquiryHref: string | null; file?: { src: string; width: number | null; height: number | null } | null };

const YT = "https://www.youtube-nocookie.com";
const ytEmbed = (id: string) => `${YT}/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0&enablejsapi=1`;
function ytCommand(frame: HTMLIFrameElement | null, func: string, args: unknown[] = []) {
  frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), YT);
}

const LOAD_TIMEOUT_MS = 15_000;
type Status = "loading" | "playing" | "paused" | "blocked" | "error";

/**
 * Reels mode (owner request): one clip per screen, vertical swipe to the next, built on native scroll-snap so the finger
 * drives the movement and nothing jumps. State lives in the URL (`&reel=<id>`): opening pushes, switching replaces, and
 * closing goes Back, so the visitor lands on the same card at the same scroll position.
 *
 * - One player for the whole viewer. A studio file plays in a single <video> with our controls (tap = play/pause, sound,
 *   progress); moving to another clip swaps its source, so a sound choice the visitor made keeps working. A YouTube
 *   clip plays in YouTube's player with YouTube's own interface, untouched.
 * - While the feed moves, the player fades out and pauses: two clips never play together.
 * - Only the visible clip loads. Others are posters; nothing is preloaded ahead.
 * - Landscape clips show whole (contain) over a blurred copy of their poster, so there is no large black void;
 *   vertical files fill the screen height. Safe areas and the moving browser bar are respected (dvh + env()).
 * - Reduced motion: no smooth scrolling and no fades.
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
  const [moving, setMoving] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const [flash, setFlash] = useState<"play" | "pause" | null>(null);
  // The real shape of the file once it loads (the stored size may be missing).
  const [shape, setShape] = useState<{ id: string; ratio: number } | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);
  const openedCard = useRef<string | null>(null);
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

  useEffect(() => {
    if (!open) return;
    openerRef.current ??= document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    openedCard.current ??= valid[openIndex]?.youtubeId ?? null;
    // Instant: a smooth jump would pass over the clips before it and make them active on the way.
    (feedRef.current?.children[openIndex] as HTMLElement | undefined)?.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
    closeRef.current?.focus();
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on open/close only; scrolling updates `active`
  }, [open]);

  useEffect(() => {
    if (open) return;
    // The page under the viewer may have re-rendered (Back): look the card up again rather than trusting an old node.
    const stored = openerRef.current as HTMLElement | null;
    const id = openedCard.current;
    openerRef.current = null;
    openedCard.current = null;
    if (!stored && !id) return;
    requestAnimationFrame(() => {
      const el = stored?.isConnected ? stored : (document.querySelector(`[data-reel-card="${id}"]`) as HTMLElement | null);
      el?.focus({ preventScroll: true });
    });
  }, [open]);

  // The clip that fills the screen becomes active; the URL follows with replace (shareable, no history spam).
  useEffect(() => {
    if (!open || !feedRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = Number((e.target as HTMLElement).dataset.reelIndex);
          setActive(i);
          window.history.replaceState(window.history.state, "", hrefFor(valid[i]!.id));
        }
      },
      { root: feedRef.current, threshold: 0.6 },
    );
    for (const c of Array.from(feedRef.current.children)) io.observe(c);
    return () => io.disconnect();
  }, [open, valid, hrefFor]);

  // Moving: hide and pause the player until the feed settles on a clip.
  useEffect(() => {
    const feed = feedRef.current;
    if (!open || !feed) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      setMoving(true);
      videoRef.current?.pause();
      clearTimeout(t);
      t = setTimeout(() => setMoving(false), 140);
    };
    feed.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      feed.removeEventListener("scroll", onScroll);
      clearTimeout(t);
    };
  }, [open]);

  const current = valid[active];
  const isFile = !!current?.file;

  // Studio file: load the active clip into the one <video>, then play (muted first if the browser refuses sound).
  useEffect(() => {
    const v = videoRef.current;
    if (!open || moving || !v || !current?.file) return;
    if (v.dataset.reel !== current.id) {
      v.dataset.reel = current.id;
      v.src = current.file.src;
      setProgress(0);
    }
    setStatus("loading");
    v.muted = muted;
    // A broken file also rejects play(); its error must win over "tap to play" (Safari reports both).
    const refused = () => setStatus(v.error ? "error" : "blocked");
    v.play().then(
      () => setStatus("playing"),
      () => {
        if (v.error) return setStatus("error");
        if (!v.muted) {
          v.muted = true;
          setMuted(true);
          v.play().then(() => setStatus("playing"), refused);
        } else refused();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `muted` is applied by its own handler
  }, [open, moving, current]);

  // Some browsers (Safari) never report a failed file and keep loading: after a while, say so instead of spinning.
  useEffect(() => {
    if (status !== "loading" || !isFile || moving) return;
    const t = setTimeout(() => setStatus("error"), LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [status, isFile, moving, active]);

  // YouTube: the one iframe loads the active clip; YouTube decides whether it may autoplay.
  const ytStart = useMemo(() => valid[Math.max(openIndex, 0)]?.youtubeId ?? "", [open]); // eslint-disable-line react-hooks/exhaustive-deps -- fixed for one opening
  const ytLoaded = useRef(ytStart);
  const ytReady = useRef(false);
  useEffect(() => {
    ytReady.current = false;
    ytLoaded.current = ytStart;
  }, [ytStart, open]);
  const syncYouTube = useCallback(() => {
    const f = frameRef.current;
    if (!f || !ytReady.current || !current || current.file) return;
    if (moving) return ytCommand(f, "pauseVideo");
    if (ytLoaded.current !== current.youtubeId) {
      ytLoaded.current = current.youtubeId;
      ytCommand(f, "loadVideoById", [current.youtubeId]);
    } else ytCommand(f, "playVideo");
  }, [current, moving]);
  useEffect(syncYouTube, [syncYouTube]);
  useEffect(() => {
    if (isFile) ytCommand(frameRef.current, "pauseVideo");
    else videoRef.current?.pause();
  }, [isFile, active]);

  // Hidden tab → pause.
  useEffect(() => {
    if (!open) return;
    const onVis = () => {
      if (!document.hidden) return;
      videoRef.current?.pause();
      ytCommand(frameRef.current, "pauseVideo");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [open]);

  const close = useCallback(() => {
    videoRef.current?.pause();
    if (!landedOpen.current) router.back();
    else router.replace(hrefFor(null), { scroll: false });
  }, [router, hrefFor]);

  const go = useCallback(
    (d: 1 | -1) => {
      const i = Math.min(valid.length - 1, Math.max(0, active + d));
      (feedRef.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    },
    [active, valid.length],
  );

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().then(() => setStatus("playing"), () => setStatus(v.error ? "error" : "blocked"));
      setFlash("play");
    } else {
      v.pause();
      setStatus("paused");
      setFlash("pause");
    }
    window.setTimeout(() => setFlash(null), 600);
  };
  const toggleSound = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (v.paused) v.play().then(() => setStatus("playing"), () => undefined);
  };

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
    } else if (e.key === " " && isFile && (e.target as HTMLElement).tagName !== "BUTTON") {
      e.preventDefault();
      toggle();
    } else if (e.key === "Tab") {
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

  if (!open || !current) return null;
  const round = "pointer-events-auto inline-flex size-12 items-center justify-center rounded-full bg-night/60 text-ivory ring-1 ring-ivory/20 backdrop-blur-md transition-colors hover:text-gold focus-visible:outline-2 focus-visible:outline-gold";
  const fileRatio =
    shape?.id === current.id ? shape.ratio : current.file?.width && current.file.height ? current.file.width / current.file.height : 9 / 16;
  const fade = "motion-safe:transition-opacity motion-safe:duration-200";

  return (
    <div role="dialog" aria-modal="true" aria-label="وضع الريلز" data-reels-viewer onKeyDown={onKeyDown} className="fixed inset-0 z-[80] bg-night-deep text-ivory">
      <div ref={feedRef} data-reels-feed className={`h-dvh snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] motion-safe:scroll-smooth`}>
        {valid.map((r, i) => {
          const near = Math.abs(i - active) <= 1;
          return (
            <section
              key={r.id}
              data-reel={r.id}
              data-reel-index={i}
              data-active={i === active ? "1" : "0"}
              data-kind={r.file ? "file" : "youtube"}
              aria-roledescription="مقطع"
              aria-label={`${i + 1} من ${valid.length}: ${r.title}`}
              className="relative isolate flex h-dvh snap-start snap-always items-center justify-center overflow-hidden"
            >
              {near ? (
                <>
                  {/* Blurred poster fills the space a landscape clip leaves (decorative). */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={youTubeThumbUrl(r.youtubeId)} alt="" aria-hidden="true" decoding="async" className="absolute inset-0 -z-10 size-full scale-125 object-cover opacity-45 blur-2xl" />
                  {/* Until the player arrives (and while swiping) the clip's own poster holds its place. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={youTubeThumbUrl(r.youtubeId)} alt="" aria-hidden="true" decoding="async" className="aspect-video w-full max-w-[min(100vw,calc(100dvh*16/9))] object-contain" />
                </>
              ) : null}
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 -z-0 h-2/5 bg-gradient-to-t from-night-deep via-night-deep/60 to-transparent" />
            </section>
          );
        })}
      </div>

      {/* The one player, above the active clip. */}
      <div className={`pointer-events-none absolute inset-0 flex items-center justify-center ${fade} ${moving ? "opacity-0" : "opacity-100"}`}>
        <div
          data-reels-player
          data-kind={isFile ? "file" : "youtube"}
          data-status={isFile ? status : undefined}
          className="pointer-events-auto relative max-h-dvh w-full"
          style={isFile ? { aspectRatio: String(fileRatio), maxWidth: `min(100vw, calc(100dvh * ${fileRatio}))` } : { aspectRatio: "16 / 9", maxWidth: "min(100vw, calc(100dvh * 16 / 9))" }}
        >
          <video
            ref={videoRef}
            playsInline
            preload="metadata"
            poster={youTubeThumbUrl(current.youtubeId)}
            data-reels-video
            hidden={!isFile}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight && v.dataset.reel) setShape({ id: v.dataset.reel, ratio: v.videoWidth / v.videoHeight });
            }}
            onWaiting={() => setStatus("loading")}
            onPlaying={() => setStatus("playing")}
            onPause={() => setStatus((s) => (s === "error" ? s : "paused"))}
            onError={() => setStatus("error")}
            onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
            onEnded={() => (active < valid.length - 1 ? go(1) : setStatus("paused"))}
            className="absolute inset-0 size-full bg-black object-contain"
          />
          {isFile ? (
            <button type="button" aria-label={status === "playing" ? "إيقاف مؤقت" : "تشغيل"} data-reels-toggle onClick={toggle} className="absolute inset-0 size-full cursor-pointer">
              <span className="sr-only">{status === "playing" ? "إيقاف مؤقت" : "تشغيل"}</span>
            </button>
          ) : (
            <iframe
              ref={frameRef}
              src={ytEmbed(ytStart)}
              title={current.title}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              onLoad={() => {
                ytReady.current = true;
                frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening" }), YT);
                syncYouTube();
              }}
              className="absolute inset-0 size-full"
            />
          )}
          {isFile && (status === "loading" || status === "blocked" || status === "error" || flash) ? (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {status === "loading" && !flash ? (
                <span data-reels-loading role="status" aria-label="جارِ التحميل" className="size-12 animate-spin rounded-full border-2 border-ivory/30 border-t-gold motion-reduce:animate-none" />
              ) : status === "error" ? (
                <span data-reels-error role="alert" className="rounded-md bg-night/80 px-4 py-3 text-center text-sm">
                  تعذّر تشغيل هذا المقطع الآن. اسحب للمقطع التالي أو حاول لاحقًا.
                </span>
              ) : (
                <span data-reels-play-hint className="inline-flex size-20 items-center justify-center rounded-full bg-night/55 text-gold backdrop-blur">
                  <svg aria-hidden="true" viewBox="0 0 24 24" width="34" height="34" fill="currentColor">
                    {flash === "pause" ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
                  </svg>
                </span>
              )}
            </span>
          ) : null}
        </div>
      </div>

      {/* Top: close and position, inside the safe area. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-night-deep/80 to-transparent px-3 pb-8 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button ref={closeRef} type="button" onClick={close} aria-label="إغلاق وضع الريلز" data-reels-close className={round}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <span dir="ltr" className="rounded-full bg-night/60 px-3 py-1 text-sm text-ivory/85 backdrop-blur-md">
          {active + 1} / {valid.length}
        </span>
      </div>

      {/* Bottom: title on the start side, actions in one column on the end side, progress last. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-4">
          <div className="min-w-0 flex-1 pb-1">
            <p dir={bidiDir(current.title)} className="line-clamp-2 text-base font-semibold leading-snug [overflow-wrap:anywhere] md:text-lg">
              {current.title}
            </p>
            {!isFile ? <p className="mt-1 text-xs text-ivory/70">يُعرض من YouTube</p> : null}
          </div>
          <div className="flex shrink-0 flex-col items-center gap-3">
            {isFile ? (
              <button type="button" data-reels-mute aria-pressed={!muted} aria-label={muted ? "تشغيل الصوت" : "كتم الصوت"} onClick={toggleSound} className={round}>
                <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                  <path d="M4 9v6h4l5 4V5L8 9H4z" />
                  {muted ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" />}
                </svg>
              </button>
            ) : null}
            <button type="button" onClick={() => share(current)} data-reels-share aria-label="مشاركة" className={round}>
              <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M12 3v12M7 8l5-5 5 5" />
              </svg>
            </button>
            {current.inquiryHref ? (
              <a href={current.inquiryHref} target="_blank" rel="noopener noreferrer" data-reels-inquiry aria-label="استفسر عبر واتساب" className={`${round} bg-gold text-ink ring-0 hover:text-ink`}>
                <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                  <path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2 5.2 5.2 0 001.1 2.7 11.8 11.8 0 004.6 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 001.8-1.3 2.2 2.2 0 00.2-1.3c-.1-.1-.3-.2-.5-.3z" />
                </svg>
              </a>
            ) : null}
          </div>
        </div>
        {isFile ? (
          <div data-reels-progress role="progressbar" aria-label="تقدم المقطع" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="mt-3 h-1 overflow-hidden rounded-full bg-ivory/20">
            <div className="h-full origin-[right_center] bg-gold" style={{ transform: `scaleX(${progress})` }} />
          </div>
        ) : null}
        <p role="status" aria-live="polite" className="sr-only">
          {copied ? "نُسخ الرابط" : ""}
        </p>
      </div>

      {/* Larger screens: previous/next beside the clip (phones swipe). */}
      <div className="pointer-events-none absolute inset-y-0 start-4 hidden flex-col justify-center gap-3 md:flex">
        <button type="button" onClick={() => go(-1)} disabled={active === 0} aria-label="المقطع السابق" data-reels-prev className={`${round} disabled:opacity-40`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 15l6-6 6 6" />
          </svg>
        </button>
        <button type="button" onClick={() => go(1)} disabled={active === valid.length - 1} aria-label="المقطع التالي" data-reels-next className={`${round} disabled:opacity-40`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {copied ? (
        <p aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-20 text-center text-sm">
          <span className="rounded-full bg-night/80 px-3 py-1">نُسخ الرابط</span>
        </p>
      ) : null}
    </div>
  );
}
