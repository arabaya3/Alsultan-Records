import * as THREE from "three";

/**
 * The few textures still drawn at runtime (tiny canvases, no files): soft light pools / contact shadows, and the
 * night outside the window. Surfaces (plaster, planks, walnut, leather) are CC0 texture files — see room.ts.
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext("2d")! };
}

function toTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft radial glow / shadow sprite: warm light pools on walls and contact shadows under objects. */
export function radial(inner: string, outer: string): THREE.CanvasTexture {
  const S = 128;
  const { c, ctx } = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c);
}

/** Night outside the arched window: deep blue dusk with a few blurred warm lights (no real place depicted). */
export function night(): THREE.CanvasTexture {
  const W = 128;
  const H = 192;
  const { c, ctx } = canvas(W, H);
  const rand = rng(5);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#06080f");
  g.addColorStop(0.65, "#141a2b");
  g.addColorStop(1, "#2a2219");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.filter = "blur(2px)";
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(255,${170 + rand() * 60},${90 + rand() * 50},${0.25 + rand() * 0.5})`;
    ctx.beginPath();
    ctx.arc(rand() * W, H * (0.62 + rand() * 0.36), 1 + rand() * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.filter = "none";
  return toTexture(c);
}
