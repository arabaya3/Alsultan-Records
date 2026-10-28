import type { Station } from "./stations";

/**
 * Room map (metres, y up). The room is 16 × 12 × 4.4; the entrance is on the front wall (z = +6, east side).
 *
 *            back wall z = -6:  [ about: shelves ]   [ ALBUM WALL: frames on a rope ]
 *   west x = -8: VIDEO SCREEN        album table (centre)            east x = +8: RECEPTION (logo, 3 frames, desk)
 *            front wall z = +6: [ packages table ] (arched window)     [ services: camera rig ]  (door)
 *
 * Camera poses are DATA, not hand-placed cameras: a corner gives its focal point, the direction the visitor looks
 * from, and the area that must stay in view; the distance is solved for the current aspect ratio, so resize and
 * phone rotation keep the same composition.
 */
export type Vec3 = [number, number, number];

export type Pose = {
  /** focal point */
  target: Vec3;
  /** from the target toward the camera (normalised here) */
  dir: Vec3;
  /** width × height (m) around the target that must be visible */
  fit: [number, number];
  /** vertical field of view (deg) on wide screens; tall screens widen it */
  fov: number;
  /** area kept in view on tall (phone) screens, when it differs */
  fitTall?: [number, number];
  /** where the focal point sits on screen, 0 = top … 1 = bottom (default 0.5); lower leaves room for text above */
  screenY?: number;
  /** same on tall screens (phones): the room is a band at the TOP, so focal points sit high (default 0.3) */
  screenYTall?: number;
};

export const ROOM = { w: 16, d: 12, h: 4.4 } as const;

/** Album wall: one rope, five frames per group (bigger, legible covers; groups page through the list). */
export const WALL = { z: -5.86, ropeY: 2.92, frameY: 1.98, frameW: 1.36, frameH: 1.7, spacing: 2.05, perGroup: 5 } as const;
/** Reception: three hanging frames under the logo (RTL: the first item is on the visitor's right = +z). */
export const RECEPTION = { x: 7.86, frameY: 2.2, frameW: 1.12, frameH: 1.4, z: [2.0, 0, -2.0] as const, logoY: 3.7 } as const;
export const TABLE = { x: 0, y: 0.8, z: -2.55 } as const;

export const POSES: Record<Station, Pose> = {
  reception: { target: [7.6, 2.05, 0.1], dir: [-1, 0.07, -0.06], fit: [5.9, 3.05], fov: 40, fitTall: [1.9, 2.2], screenYTall: 0.27 },
  albums: { target: [0, 1.95, WALL.z], dir: [0, 0.05, 1], fit: [10.6, 3.4], fov: 38, fitTall: [3.6, 3.2], screenY: 0.66 },
  album: { target: [TABLE.x, TABLE.y + 0.03, TABLE.z + 0.05], dir: [0.1, 0.95, 0.85], fit: [1.3, 0.9], fov: 34, fitTall: [1.05, 0.95] },
  videos: { target: [-7.9, 1.95, -0.6], dir: [1, 0.04, 0.12], fit: [3.8, 2.4], fov: 38 },
  packages: { target: [-4.4, 1.05, 4.35], dir: [0.4, 0.42, -1], fit: [3.3, 1.7], fov: 38 },
  about: { target: [6.8, 1.5, -4.7], dir: [-0.75, 0.1, 0.65], fit: [3.4, 2.7], fov: 38 },
  services: { target: [4.2, 1.05, 5.15], dir: [-0.45, 0.22, -1], fit: [3.0, 2.0], fov: 38 },
  contact: { target: [6.25, 1.2, 0.5], dir: [-1, 0.3, -0.2], fit: [2.6, 1.6], fov: 36 },
};

const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const norm = (v: Vec3): Vec3 => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const RAD = Math.PI / 180;

/** How far the camera may back away from a target along dir before leaving the room (0.45 m margin). */
function maxDistance(t: Vec3, dir: Vec3): number {
  const lim: Vec3 = [ROOM.w / 2 - 0.45, ROOM.h - 0.45, ROOM.d / 2 - 0.45];
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-6) continue;
    const bound = i === 1 ? (dir[i] > 0 ? lim[1] : 0.45) : dir[i] > 0 ? lim[i] : -lim[i];
    best = Math.min(best, (bound - t[i]) / dir[i]);
  }
  return Math.max(0.5, best);
}

