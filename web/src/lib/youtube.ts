/**
 * YouTube helpers shared by admin validation, the import script contract and the public player.
 * Only an 11-char video ID is ever stored or rendered; arbitrary HTML/iframes are never accepted.
 */
const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtube-nocookie.com", "youtube-nocookie.com"]);

export function isYouTubeId(v: unknown): v is string {
  return typeof v === "string" && ID.test(v);
}

/** Accepts a bare ID or a watch / youtu.be / shorts / embed / live URL on a YouTube host. Returns null otherwise. */
export function parseYouTubeId(input: string): string | null {
  const raw = input.trim();
  if (isYouTubeId(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (url.hostname.toLowerCase() === "youtu.be") id = parts[0] ?? null;
  else if (parts[0] === "watch") id = url.searchParams.get("v");
  else if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) id = parts[1] ?? null;
  return isYouTubeId(id) ? id : null;
}

export const youTubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
/** Privacy-enhanced embed; playback starts only after the visitor clicks (no autoplay on page load). */
export const youTubeEmbedUrl = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
/** hqdefault always exists; maxresdefault may 404 for some uploads. */
export const youTubeThumbUrl = (id: string, quality: "hq" | "max" = "hq") =>
  `https://i.ytimg.com/vi/${id}/${quality === "max" ? "maxresdefault" : "hqdefault"}.jpg`;
