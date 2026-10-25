import { gsap } from "gsap";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { median, tierAfterProbe, type Tier } from "../capability";
import { POSES, cameraFor, entryFrom, moveDuration, pathMid, type CameraState, type Vec3 } from "../poses";
import { SIDE_TEXT, type Station } from "../stations";
import { buildRoom, type FrameSlot, type Room } from "./room";

/**
 * The studio engine: one persistent room, one camera. Everything the visitor sees is driven by `set()`:
 * the station (corner) comes from the URL, the images from the page's real data. The engine never touches
 * history or the DOM outside its canvas; it reports hotspot rectangles so real HTML links sit over the frames.
 *
 * Rendering is on demand: frames are drawn only while something moves (camera, hover, a texture fading in),
 * then the loop stops. Hidden tab / stage out of view → nothing is drawn at all.
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
  /** +1 next album, -1 previous album (the book slides out and the neighbour slides in) */
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
  onIdle?: () => void;
  onMoving?: (moving: boolean) => void;
};

export type StudioEngine = {
  set: (input: SceneInput, opts?: { instant?: boolean; entry?: boolean }) => void;
  hover: (key: string | null) => void;
  /** dolly toward a hotspot before the route changes (wall:<i> / reception:<i>) */
  preview: (key: string) => void;
  resize: (w: number, h: number) => void;
  /** draw once more (e.g. a hotspot registered and needs its position) */
  refresh: () => void;
  setVisible: (visible: boolean) => void;
  stats: () => { textures: number; calls: number; triangles: number; tier: Tier; moving: boolean };
  dispose: () => void;
};

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);
const TEX_LIMIT = 24;

