/**
 * Which studio experience a device gets. Inputs are what the browser reports, NOT the screen width alone:
 *   "high"   — full scene: device pixel ratio up to 1.75, one soft shadow, all corner lights
 *   "low"    — same room, pixel ratio 1, no shadows, fewer lights
 *   "static" — no WebGL: the elegant HTML/photo version (a complete experience, not an error)
 * A runtime frame-time probe can still lower the tier after the first frames (see `tierAfterProbe`).
 */
export type Tier = "high" | "low" | "static";

export type CapabilityInput = {
  webgl: boolean;
  /** navigator.hardwareConcurrency (undefined when hidden) */
  cores?: number;
  /** navigator.deviceMemory in GB (Chromium only) */
  memoryGb?: number;
  /** Save-Data / data saver on */
  saveData?: boolean;
  /** user chose the simple view (stored preference) */
  optedOut?: boolean;
  /** the renderer reports a software rasterizer (SwiftShader / llvmpipe …) */
  softwareRenderer?: boolean;
  /** primary pointer is coarse (touch) */
  coarse?: boolean;
};

export function decideTier(c: CapabilityInput): Tier {
  // software rasterizers (SwiftShader, llvmpipe: VMs, blocked GPUs) compile and draw on the CPU and would block
  // the page's main thread: they get the static studio
  if (!c.webgl || c.optedOut || c.saveData || c.softwareRenderer) return "static";
  if (c.memoryGb !== undefined && c.memoryGb < 2) return "static";
  const weakCpu = c.cores !== undefined && c.cores <= 4;
  const weakMem = c.memoryGb !== undefined && c.memoryGb <= 4;
  if (weakCpu || weakMem || c.coarse) return "low";
  return "high";
}

/**
 * After the first frames: median frame time decides whether to keep, lower, or leave the scene.
 * (Rendering is on demand, so this is measured during the first camera move only.)
 */
export function tierAfterProbe(tier: Tier, medianFrameMs: number): Tier {
  if (tier === "static") return "static";
  if (medianFrameMs > 90) return "static";
  if (medianFrameMs > 40) return "low";
  return tier;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|basic render/i;
