import { gsap } from "gsap";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { median, tierAfterProbe, type Tier } from "../capability";
import { POSES, WALL, cameraFor, entryFrom, moveDuration, pathMid, type CameraState, type Vec3 } from "../poses";
import { SIDE_TEXT, type Station } from "../stations";
import { buildRoom, PROPS, type FrameSlot, type Room, type SurfaceName, type TextureSet } from "./room";

/**
 * The studio engine: one persistent room, one camera. Everything the visitor sees is driven by `set()`:
 * the corner comes from the URL, the images from the page's real data. The engine never touches history or the DOM
 * outside its canvas; it reports hotspot rectangles so real HTML links sit over the prints.
 *
 * Start-up is staged so the page never freezes: build the room (flat colours) → compile shaders asynchronously
 * (parallel compile where the GPU supports it) → first frame → surfaces and props stream in afterwards, one per
 * idle slice. `onReady` fires once the current corner's own images are on screen (or failed), so the canvas only
 * replaces the static studio when there is something finished to show.
 *
 * Rendering is on demand: frames are drawn only while something moves, then the loop stops; nothing is drawn while
 * the tab is hidden or the stage is out of view.
 */
export type FrameImage = { key: string; src: string } | null;
export type AlbumImage = { key: string; cover: string | null; inner: string | null };

export type SceneInput = {
  station: Station;
  logo?: string;
  reception?: FrameImage[];
  wall?: FrameImage[];
  /** set when the wall shows another group: +1 next, -1 previous */
  wallDir?: number;
  album?: AlbumImage | null;
  /** +1 next album, -1 previous album (the book closes, slides away and the neighbour slides in) */
  albumDir?: number;
  shelf?: FrameImage[];
  screen?: string;
};

export type Rect = { x: number; y: number; w: number; h: number };
export type EngineOptions = {
  tier: Exclude<Tier, "static">;
  reducedMotion: boolean;
  onRects?: (rects: Record<string, Rect | null>) => void;
  onFail?: (reason: string) => void;
  onTier?: (tier: Tier) => void;
  onMoving?: (moving: boolean) => void;
  /** the current corner is fully drawn (its images loaded or failed) */
  onReady?: () => void;
};

export type FrameStats = { frames: number; avgMs: number; p95Ms: number; maxMs: number; over50: number };

export type StudioEngine = {
  set: (input: SceneInput, opts?: { instant?: boolean; entry?: boolean }) => void;
  hover: (key: string | null) => void;
  /** dolly toward a hotspot before the route changes (wall:<i> / reception:<i>) */
  preview: (key: string) => void;
  /** phones: turn toward print `key` while the visitor scrolls through the list (short, interruptible) */
  focus: (key: string | null) => void;
  resize: (w: number, h: number) => void;
  refresh: () => void;
  setVisible: (visible: boolean) => void;
  stats: () => {
    textures: number;
    geometries: number;
    calls: number;
    triangles: number;
    tier: Tier;
    moving: boolean;
    camera: number[];
    target: number[];
    station: Station | null;
    frames: FrameStats;
  };
  /** frame-time stats of camera moves since the last call */
  takeFrameStats: () => FrameStats;
  dispose: () => void;
};

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);
const TEX_LIMIT = 28;
const nextIdle = () =>
  new Promise<void>((r) => ("requestIdleCallback" in window ? window.requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 30)));
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
/** yield to the browser (input, rendering) before the next piece of start-up work */
const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));

