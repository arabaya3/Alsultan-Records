import { describe, expect, it } from "vitest";
import { decideTier, median, tierAfterProbe } from "./capability";
import { POSES, cameraFor, entryFrom, moveDuration, pathMid, wallGroup, wallSlotX } from "./poses";
import { SIDE_TEXT, STATIONS, stationFor } from "./stations";

describe("stationFor", () => {
  it("maps every public corner from the URL alone", () => {
    expect(stationFor("/")).toBe("reception");
    expect(stationFor("/work")).toBe("videos");
    expect(stationFor("/work", "?tab=videos&cat=weddings")).toBe("videos");
    expect(stationFor("/work", "?tab=photos")).toBe("albums");
    expect(stationFor("/work", new URLSearchParams("tab=photos&cat=grooms"))).toBe("albums");
    expect(stationFor("/work", "?tab=promos")).toBe("videos");
    expect(stationFor("/work/albums/wedding-dawood-nairat-2026")).toBe("album");
    expect(stationFor("/work/v/A7Bby0aFuz0")).toBe("videos");
    expect(stationFor("/work/some-project")).toBe("videos");
    expect(stationFor("/offers")).toBe("packages");
    expect(stationFor("/offers/wedding-complete")).toBe("packages");
    expect(stationFor("/packages")).toBe("packages");
    expect(stationFor("/about")).toBe("about");
    expect(stationFor("/services")).toBe("services");
    expect(stationFor("/services/dj")).toBe("services");
    expect(stationFor("/contact")).toBe("contact");
    expect(stationFor("/book")).toBe("contact");
  });
  it("reading pages and private areas have no scene", () => {
    for (const p of ["/privacy", "/terms", "/faq", "/track", "/admin", "/portal", "/login", "/work/albums/a/b"]) expect(stationFor(p)).toBeNull();
  });
});

describe("decideTier", () => {
  it("no WebGL, data saver or opt-out → the static studio", () => {
    expect(decideTier({ webgl: false })).toBe("static");
    expect(decideTier({ webgl: true, saveData: true })).toBe("static");
    expect(decideTier({ webgl: true, optedOut: true })).toBe("static");
    expect(decideTier({ webgl: true, memoryGb: 1 })).toBe("static");
  });
  it("weak or touch devices get the lighter scene, strong desktops the full one", () => {
    expect(decideTier({ webgl: true, cores: 4 })).toBe("low");
    expect(decideTier({ webgl: true, cores: 8, memoryGb: 4 })).toBe("low");
    expect(decideTier({ webgl: true, cores: 8, coarse: true })).toBe("low");
    expect(decideTier({ webgl: true, cores: 8, softwareRenderer: true })).toBe("static");
    expect(decideTier({ webgl: true, cores: 8, memoryGb: 8 })).toBe("high");
    expect(decideTier({ webgl: true })).toBe("high");
  });
  it("measured frame time lowers the tier, never raises it", () => {
    expect(tierAfterProbe("high", 12)).toBe("high");
    expect(tierAfterProbe("high", 55)).toBe("low");
    expect(tierAfterProbe("low", 120)).toBe("static");
    expect(tierAfterProbe("low", 10)).toBe("low");
    expect(median([30, 10, 20])).toBe(20);
    expect(median([])).toBe(0);
  });
});

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const inRoom = (p: number[]) => Math.abs(p[0]) < 8 && Math.abs(p[2]) < 6 && p[1] > 0.3 && p[1] < 4.4;

describe("camera poses", () => {
  it("every corner's camera stays inside the room on wide and tall screens", () => {
    for (const s of STATIONS) {
      for (const aspect of [16 / 9, 1440 / 900, 1024 / 768, 768 / 1024, 390 / 520, 320 / 480]) {
        for (const side of SIDE_TEXT[s] ? [false, true] : [false]) {
          const c = cameraFor(POSES[s], aspect, side);
          expect(inRoom(c.position), `${s} @${aspect.toFixed(2)} side=${side}: ${c.position.map((n) => n.toFixed(2))}`).toBe(true);
          expect(c.fov).toBeGreaterThanOrEqual(POSES[s].fov);
        }
      }
    }
  });
  it("a narrower screen moves the camera back to keep the same area in view", () => {
    const wide = cameraFor(POSES.videos, 16 / 9);
    const tall = cameraFor(POSES.videos, 0.75);
    expect(dist(tall.position, tall.target)).toBeGreaterThan(dist(wide.position, wide.target) * 0.9);
  });
  it("side text shifts the aim sideways without changing the viewing direction", () => {
    const a = cameraFor(POSES.album, 1.6, false);
    const b = cameraFor(POSES.album, 1.6, true);
    const da = [a.position[0] - a.target[0], a.position[1] - a.target[1], a.position[2] - a.target[2]].map((n) => n / dist(a.position, a.target));
    const db = [b.position[0] - b.target[0], b.position[1] - b.target[1], b.position[2] - b.target[2]].map((n) => n / dist(b.position, b.target));
    for (let i = 0; i < 3; i++) expect(db[i]).toBeCloseTo(da[i], 5);
    expect(dist(a.target, b.target)).toBeGreaterThan(0.1);
  });
  it("the entry approach starts further away and the path bends toward the room's middle", () => {
    const c = cameraFor(POSES.reception, 1.6);
    const e = entryFrom(c);
    expect(dist(e.position, c.target)).toBeGreaterThan(dist(c.position, c.target));
    const m = pathMid(cameraFor(POSES.videos, 1.6).position, cameraFor(POSES.reception, 1.6).position);
    expect(inRoom(m)).toBe(true);
  });
  it("moves are short, shorter on phones, instant with reduced motion", () => {
    const a = cameraFor(POSES.reception, 1.6).position;
    const b = cameraFor(POSES.videos, 1.6).position;
    const desk = moveDuration(a, b, { tall: false, reduced: false });
    expect(desk).toBeGreaterThan(0.7);
    expect(desk).toBeLessThanOrEqual(1.75);
    expect(moveDuration(a, b, { tall: true, reduced: false })).toBeLessThan(desk);
    expect(moveDuration(a, b, { tall: false, reduced: true })).toBe(0);
  });
});

describe("album wall", () => {
  it("slots read right-to-left and are centred", () => {
    expect(wallSlotX(0, 5)).toBeGreaterThan(0);
    expect(wallSlotX(4, 5)).toBeLessThan(0);
    expect(wallSlotX(2, 5)).toBeCloseTo(0);
    expect(wallSlotX(0, 1)).toBeCloseTo(0);
  });
  it("groups respect the list bounds", () => {
    expect(wallGroup(12, 0)).toEqual({ start: 0, end: 5, group: 0, groups: 3 });
    expect(wallGroup(12, 2)).toEqual({ start: 10, end: 12, group: 2, groups: 3 });
    expect(wallGroup(12, 9)).toEqual({ start: 10, end: 12, group: 2, groups: 3 });
    expect(wallGroup(12, -1).group).toBe(0);
    expect(wallGroup(0, 0)).toEqual({ start: 0, end: 0, group: 0, groups: 1 });
  });
});