export function createStudio(canvas: HTMLCanvasElement, opts: EngineOptions): StudioEngine {
  let tier: Tier = opts.tier;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier === "high", powerPreference: "high-performance", alpha: false, stencil: false });
  renderer.setClearColor(0x0b0907, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = tier === "high";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxDpr = () => (tier === "high" ? Math.min(window.devicePixelRatio || 1, 1.75) : 1);
  renderer.setPixelRatio(maxDpr());

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b0907, 11, 26);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.32;
  pmrem.dispose();

  const room: Room = buildRoom(tier);
  scene.add(room.root);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 40);
  const cam = { pos: new THREE.Vector3(2, 1.7, 0), target: new THREE.Vector3(7.9, 2, 0), fov: 40 };
  const applyCam = () => {
    camera.position.copy(cam.pos);
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(cam.target);
  };

  // ------------------------------------------------------------------ render loop (on demand)
  let width = 1;
  let height = 1;
  let visible = true;
  let disposed = false;
  let raf = 0;
  let activeUntil = 0;
  let moving = false;
  let last = 0;
  const probe: number[] = [];
  let probing = true;

  const invalidate = (ms = 120) => {
    activeUntil = Math.max(activeUntil, performance.now() + ms);
    if (!raf && visible && !disposed) raf = requestAnimationFrame(frame);
  };
  const frame = (now: number) => {
    raf = 0;
    if (disposed || !visible) return;
    if (probing && last && now - last < 250) {
      probe.push(now - last);
      if (probe.length >= 24) finishProbe();
    }
    last = now;
    renderer.render(scene, camera);
    report();
    if (now < activeUntil) raf = requestAnimationFrame(frame);
    else {
      last = 0;
      opts.onIdle?.();
    }
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
      if (mesh.isMesh) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mt) => (mt.needsUpdate = true));
      }
    });
    opts.onTier?.(tier);
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

  // ------------------------------------------------------------------ textures (same-origin, cached, bounded)
  const loader = new THREE.TextureLoader();
  const cache = new Map<string, Promise<THREE.Texture | null>>();
  const loaded = new Map<string, THREE.Texture>();
  const inUse = new Set<string>();
  const load = (src: string): Promise<THREE.Texture | null> => {
    let p = cache.get(src);
    if (!p) {
      p = new Promise((resolve) => {
        loader.load(
          src,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
            t.generateMipmaps = true;
            loaded.set(src, t);
            evict();
            resolve(t);
          },
          undefined,
          () => {
            cache.delete(src); // a later visit may retry; this one keeps the plain mat
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
  /** Cover-fit an image into a w×h print (centre crop, never stretched). */
  const coverFit = (t: THREE.Texture, w: number, h: number) => {
    const img = t.image as { width: number; height: number } | undefined;
    if (!img?.width) return;
    const ia = img.width / img.height;
    const fa = w / h;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    if (ia > fa) {
      t.repeat.set(fa / ia, 1);
      t.offset.set((1 - fa / ia) / 2, 0);
    } else {
      t.repeat.set(1, ia / fa);
      t.offset.set(0, (1 - ia / fa) / 2);
    }
  };
  const shown = new WeakMap<THREE.Material, string | null>();
  const DARK = new THREE.Color(0x2a2520);
  /** Put an image on a print / page; fades in when it arrives; null keeps the plain mat. */
  const setImage = (mat: THREE.MeshStandardMaterial, img: { key: string; src: string } | null, size: [number, number], instant: boolean) => {
    const want = img?.src ?? null;
    if (shown.get(mat) === want) return;
    const prev = shown.get(mat);
    if (prev) inUse.delete(prev);
    shown.set(mat, want);
    if (!want) {
      mat.map = null;
      mat.color.copy(DARK);
      mat.needsUpdate = true;
      invalidate();
      return;
    }
    inUse.add(want);
    void load(want).then((t) => {
      if (disposed || shown.get(mat) !== want) return;
      if (!t) {
        mat.map = null;
        mat.color.copy(DARK);
        mat.needsUpdate = true;
        invalidate();
        return;
      }
      const tex = t.clone(); // per-use UV fit; shares the GPU image
      tex.needsUpdate = true;
      coverFit(tex, size[0], size[1]);
      const old = mat.map;
      mat.map = tex;
      mat.needsUpdate = true;
      if (old && old !== tex) old.dispose();
      if (instant || opts.reducedMotion) {
        mat.color.set(0xffffff);
        invalidate();
      } else {
        mat.color.copy(DARK);
        gsap.to(mat.color, { r: 1, g: 1, b: 1, duration: 0.55, ease: "power1.out", onUpdate: () => invalidate() });
      }
    });
  };

  // ------------------------------------------------------------------ camera moves
  let camTween: gsap.core.Tween | null = null;
  const setMoving = (m: boolean) => {
    if (moving === m) return;
    moving = m;
    opts.onMoving?.(m);
  };
  const goTo = (to: CameraState, duration: number, ease = "power2.inOut", path = true) => {
    camTween?.kill();
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
    const mid = path ? v3(pathMid([from.pos.x, from.pos.y, from.pos.z], to.position)) : from.pos.clone().lerp(p1, 0.5);
    const curve = new THREE.QuadraticBezierCurve3(from.pos, mid, p1);
    const s = { t: 0 };
    setMoving(true);
    camTween = gsap.to(s, {
      t: 1,
      duration,
      ease,
      onUpdate: () => {
        curve.getPoint(s.t, cam.pos);
        // the aim leads slightly: turning starts before the walk does — reads as a head turn, not a slide
        const k = Math.min(1, s.t * 1.15);
        cam.target.lerpVectors(from.target, t1, k);
        cam.fov = from.fov + (to.fov - from.fov) * s.t;
        applyCam();
        invalidate();
      },
      onComplete: () => {
        camTween = null;
        setMoving(false);
        invalidate();
      },
    });
  };
  const aspect = () => width / Math.max(1, height);
  const cameraForStation = (s: Station) => cameraFor(POSES[s], aspect(), SIDE_TEXT[s]);

  // ------------------------------------------------------------------ lighting per corner
  let lightTween: gsap.core.Tween | null = null;
  const setMood = (s: Station, instant: boolean) => {
    const dim = s === "videos";
    const target = { k: dim ? 0.32 : 1, screen: dim ? 1 : 0.42 };
    const cur = { k: room.lights.ambient.intensity / (room.lights.base.get(room.lights.ambient) || 1), screen: room.screen.color.r };
    lightTween?.kill();
    const apply = () => {
      room.lights.ambient.intensity = (room.lights.base.get(room.lights.ambient) ?? 0) * cur.k;
      for (const l of room.lights.dimmable) l.intensity = (room.lights.base.get(l) ?? 0) * cur.k;
      for (const g of room.glows) (g.material as THREE.MeshBasicMaterial).opacity = (g.userData.base ??= (g.material as THREE.MeshBasicMaterial).opacity) * (0.4 + 0.6 * cur.k);
      room.screen.color.setScalar(cur.screen);
      for (const l of room.lights.videos) l.intensity = (room.lights.base.get(l) ?? 0) * (0.3 + cur.screen);
      invalidate();
    };
    if (instant || opts.reducedMotion) {
      Object.assign(cur, target);
      apply();
      return;
    }
    lightTween = gsap.to(cur, { ...target, duration: 0.9, ease: "power1.inOut", onUpdate: apply });
  };

  // ------------------------------------------------------------------ book
  let bookTl: gsap.core.Timeline | null = null;
  let bookKey: string | null = null;
  const book = room.book;
  const setBookImages = (a: AlbumImage | null, instant: boolean) => {
    const [bw, bd] = book.size;
    const page: [number, number] = [bw - 0.08, bd - 0.08];
    setImage(book.rightPage.material, a?.cover ? { key: `${a.key}:c`, src: a.cover } : null, page, instant);
    setImage(book.leftPage.material, a?.inner ? { key: `${a.key}:i`, src: a.inner } : a?.cover ? { key: `${a.key}:c`, src: a.cover } : null, page, instant);
  };
  const openBook = (open: boolean, instant: boolean, delay = 0) => {
    bookTl?.kill();
    const angle = open ? Math.PI : 0;
    if (instant || opts.reducedMotion) {
      book.cover.rotation.z = angle;
      book.group.position.copy(book.home);
      invalidate();
      return;
    }
    bookTl = gsap.timeline({ delay, onUpdate: () => invalidate() });
    bookTl.to(book.cover.rotation, { z: angle, duration: open ? 0.75 : 0.4, ease: open ? "power2.inOut" : "power2.in" });
  };
  /** Album → neighbour: close, slide out (RTL: next leaves to the right), swap, slide in from the other side, open. */
  const swapBook = (a: AlbumImage | null, dir: number) => {
    bookTl?.kill();
    const out = dir > 0 ? 1.5 : -1.5;
    const shadow = book.group.userData.shadow as THREE.Mesh | undefined;
    bookTl = gsap.timeline({ onUpdate: () => invalidate() });
    bookTl
      .to(book.cover.rotation, { z: 0, duration: 0.32, ease: "power2.in" })
      .to(book.group.position, { x: book.home.x + out, duration: 0.34, ease: "power2.in" }, ">-0.04")
      .add(() => {
        setBookImages(a, true);
        book.group.position.x = book.home.x - out;
      })
      .to(book.group.position, { x: book.home.x, duration: 0.38, ease: "power2.out" })
      .to(book.cover.rotation, { z: Math.PI, duration: 0.55, ease: "power2.inOut" }, ">-0.05");
    if (shadow) shadow.visible = true;
  };

  // ------------------------------------------------------------------ wall group swap
  let wallKeys: (string | null)[] = [];
  let wallTl: gsap.core.Timeline | null = null;
  const setWall = (imgs: FrameImage[], dir: number, instant: boolean) => {
    const keys = room.wall.map((_, i) => imgs[i]?.src ?? null);
    if (keys.join("|") === wallKeys.join("|")) return;
    wallKeys = keys;
    const apply = (inst: boolean) =>
      room.wall.forEach((slot, i) => {
        slot.group.visible = Boolean(imgs[i]);
        setImage(slot.photo.material, imgs[i] ?? null, slot.size, inst);
      });
    wallTl?.kill();
    if (!dir || instant || opts.reducedMotion) {
      room.wall.forEach((s) => {
        s.group.position.copy(s.rest.position);
        s.group.rotation.x = 0;
      });
      apply(instant);
      invalidate();
      return;
    }
    // prints lift off the rope, the next group drops in (direction-aware sideways drift)
    wallTl = gsap.timeline({ onUpdate: () => invalidate() });
    const groups = room.wall.map((s) => s.group);
    wallTl
      .to(groups.map((g) => g.position), { y: `+=0.25`, x: (i) => room.wall[i].rest.position.x + dir * 0.35, duration: 0.28, ease: "power2.in", stagger: 0.03 })
      .to(groups.map((g) => g.rotation), { x: -0.5, duration: 0.28, ease: "power2.in" }, "<")
      .add(() => apply(true))
      .set(groups.map((g) => g.position), { x: (i) => room.wall[i].rest.position.x - dir * 0.35 })
      .to(groups.map((g) => g.position), { y: (i) => room.wall[i].rest.position.y, x: (i) => room.wall[i].rest.position.x, duration: 0.42, ease: "back.out(1.4)", stagger: 0.04 })
      .to(groups.map((g) => g.rotation), { x: 0, duration: 0.42, ease: "power2.out" }, "<");
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
    const d = opts.reducedMotion ? 0 : 0.35;
    if (prev) gsap.to(prev.group.position, { z: prev.rest.position.z, duration: d, ease: "power2.out", onUpdate: () => invalidate() });
    if (prev) gsap.to(prev.group.rotation, { z: prev.rest.rotZ, duration: d, onUpdate: () => invalidate() });
    if (next) gsap.to(next.group.position, { z: next.rest.position.z + 0.06, duration: d, ease: "power2.out", onUpdate: () => invalidate() });
    if (next) gsap.to(next.group.rotation, { z: 0, duration: d, onUpdate: () => invalidate() });
    invalidate(d * 1000 + 60);
  };

  // ------------------------------------------------------------------ public: set()
  let logoSrc: string | null = null;
  let screenSrc: string | null = null;
  const set: StudioEngine["set"] = (input, o = {}) => {
    const instant = Boolean(o.instant) || opts.reducedMotion;
    const prevStation = station;
    station = input.station;

    if (input.logo && input.logo !== logoSrc) {
      logoSrc = input.logo;
      void load(input.logo).then((t) => {
        if (!t || disposed) return;
        room.logo.map = t;
        room.logo.needsUpdate = true;
        if (instant) room.logo.opacity = 1;
        else gsap.to(room.logo, { opacity: 1, duration: 0.6, onUpdate: () => invalidate() });
        invalidate();
      });
    }
    if (input.screen && input.screen !== screenSrc) {
      screenSrc = input.screen;
      void load(input.screen).then((t) => {
        if (!t || disposed) return;
        const tex = t.clone();
        tex.needsUpdate = true;
        coverFit(tex, 16, 9);
        room.screen.map = tex;
        room.screen.needsUpdate = true;
        invalidate();
      });
    }
    input.reception?.forEach((img, i) => room.reception[i] && setImage(room.reception[i].photo.material, img, room.reception[i].size, instant));
    input.shelf?.forEach((img, i) => room.shelf[i] && setImage(room.shelf[i].photo.material, img, room.shelf[i].size, instant));
    if (input.wall) setWall(input.wall, input.wallDir ?? 0, instant || prevStation !== "albums");

    // the album on the table
    const nextKey = input.station === "album" ? (input.album?.key ?? null) : bookKey;
    if (input.station === "album") {
      if (prevStation === "album" && bookKey && nextKey !== bookKey && input.albumDir && !instant) swapBook(input.album ?? null, input.albumDir);
      else if (nextKey !== bookKey || prevStation !== "album") {
        setBookImages(input.album ?? null, true);
        if (prevStation !== "album") book.cover.rotation.z = 0;
        openBook(true, instant, prevStation === "album" ? 0 : 0.55);
      }
      bookKey = nextKey;
    } else if (prevStation === "album") {
      openBook(false, instant);
    }

    if (prevStation !== input.station || o.entry) setMood(input.station, instant || prevStation === null);
    const to = cameraForStation(input.station);
    if (o.entry && !instant) {
      const from = entryFrom(to);
      cam.pos.copy(v3(from.position));
      cam.target.copy(v3(from.target));
      cam.fov = from.fov;
      applyCam();
      goTo(to, 1.7, "power2.out", false);
    } else if (prevStation === null || instant) {
      goTo(to, 0);
    } else if (prevStation !== input.station || moving) {
      const dur = moveDuration([cam.pos.x, cam.pos.y, cam.pos.z], to.position, { tall: aspect() < 1, reduced: opts.reducedMotion });
      goTo(to, dur);
    }
    invalidate(300);
  };

  const preview = (key: string) => {
    const slot = slotOf(key);
    if (!slot || opts.reducedMotion) return;
    const c = slot.corners();
    const centre = c[0].clone().add(c[2]).multiplyScalar(0.5);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(slot.photo.getWorldQuaternion(new THREE.Quaternion()));
    const pos = centre.clone().add(normal.multiplyScalar(2.3));
    pos.y += 0.1;
    goTo({ position: [pos.x, pos.y, pos.z], target: [centre.x, centre.y, centre.z], fov: cam.fov }, 0.55, "power2.in", false);
  };

  const resize = (w: number, h: number) => {
    width = Math.max(1, Math.round(w));
    height = Math.max(1, Math.round(h));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (station) {
      const to = cameraForStation(station);
      if (moving && camTween) goTo(to, Math.max(0.25, (camTween.duration() - camTween.time()) || 0.3));
      else goTo(to, 0);
    }
    invalidate();
  };

  const onLost = (e: Event) => {
    e.preventDefault();
    opts.onFail?.("context-lost");
  };
  canvas.addEventListener("webglcontextlost", onLost);

  return {
    set,
    hover,
    preview,
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
    stats: () => ({ textures: renderer.info.memory.textures, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tier, moving }),
    dispose: () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      camTween?.kill();
      lightTween?.kill();
      bookTl?.kill();
      wallTl?.kill();
      gsap.killTweensOf([room.logo, ...room.wall.map((s) => s.group.position)]);
      canvas.removeEventListener("webglcontextlost", onLost);
      for (const t of loaded.values()) t.dispose();
      loaded.clear();
      cache.clear();
      room.dispose();
      envRT.dispose();
      renderer.dispose();
    },
  };
}
