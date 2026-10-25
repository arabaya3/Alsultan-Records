import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RECEPTION, ROOM, TABLE, WALL, wallSlotX } from "../poses";
import { bookSpines, leather, night, paper, plaster, radial, walnut } from "./textures";

/**
 * The studio room, built from code (no downloaded models): every object is made of simple primitives with
 * physically based materials and procedural textures, so the room is light (no model files), licence-free and
 * easy to refine. Shapes are deliberately restrained — furniture silhouettes, not hero props.
 *
 * Returns handles the engine animates: hanging frames (album wall + reception), the album on the table, the
 * screening screen, the logo plaque, and the lights grouped by corner.
 */
export type Tier = "high" | "low";

export type FrameSlot = {
  group: THREE.Group;
  photo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  size: [number, number];
  rest: { position: THREE.Vector3; rotZ: number };
  /** world-space corners of the photo (for projecting the HTML hotspot over it) */
  corners: () => THREE.Vector3[];
};

export type Book = {
  group: THREE.Group;
  cover: THREE.Group; // hinged at the spine; rotation.z: 0 closed → Math.PI open
  rightPage: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  leftPage: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  home: THREE.Vector3;
  size: [number, number];
};

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
  dispose: () => void;
};

const WARM = 0xffb36b;
const WARM_SOFT = 0xffc996;