/** Async on purpose: each start-up phase is its own task (yield in between), so no single long freeze. */
export async function createStudio(canvas: HTMLCanvasElement, opts: EngineOptions): Promise<StudioEngine> {
  // start-up phases as User Timing marks (studio:*) — visible in DevTools and read by the perf script
  const mark = (n: string) => performance.mark(`studio:${n}`);
  mark("create");
  let tier: Tier = opts.tier;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier === "high", powerPreference: "high-performance", alpha: false, stencil: false });
  renderer.setClearColor(0x14100c, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = tier === "high";
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const maxDpr = () => (tier === "high" ? Math.min(window.devicePixelRatio || 1, 1.75) : Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.setPixelRatio(maxDpr());

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x14100c, 14, 30);
  await yieldTask();
  // the room, zone by zone (a yield between zones)
  const room: Room = await buildRoom(tier, yieldTask);
  scene.add(room.root);
  mark("room");
  await yieldTask();
  // soft reflections for brass and varnish (high tier): a small prefiltered environment. On the lighter tier it is
  // skipped — generating it costs ~0.6 s of main thread on a mid phone; metals there rely on the room lights
  let envRT: THREE.WebGLRenderTarget | null = null;
  if (tier === "high") {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envRT = pmrem.fromScene(new RoomEnvironment(), 0.04, 0.1, 100, { size: 64 });
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.45;
    pmrem.dispose();
  }
  mark("env");
  await yieldTask();

  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 40);
  const cam = { pos: new THREE.Vector3(2, 1.7, 0), target: new THREE.Vector3(7.9, 2, 0), fov: 40 };
  const applyCam = () => {
    camera.position.copy(cam.pos);
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(cam.target);
  };

  // ------------------------------------------------------------------ render loop (on demand) + frame stats
  let width = 1;
  let height = 1;
  let visible = true;
  let disposed = false;
  let compiled = false;
  let raf = 0;
  let activeUntil = 0;
  let moving = false;
  let last = 0;
  const probe: number[] = [];
  let probing = true;
  let moveFrames: number[] = [];
  let firstFrame = false;

  const invalidate = (ms = 120) => {
    activeUntil = Math.max(activeUntil, performance.now() + ms);
    if (!raf && visible && !disposed && compiled) raf = requestAnimationFrame(frame);
  };
  const frame = (now: number) => {
    raf = 0;
    if (disposed || !visible) return;
    if (last && now - last < 250) {
      const dt = now - last;
      if (moving) moveFrames.push(dt);
      if (probing) {
        probe.push(dt);
        if (probe.length >= 30) finishProbe();
      }
    }
    last = now;
    room.book.sync();
    renderer.render(scene, camera);
    if (!firstFrame) {
      firstFrame = true;
      mark("first-frame");
    }
    report();
    if (now < activeUntil) raf = requestAnimationFrame(frame);
    else last = 0;
  };
  const finishProbe = () => {
    probing = false;
    const next = tierAfterProbe(tier, median(probe));
    if (next === tier) return;
    if (next === "static") {
      opts.onFail?.("slow");
      return;
    }
    tier = next;
    renderer.setPixelRatio(maxDpr());
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = false;
    scene.traverse((o) => {
      const l = o as THREE.SpotLight;
      if (l.isSpotLight) l.castShadow = false;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((mt) => (mt.needsUpdate = true));
    });
    opts.onTier?.(tier);
  };
  const frameStats = (xs: number[]): FrameStats => {
    if (!xs.length) return { frames: 0, avgMs: 0, p95Ms: 0, maxMs: 0, over50: 0 };
    const s = [...xs].sort((a, b) => a - b);
    return {
      frames: xs.length,
      avgMs: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1),
      p95Ms: +s[Math.floor(s.length * 0.95)].toFixed(1),
      maxMs: +s[s.length - 1].toFixed(1),
      over50: xs.filter((x) => x > 50).length,
    };
  };

  // ------------------------------------------------------------------ hotspot projection
  let station: Station | null = null;
  const tmp = new THREE.Vector3();
  const rectOf = (slot: FrameSlot): Rect | null => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of slot.corners()) {
      tmp.copy(c).project(camera);
      if (tmp.z > 1) return null;
      const x = (tmp.x * 0.5 + 0.5) * width;
      const y = (-tmp.y * 0.5 + 0.5) * height;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };
  const report = () => {
    if (!opts.onRects) return;
    const out: Record<string, Rect | null> = {};
    room.wall.forEach((s, i) => (out[`wall:${i}`] = station === "albums" && s.group.visible ? rectOf(s) : null));
    room.reception.forEach((s, i) => (out[`reception:${i}`] = station === "reception" ? rectOf(s) : null));
    opts.onRects(out);
  };

  // ------------------------------------------------------------------ textures (same-origin, cached, bounded, no retry loops)
  const loader = new THREE.TextureLoader();
  const cache = new Map<string, Promise<THREE.Texture | null>>();
  const loaded = new Map<string, THREE.Texture>();
  const failed = new Set<string>(); // a photo that is gone (unpublished) is not requested again in this visit
  const inUse = new Set<string>();
  const load = (src: string): Promise<THREE.Texture | null> => {
    if (failed.has(src)) return Promise.resolve(null);
    let p = cache.get(src);
    if (!p) {
      p = new Promise((resolve) => {
        loader.load(
          src,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
            loaded.set(src, t);
            evict();
            resolve(t);
          },
          undefined,
          () => {
            failed.add(src);
            resolve(null);
          },
        );
      });
      cache.set(src, p);
    }
    return p;
  };
  const evict = () => {
    if (loaded.size <= TEX_LIMIT) return;
    for (const [src, t] of loaded) {
      if (loaded.size <= TEX_LIMIT) break;
      if (inUse.has(src)) continue;
      t.dispose();
      loaded.delete(src);
      cache.delete(src);
    }
  };
  const aspectOf = (t: THREE.Texture) => {
    const img = t.image as { width: number; height: number } | undefined;
    return img?.width ? img.width / img.height : null;
  };
  const shown = new WeakMap<THREE.Material, string | null>();
  const PAPER = new THREE.Color(0xe6dccb);
  type Target = { mat: THREE.MeshBasicMaterial; fit: (aspect: number | null) => void };
  // a print sits slightly below pure white so it reads as paper in the room, not as a light source
  const PRINT = 0.95;
  /** Put a photo on a print (whole photo; the print takes its proportions); null / failed keeps a blank mat. */
  const setImage = (target: Target, img: { key: string; src: string } | null, instant: boolean): Promise<void> => {
    const { mat, fit } = target;
    const want = img?.src ?? null;
    if (shown.get(mat) === want) return Promise.resolve();
    const prev = shown.get(mat);
    if (prev) inUse.delete(prev);
    shown.set(mat, want);
    const blank = () => {
      mat.map = room.blank;
      mat.color.copy(PAPER);
      mat.needsUpdate = true;
      fit(null);
      invalidate();
    };
    if (!want) {
      blank();
      return Promise.resolve();
    }
    inUse.add(want);
    return load(want).then((t) => {
      if (disposed || shown.get(mat) !== want) return;
      if (!t) return blank();
      fit(aspectOf(t));
      mat.map = t;
      mat.needsUpdate = true;
      if (instant || opts.reducedMotion) {
        mat.color.setScalar(PRINT);
        invalidate();
      } else {
        mat.color.copy(PAPER);
        gsap.to(mat.color, { r: PRINT, g: PRINT, b: PRINT, duration: 0.5, ease: "power1.out", onUpdate: () => invalidate() });
      }
    });
  };
  const slotTarget = (s: FrameSlot): Target => ({ mat: s.photo.material, fit: s.fit });

  // ------------------------------------------------------------------ camera moves
  let camTween: gsap.core.Tween | null = null;
  let camGuard: ReturnType<typeof setTimeout> | undefined;
  const setMoving = (m: boolean) => {
    if (moving === m) return;
    moving = m;
    opts.onMoving?.(m);
  };
  const goTo = (to: CameraState, duration: number, ease = "power2.inOut", curved = true) => {
    camTween?.kill();
    clearTimeout(camGuard);
    const from = { pos: cam.pos.clone(), target: cam.target.clone(), fov: cam.fov };
    const p1 = v3(to.position);
    const t1 = v3(to.target);
    if (duration <= 0) {
      cam.pos.copy(p1);
      cam.target.copy(t1);
      cam.fov = to.fov;
      applyCam();
      setMoving(false);
      invalidate();
      return;
    }
    const mid = curved ? v3(pathMid([from.pos.x, from.pos.y, from.pos.z], to.position)) : from.pos.clone().lerp(p1, 0.5);
    const curve = new THREE.QuadraticBezierCurve3(from.pos, mid, p1);
    const s = { t: 0 };
    setMoving(true);
    camTween = gsap.to(s, {
      t: 1,
      duration,
      ease,
      onUpdate: () => {
        curve.getPoint(s.t, cam.pos);
        // the aim leads slightly: the head turns before the walk ends
        const k = Math.min(1, s.t * 1.12);
        cam.target.lerpVectors(from.target, t1, k);
        cam.fov = from.fov + (to.fov - from.fov) * s.t;
        applyCam();
        invalidate();
      },
      onComplete: () => {
        clearTimeout(camGuard);
        camTween = null;
        setMoving(false);
        invalidate();
      },
    });
    // GSAP ticks on requestAnimationFrame, which a browser may throttle or stall (background tab, WebKit under
    // load): the move still ends on time, so the corner is never left "moving"
    const tween = camTween;
    clearTimeout(camGuard);
    camGuard = setTimeout(() => {
      if (camTween === tween && !disposed) tween.progress(1);
    }, duration * 1000 + 600);
  };
  const aspect = () => width / Math.max(1, height);
  // the album wall frames as many prints as hang (1–5): a short group is seen closer, not lost on a wide wall
  let wallCount = 5;
  const cameraForStation = (s: Station) => {
    const pose = s === "albums" ? { ...POSES.albums, fit: [Math.max(8.6, wallCount * WALL.spacing + 1.6), POSES.albums.fit[1]] as [number, number] } : POSES[s];
    return cameraFor(pose, aspect(), SIDE_TEXT[s]);
  };

  // ------------------------------------------------------------------ lighting per corner
  let lightTween: gsap.core.Tween | null = null;
  const mood = { k: 1, screen: 0.45 };
  const applyMood = () => {
    room.lights.ambient.intensity = (room.lights.base.get(room.lights.ambient) ?? 0) * (0.35 + 0.65 * mood.k);
    for (const l of room.lights.dimmable) l.intensity = (room.lights.base.get(l) ?? 0) * mood.k;
    for (const g of room.glows) {
      const mt = g.material as THREE.MeshBasicMaterial;
      mt.opacity = (g.userData.base ??= mt.opacity) * (0.45 + 0.55 * mood.k);
    }
    room.screen.color.setScalar(mood.screen);
    for (const l of room.lights.videos) l.intensity = (room.lights.base.get(l) ?? 0) * (0.3 + mood.screen);
    invalidate();
  };
  const setMood = (s: Station, instant: boolean) => {
    const target = { k: s === "videos" ? 0.38 : 1, screen: s === "videos" ? 1 : 0.45 };
    lightTween?.kill();
    if (instant || opts.reducedMotion) {
      Object.assign(mood, target);
      applyMood();
      return;
    }
    lightTween = gsap.to(mood, { ...target, duration: 0.9, ease: "power1.inOut", onUpdate: applyMood });
  };

  // ------------------------------------------------------------------ the album on the table
  let bookTl: gsap.core.Timeline | null = null;
  let bookKey: string | null = null;
  const book = room.book;
  const pageFit = (mesh: THREE.Mesh) => (aspectRatio: number | null) => {
    // the photo sits on the page with a paper margin, whole (contain)
    const [pw, pd] = book.page;
    let w = pw;
    let h = pd;
    if (aspectRatio) {
      if (aspectRatio > pw / pd) h = pw / aspectRatio;
      else w = pd * aspectRatio;
    }
    mesh.scale.set(w, h, 1);
  };
  const rightTarget: Target = { mat: book.rightPage.material, fit: pageFit(book.rightPage) };
  const leftTarget: Target = { mat: book.leftPage.material, fit: pageFit(book.leftPage) };
  const setBookImages = (a: AlbumImage | null, instant: boolean) =>
    Promise.all([
      setImage(rightTarget, a?.cover ? { key: `${a.key}:c`, src: a.cover } : null, instant),
      setImage(leftTarget, a?.inner ? { key: `${a.key}:i`, src: a.inner } : a?.cover ? { key: `${a.key}:c`, src: a.cover } : null, instant),
    ]);
  const OPEN = 0;
  const CLOSED = -Math.PI;
  const hingeTo = (angle: number, instant: boolean, delay = 0) => {
    bookTl?.kill();
    if (instant || opts.reducedMotion) {
      book.hinge.rotation.z = angle;
      book.group.position.copy(book.home);
      book.sync();
      invalidate();
      return;
    }
    bookTl = gsap.timeline({ delay, onUpdate: () => invalidate() });
    bookTl.to(book.hinge.rotation, { z: angle, duration: angle === OPEN ? 0.85 : 0.5, ease: angle === OPEN ? "power2.inOut" : "power2.in" });
  };
  /** Album → neighbour: close, slide away (RTL: next leaves to the right), swap, slide in from the other side, open. */
  const swapBook = (a: AlbumImage | null, dir: number) => {
    bookTl?.kill();
    const out = dir > 0 ? 1.2 : -1.2;
    const shadow = (book.group.userData.shadow as THREE.Mesh | undefined)?.position ?? new THREE.Vector3();
    bookTl = gsap.timeline({ onUpdate: () => invalidate() });
    bookTl
      .to(book.hinge.rotation, { z: CLOSED, duration: 0.42, ease: "power2.in" })
      .to([book.group.position, shadow], { x: book.home.x + out, duration: 0.36, ease: "power2.in" }, ">-0.02")
      .add(() => {
        void setBookImages(a, true);
        book.group.position.x = book.home.x - out;
        shadow.x = book.home.x - out;
      })
      .to([book.group.position, shadow], { x: book.home.x, duration: 0.4, ease: "power2.out" })
      .to(book.hinge.rotation, { z: OPEN, duration: 0.7, ease: "power2.inOut" }, ">-0.04");
  };

  // ------------------------------------------------------------------ wall group swap
  let wallKeys: (string | null)[] = [];
  let wallTl: gsap.core.Timeline | null = null;
  const setWall = (imgs: FrameImage[], dir: number, instant: boolean): Promise<unknown> => {
    const keys = room.wall.map((_, i) => imgs[i]?.src ?? null);
    if (keys.join("|") === wallKeys.join("|")) return Promise.resolve();
    wallKeys = keys;
    // re-centre the group: n prints hang balanced in the middle of the rope
    const n = Math.max(1, keys.filter(Boolean).length);
    wallCount = n;
    room.wallLayout(n).forEach((pos, i) => room.wall[i].rest.position.copy(pos));
    const apply = (inst: boolean) =>
      Promise.all(
        room.wall.map((slot, i) => {
          slot.group.visible = Boolean(imgs[i]);
          return setImage(slotTarget(slot), imgs[i] ?? null, inst);
        }),
      );
    wallTl?.kill();
    if (!dir || instant || opts.reducedMotion) {
      room.wall.forEach((s) => {
        s.group.rotation.x = 0;
        if (instant || opts.reducedMotion) s.group.position.copy(s.rest.position);
        else gsap.to(s.group.position, { x: s.rest.position.x, y: s.rest.position.y, duration: 0.6, ease: "power2.inOut", onUpdate: () => invalidate() });
      });
      const p = apply(instant);
      invalidate();
      return p;
    }
    // prints lift off the rope; the next group drops in (direction-aware)
    wallTl = gsap.timeline({ onUpdate: () => invalidate() });
    const groups = room.wall.map((s) => s.group);
    wallTl
      .to(groups.map((g) => g.position), { y: "+=0.22", x: (i) => room.wall[i].rest.position.x + dir * 0.3, duration: 0.26, ease: "power2.in", stagger: 0.03 })
      .to(groups.map((g) => g.rotation), { x: -0.45, duration: 0.26, ease: "power2.in" }, "<")
      .add(() => void apply(true))
      .set(groups.map((g) => g.position), { x: (i) => room.wall[i].rest.position.x - dir * 0.3 })
      .to(groups.map((g) => g.position), { y: (i) => room.wall[i].rest.position.y, x: (i) => room.wall[i].rest.position.x, duration: 0.42, ease: "back.out(1.3)", stagger: 0.04 })
      .to(groups.map((g) => g.rotation), { x: 0, duration: 0.42, ease: "power2.out" }, "<");
    return Promise.resolve();
  };

  // ------------------------------------------------------------------ hover
  let hovered: string | null = null;
  const slotOf = (key: string): FrameSlot | null => {
    const [kind, i] = key.split(":");
    const list = kind === "wall" ? room.wall : kind === "reception" ? room.reception : null;
    return list?.[Number(i)] ?? null;
  };
  const hover = (key: string | null) => {
    if (hovered === key) return;
    const prev = hovered ? slotOf(hovered) : null;
    hovered = key;
    const next = key ? slotOf(key) : null;
    const d = opts.reducedMotion ? 0 : 0.3;
    if (prev) gsap.to(prev.group.position, { z: prev.rest.position.z, duration: d, ease: "power2.out", onUpdate: () => invalidate() });
    if (next) gsap.to(next.group.position, { z: next.rest.position.z + 0.05, duration: d, ease: "power2.out", onUpdate: () => invalidate() });
    invalidate(d * 1000 + 60);
  };

  // ------------------------------------------------------------------ public: set()
  let logoSrc: string | null = null;
  let screenSrc: string | null = null;
  let readySent = false;
  let focusKey: string | null = null;
  const set: StudioEngine["set"] = (input, o = {}) => {
    const instant = Boolean(o.instant) || opts.reducedMotion;
    const prevStation = station;
    station = input.station;
    const pending: Promise<unknown>[] = [];

    if (input.logo && input.logo !== logoSrc) {
      logoSrc = input.logo;
      pending.push(
        load(input.logo).then((t) => {
          if (!t || disposed) return;
          room.logo.map = t;
          room.logo.needsUpdate = true;
          room.logo.opacity = 1;
          invalidate();
        }),
      );
    }
    if (input.screen && input.screen !== screenSrc) {
      screenSrc = input.screen;
      pending.push(
        load(input.screen).then((t) => {
          if (!t || disposed) return;
          room.screen.map = t;
          room.screen.needsUpdate = true;
          invalidate();
        }),
      );
    }
    input.reception?.forEach((img, i) => room.reception[i] && pending.push(setImage(slotTarget(room.reception[i]), img, instant)));
    input.shelf?.forEach((img, i) => room.shelf[i] && pending.push(setImage(slotTarget(room.shelf[i]), img, instant)));
    const countBefore = wallCount;
    if (input.wall) pending.push(setWall(input.wall, input.wallDir ?? 0, instant || prevStation !== "albums"));
    const regroup = input.station === "albums" && prevStation === "albums" && wallCount !== countBefore;

    // the album on the table
    if (input.station === "album") {
      const nextKey = input.album?.key ?? null;
      if (prevStation === "album" && bookKey && nextKey !== bookKey && input.albumDir && !instant) swapBook(input.album ?? null, input.albumDir);
      else if (nextKey !== bookKey || prevStation !== "album") {
        pending.push(setBookImages(input.album ?? null, true));
        if (prevStation !== "album") {
          book.hinge.rotation.z = instant ? OPEN : CLOSED;
          book.sync();
        }
        hingeTo(OPEN, instant, prevStation === "album" || instant ? 0 : 0.55);
      }
      bookKey = nextKey;
    } else if (prevStation === "album") {
      hingeTo(CLOSED, instant);
    }

    if (prevStation !== input.station || o.entry) setMood(input.station, instant || prevStation === null);
    const to = cameraForStation(input.station);
    focusKey = null;
    if (o.entry && !instant) {
      const from = entryFrom(to);
      cam.pos.copy(v3(from.position));
      cam.target.copy(v3(from.target));
      cam.fov = from.fov;
      applyCam();
      goTo(to, 1.7, "power2.out", false);
    } else if (prevStation === null || instant) {
      goTo(to, 0);
    } else if (regroup) {
      goTo(to, opts.reducedMotion ? 0 : 0.8, "power2.inOut", false);
    } else if (prevStation !== input.station || moving) {
      const dur = moveDuration([cam.pos.x, cam.pos.y, cam.pos.z], to.position, { tall: aspect() < 1, reduced: opts.reducedMotion });
      goTo(to, dur);
    }
    invalidate(300);
    if (!readySent) {
      // the first corner is "ready" once its images are in (or failed) — capped so a slow image never holds it
      void Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 2500))]).then(async () => {
        while (!compiled && !disposed) await nextFrame();
        if (disposed || readySent) return;
        readySent = true;
        invalidate(400);
        requestAnimationFrame(() => requestAnimationFrame(() => opts.onReady?.()));
      });
    }
  };

  const preview = (key: string) => {
    const slot = slotOf(key);
    if (!slot || opts.reducedMotion) return;
    const c = slot.corners();
    const centre = c[0].clone().add(c[2]).multiplyScalar(0.5);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(slot.photo.getWorldQuaternion(new THREE.Quaternion()));
    const pos = centre.clone().add(normal.multiplyScalar(2.4));
    pos.y += 0.08;
    goTo({ position: [pos.x, pos.y, pos.z], target: [centre.x, centre.y, centre.z], fov: cam.fov }, 0.5, "power2.in", false);
  };

  // phones: the camera turns to the print whose card is in the middle of the screen (no path through the room)
  const focus = (key: string | null) => {
    if (key === focusKey || !station) return;
    focusKey = key;
    const base = cameraForStation(station);
    const slot = key ? slotOf(key) : null;
    if (!slot) return goTo(base, opts.reducedMotion ? 0 : 0.6, "power2.out", false);
    const c = slot.corners();
    const centre = c[0].clone().add(c[2]).multiplyScalar(0.5);
    const t = v3(base.target);
    const shift = centre.clone().sub(t);
    // keep the corner's viewpoint, slide along the wall to face the print
    const p = v3(base.position).add(new THREE.Vector3(shift.x, 0, shift.z));
    goTo({ position: [p.x, p.y, p.z], target: [centre.x, t.y + (centre.y - t.y) * 0.6, centre.z], fov: base.fov }, opts.reducedMotion ? 0 : 0.55, "power2.out", false);
  };

  const resize = (w: number, h: number) => {
    width = Math.max(1, Math.round(w));
    height = Math.max(1, Math.round(h));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (station) {
      const key = focusKey;
      focusKey = null;
      const to = cameraForStation(station);
      if (moving && camTween) goTo(to, Math.max(0.25, camTween.duration() - camTween.time() || 0.3));
      else goTo(to, 0);
      if (key) focus(key);
    }
    invalidate();
  };

  const onLost = (e: Event) => {
    e.preventDefault();
    opts.onFail?.("context-lost");
  };
  canvas.addEventListener("webglcontextlost", onLost);

  // ------------------------------------------------------------------ staged start-up
  void (async () => {
    applyCam();
    // 1) shaders compile without blocking where the GPU supports parallel compile; the first frame waits for it
    //    (the static studio shows meanwhile)
    try {
      await renderer.compileAsync(scene, camera);
    } catch {
      /* older drivers: compile happens on first render */
    }
    if (disposed) return;
    mark("compiled");
    compiled = true;
    invalidate(300);
    // 2) surfaces, one per idle slice (decode + upload spread out)
    const tl = new THREE.TextureLoader();
    const loadTex = (u: string) => new Promise<THREE.Texture | null>((r) => tl.load(u, r, undefined, () => r(null)));
    const SURF: [SurfaceName, string][] = [
      ["plaster", "clay_plaster"],
      ["floor", "herringbone_parquet"],
      ["walnut", "black_walnut_veneer_01"],
      ["leather", "brown_leather"],
    ];
    for (const [name, file] of SURF) {
      await nextIdle();
      if (disposed) return;
      const [color, normal, rough] = await Promise.all((name === "plaster" ? ["color", "normal", "rough"] : ["color", "normal"]).map((k) => loadTex(`/studio/tex/${file}_${k}.webp`)));
      if (disposed || !color) continue;
      const surface: TextureSet = { color, normal: normal ?? undefined, rough: rough ?? undefined };
      room.applySurface(name, surface);
      await nextFrame();
      invalidate();
    }
    // 3) props (CC0 glTF, meshopt-compressed), one per idle slice; their materials compile before they are shown
    const gl = new GLTFLoader();
    gl.setMeshoptDecoder(MeshoptDecoder);
    // the lighter tier skips the heaviest prop (the plant: dense geometry, long decode)
    for (const name of PROPS.filter((n) => tier === "high" || n !== "potted_plant_02")) {
      await nextIdle();
      if (disposed) return;
      try {
        const g = await gl.loadAsync(`/studio/models/${name}.glb`);
        if (disposed) return;
        try {
          await renderer.compileAsync(g.scene, camera, scene);
        } catch {
          /* compile on first render */
        }
        room.placeProp(name, g);
        invalidate();
      } catch {
        /* a missing prop just leaves its spot empty */
      }
    }
  })();

  return {
    set,
    hover,
    preview,
    focus,
    resize,
    refresh: () => invalidate(),
    setVisible: (v) => {
      visible = v;
      if (v) invalidate();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    stats: () => ({
      textures: renderer.info.memory.textures,
      geometries: renderer.info.memory.geometries,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      tier,
      moving,
      camera: cam.pos.toArray().map((n) => +n.toFixed(2)),
      target: cam.target.toArray().map((n) => +n.toFixed(2)),
      station,
      frames: frameStats(moveFrames),
    }),
    takeFrameStats: () => {
      const s = frameStats(moveFrames);
      moveFrames = [];
      return s;
    },
    dispose: () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      camTween?.kill();
      clearTimeout(camGuard);
      lightTween?.kill();
      bookTl?.kill();
      wallTl?.kill();
      canvas.removeEventListener("webglcontextlost", onLost);
      for (const t of loaded.values()) t.dispose();
      loaded.clear();
      cache.clear();
      room.dispose();
      envRT?.dispose();
      renderer.dispose();
    },
  };
}
