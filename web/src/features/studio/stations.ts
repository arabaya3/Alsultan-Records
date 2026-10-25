/**
 * The immersive studio is ONE room; every public route maps to a corner of it ("station"). The URL is the only
 * source of truth: the scene derives its camera from the route, so direct links, refresh and Back/Forward always
 * land on the right corner, and nothing is pushed to history by the scene itself.
 *
 * Routes without a station (privacy, terms, FAQ, tracking) are reading pages: no scene, no tour.
 */
export const STATIONS = ["reception", "albums", "album", "videos", "packages", "about", "services", "contact"] as const;
export type Station = (typeof STATIONS)[number];

/** Ordered rules: first match wins. Kept as plain regex sources so the pre-paint boot script can reuse them. */
export const STATION_RULES: [source: string, station: Station | "work"][] = [
  ["^/$", "reception"],
  ["^/work/albums/[^/]+/?$", "album"],
  ["^/work/v/[^/]+/?$", "videos"],
  ["^/work/[^/]+/?$", "videos"],
  ["^/work/?$", "work"], // resolved by ?tab=
  ["^/(offers|packages)(/[^/]+)?/?$", "packages"],
  ["^/about/?$", "about"],
  ["^/services(/[^/]+)?/?$", "services"],
  ["^/(contact|book)/?$", "contact"],
];

export function stationFor(pathname: string, search: string | URLSearchParams = ""): Station | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  for (const [source, station] of STATION_RULES) {
    if (!new RegExp(source).test(pathname)) continue;
    if (station !== "work") return station;
    return params.get("tab") === "photos" ? "albums" : "videos";
  }
  return null;
}

/** Corners whose hero text sits beside the focal object (desktop): the scene shifts its focus to the other side. */
export const SIDE_TEXT: Record<Station, boolean> = {
  reception: true,
  albums: false,
  album: true,
  videos: true,
  packages: true,
  about: true,
  services: true,
  contact: true,
};

/** Arabic names of the corners (used by the static fallback captions and the scene's status text). */
export const STATION_LABEL: Record<Station, string> = {
  reception: "الاستقبال",
  albums: "حائط الألبومات",
  album: "طاولة الألبوم",
  videos: "زاوية العرض",
  packages: "طاولة البكجات والعروض",
  about: "زاوية من نحن",
  services: "زاوية المعدات",
  contact: "الاستقبال",
};
