import * as THREE from "three";

/**
 * Studio materials, generated at runtime on small canvases (no image files in Git, nothing downloaded, no
 * third-party licence): dark plaster, walnut planks, leather, paper, warm light pools. Deterministic (seeded) so
 * every visit sees the same room. All textures are created once and shared.
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
  const ctx = c.getContext("2d")!;
  return { c, ctx };
}

/** Smooth value noise on a small lattice, bilinear-upsampled by drawing a tiny canvas big (cheap, GPU-free). */
function blotches(ctx: CanvasRenderingContext2D, w: number, h: number, cells: number, alpha: number, rand: () => number) {
  const { c: small, ctx: s } = canvas(cells, cells);
  const img = s.createImageData(cells, cells);
  for (let i = 0; i < cells * cells; i++) {
    const v = rand();
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v * 255;
    img.data[i * 4 + 3] = 255;
  }
  s.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalCompositeOperation = "overlay";
  ctx.drawImage(small, 0, 0, w, h);
  ctx.restore();
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, rand: () => number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function toTexture(c: HTMLCanvasElement, repeat: [number, number] = [1, 1], srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Dark lime-plaster wall: mottled warm charcoal with fine grain. */
export function plaster(): THREE.CanvasTexture {
  const S = 512;
  const { c, ctx } = canvas(S, S);
  const rand = rng(11);
  ctx.fillStyle = "#2a241e";
  ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, S, 6, 0.55, rand);
  blotches(ctx, S, S, 18, 0.35, rand);
  blotches(ctx, S, S, 60, 0.18, rand);
  grain(ctx, S, S, 14, rand);
  return toTexture(c, [3, 1]);
}

/** Walnut planks (floor) or a single walnut board (furniture): grain lines, plank seams, tone variation. */
export function walnut(planks = true): THREE.CanvasTexture {
  const W = 1024;
  const H = 1024;
  const { c, ctx } = canvas(W, H);
  const rand = rng(planks ? 7 : 19);
  const rows = planks ? 8 : 1;
  const rowH = H / rows;
  for (let r = 0; r < rows; r++) {
    let x = planks ? -rand() * 400 : 0;
    while (x < W) {
      const len = planks ? 380 + rand() * 520 : W;
      const tone = 0.82 + rand() * 0.3;
      const base = [Math.round(78 * tone), Math.round(50 * tone), Math.round(31 * tone)];
      ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
      ctx.fillRect(x, r * rowH, len, rowH);
      // grain: long wavy darker / lighter strokes along the board
      const lines = planks ? 26 : 70;
      for (let i = 0; i < lines; i++) {
        const y0 = r * rowH + rand() * rowH;
        const amp = 1 + rand() * (planks ? 3 : 9);
        const freq = 0.004 + rand() * 0.01;
        const ph = rand() * 6.28;
        ctx.beginPath();
        for (let xx = x; xx <= x + len; xx += 8) ctx.lineTo(xx, y0 + Math.sin(xx * freq + ph) * amp);
        const dark = rand() < 0.65;
        ctx.strokeStyle = dark ? `rgba(30,17,9,${0.18 + rand() * 0.25})` : `rgba(150,105,64,${0.08 + rand() * 0.12})`;
        ctx.lineWidth = 0.6 + rand() * 1.8;
        ctx.stroke();
      }
      if (planks) {
        ctx.fillStyle = "rgba(12,7,4,0.75)";
        ctx.fillRect(x, r * rowH, 2, rowH);
      }
      x += len;
    }
    if (planks) {
      ctx.fillStyle = "rgba(12,7,4,0.8)";
      ctx.fillRect(0, r * rowH, W, 2);
    }
  }
  grain(ctx, W, H, 10, rand);
  return toTexture(c, planks ? [3, 3] : [1, 1]);
}

/** Aged dark leather (armchair, album cover, desk pad). */
export function leather(): THREE.CanvasTexture {
  const S = 256;
  const { c, ctx } = canvas(S, S);
  const rand = rng(23);
  ctx.fillStyle = "#3a2417";
  ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, S, 10, 0.5, rand);
  blotches(ctx, S, S, 48, 0.25, rand);
  grain(ctx, S, S, 24, rand);
  return toTexture(c, [2, 2]);
}

/** Warm off-white print paper (frame mats, album pages). */
export function paper(): THREE.CanvasTexture {
  const S = 128;
  const { c, ctx } = canvas(S, S);
  const rand = rng(31);
  ctx.fillStyle = "#efe7d6";
  ctx.fillRect(0, 0, S, S);
  grain(ctx, S, S, 10, rand);
  return toTexture(c);
}

/** Soft radial glow / shadow sprite: warm light pools on walls and contact shadows under objects. */
export function radial(inner: string, outer: string): THREE.CanvasTexture {
  const S = 256;
  const { c, ctx } = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Night outside the arched window: deep blue dusk with a few blurred warm lights (no real place depicted). */
export function night(): THREE.CanvasTexture {
  const W = 256;
  const H = 384;
  const { c, ctx } = canvas(W, H);
  const rand = rng(5);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#06080f");
  g.addColorStop(0.65, "#141a2b");
  g.addColorStop(1, "#2a2219");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.filter = "blur(3px)";
  for (let i = 0; i < 40; i++) {
    const y = H * (0.62 + rand() * 0.36);
    ctx.fillStyle = `rgba(255,${170 + rand() * 60},${90 + rand() * 50},${0.25 + rand() * 0.5})`;
    ctx.beginPath();
    ctx.arc(rand() * W, y, 1.5 + rand() * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.filter = "none";
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Spines of a shelf of books: a row of muted cloth colours with thin gold bands. */
export function bookSpines(seed: number): THREE.CanvasTexture {
  const W = 512;
  const H = 128;
  const { c, ctx } = canvas(W, H);
  const rand = rng(seed);
  const palette = ["#3b2a1f", "#22303a", "#4a1f1c", "#2f3326", "#5a4630", "#1d1b19", "#6b5236"];
  let x = 0;
  while (x < W) {
    const w = 12 + rand() * 22;
    const h = H * (0.72 + rand() * 0.28);
    ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
    ctx.fillRect(x, H - h, w - 1.5, h);
    if (rand() < 0.6) {
      ctx.fillStyle = "rgba(201,160,82,0.75)";
      ctx.fillRect(x + 2, H - h + 10, w - 5.5, 2);
      ctx.fillRect(x + 2, H - 18, w - 5.5, 2);
    }
    x += w;
  }
  grain(ctx, W, H, 12, rand);
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
