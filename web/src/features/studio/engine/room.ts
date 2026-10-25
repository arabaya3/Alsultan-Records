import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RECEPTION, ROOM, TABLE, WALL, wallSlotX } from "../poses";
import { night, radial } from "./textures";

/**
 * The studio room. The shell and the built pieces (desk, tables, frames, the album, the screen) are modelled here;
 * the props (desk lamp, vintage camera, lounge chair, side table, plants, bookshelf, brass vase) are CC0 models from
 * Poly Haven, and the surfaces use CC0 Poly Haven texture sets (colour + normal + roughness) — see
 * docs/studio-assets.md. Everything starts with matching flat colours, so the room is complete before any file
 * arrives; textures and props are swapped in as they load.
 */
export type Tier = "high" | "low";

/** A print hanging on a rope / on the wall. Its size follows the photo's own proportions (never cropped). */
export type FrameSlot = {
  group: THREE.Group;
  photo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  /** the largest photo area (w × h, metres) — the photo is fitted INSIDE it */
  box: [number, number];
  /** current photo size */
  size: [number, number];
  /** resize the print to a photo of aspect ratio w/h (contain) */
  fit: (aspect: number | null) => void;
  rest: { position: THREE.Vector3; rotZ: number };
  corners: () => THREE.Vector3[];
};

export type Book = {
  group: THREE.Group;
  /** hinge: rotation.z 0 = open, -π = closed */
  hinge: THREE.Group;
  rightPage: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  leftPage: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  /** page area (w × d) */
  page: [number, number];
  home: THREE.Vector3;
  /** keep the spine in step with the hinge */
  sync: () => void;
};

export type TextureSet = { color: THREE.Texture; normal?: THREE.Texture; rough?: THREE.Texture };
export type SurfaceName = "plaster" | "floor" | "walnut" | "leather";

export type Room = {
  root: THREE.Group;
  wall: FrameSlot[];
  reception: FrameSlot[];
  shelf: FrameSlot[];
  book: Book;
  screen: THREE.MeshBasicMaterial;
  logo: THREE.MeshBasicMaterial;
  lights: { videos: THREE.Light[]; ambient: THREE.HemisphereLight; dimmable: THREE.Light[]; base: Map<THREE.Light, number> };
  glows: THREE.Mesh[];
  /** surfaces: plaster, floor planks, walnut, leather (each optional; called as they load) */
  applySurface: (name: SurfaceName, set: TextureSet) => void;
  /** props from glTF, placed where they belong */
  placeProp: (name: PropName, gltf: GLTF) => void;
  dispose: () => void;
};

export type PropName = "desk_lamp_arm_01" | "vintage_video_camera" | "mid_century_lounge_chair" | "potted_plant_02" | "wooden_bookshelf_worn" | "side_table_01" | "brass_vase_01";
export const PROPS: PropName[] = ["desk_lamp_arm_01", "vintage_video_camera", "potted_plant_02", "brass_vase_01", "side_table_01", "mid_century_lounge_chair", "wooden_bookshelf_worn"];

const WARM = 0xffb877;
const WARM_SOFT = 0xffd2a3;