export function buildRoom(tier: Tier): Room {
  const root = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

  // ---------------------------------------------------------------- materials
  const tPlaster = keep(plaster());
  const tFloor = keep(walnut(true));
  tFloor.repeat.set(7, 5);
  const tBoard = keep(walnut(false));
  const tLeather = keep(leather());
  const tPaper = keep(paper());
  const tGlow = keep(radial("rgba(255,190,120,0.55)", "rgba(255,190,120,0)"));
  const tShadow = keep(radial("rgba(0,0,0,0.55)", "rgba(0,0,0,0)"));
  const tNight = keep(night());

  const m = {
    wall: keep(new THREE.MeshStandardMaterial({ map: tPlaster, roughness: 0.96, metalness: 0, color: 0xb9ab98 })),
    ceiling: keep(new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 1 })),
    floor: keep(new THREE.MeshStandardMaterial({ map: tFloor, roughness: 0.48, metalness: 0, color: 0xc9b29a, envMapIntensity: 0.6 })),
    walnut: keep(new THREE.MeshStandardMaterial({ map: tBoard, roughness: 0.5, metalness: 0, color: 0xd4b79a, envMapIntensity: 0.55 })),
    walnutDark: keep(new THREE.MeshStandardMaterial({ map: tBoard, roughness: 0.62, color: 0x8c735e })),
    brass: keep(new THREE.MeshStandardMaterial({ color: 0xc19a5b, roughness: 0.32, metalness: 1, envMapIntensity: 1.1 })),
    brassDull: keep(new THREE.MeshStandardMaterial({ color: 0x8f7347, roughness: 0.5, metalness: 1 })),
    black: keep(new THREE.MeshStandardMaterial({ color: 0x0d0c0b, roughness: 0.45, metalness: 0.25 })),
    blackMatte: keep(new THREE.MeshStandardMaterial({ color: 0x121110, roughness: 0.85 })),
    leather: keep(new THREE.MeshStandardMaterial({ map: tLeather, roughness: 0.62, color: 0xb08870, envMapIntensity: 0.5 })),
    paper: keep(new THREE.MeshStandardMaterial({ map: tPaper, roughness: 0.9, color: 0xffffff })),
    rope: keep(new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.95 })),
    glass: keep(new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.08, metalness: 0.4 })),
    lampShade: keep(new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide })),
    lampGlow: keep(new THREE.MeshBasicMaterial({ color: 0xffd9a8 })),
    leaf: keep(new THREE.MeshStandardMaterial({ color: 0x5d6b3c, roughness: 0.75, side: THREE.DoubleSide, alphaTest: 0.5 })),
    pot: keep(new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.75 })),
    softbox: keep(new THREE.MeshBasicMaterial({ color: 0xf6efe2 })),
  };

  const box = (w: number, h: number, d: number, mat: THREE.Material, r = 0) =>
    new THREE.Mesh(keep(r ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d)), mat);
  const cyl = (rt: number, rb: number, h: number, mat: THREE.Material, seg = 24) => new THREE.Mesh(keep(new THREE.CylinderGeometry(rt, rb, h, seg)), mat);
  const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const shadowCast = (o: THREE.Object3D) => {
    if (tier !== "high") return o;
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) c.castShadow = true;
    });
    return o;
  };
  /** Soft contact shadow under an object (a darkened radial sprite on the floor / table). */
  const contact = (w: number, d: number, x: number, y: number, z: number) => {
    const s = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, d)), keep(new THREE.MeshBasicMaterial({ map: tShadow, transparent: true, depthWrite: false })));
    s.rotation.x = -Math.PI / 2;
    return at(s, x, y + 0.002, z);
  };
  const glows: THREE.Mesh[] = [];
  /** Warm light pool on a wall (additive sprite): picture lights, sconces — reads as light without a real light. */
  const glow = (w: number, h: number, x: number, y: number, z: number, ry: number, opacity = 0.7) => {
    const g = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(w, h)),
      keep(new THREE.MeshBasicMaterial({ map: tGlow, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })),
    );
    g.rotation.y = ry;
    glows.push(g);
    return at(g, x, y, z);
  };

  // ---------------------------------------------------------------- shell
  const { w: W, d: D, h: H } = ROOM;
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(W, D)), m.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = tier === "high";
  root.add(floor);
  const ceil = new THREE.Mesh(keep(new THREE.PlaneGeometry(W, D)), m.ceiling);
  ceil.rotation.x = Math.PI / 2;
  at(ceil, 0, H, 0);
  // walls: back (z-), front (z+), west (x-), east (x+)
  const wallPlane = (len: number) => new THREE.Mesh(keep(new THREE.PlaneGeometry(len, H)), m.wall);
  const back = at(wallPlane(W), 0, H / 2, -D / 2);
  back.receiveShadow = tier === "high";
  const front = at(wallPlane(W), 0, H / 2, D / 2);
  front.rotation.y = Math.PI;
  const west = at(wallPlane(D), -W / 2, H / 2, 0);
  west.rotation.y = Math.PI / 2;
  const east = at(wallPlane(D), W / 2, H / 2, 0);
  east.rotation.y = -Math.PI / 2;
  east.receiveShadow = tier === "high";

  // walnut wainscot (1 m), brass cap rail, dark skirting — on all four walls
  const wains = (len: number, x: number, z: number, ry: number) => {
    const g = new THREE.Group();
    const panel = box(len, 1.0, 0.04, m.walnutDark);
    panel.position.set(0, 0.5, 0.02);
    g.add(panel);
    const rail = box(len, 0.035, 0.06, m.brass);
    rail.position.set(0, 1.02, 0.03);
    g.add(rail);
    const skirt = box(len, 0.12, 0.06, m.blackMatte);
    skirt.position.set(0, 0.06, 0.03);
    g.add(skirt);
    // vertical panel joints every ~1.2 m
    for (let i = -len / 2 + 0.6; i < len / 2; i += 1.2) {
      const j = box(0.02, 0.86, 0.05, m.black);
      j.position.set(i, 0.53, 0.025);
      g.add(j);
    }
    g.rotation.y = ry;
    return at(g, x, 0, z);
  };
  wains(W, 0, -D / 2, 0);
  wains(W, 0, D / 2, Math.PI);
  wains(D, -W / 2, 0, Math.PI / 2);
  wains(D, W / 2, 0, -Math.PI / 2);

  // ceiling beams + a brass track with spot cans over each corner
  for (let z = -D / 2 + 1.5; z < D / 2; z += 3) at(box(W, 0.22, 0.24, m.walnutDark), 0, H - 0.11, z);
  const can = (x: number, z: number, aim: THREE.Vector3) => {
    const c = cyl(0.05, 0.065, 0.14, m.black, 16);
    at(c, x, H - 0.12, z);
    c.lookAt(aim);
    c.rotateX(Math.PI / 2);
    const ring = cyl(0.092, 0.092, 0.02, m.brass, 16);
    c.add(ring);
    ring.position.y = -0.1;
    return c;
  };

  // arched window on the front wall (west side) with the night outside, and the entrance door (east side)
  const winW = 1.7;
  const winH = 2.5;
  const arch = new THREE.Shape();
  arch.moveTo(-winW / 2, 0);
  arch.lineTo(-winW / 2, winH - winW / 2);
  arch.absarc(0, winH - winW / 2, winW / 2, Math.PI, 0, true);
  arch.lineTo(winW / 2, 0);
  arch.lineTo(-winW / 2, 0);
  const winGeo = keep(new THREE.ShapeGeometry(arch, 24));
  const uv = winGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + winW / 2) / winW, uv.getY(i) / winH);
  const pane = new THREE.Mesh(winGeo, keep(new THREE.MeshBasicMaterial({ map: tNight })));
  pane.rotation.y = Math.PI;
  at(pane, -2.2, 1.15, D / 2 - 0.01);
  // mullions
  at(box(0.04, winH, 0.06, m.black), -2.2, 1.15 + winH / 2, D / 2 - 0.03);
  at(box(winW, 0.04, 0.06, m.black), -2.2, 1.15 + 1.2, D / 2 - 0.03);
  at(box(winW + 0.16, 0.08, 0.2, m.walnut), -2.2, 1.11, D / 2 - 0.1); // sill
  // door
  at(box(1.15, 2.45, 0.06, m.walnutDark, 0.01), 6.3, 1.225, D / 2 - 0.04);
  at(box(1.3, 0.08, 0.1, m.brass), 6.3, 2.5, D / 2 - 0.05);
  at(cyl(0.015, 0.015, 0.28, m.brass, 8), 5.85, 1.1, D / 2 - 0.1);

  // big rug under the album table
  const rugTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const x = c.getContext("2d")!;
    x.fillStyle = "#3a1d18";
    x.fillRect(0, 0, 256, 256);
    x.strokeStyle = "rgba(196,150,84,0.55)";
    x.lineWidth = 3;
    x.strokeRect(14, 14, 228, 228);
    x.lineWidth = 1.2;
    x.strokeRect(24, 24, 208, 208);
    x.strokeStyle = "rgba(20,10,8,0.6)";
    for (let i = 0; i < 256; i += 3) {
      x.beginPath();
      x.moveTo(0, i);
      x.lineTo(256, i + 1);
      x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return keep(t);
  })();
  const rug = new THREE.Mesh(keep(new THREE.PlaneGeometry(4.2, 3.0)), keep(new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 })));
  rug.rotation.x = -Math.PI / 2;
  rug.receiveShadow = tier === "high";
  at(rug, TABLE.x, 0.004, TABLE.z + 0.2);

  // ---------------------------------------------------------------- hanging frames
  const clipGeo = keep(new THREE.BoxGeometry(0.03, 0.08, 0.025));
  const makeFrame = (fw: number, fh: number, parent: THREE.Object3D, matColor = 0x1b1511): FrameSlot => {
    const g = new THREE.Group();
    const border = 0.045;
    const mat = 0.07;
    const frame = box(fw + (border + mat) * 2, fh + (border + mat) * 2, 0.035, keep(new THREE.MeshStandardMaterial({ color: matColor, roughness: 0.55, metalness: 0.2 })));
    frame.position.z = -0.018;
    g.add(frame);
    const matte = new THREE.Mesh(keep(new THREE.PlaneGeometry(fw + mat * 2, fh + mat * 2)), m.paper);
    matte.position.z = 0.0005;
    g.add(matte);
    const photo = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(fw, fh)),
      keep(new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.55, metalness: 0, envMapIntensity: 0.35 })),
    );
    photo.position.z = 0.002;
    g.add(photo);
    // two clips at the top, and their strings up to the rope (the group's origin is at the rope)
    for (const sx of [-1, 1]) {
      const clip = new THREE.Mesh(clipGeo, m.walnut);
      clip.position.set(sx * fw * 0.32, fh / 2 + border + mat + 0.02, 0.005);
      g.add(clip);
    }
    const fullH = fh + (border + mat) * 2;
    g.children.forEach((c) => (c.position.y -= fullH / 2 + 0.04));
    parent.add(g);
    return {
      group: g,
      photo,
      size: [fw, fh],
      rest: { position: new THREE.Vector3(), rotZ: 0 },
      corners: () => {
        photo.updateWorldMatrix(true, false);
        return [
          [-fw / 2, -fh / 2],
          [fw / 2, -fh / 2],
          [fw / 2, fh / 2],
          [-fw / 2, fh / 2],
        ].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(photo.matrixWorld));
      },
    };
  };
  /** A sagging rope between two brass hooks (catenary-ish curve). */
  const rope = (a: THREE.Vector3, b: THREE.Vector3, sag: number, parent: THREE.Object3D = root) => {
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= sag;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const tube = new THREE.Mesh(keep(new THREE.TubeGeometry(curve, 48, 0.008, 6)), m.rope);
    parent.add(tube);
    for (const p of [a, b]) {
      const hook = cyl(0.025, 0.025, 0.05, m.brass, 12);
      hook.rotation.x = Math.PI / 2;
      hook.position.copy(p);
      parent.add(hook);
    }
    return curve;
  };

  // album wall (back): one long rope, five slots; picture lights above
  const wallGroup = at(new THREE.Group(), 0, 0, WALL.z);
  const span = (WALL.perGroup - 1) * WALL.spacing + 1.6;
  const wallRope = rope(new THREE.Vector3(-span / 2, WALL.ropeY, 0.04), new THREE.Vector3(span / 2, WALL.ropeY, 0.04), 0.1, wallGroup);
  const wall: FrameSlot[] = [];
  for (let i = 0; i < WALL.perGroup; i++) {
    const x = wallSlotX(i, WALL.perGroup);
    const t = (x + span / 2) / span;
    const p = wallRope.getPoint(t);
    const f = makeFrame(WALL.frameW, WALL.frameH, wallGroup);
    f.group.position.set(x, p.y, 0.07);
    f.group.rotation.z = (i % 2 ? 1 : -1) * 0.012;
    f.rest = { position: f.group.position.clone(), rotZ: f.group.rotation.z };
    wall.push(f);
    // picture light: a small brass bar above the rope + its light pool on the plaster
    const bar = cyl(0.025, 0.025, 0.42, m.brass, 12);
    bar.rotation.z = Math.PI / 2;
    at(bar, x, WALL.ropeY + 0.42, 0.12, wallGroup);
    at(box(0.02, 0.12, 0.08, m.brassDull), x, WALL.ropeY + 0.48, 0.06, wallGroup);
    const pool = glow(1.9, 2.4, x, WALL.frameY + 0.1, WALL.z + 0.02, 0, 0.42);
    pool.renderOrder = 1;
  }
  // a low walnut bench under the wall
  at(box(5.4, 0.08, 0.5, m.walnut, 0.02), 0, 0.46, WALL.z + 0.6);
  for (const x of [-2.5, 2.5]) at(box(0.08, 0.42, 0.42, m.black), x, 0.21, WALL.z + 0.6);
  contact(6, 1.0, 0, 0, WALL.z + 0.6);

  // reception (east wall): logo plaque with a soft backlight, three frames on a rope, the desk
  const recGroup = at(new THREE.Group(), RECEPTION.x, 0, 0);
  recGroup.rotation.y = -Math.PI / 2; // faces -x (into the room)
  const plaque = box(2.6, 1.05, 0.06, m.walnutDark, 0.02);
  plaque.position.set(0, RECEPTION.logoY, 0.03);
  recGroup.add(plaque);
  const logoMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  const logoMesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.08, 0.9)), logoMat);
  logoMesh.position.set(0, RECEPTION.logoY, 0.065);
  recGroup.add(logoMesh);
  glow(3.4, 1.9, RECEPTION.x - 0.02, RECEPTION.logoY, 0, -Math.PI / 2, 0.5);
  const recSpan = 5.0;
  const recRope = rope(new THREE.Vector3(-recSpan / 2, RECEPTION.frameY + 0.95, 0.05), new THREE.Vector3(recSpan / 2, RECEPTION.frameY + 0.95, 0.05), 0.08, recGroup);
  const reception: FrameSlot[] = [];
  RECEPTION.z.forEach((z, i) => {
    // recGroup is rotated -90° about y: its local +x runs along world +z
    const lx = z;
    const p = recRope.getPoint((lx + recSpan / 2) / recSpan);
    const f = makeFrame(RECEPTION.frameW, RECEPTION.frameH, recGroup);
    f.group.position.set(lx, p.y, 0.08);
    f.group.rotation.z = (i - 1) * 0.01;
    f.rest = { position: f.group.position.clone(), rotZ: f.group.rotation.z };
    reception.push(f);
    glow(1.7, 2.0, RECEPTION.x - 0.02, RECEPTION.frameY, z, -Math.PI / 2, 0.38);
  });
  // desk: walnut body, brass kick, dark leather top
  const desk = new THREE.Group();
  const deskBody = box(1.0, 1.0, 3.6, m.walnut, 0.03);
  deskBody.position.y = 0.5;
  desk.add(deskBody);
  const deskTop = box(1.12, 0.05, 3.75, m.leather, 0.015);
  deskTop.position.y = 1.025;
  desk.add(deskTop);
  const kick = box(1.02, 0.06, 3.62, m.brass);
  kick.position.y = 0.04;
  desk.add(kick);
  for (const z of [-1.2, 0, 1.2]) {
    const fl = box(0.02, 0.8, 0.9, m.walnutDark);
    fl.position.set(-0.51, 0.52, z);
    desk.add(fl);
  }
  at(shadowCast(desk), 6.05, 0, 0);
  contact(1.8, 4.4, 6.05, 0, 0);
  // camera on the desk
  const camera = (scale = 1) => {
    const g = new THREE.Group();
    const body = box(0.15 * scale, 0.1 * scale, 0.085 * scale, m.black, 0.012 * scale);
    g.add(body);
    const grip = box(0.04 * scale, 0.1 * scale, 0.09 * scale, m.blackMatte, 0.012 * scale);
    grip.position.x = -0.07 * scale;
    g.add(grip);
    const hump = box(0.06 * scale, 0.035 * scale, 0.06 * scale, m.black, 0.01 * scale);
    hump.position.y = 0.06 * scale;
    g.add(hump);
    const lens = cyl(0.036 * scale, 0.038 * scale, 0.11 * scale, m.black, 28);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.09 * scale;
    g.add(lens);
    const ring = cyl(0.039 * scale, 0.039 * scale, 0.012 * scale, m.brassDull, 28);
    ring.rotation.x = Math.PI / 2;
    ring.position.z = 0.12 * scale;
    g.add(ring);
    const glassFront = cyl(0.03 * scale, 0.03 * scale, 0.003, m.glass, 28);
    glassFront.rotation.x = Math.PI / 2;
    glassFront.position.z = 0.146 * scale;
    g.add(glassFront);
    return shadowCast(g);
  };
  const deskCam = at(camera(1.4), 5.85, 1.12, -1.15);
  deskCam.rotation.y = -2.2;
  // brass desk lamp
  const lamp = (x: number, y: number, z: number, h = 0.5) => {
    const g = new THREE.Group();
    const base = cyl(0.09, 0.11, 0.025, m.brass, 24);
    g.add(base);
    const stem = cyl(0.012, 0.012, h, m.brass, 8);
    stem.position.y = h / 2;
    g.add(stem);
    const shade = new THREE.Mesh(keep(new THREE.ConeGeometry(0.16, 0.16, 28, 1, true)), m.lampShade);
    shade.position.y = h;
    g.add(shade);
    const bulb = new THREE.Mesh(keep(new THREE.SphereGeometry(0.035, 12, 8)), m.lampGlow);
    bulb.position.y = h - 0.04;
    g.add(bulb);
    return at(shadowCast(g), x, y, z);
  };
  lamp(6.2, 1.05, 1.35, 0.46);
  // a small open sample album on the desk (paper, no photo)
  const sample = box(0.5, 0.025, 0.36, m.paper, 0.005);
  at(sample, 6.0, 1.065, 0.45).rotation.y = 0.3;
  contact(0.7, 0.55, 6.0, 1.05, 0.45);

  // ---------------------------------------------------------------- album table + book
  const table = new THREE.Group();
  const top = box(2.6, 0.06, 1.5, m.walnut, 0.025);
  top.position.y = TABLE.y - 0.03;
  table.add(top);
  for (const [x, z] of [
    [-1.15, -0.6],
    [1.15, -0.6],
    [-1.15, 0.6],
    [1.15, 0.6],
  ]) {
    const leg = box(0.07, TABLE.y - 0.06, 0.07, m.walnutDark);
    leg.position.set(x, (TABLE.y - 0.06) / 2, z);
    table.add(leg);
  }
  const apron = box(2.4, 0.1, 1.32, m.walnutDark);
  apron.position.y = TABLE.y - 0.11;
  table.add(apron);
  at(shadowCast(table), TABLE.x, 0, TABLE.z);
  table.traverse((c) => ((c as THREE.Mesh).receiveShadow = tier === "high"));
  contact(3.2, 2.1, TABLE.x, 0, TABLE.z);
  lamp(TABLE.x - 1.05, TABLE.y, TABLE.z - 0.5, 0.42);
  const tableCam = at(camera(1.2), TABLE.x - 0.8, TABLE.y + 0.06, TABLE.z + 0.4);
  tableCam.rotation.y = -0.6;

  const BW = 0.42;
  const BD = 0.56;
  const book = new THREE.Group();
  const backCover = box(BW, 0.014, BD, m.leather, 0.004);
  backCover.position.set(BW / 2, 0.007, 0);
  book.add(backCover);
  const block = box(BW - 0.02, 0.04, BD - 0.02, m.paper, 0.003);
  block.position.set(BW / 2, 0.034, 0);
  book.add(block);
  const pageGeo = (w: number, d: number) => {
    const g = keep(new THREE.PlaneGeometry(w, d, 12, 1));
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const u = (p.getX(i) + w / 2) / w; // 0 at spine side … 1 outer edge
      p.setZ(i, Math.sin(u * Math.PI) * 0.006 + (1 - u) * 0.004);
    }
    g.computeVertexNormals();
    return g;
  };
  const photoMat = () => keep(new THREE.MeshStandardMaterial({ color: 0xe9e1d2, roughness: 0.6, envMapIntensity: 0.3 }));
  const rightPage = new THREE.Mesh(pageGeo(BW - 0.08, BD - 0.08), photoMat());
  rightPage.rotation.x = -Math.PI / 2;
  rightPage.position.set(BW / 2, 0.0555, 0);
  book.add(rightPage);
  const cover = new THREE.Group(); // pivot on the spine (x = 0)
  const coverBoard = box(BW, 0.014, BD, m.leather, 0.004);
  coverBoard.position.set(BW / 2, 0, 0);
  cover.add(coverBoard);
  const emblem = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.18, 0.15)), logoMat);
  emblem.rotation.x = -Math.PI / 2;
  emblem.position.set(BW / 2, 0.0075, 0);
  cover.add(emblem);
  const leftPage = new THREE.Mesh(pageGeo(BW - 0.08, BD - 0.08), photoMat());
  leftPage.rotation.x = Math.PI / 2; // faces down while closed, up once the cover is open
  leftPage.rotation.z = Math.PI;
  leftPage.position.set(BW / 2, -0.0085, 0);
  cover.add(leftPage);
  cover.position.set(0, 0.062, 0);
  book.add(cover);
  const spine = cyl(0.03, 0.03, BD, m.leather, 12);
  spine.rotation.x = Math.PI / 2;
  spine.position.set(0, 0.03, 0);
  book.add(spine);
  const bookHome = new THREE.Vector3(TABLE.x, TABLE.y, TABLE.z + 0.05);
  at(shadowCast(book), bookHome.x, bookHome.y, bookHome.z);
  const bookShadow = contact(1.6, 0.8, TABLE.x, TABLE.y, TABLE.z + 0.05);
  book.userData.shadow = bookShadow;

  // ---------------------------------------------------------------- screening corner (west wall)
  const screenMat = keep(new THREE.MeshBasicMaterial({ color: 0x222222 }));
  const scr = new THREE.Group();
  const bezel = box(3.75, 2.15, 0.08, m.black, 0.02);
  scr.add(bezel);
  const screen = new THREE.Mesh(keep(new THREE.PlaneGeometry(3.6, 2.025)), screenMat);
  screen.position.z = 0.042;
  scr.add(screen);
  scr.rotation.y = Math.PI / 2;
  at(scr, -ROOM.w / 2 + 0.08, 1.95, -0.6);
  glow(5.6, 3.6, -ROOM.w / 2 + 0.02, 1.95, -0.6, Math.PI / 2, 0.22);
  for (const z of [-2.75, 1.55]) {
    const sp = new THREE.Group();
    const cab = box(0.36, 1.1, 0.36, m.walnutDark, 0.02);
    cab.position.y = 0.55;
    sp.add(cab);
    for (const [y, r] of [
      [0.82, 0.09],
      [0.42, 0.13],
    ]) {
      const cone = cyl(r, r, 0.01, m.black, 24);
      cone.rotation.z = Math.PI / 2;
      cone.position.set(0.185, y, 0);
      sp.add(cone);
    }
    at(shadowCast(sp), -ROOM.w / 2 + 0.55, 0, z);
    contact(0.8, 0.8, -ROOM.w / 2 + 0.55, 0, z);
  }
  // leather armchair facing the screen
  const chair = new THREE.Group();
  const seat = box(0.85, 0.22, 0.8, m.leather, 0.06);
  seat.position.y = 0.42;
  chair.add(seat);
  const backRest = box(0.2, 0.7, 0.85, m.leather, 0.07);
  backRest.position.set(0.36, 0.78, 0);
  chair.add(backRest);
  for (const s of [-1, 1]) {
    const arm = box(0.8, 0.26, 0.16, m.leather, 0.06);
    arm.position.set(0.02, 0.6, s * 0.44);
    chair.add(arm);
  }
  for (const [x, z] of [
    [-0.32, -0.33],
    [0.32, -0.33],
    [-0.32, 0.33],
    [0.32, 0.33],
  ]) {
    const leg = cyl(0.02, 0.015, 0.31, m.brass, 8);
    leg.position.set(x, 0.155, z);
    chair.add(leg);
  }
  at(shadowCast(chair), -4.9, 0, -0.5);
  contact(1.4, 1.4, -4.9, 0, -0.5);
  at(cyl(0.22, 0.22, 0.04, m.walnut, 28), -4.9, 0.55, 0.45);
  at(cyl(0.03, 0.05, 0.53, m.brass, 10), -4.9, 0.27, 0.45);

  // ---------------------------------------------------------------- packages table (front-west, by the window)
  const ptab = new THREE.Group();
  const pTop = box(3.2, 0.06, 1.0, m.walnut, 0.02);
  pTop.position.y = 0.78;
  ptab.add(pTop);
  for (const x of [-1.45, 1.45]) {
    const leg = box(0.08, 0.75, 0.86, m.walnutDark);
    leg.position.set(x, 0.375, 0);
    ptab.add(leg);
  }
  at(shadowCast(ptab), -4.4, 0, 4.45);
  ptab.traverse((c) => ((c as THREE.Mesh).receiveShadow = tier === "high"));
  contact(3.8, 1.5, -4.4, 0, 4.45);
  // three corners of the table: a lamp, a video camera on a short tripod, a closed album
  lamp(-5.5, 0.81, 4.55, 0.48);
  const vcam = new THREE.Group();
  const vBody = box(0.32, 0.17, 0.15, m.black, 0.02);
  vBody.position.y = 0.32;
  vcam.add(vBody);
  const vLens = cyl(0.055, 0.06, 0.16, m.black, 24);
  vLens.rotation.x = Math.PI / 2;
  vLens.position.set(0.05, 0.32, 0.15);
  vcam.add(vLens);
  const vHood = box(0.15, 0.12, 0.04, m.black);
  vHood.position.set(0.05, 0.32, 0.25);
  vcam.add(vHood);
  const vHandle = box(0.2, 0.03, 0.04, m.black);
  vHandle.position.set(0, 0.44, 0);
  vcam.add(vHandle);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = cyl(0.008, 0.008, 0.28, m.black, 6);
    leg.position.set(Math.cos(a) * 0.06, 0.12, Math.sin(a) * 0.06);
    leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    vcam.add(leg);
  }
  const vc = at(shadowCast(vcam), -4.35, 0.81, 4.4);
  vc.rotation.y = Math.PI + 0.35;
  const closed = box(0.5, 0.06, 0.38, m.leather, 0.008);
  at(shadowCast(closed), -3.25, 0.84, 4.5).rotation.y = -0.25;
  contact(0.8, 0.6, -3.25, 0.81, 4.5);

  // ---------------------------------------------------------------- about corner (back wall, east): shelves
  const shelf = new THREE.Group();
  const sw = 3.0;
  const sh = 2.8;
  const sideL = box(0.05, sh, 0.42, m.walnut);
  sideL.position.set(-sw / 2, sh / 2, 0);
  const sideR = sideL.clone();
  sideR.position.x = sw / 2;
  shelf.add(sideL, sideR);
  const backBoard = box(sw, sh, 0.02, m.walnutDark);
  backBoard.position.set(0, sh / 2, -0.2);
  shelf.add(backBoard);
  const spinesA = keep(bookSpines(41));
  const spinesB = keep(bookSpines(43));
  const rowY = [0.05, 0.75, 1.45, 2.15, 2.78];
  rowY.forEach((y) => {
    const b = box(sw, 0.04, 0.42, m.walnut);
    b.position.set(0, y, 0);
    shelf.add(b);
  });
  // books on two shelves (one plane each, textured spines), shelf frames on the others
  [rowY[0], rowY[2]].forEach((y, i) => {
    const spines = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.5, 0.38)), keep(new THREE.MeshStandardMaterial({ map: i ? spinesB : spinesA, roughness: 0.8 })));
    spines.position.set(i ? 0.6 : -0.6, y + 0.21, 0.05);
    shelf.add(spines);
  });
  const shelfFrames: FrameSlot[] = [];
  [
    [-0.7, rowY[1]],
    [0.75, rowY[3]],
  ].forEach(([x, y]) => {
    const f = makeFrame(0.38, 0.48, shelf, 0x2a1f16);
    f.group.position.set(x, y + 0.66, 0.02);
    f.group.children.forEach((c) => {
      if ((c as THREE.Mesh).geometry === clipGeo) c.visible = false;
    });
    f.rest = { position: f.group.position.clone(), rotZ: 0 };
    shelfFrames.push(f);
  });
  const shelfCam = camera(1.5);
  shelfCam.position.set(0.7, rowY[1] + 0.1, 0.05);
  shelfCam.rotation.y = -0.5;
  shelf.add(shelfCam);
  at(shadowCast(shelf), 5.6, 0, -ROOM.d / 2 + 0.24);
  glow(3.8, 3.4, 5.6, 1.6, -ROOM.d / 2 + 0.02, 0, 0.32);

  // ---------------------------------------------------------------- services corner (front-east): camera rig + softbox
  const rig = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const leg = cyl(0.022, 0.016, 1.38, m.black, 8);
    leg.position.set(Math.cos(a) * 0.22, 0.65, Math.sin(a) * 0.22);
    leg.rotation.set(Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2);
    rig.add(leg);
  }
  const head = box(0.12, 0.08, 0.12, m.black);
  head.position.y = 1.36;
  rig.add(head);
  const cine = camera(2.2);
  cine.position.y = 1.5;
  rig.add(cine);
  const rigObj = at(shadowCast(rig), 4.6, 0, 4.7);
  rigObj.rotation.y = Math.PI + 0.6;
  contact(1.2, 1.2, 4.6, 0, 4.7);
  const stand = new THREE.Group();
  const pole = cyl(0.015, 0.015, 1.9, m.black, 8);
  pole.position.y = 0.95;
  stand.add(pole);
  const sb = box(0.75, 0.75, 0.32, m.black, 0.02);
  sb.position.y = 1.95;
  stand.add(sb);
  const sbFace = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.66, 0.66)), m.softbox);
  sbFace.position.set(0, 1.95, 0.165);
  stand.add(sbFace);
  const st = at(shadowCast(stand), 6.6, 0, 5.2);
  st.rotation.y = -2.6;
  contact(0.9, 0.9, 6.6, 0, 5.2);

  // ---------------------------------------------------------------- plants (olive in a stone pot), instanced leaves
  // olive leaf: a narrow lanceolate cut-out (alpha) on a small canvas
  const leafTex = (() => {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 96;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 32, 0);
    g.addColorStop(0, "#4d5a30");
    g.addColorStop(0.5, "#7d8a58");
    g.addColorStop(1, "#3f4a27");
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(16, 2);
    x.quadraticCurveTo(31, 48, 16, 94);
    x.quadraticCurveTo(1, 48, 16, 2);
    x.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return keep(t);
  })();
  m.leaf.map = leafTex;
  const leafGeo = keep(new THREE.PlaneGeometry(0.03, 0.09));
  leafGeo.translate(0, 0.045, 0);
  const plant = (x: number, z: number, h: number, seed: number) => {
    const g = new THREE.Group();
    const pot = cyl(0.3, 0.24, 0.5, m.pot, 24);
    pot.position.y = 0.25;
    g.add(pot);
    const trunk = cyl(0.03, 0.05, h, keep(new THREE.MeshStandardMaterial({ color: 0x4a3a2b, roughness: 1 })), 8);
    trunk.position.y = 0.5 + h / 2;
    trunk.rotation.z = 0.06;
    g.add(trunk);
    const n = tier === "high" ? 1400 : 700;
    const leaves = new THREE.InstancedMesh(leafGeo, m.leaf, n);
    const r = (() => {
      let s = seed;
      return () => ((s = (s * 16807) % 2147483647) / 2147483647);
    })();
    const o = new THREE.Object3D();
    // a few rounded foliage clusters around the top of the trunk (points inside ellipsoids, biased to the surface)
    const clusters = [
      [0, 0.5 + h * 0.95, 0, 0.42],
      [0.22, 0.5 + h * 0.78, 0.1, 0.3],
      [-0.2, 0.5 + h * 0.82, -0.12, 0.32],
      [0.05, 0.5 + h * 1.12, 0.08, 0.3],
    ];
    for (let i = 0; i < n; i++) {
      const [cx, cy, cz, cr] = clusters[Math.floor(r() * clusters.length)];
      const u = r() * 2 - 1;
      const ang = r() * Math.PI * 2;
      const rad = cr * (0.55 + 0.45 * Math.cbrt(r()));
      const q = Math.sqrt(1 - u * u);
      o.position.set(cx + Math.cos(ang) * q * rad, cy + u * rad * 0.75, cz + Math.sin(ang) * q * rad);
      o.lookAt(cx * 2, cy + 0.2, cz * 2);
      o.rotateX(-1.2 + r() * 0.8);
      o.rotateZ((r() - 0.5) * 1.6);
      const s = 0.8 + r() * 0.5;
      o.scale.set(s, s, s);
      o.updateMatrix();
      leaves.setMatrixAt(i, o.matrix);
    }
    g.add(leaves);
    contact(0.9, 0.9, x, 0, z);
    return at(g, x, 0, z);
  };
  plant(-3.15, 5.3, 1.6, 3);
  plant(7.2, -2.95, 1.4, 7);
  plant(-7.25, -3.6, 1.3, 11);
  plant(-1.0, 5.35, 1.2, 13);

  // spot cans (decor) above the corners
  can(0, -3.4, new THREE.Vector3(0, 1.8, WALL.z));
  can(4.8, 0, new THREE.Vector3(7.9, 2, 0));
  can(-5.4, -0.6, new THREE.Vector3(-7.9, 2, -0.6));
  can(-4.4, 3.4, new THREE.Vector3(-4.4, 0.8, 4.4));
  can(5.0, -3.8, new THREE.Vector3(5.6, 1.6, -5.8));

  // ---------------------------------------------------------------- lights
  const base = new Map<THREE.Light, number>();
  const ambient = new THREE.HemisphereLight(0xffe0bd, 0x2a1a10, 1.1);
  root.add(ambient);
  base.set(ambient, ambient.intensity);
  const spot = (pos: THREE.Vector3, aim: THREE.Vector3, intensity: number, angle: number, shadow = false) => {
    const l = new THREE.SpotLight(WARM, intensity, 14, angle, 0.75, 1.6);
    l.position.copy(pos);
    l.target.position.copy(aim);
    root.add(l, l.target);
    if (shadow && tier === "high") {
      l.castShadow = true;
      l.shadow.mapSize.set(1024, 1024);
      l.shadow.bias = -0.0004;
      l.shadow.radius = 4;
      l.shadow.camera.near = 0.5;
      l.shadow.camera.far = 10;
    }
    base.set(l, intensity);
    return l;
  };
  const point = (pos: THREE.Vector3, intensity: number, dist: number, color = WARM_SOFT) => {
    const l = new THREE.PointLight(color, intensity, dist, 1.8);
    l.position.copy(pos);
    root.add(l);
    base.set(l, intensity);
    return l;
  };
  const wallSpot = spot(new THREE.Vector3(0, 4.25, -2.2), new THREE.Vector3(0, 1.7, WALL.z), 95, 0.82);
  const recSpot = spot(new THREE.Vector3(4.2, 4.25, 0.4), new THREE.Vector3(7.6, 1.6, 0), 90, 0.72, true);
  const tableSpot = spot(new THREE.Vector3(TABLE.x + 0.4, 4.25, TABLE.z + 1.2), new THREE.Vector3(TABLE.x, TABLE.y, TABLE.z), 55, 0.42, true);
  const pkgSpot = spot(new THREE.Vector3(-4.4, 4.25, 2.6), new THREE.Vector3(-4.4, 0.8, 4.45), 34, 0.6);
  const aboutLight = point(new THREE.Vector3(5.6, 2.5, -4.6), 9, 5);
  const lampLight = point(new THREE.Vector3(6.2, 1.45, 1.35), 2.2, 3.2);
  const screenLight = point(new THREE.Vector3(-6.6, 1.9, -0.6), 4, 7, 0xbfd2ff);
  const svcLight = point(new THREE.Vector3(6.3, 1.95, 4.9), tier === "high" ? 5 : 0, 4, 0xfff3e2);
  const lights = [wallSpot, recSpot, tableSpot, pkgSpot, aboutLight, lampLight, screenLight, svcLight];
  if (tier === "low") {
    // fewer real lights on weaker devices: the decor lamps keep their glow, the room keeps its key lights
    for (const l of [lampLight, svcLight]) {
      l.visible = false;
      base.set(l, 0);
    }
  }

  return {
    root,
    wall,
    reception,
    shelf: shelfFrames,
    book: { group: book, cover, rightPage, leftPage, home: bookHome, size: [BW, BD] },
    screen: screenMat,
    logo: logoMat,
    lights: { videos: [screenLight], ambient, dimmable: lights.filter((l) => l !== screenLight), base },
    glows,
    dispose: () => {
      for (const d of disposables) d.dispose();
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mt of mats) mt?.dispose();
        }
      });
    },
  };
}