export type CameraState = { position: Vec3; target: Vec3; fov: number };

/**
 * Solve a corner's camera for a viewport.
 *   aspect   — width / height of the stage
 *   sideText — the hero text sits on the visitor's right (RTL start): the focal area moves to the left part
 */
export function cameraFor(pose: Pose, aspect: number, sideText = false): CameraState {
  const tall = aspect < 1;
  const fov = tall ? Math.max(pose.fov, 52) : aspect < 1.4 ? Math.max(pose.fov, 44) : pose.fov;
  const v = fov * RAD;
  // the focal area only gets the left ~58% of a wide screen when text takes the right side
  const usable = sideText && !tall ? 0.58 : 1;
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect * usable);
  const [fw, fh] = tall && pose.fitTall ? pose.fitTall : pose.fit;
  const dir = norm(pose.dir);
  const d = Math.min(Math.max(fh / 2 / Math.tan(v / 2), fw / 2 / Math.tan(h / 2)) * 1.04, maxDistance(pose.target, dir));
  let target = pose.target;
  let position = add(target, dir, d);
  const sy = tall ? (pose.screenYTall ?? 0.3) : pose.screenY;
  if (sy !== undefined) {
    // aim higher/lower (camera and aim move together): the focal point lands at sy of the screen height
    const lift = (sy - 0.5) * 2 * d * Math.tan(v / 2);
    target = add(target, [0, lift, 0]);
    position = add(position, [0, lift, 0]);
  }
  if (usable < 1) {
    // slide camera AND aim along the screen-right vector: the focal point lands at ~29% from the left
    const forward: Vec3 = [-dir[0], -dir[1], -dir[2]];
    const right = norm(cross(forward, [0, 1, 0]));
    const halfW = d * Math.tan(v / 2) * aspect;
    const s = halfW * (1 - usable);
    target = add(target, right, s);
    position = add(position, right, s);
  }
  return { position, target, fov };
}

/** The first-visit approach starts further back along the reception line of sight (short, calm dolly-in). */
export function entryFrom(c: CameraState): CameraState {
  const dir: Vec3 = norm([c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]]);
  return { position: add(add(c.position, dir, 2.4), [0, 0, 1], 0.6), target: add(c.target, [0, -0.15, 0], 1), fov: c.fov + 4 };
}

/**
 * Transition path control point: halfway between the two cameras, pulled toward the middle of the room at eye
 * height, so moving between corners turns through open floor instead of cutting through walls or furniture.
 */
export function pathMid(a: Vec3, b: Vec3): Vec3 {
  const centre: Vec3 = [0, 1.75, 1.2];
  const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  // only long, cross-room moves bend (gently) toward the open floor; short moves stay short and direct
  const d = len([b[0] - a[0], 0, b[2] - a[2]]);
  const pull = d < 5 ? 0 : Math.min(0.28, (d - 5) / 25);
  return [mid[0] + (centre[0] - mid[0]) * pull, mid[1] + (centre[1] - mid[1]) * pull + 0.08, mid[2] + (centre[2] - mid[2]) * pull];
}

/** Seconds for a move: longer for far corners, shorter on phones, zero with reduced motion. */
export function moveDuration(a: Vec3, b: Vec3, opts: { tall: boolean; reduced: boolean }): number {
  if (opts.reduced) return 0;
  const dist = len([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const base = Math.min(1.75, 0.75 + dist * 0.09);
  return opts.tall ? Math.min(1.15, base * 0.7) : base;
}

/** x of the frame slot i (0-based, RTL: slot 0 is the right-most when facing the wall = +x side). */
export function wallSlotX(i: number, count: number): number {
  const n = Math.max(1, Math.min(count, WALL.perGroup));
  return ((n - 1) / 2 - i) * WALL.spacing; // facing the back wall, screen-right is +x
}

/** Groups of the album wall: [start, end) indexes for group g (0-based), clamped. */
export function wallGroup(total: number, g: number): { start: number; end: number; group: number; groups: number } {
  const groups = Math.max(1, Math.ceil(total / WALL.perGroup));
  const group = Math.min(Math.max(0, g), groups - 1);
  const start = group * WALL.perGroup;
  return { start, end: Math.min(total, start + WALL.perGroup), group, groups };
}