export function buildRoom(tier: Tier): Room {
  const root = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const shadows = tier === "high";

  const tGlow = keep(radial("rgba(255,196,128,0.6)", "rgba(255,196,128,0)"));
  const tShadow = keep(radial("rgba(0,0,0,0.62)", "rgba(0,0,0,0)"));
  const tNight = keep(night());

  const std = (p: THREE.MeshStandardMaterialParameters) => keep(new THREE.MeshStandardMaterial(p));
  // flat colours = the textured look's average, so nothing "pops" when the texture arrives
  const m = {
    wall: std({ color: 0x8c7867, roughness: 0.95 }),
    ceiling: std({ color: 0x1a1612, roughness: 1 }),
    floor: std({ color: 0x7a5236, roughness: 0.5, envMapIntensity: 0.7 }),
    walnut: std({ color: 0x6a4630, roughness: 0.58, envMapIntensity: 0.28 }),
    walnutDark: std({ color: 0x3e2a1d, roughness: 0.6, envMapIntensity: 0.3 }),
    leather: std({ color: 0x5a3220, roughness: 0.55, envMapIntensity: 0.5 }),
    brass: std({ color: 0xc9a062, roughness: 0.28, metalness: 1, envMapIntensity: 1.2 }),
    brassDull: std({ color: 0x9a7a4c, roughness: 0.45, metalness: 1 }),
    black: std({ color: 0x111010, roughness: 0.4, metalness: 0.3 }),
    blackMatte: std({ color: 0x151413, roughness: 0.85 }),
    paper: std({ color: 0xf1ead9, roughness: 0.92 }),
    rope: std({ color: 0x9c8058, roughness: 0.9 }),
    glass: std({ color: 0x0a0b0d, roughness: 0.06, metalness: 0.5 }),
    clip: std({ color: 0x2b2a28, roughness: 0.35, metalness: 0.8 }),
    lampGlow: keep(new THREE.MeshBasicMaterial({ color: 0xffe2b8 })),
    softbox: keep(new THREE.MeshBasicMaterial({ color: 0xf8f1e4 })),
    frame: std({ color: 0x24170f, roughness: 0.38, envMapIntensity: 0.7 }),
  };

  const box = (w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], r = 0) =>
    new THREE.Mesh(keep(r ? new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d)), mat);
  const cyl = (rt: number, rb: number, h: number, mat: THREE.Material, seg = 24) => new THREE.Mesh(keep(new THREE.CylinderGeometry(rt, rb, h, seg)), mat);
  const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const cast = (o: THREE.Object3D, receive = false) => {
    o.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = shadows;
      if (receive) mesh.receiveShadow = shadows;
    });
    return o;
  };
  /** soft contact shadow (darkened radial sprite) — grounds objects without shadow maps */
  const contact = (w: number, d: number, x: number, y: number, z: number, opacity = 1) => {
    const s = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, d)), keep(new THREE.MeshBasicMaterial({ map: tShadow, transparent: true, opacity, depthWrite: false })));
    s.rotation.x = -Math.PI / 2;
    s.renderOrder = 1;
    return at(s, x, y + 0.003, z);
  };
  const glows: THREE.Mesh[] = [];
  const glow = (w: number, h: number, x: number, y: number, z: number, ry: number, opacity = 0.6) => {
    const g = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(w, h)),
      keep(new THREE.MeshBasicMaterial({ map: tGlow, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })),
    );
    g.rotation.y = ry;
    g.renderOrder = 2;
    glows.push(g);
    return at(g, x, y, z);
  };

  // ------------------------------------------------------------------ shell
  const { w: W, d: D, h: H } = ROOM;
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(W, D)), m.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = shadows;
  root.add(floor);
  const ceil = new THREE.Mesh(keep(new THREE.PlaneGeometry(W, D)), m.ceiling);
  ceil.rotation.x = Math.PI / 2;
  at(ceil, 0, H, 0);
  const wallPlane = (len: number) => {
    const p = new THREE.Mesh(keep(new THREE.PlaneGeometry(len, H)), m.wall);
    p.receiveShadow = shadows;
    return p;
  };
  at(wallPlane(W), 0, H / 2, -D / 2);
  at(wallPlane(W), 0, H / 2, D / 2).rotation.y = Math.PI;
  at(wallPlane(D), -W / 2, H / 2, 0).rotation.y = Math.PI / 2;
  at(wallPlane(D), W / 2, H / 2, 0).rotation.y = -Math.PI / 2;

  // walnut wainscot with raised panels, brass cap rail, dark skirting — on all four walls
  const wains = (len: number, x: number, z: number, ry: number) => {
    const g = new THREE.Group();
    const back = box(len, 1.02, 0.03, m.walnutDark);
    back.position.set(0, 0.51, 0.015);
    g.add(back);
    const n = Math.max(1, Math.round(len / 1.3));
    const pw = len / n;
    for (let i = 0; i < n; i++) {
      const panel = box(pw - 0.14, 0.66, 0.03, m.walnut, 0.012);
      panel.position.set(-len / 2 + pw * (i + 0.5), 0.55, 0.035);
      panel.receiveShadow = shadows;
      g.add(panel);
    }
    const cap = box(len, 0.045, 0.07, m.walnutDark, 0.01);
    cap.position.set(0, 1.04, 0.035);
    g.add(cap);
    const rail = box(len, 0.012, 0.072, m.brass);
    rail.position.set(0, 1.068, 0.036);
    g.add(rail);
    const skirt = box(len, 0.14, 0.05, m.blackMatte);
    skirt.position.set(0, 0.07, 0.03);
    g.add(skirt);
    g.rotation.y = ry;
    return at(g, x, 0, z);
  };
  wains(W, 0, -D / 2, 0);
  wains(W, 0, D / 2, Math.PI);
  wains(D, -W / 2, 0, Math.PI / 2);
  wains(D, W / 2, 0, -Math.PI / 2);

  // brass track spots aimed at each corner (the ceiling stays plain and dark: nothing competes with the walls)
  const can = (x: number, z: number, aim: THREE.Vector3) => {
    const g = new THREE.Group();
    g.add(cyl(0.045, 0.06, 0.13, m.black, 18));
    const ring = cyl(0.062, 0.062, 0.012, m.brass, 18);
    ring.position.y = -0.065;
    g.add(ring);
    at(g, x, H - 0.16, z);
    g.lookAt(aim);
    g.rotateX(Math.PI / 2);
    return g;
  };

  // arched window (front wall, west) and the entrance door (front wall, east)
  const winW = 1.7;
  const winH = 2.5;
  const arch = new THREE.Shape();
  arch.moveTo(-winW / 2, 0);
  arch.lineTo(-winW / 2, winH - winW / 2);
  arch.absarc(0, winH - winW / 2, winW / 2, Math.PI, 0, true);
  arch.lineTo(winW / 2, 0);
  const winGeo = keep(new THREE.ShapeGeometry(arch, 24));
  const uv = winGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + winW / 2) / winW, uv.getY(i) / winH);
  const pane = new THREE.Mesh(winGeo, keep(new THREE.MeshBasicMaterial({ map: tNight })));
  pane.rotation.y = Math.PI;
  at(pane, -2.2, 1.15, D / 2 - 0.01);
  at(box(0.05, winH, 0.07, m.black), -2.2, 1.15 + winH / 2, D / 2 - 0.035);
  at(box(winW, 0.05, 0.07, m.black), -2.2, 1.15 + 1.2, D / 2 - 0.035);
  at(box(winW + 0.2, 0.07, 0.24, m.walnut, 0.015), -2.2, 1.12, D / 2 - 0.12);
  const door = new THREE.Group();
  door.add(box(1.2, 2.5, 0.07, m.walnutDark, 0.012));
  for (const y of [-0.55, 0.55]) {
    const p = box(0.9, 0.85, 0.02, m.walnut, 0.01);
    p.position.set(0, y, 0.045);
    door.add(p);
  }
  const handle = cyl(0.014, 0.014, 0.34, m.brass, 10);
  handle.position.set(-0.45, -0.05, 0.08);
  door.add(handle);
  door.rotation.y = Math.PI;
  at(door, 6.3, 1.25, D / 2 - 0.05);
  at(box(1.36, 0.1, 0.12, m.brass), 6.3, 2.55, D / 2 - 0.06);

  // rug under the album table (deep oxblood, double gold border)
  const rugTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const x = c.getContext("2d")!;
    x.fillStyle = "#47201a";
    x.fillRect(0, 0, 256, 256);
    x.strokeStyle = "rgba(205,160,92,0.6)";
    x.lineWidth = 4;
    x.strokeRect(14, 14, 228, 228);
    x.lineWidth = 1.5;
    x.strokeRect(26, 26, 204, 204);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return keep(t);
  })();
  const rug = new THREE.Mesh(keep(new THREE.PlaneGeometry(3.4, 2.4)), std({ map: rugTex, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.receiveShadow = shadows;
  at(rug, TABLE.x, 0.005, TABLE.z + 0.15);

  // ------------------------------------------------------------------ prints (frame follows the photo's proportions)
  const clipGeo = keep(new RoundedBoxGeometry(0.026, 0.06, 0.02, 2, 0.006));
  const barGeo = keep(new RoundedBoxGeometry(1, 1, 0.045, 2, 0.012));
  const unitPlane = keep(new THREE.PlaneGeometry(1, 1));
  const makeFrame = (boxW: number, boxH: number, parent: THREE.Object3D, opts: { clips?: boolean; moulding?: number; mat?: number } = {}): FrameSlot => {
    const g = new THREE.Group(); // origin = top centre (where it hangs from)
    const mould = opts.moulding ?? 0.05;
    const matW = opts.mat ?? 0.06;
    const bars = [0, 1, 2, 3].map(() => {
      const b = new THREE.Mesh(barGeo, m.frame);
      b.castShadow = shadows;
      g.add(b);
      return b;
    });
    const back = new THREE.Mesh(unitPlane, m.paper);
    g.add(back);
    const photo = new THREE.Mesh(unitPlane, std({ color: 0xe6dccb, roughness: 0.55, envMapIntensity: 0.3 }));
    g.add(photo);
    const clips: THREE.Mesh[] = [];
    if (opts.clips !== false) {
      for (let i = 0; i < 2; i++) {
        const c = new THREE.Mesh(clipGeo, m.clip);
        c.castShadow = shadows;
        g.add(c);
        clips.push(c);
      }
    }
    const slot: FrameSlot = {
      group: g,
      photo: photo as FrameSlot["photo"],
      box: [boxW, boxH],
      size: [boxW, boxH],
      rest: { position: new THREE.Vector3(), rotZ: 0 },
      fit: (aspect) => {
        // contain the photo in the box; mat and moulding wrap whatever size results
        let w = boxW;
        let h = boxH;
        if (aspect) {
          if (aspect > boxW / boxH) h = boxW / aspect;
          else w = boxH * aspect;
        }
        slot.size = [w, h];
        const ow = w + 2 * (matW + mould);
        const oh = h + 2 * (matW + mould);
        const cy = -oh / 2; // hangs from the top
        photo.scale.set(w, h, 1);
        photo.position.set(0, cy, 0.008);
        back.scale.set(w + 2 * matW, h + 2 * matW, 1);
        back.position.set(0, cy, 0.006);
        const [top, bottom, left, right] = bars;
        top.scale.set(ow, mould, 1);
        top.position.set(0, cy + oh / 2 - mould / 2, 0);
        bottom.scale.set(ow, mould, 1);
        bottom.position.set(0, cy - oh / 2 + mould / 2, 0);
        left.scale.set(mould, oh - 2 * mould, 1);
        left.position.set(-ow / 2 + mould / 2, cy, 0);
        right.scale.set(mould, oh - 2 * mould, 1);
        right.position.set(ow / 2 - mould / 2, cy, 0);
        clips.forEach((c, i) => c.position.set((i ? 1 : -1) * Math.min(0.3, ow * 0.3), 0.012, 0.014));
      },
      corners: () => {
        photo.updateWorldMatrix(true, false);
        return [
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.5],
          [-0.5, 0.5],
        ].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(photo.matrixWorld));
      },
    };
    slot.fit(null);
    parent.add(g);
    return slot;
  };

  /** A slightly sagging twisted rope between two brass hooks. */
  const ropeTex = (() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 8;
    const x = c.getContext("2d")!;
    x.fillStyle = "#a88a60";
    x.fillRect(0, 0, 64, 8);
    x.strokeStyle = "rgba(60,40,20,0.55)";
    x.lineWidth = 2;
    for (let i = -8; i < 72; i += 8) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i + 8, 8);
      x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return keep(t);
  })();
  const rope = (a: THREE.Vector3, b: THREE.Vector3, sag: number, parent: THREE.Object3D) => {
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= sag;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const tex = keep(ropeTex.clone());
    tex.repeat.set(a.distanceTo(b) * 40, 1);
    tex.needsUpdate = true;
    parent.add(new THREE.Mesh(keep(new THREE.TubeGeometry(curve, 64, 0.007, 8)), std({ map: tex, roughness: 0.9 })));
    for (const p of [a, b]) {
      const hook = new THREE.Mesh(keep(new THREE.TorusGeometry(0.02, 0.006, 8, 16)), m.brass);
      hook.position.copy(p);
      parent.add(hook);
      const plate = cyl(0.03, 0.03, 0.012, m.brass, 16);
      plate.rotation.x = Math.PI / 2;
      plate.position.set(p.x, p.y, p.z - 0.03);
      parent.add(plate);
    }
    return curve;
  };

  // ------------------------------------------------------------------ album wall (back)
  const wallGroup = at(new THREE.Group(), 0, 0, WALL.z);
  const span = (WALL.perGroup - 1) * WALL.spacing + 1.7;
  const wallRope = rope(new THREE.Vector3(-span / 2, WALL.ropeY, 0.06), new THREE.Vector3(span / 2, WALL.ropeY, 0.06), 0.08, wallGroup);
  const wall: FrameSlot[] = [];
  for (let i = 0; i < WALL.perGroup; i++) {
    const x = wallSlotX(i, WALL.perGroup);
    const p = wallRope.getPoint((x + span / 2) / span);
    const f = makeFrame(WALL.frameW, WALL.frameH, wallGroup);
    f.group.position.set(x, p.y - 0.01, 0.075);
    f.rest = { position: f.group.position.clone(), rotZ: 0 };
    wall.push(f);
    // picture light: brass bar on an arm + its pool of light on the plaster
    const bar = cyl(0.022, 0.022, 0.5, m.brass, 14);
    bar.rotation.z = Math.PI / 2;
    at(bar, x, WALL.ropeY + 0.36, 0.2, wallGroup);
    at(box(0.015, 0.015, 0.2, m.brass), x, WALL.ropeY + 0.36, 0.1, wallGroup);
    at(box(0.42, 0.006, 0.02, m.lampGlow), x, WALL.ropeY + 0.34, 0.205, wallGroup);
    glow(2.2, 2.7, x, WALL.frameY + 0.05, WALL.z + 0.02, 0, 0.5);
  }
  const bench = new THREE.Group();
  const seat = box(5.6, 0.07, 0.48, m.walnut, 0.02);
  seat.position.y = 0.46;
  bench.add(seat);
  for (const x of [-2.6, 2.6]) {
    const leg = box(0.07, 0.43, 0.42, m.walnutDark, 0.01);
    leg.position.set(x, 0.215, 0);
    bench.add(leg);
  }
  at(cast(bench), 0, 0, WALL.z + 0.62);
  contact(6.2, 1.1, 0, 0, WALL.z + 0.62);

  // ------------------------------------------------------------------ reception (east wall)
  const recGroup = at(new THREE.Group(), RECEPTION.x, 0, 0);
  recGroup.rotation.y = -Math.PI / 2; // local +x = world +z, faces into the room
  const plaque = box(2.9, 1.1, 0.07, m.walnutDark, 0.025);
  plaque.position.set(0, RECEPTION.logoY, 0.035);
  recGroup.add(plaque);
  const plaqueRim = box(2.98, 1.18, 0.05, m.brass, 0.02);
  plaqueRim.position.set(0, RECEPTION.logoY, 0.02);
  recGroup.add(plaqueRim);
  const logoMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  const logoMesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.15, 0.956)), logoMat);
  logoMesh.position.set(0, RECEPTION.logoY, 0.075);
  recGroup.add(logoMesh);
  glow(3.8, 2.0, RECEPTION.x - 0.02, RECEPTION.logoY, 0, -Math.PI / 2, 0.45);
  const recSpan = 6.2;
  const recRope = rope(new THREE.Vector3(-recSpan / 2, RECEPTION.frameY + 0.88, 0.06), new THREE.Vector3(recSpan / 2, RECEPTION.frameY + 0.88, 0.06), 0.07, recGroup);
  const reception: FrameSlot[] = [];
  RECEPTION.z.forEach((z) => {
    const p = recRope.getPoint((z + recSpan / 2) / recSpan);
    const f = makeFrame(RECEPTION.frameW, RECEPTION.frameH, recGroup);
    f.group.position.set(z, p.y - 0.01, 0.08);
    f.rest = { position: f.group.position.clone(), rotZ: 0 };
    reception.push(f);
    glow(1.9, 2.3, RECEPTION.x - 0.02, RECEPTION.frameY - 0.2, z, -Math.PI / 2, 0.42);
  });
  // the desk: walnut body with a fluted front, brass edge and kick, leather writing pad
  const desk = new THREE.Group();
  const deskBody = box(0.9, 0.98, 3.4, m.walnut, 0.03);
  deskBody.position.y = 0.51;
  desk.add(deskBody);
  const fluteGeo = keep(new THREE.CylinderGeometry(0.028, 0.028, 0.78, 10));
  for (let i = 0; i < 22; i++) {
    const flute = new THREE.Mesh(fluteGeo, m.walnutDark);
    flute.position.set(-0.455, 0.5, -1.55 + i * (3.1 / 21));
    desk.add(flute);
  }
  const deskTop = box(1.04, 0.05, 3.6, m.walnutDark, 0.02);
  deskTop.position.y = 1.025;
  desk.add(deskTop);
  const pad = box(0.66, 0.008, 1.2, m.leather, 0.004);
  pad.position.set(0.05, 1.054, 0.25);
  desk.add(pad);
  const edge = box(1.05, 0.012, 3.61, m.brass);
  edge.position.y = 1.0;
  desk.add(edge);
  const kick = box(0.92, 0.05, 3.42, m.brass);
  kick.position.y = 0.025;
  desk.add(kick);
  desk.scale.set(1, 0.92, 1);
  at(cast(desk, true), 6.85, 0, 0);
  contact(1.9, 4.3, 6.85, 0, 0);
  const sample = new THREE.Group();
  sample.add(box(0.62, 0.012, 0.42, m.leather, 0.004));
  for (const s of [-1, 1]) {
    const pages = box(0.29, 0.018, 0.4, m.paper, 0.003);
    pages.position.set(s * 0.155, 0.014, 0);
    sample.add(pages);
  }
  sample.rotation.y = 0.35;
  at(cast(sample), 6.75, 0.98, 0.55);
  contact(0.85, 0.6, 6.75, 0.97, 0.55, 0.8);

  // ------------------------------------------------------------------ album table + the album
  const table = new THREE.Group();
  const tTop = box(1.9, 0.055, 1.1, m.walnut, 0.02);
  tTop.position.y = TABLE.y - 0.0275;
  tTop.receiveShadow = shadows;
  table.add(tTop);
  for (const [x, z] of [
    [-0.84, -0.44],
    [0.84, -0.44],
    [-0.84, 0.44],
    [0.84, 0.44],
  ]) {
    const leg = cyl(0.03, 0.022, TABLE.y - 0.06, m.walnutDark, 12);
    leg.position.set(x, (TABLE.y - 0.06) / 2, z);
    table.add(leg);
    const shoe = cyl(0.024, 0.024, 0.03, m.brass, 12);
    shoe.position.set(x, 0.015, z);
    table.add(shoe);
  }
  const apron = box(1.74, 0.09, 0.94, m.walnutDark, 0.01);
  apron.position.y = TABLE.y - 0.1;
  table.add(apron);
  at(cast(table), TABLE.x, 0, TABLE.z);
  contact(2.6, 1.8, TABLE.x, 0, TABLE.z);

  // The album: back board + right page block; the hinge carries the left page block + front board.
  // Open (hinge 0): both blocks lie flat side by side. Closed (hinge -π): the left block folds exactly onto the right
  // one — so opening/closing never cuts through pages or the table.
  const PW = 0.46; // page width
  const PD = 0.62; // page depth (portrait pages)
  const T = 0.028; // page block thickness
  const C = 0.009; // board thickness
  const edgeTex = (() => {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 64;
    const x = c.getContext("2d")!;
    x.fillStyle = "#efe7d4";
    x.fillRect(0, 0, 8, 64);
    for (let y = 0; y < 64; y += 2) {
      x.fillStyle = y % 4 ? "rgba(120,100,70,0.18)" : "rgba(120,100,70,0.3)";
      x.fillRect(0, y, 8, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return keep(t);
  })();
  const edgeMat = std({ map: edgeTex, roughness: 0.95 });
  const block = () => {
    const b = box(PW - 0.006, T, PD - 0.012, [edgeMat, edgeMat, m.paper, m.paper, edgeMat, edgeMat]);
    b.castShadow = shadows;
    b.receiveShadow = shadows;
    return b;
  };
  const book = new THREE.Group();
  const backBoard = box(PW + 0.012, C, PD + 0.012, m.leather, 0.003);
  backBoard.position.set(PW / 2, C / 2, 0);
  book.add(backBoard);
  const rightBlock = block();
  rightBlock.position.set(PW / 2, C + T / 2, 0);
  book.add(rightBlock);
  const pageGeo = () => {
    const g = keep(new THREE.PlaneGeometry(1, 1, 10, 1));
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + 0.5; // 0 at the spine … 1 at the outer edge
      p.setZ(i, Math.sin(Math.min(1, u * 3) * Math.PI * 0.5) * 0.004 - (1 - u) * 0.001);
    }
    g.computeVertexNormals();
    return g;
  };
  const photoMat = () => std({ color: 0xe6dccb, roughness: 0.6, envMapIntensity: 0.25 });
  const rightPage = new THREE.Mesh(pageGeo(), photoMat());
  rightPage.rotation.x = -Math.PI / 2;
  rightPage.position.set(PW / 2, C + T + 0.0012, 0);
  book.add(rightPage);
  const hinge = new THREE.Group();
  hinge.position.set(0, C + T, 0);
  const leftBlock = block();
  leftBlock.position.set(-PW / 2, -T / 2, 0);
  hinge.add(leftBlock);
  const frontBoard = box(PW + 0.012, C, PD + 0.012, m.leather, 0.003);
  frontBoard.position.set(-PW / 2, -T - C / 2, 0);
  hinge.add(frontBoard);
  const emblem = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.2, 0.166)), logoMat);
  emblem.rotation.x = Math.PI / 2; // outer face of the front board (down when open, up when closed)
  emblem.position.set(-PW / 2, -T - C - 0.0006, 0);
  hinge.add(emblem);
  const leftPage = new THREE.Mesh(pageGeo(), photoMat());
  leftPage.rotation.x = -Math.PI / 2;
  leftPage.position.set(-PW / 2, 0.0012, 0);
  hinge.add(leftPage);
  book.add(hinge);
  // the spine: a half tube around the hinge; turning with half the hinge angle keeps it wrapped round both boards
  const spine = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(T + C, T + C, PD + 0.012, 18, 1, true, -Math.PI / 2, Math.PI)),
    std({ color: 0x3a2014, roughness: 0.6, side: THREE.DoubleSide }),
  );
  spine.rotation.x = Math.PI / 2;
  const spinePivot = new THREE.Group();
  spinePivot.position.copy(hinge.position);
  spinePivot.add(spine);
  book.add(spinePivot);
  const bookHome = new THREE.Vector3(TABLE.x, TABLE.y, TABLE.z + 0.05);
  at(cast(book), bookHome.x, bookHome.y, bookHome.z);
  const bookShadow = contact(1.25, 0.9, TABLE.x, TABLE.y, TABLE.z + 0.05, 0.9);
  book.userData.shadow = bookShadow;
  const sync = () => {
    spinePivot.rotation.z = hinge.rotation.z / 2;
  };

  // ------------------------------------------------------------------ screening corner (west wall)
  const screenMat = keep(new THREE.MeshBasicMaterial({ color: 0x222222 }));
  const scr = new THREE.Group();
  scr.add(box(3.8, 2.2, 0.08, m.black, 0.025));
  const screen = new THREE.Mesh(keep(new THREE.PlaneGeometry(3.6, 2.025)), screenMat);
  screen.position.z = 0.042;
  scr.add(screen);
  scr.rotation.y = Math.PI / 2;
  at(scr, -W / 2 + 0.09, 1.98, -0.6);
  glow(6, 3.8, -W / 2 + 0.02, 1.98, -0.6, Math.PI / 2, 0.2);
  at(cast(box(0.42, 0.42, 2.6, m.walnutDark, 0.02)), -W / 2 + 0.3, 0.21, -0.6);
  for (const z of [-2.85, 1.65]) {
    const sp = new THREE.Group();
    const cab = box(0.36, 1.12, 0.36, m.walnutDark, 0.02);
    cab.position.y = 0.56;
    sp.add(cab);
    for (const [y, r] of [
      [0.86, 0.075],
      [0.45, 0.12],
    ]) {
      const cone = cyl(r, r * 0.6, 0.03, m.black, 24);
      cone.rotation.z = Math.PI / 2;
      cone.position.set(0.18, y, 0);
      sp.add(cone);
      const ringS = new THREE.Mesh(keep(new THREE.TorusGeometry(r, 0.006, 6, 24)), m.brassDull);
      ringS.rotation.y = Math.PI / 2;
      ringS.position.set(0.19, y, 0);
      sp.add(ringS);
    }
    at(cast(sp), -W / 2 + 0.55, 0, z);
    contact(0.8, 0.8, -W / 2 + 0.55, 0, z);
  }

  // ------------------------------------------------------------------ packages table (front-west, by the window)
  const ptab = new THREE.Group();
  const pTop = box(3.0, 0.055, 0.95, m.walnut, 0.02);
  pTop.position.y = 0.78;
  pTop.receiveShadow = shadows;
  ptab.add(pTop);
  for (const x of [-1.32, 1.32]) {
    const leg = box(0.08, 0.75, 0.8, m.walnutDark, 0.012);
    leg.position.set(x, 0.375, 0);
    ptab.add(leg);
  }
  const stretcher = box(2.6, 0.05, 0.05, m.brass);
  stretcher.position.set(0, 0.2, 0);
  ptab.add(stretcher);
  at(cast(ptab), -4.4, 0, 4.45);
  contact(3.6, 1.4, -4.4, 0, 4.45);
  at(cast(box(0.52, 0.065, 0.4, m.leather, 0.01)), -3.35, 0.84, 4.5).rotation.y = -0.25;
  contact(0.8, 0.6, -3.35, 0.81, 4.5, 0.8);

  // ------------------------------------------------------------------ about corner (back wall, east): framed prints
  const shelfFrames: FrameSlot[] = [];
  [-4.2, -3.1].forEach((z) => {
    const f = makeFrame(0.62, 0.78, root, { clips: false, moulding: 0.045, mat: 0.05 });
    f.group.position.set(W / 2 - 0.03, 2.55, z);
    f.group.rotation.y = -Math.PI / 2;
    f.rest = { position: f.group.position.clone(), rotZ: 0 };
    shelfFrames.push(f);
    glow(1.4, 1.6, W / 2 - 0.02, 2.05, z, -Math.PI / 2, 0.35);
  });

  // ------------------------------------------------------------------ services corner (front-east): camera rig + softbox
  const cineCamera = () => {
    const g = new THREE.Group();
    g.add(box(0.16, 0.14, 0.26, m.black, 0.018));
    const top = box(0.12, 0.03, 0.2, m.blackMatte, 0.008);
    top.position.y = 0.085;
    g.add(top);
    const handleG = box(0.03, 0.03, 0.16, m.blackMatte, 0.01);
    handleG.position.y = 0.12;
    g.add(handleG);
    const lensPts = [
      [0.05, 0],
      [0.055, 0.02],
      [0.052, 0.12],
      [0.065, 0.14],
      [0.068, 0.2],
      [0.06, 0.22],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const lens = new THREE.Mesh(keep(new THREE.LatheGeometry(lensPts, 32)), m.black);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.13;
    g.add(lens);
    const focus = new THREE.Mesh(keep(new THREE.TorusGeometry(0.056, 0.006, 8, 32)), m.brassDull);
    focus.position.z = 0.2;
    g.add(focus);
    const glassF = cyl(0.055, 0.055, 0.004, m.glass, 32);
    glassF.rotation.x = Math.PI / 2;
    glassF.position.z = 0.351;
    g.add(glassF);
    const monitor = box(0.012, 0.09, 0.14, m.black, 0.004);
    monitor.position.set(0.1, 0.06, 0.02);
    g.add(monitor);
    return g;
  };
  const tripod = (h: number) => {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const leg = new THREE.Group();
      const upper = cyl(0.02, 0.018, h * 0.55, m.black, 8);
      upper.position.y = h * 0.275;
      leg.add(upper);
      const lower = cyl(0.014, 0.012, h * 0.5, m.blackMatte, 8);
      lower.position.y = -h * 0.2;
      leg.add(lower);
      const lock = cyl(0.025, 0.025, 0.03, m.brassDull, 8);
      lock.position.y = 0.02;
      leg.add(lock);
      leg.position.set(Math.cos(a) * 0.16, h * 0.45, Math.sin(a) * 0.16);
      leg.rotation.set(Math.sin(a) * 0.32, 0, -Math.cos(a) * 0.32);
      g.add(leg);
    }
    const headT = box(0.1, 0.07, 0.1, m.black, 0.01);
    headT.position.y = h * 0.95;
    g.add(headT);
    const panBar = cyl(0.01, 0.01, 0.35, m.black, 8);
    panBar.rotation.x = Math.PI / 2.4;
    panBar.position.set(0, h * 0.96, -0.18);
    g.add(panBar);
    return g;
  };
  const rig = tripod(1.35);
  const cine = cineCamera();
  cine.position.y = 1.47;
  rig.add(cine);
  at(cast(rig), 4.4, 0, 5.15).rotation.y = Math.PI + 0.6;
  contact(1.1, 1.1, 4.4, 0, 5.15);
  const stand = new THREE.Group();
  const pole = cyl(0.016, 0.02, 1.95, m.black, 8);
  pole.position.y = 0.975;
  stand.add(pole);
  const sb = box(0.8, 0.8, 0.34, m.black, 0.02);
  sb.position.y = 1.98;
  stand.add(sb);
  const sbFace = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.7, 0.7)), m.softbox);
  sbFace.position.set(0, 1.98, 0.175);
  stand.add(sbFace);
  at(cast(stand), 3.2, 0, 5.4).rotation.y = -2.9;
  contact(0.9, 0.9, 3.2, 0, 5.4);

  const kase = (w: number, h: number, d: number) => {
    const g = new THREE.Group();
    const body = box(w, h, d, m.blackMatte, 0.015);
    body.position.y = h / 2;
    g.add(body);
    const lid = box(w + 0.01, 0.03, d + 0.01, m.black, 0.01);
    lid.position.y = h * 0.72;
    g.add(lid);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [0, 1]) {
      const c = box(0.045, 0.045, 0.045, m.brass, 0.008);
      c.position.set((sx * w) / 2, sy * h, (sz * d) / 2);
      g.add(c);
    }
    const grip = box(0.16, 0.025, 0.03, m.brassDull, 0.01);
    grip.position.y = h + 0.02;
    g.add(grip);
    return cast(g);
  };
  at(kase(0.62, 0.36, 0.42), 5.2, 0, 5.45).rotation.y = 0.2;
  at(kase(0.5, 0.28, 0.34), 5.25, 0.36, 5.45).rotation.y = -0.1;
  at(kase(0.9, 0.22, 0.32), 3.0, 0, 4.95).rotation.y = -0.4;
  contact(1.2, 0.9, 5.2, 0, 5.45);
  contact(1.2, 0.7, 3.0, 0, 4.95);

  can(0, -3.6, new THREE.Vector3(0, 1.8, WALL.z));
  can(4.6, 0, new THREE.Vector3(7.9, 2, 0));
  can(-5.4, -0.6, new THREE.Vector3(-7.9, 2, -0.6));
  can(-4.4, 3.2, new THREE.Vector3(-4.4, 0.8, 4.4));
  can(5.6, -2.6, new THREE.Vector3(7.2, 1.6, -4.8));

  // ------------------------------------------------------------------ lights (warm, balanced: key per corner + room fill)
  const base = new Map<THREE.Light, number>();
  const ambient = new THREE.HemisphereLight(0xffe6c8, 0x2e1d12, 1.25);
  root.add(ambient);
  base.set(ambient, ambient.intensity);
  const spot = (pos: THREE.Vector3, aim: THREE.Vector3, intensity: number, angle: number, shadow = false, penumbra = 0.8) => {
    const l = new THREE.SpotLight(WARM, intensity, 16, angle, penumbra, 1.5);
    l.position.copy(pos);
    l.target.position.copy(aim);
    root.add(l, l.target);
    if (shadow && shadows) {
      l.castShadow = true;
      l.shadow.mapSize.set(1024, 1024);
      l.shadow.bias = -0.0003;
      l.shadow.normalBias = 0.02;
      l.shadow.camera.near = 0.5;
      l.shadow.camera.far = 12;
    }
    base.set(l, intensity);
    return l;
  };
  const point = (pos: THREE.Vector3, intensity: number, dist: number, color = WARM_SOFT) => {
    const l = new THREE.PointLight(color, intensity, dist, 1.6);
    l.position.copy(pos);
    root.add(l);
    base.set(l, intensity);
    return l;
  };
  const wallSpot = spot(new THREE.Vector3(0, 4.2, -2.4), new THREE.Vector3(0, 1.8, WALL.z), 140, 0.85);
  const recSpot = spot(new THREE.Vector3(3.9, 4.2, 0.6), new THREE.Vector3(7.6, 1.5, 0), 150, 0.8, true);
  const tableSpot = spot(new THREE.Vector3(TABLE.x + 0.5, 4.2, TABLE.z + 1.0), new THREE.Vector3(TABLE.x, TABLE.y, TABLE.z), 90, 0.42, true, 0.6);
  const pkgSpot = spot(new THREE.Vector3(-4.4, 4.2, 2.4), new THREE.Vector3(-4.4, 0.8, 4.45), 40, 0.7);
  const aboutSpot = spot(new THREE.Vector3(5.6, 4.2, -2.6), new THREE.Vector3(7.2, 1.6, -4.8), 90, 0.75);
  const fill = point(new THREE.Vector3(0, 3.4, 1.5), 18, 14, 0xffe0c0);
  const lampLight = point(new THREE.Vector3(7.0, 1.55, -1.25), 3.5, 3.5);
  const screenLight = point(new THREE.Vector3(-6.6, 1.9, -0.6), 6, 8, 0xc6d6ff);
  const svcLight = point(new THREE.Vector3(3.3, 1.95, 4.95), 7, 4.5, 0xfff3e2);
  const lights = [wallSpot, recSpot, tableSpot, pkgSpot, aboutSpot, fill, lampLight, screenLight, svcLight];
  if (tier === "low") {
    for (const l of [lampLight, svcLight, aboutSpot]) {
      l.visible = false;
      base.set(l, 0);
    }
    fill.intensity = 26;
    base.set(fill, 26);
  }

  // ------------------------------------------------------------------ surfaces & props (arrive later)
  const surfaces: Record<SurfaceName, THREE.MeshStandardMaterial[]> = {
    plaster: [m.wall],
    floor: [m.floor],
    walnut: [m.walnut, m.walnutDark, m.frame],
    leather: [m.leather],
  };
  const repeat: Record<SurfaceName, [number, number]> = { plaster: [5, 1.6], floor: [7, 5.25], walnut: [1, 1], leather: [1, 1] };
  const tint: Record<SurfaceName, number[]> = {
    plaster: [0x7d6a5a],
    floor: [0xb08a6c],
    walnut: [0x9c7458, 0x6a4c38, 0x4a3426],
    leather: [0xc49a82],
  };
  const applySurface: Room["applySurface"] = (name, set) => {
    surfaces[name].forEach((mat, i) => {
      const prep = (t: THREE.Texture | undefined, srgb: boolean) => {
        if (!t) return null;
        const c = keep(t.clone());
        c.wrapS = c.wrapT = THREE.RepeatWrapping;
        c.repeat.set(...repeat[name]);
        c.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        c.anisotropy = 4;
        c.needsUpdate = true;
        return c;
      };
      mat.map = prep(set.color, true);
      mat.normalMap = prep(set.normal, false);
      // roughness stays a calibrated constant: the CC0 roughness maps are authored for other lighting and made the
      // varnished surfaces mirror-like under this room's environment light (white sheen on tables and floor)
      if (name === "plaster") mat.roughnessMap = prep(set.rough, false);
      if (name === "floor") mat.normalScale.set(0.6, 0.6);
      mat.color.set(tint[name][i] ?? tint[name][0]);
      mat.needsUpdate = true;
    });
  };

  const placed: Record<PropName, (s: THREE.Object3D) => void> = {
    potted_plant_02: (s) => {
      for (const [x, z, k, r] of [
        [-3.1, 5.35, 1.9, 0.3],
        [5.2, -5.4, 1.7, 1.2],
        [-7.3, -3.5, 1.6, 2.2],
        [7.25, 3.0, 1.5, 0.7],
      ]) {
        const c = s.clone();
        c.scale.setScalar(k);
        c.rotation.y = r;
        at(cast(c), x, 0, z);
        contact(1.2, 1.2, x, 0, z);
      }
    },
    desk_lamp_arm_01: (s) => {
      const a = s.clone();
      a.scale.setScalar(0.95);
      a.rotation.y = -Math.PI / 2 - 0.5;
      at(cast(a), 7.0, 0.97, -1.25);
      const b = s.clone();
      b.rotation.y = 0.6;
      at(cast(b), -5.6, 0.81, 4.6);
      const c = s.clone();
      c.scale.setScalar(0.9);
      c.rotation.y = Math.PI * 0.85;
      at(cast(c), TABLE.x - 0.75, TABLE.y, TABLE.z - 0.32);
    },
    vintage_video_camera: (s) => {
      const a = s.clone();
      a.scale.setScalar(1.9);
      a.rotation.y = -2.3;
      at(cast(a), 6.7, 0.97, -0.55);
      const b = s.clone();
      b.scale.setScalar(2.1);
      b.rotation.y = Math.PI + 0.4;
      at(cast(b), -4.3, 0.81, 4.4);
      const c = s.clone();
      c.scale.setScalar(1.35);
      c.rotation.y = 0.9;
      at(cast(c), TABLE.x + 0.62, TABLE.y, TABLE.z - 0.3);
    },
    brass_vase_01: (s) => {
      const a = s.clone();
      a.scale.setScalar(0.6);
      at(cast(a), 6.95, 0.97, 1.45);
      const b = s.clone();
      b.scale.setScalar(0.55);
      at(cast(b), -4.9, 0.55, 0.45);
    },
    side_table_01: (s) => {
      at(cast(s.clone()), -4.9, 0, 0.45);
      contact(0.8, 0.7, -4.9, 0, 0.45);
    },
    mid_century_lounge_chair: (s) => {
      const a = s.clone();
      a.rotation.y = -Math.PI / 2 - 0.25; // faces the screen
      at(cast(a), -4.75, 0, -0.55);
      contact(1.5, 1.5, -4.75, 0, -0.55);
      const b = s.clone();
      b.rotation.y = -2.3; // beside the shelf, facing into the room
      at(cast(b), 5.0, 0, -4.7);
      contact(1.4, 1.4, 5.0, 0, -4.7);
    },
    wooden_bookshelf_worn: (s) => {
      const a = s.clone();
      a.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mt = (mesh.material as THREE.MeshStandardMaterial).clone();
        mt.color.multiplyScalar(0.55); // stained walnut-dark, like the rest of the furniture
        mesh.material = keep(mt);
      });
      a.scale.setScalar(1.1);
      // rows of books on four shelves (muted cloth colours, gold-tooled spines)
      const palette = [0x3b2a1f, 0x22303a, 0x4a1f1c, 0x2f3326, 0x5a4630, 0x1d1b19, 0x6b5236];
      const bookMats = palette.map((c) => std({ color: c, roughness: 0.75 }));
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (const y of [0.5, 0.98, 1.46, 1.94]) {
        let x = -0.68;
        while (x < 0.62) {
          const w = 0.03 + rnd() * 0.035;
          const h = 0.26 + rnd() * 0.12;
          const bk = box(w, h, 0.2 + rnd() * 0.05, bookMats[Math.floor(rnd() * bookMats.length)], 0.004);
          bk.position.set(x + w / 2, y + h / 2, 0);
          if (rnd() < 0.08) bk.rotation.z = 0.12;
          a.add(bk);
          x += w + 0.004;
          if (rnd() < 0.06) x += 0.12;
        }
      }
      at(cast(a), 6.55, 0, -D / 2 + 0.36);
      contact(1.8, 0.8, 6.55, 0, -D / 2 + 0.42);
    },
  };
  const placeProp: Room["placeProp"] = (name, gltf) => placed[name]?.(gltf.scene);

  return {
    root,
    wall,
    reception,
    shelf: shelfFrames,
    book: { group: book, hinge, rightPage, leftPage, page: [PW - 0.05, PD - 0.06], home: bookHome, sync },
    screen: screenMat,
    logo: logoMat,
    lights: { videos: [screenLight], ambient, dimmable: lights.filter((l) => l !== screenLight), base },
    glows,
    applySurface,
    placeProp,
    dispose: () => {
      for (const d of disposables) d.dispose();
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mt of mats) mt?.dispose();
      });
    },
  };
}
