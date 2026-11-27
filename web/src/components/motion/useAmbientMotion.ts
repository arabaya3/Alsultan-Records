"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { ambientMayAdvance, type AmbientState } from "./ambient-budget";

type Connection = { saveData?: boolean; addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void };
const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * Whether a decorative photo rotation may take its next step (see ambient-budget.ts), plus `stepped()` to count a step.
 * `ref` is the photo area: off screen → paused, back on screen → resumes. Starts paused until the first observation, so
 * nothing extra loads before the browser knows the area is visible. `enabled` false → always paused.
 */
export function useAmbientMotion(ref: RefObject<Element | null>, enabled: boolean): { running: boolean; stepped: () => void } {
  const [s, setS] = useState<AmbientState>({ reducedMotion: true, hidden: true, inView: false, saveData: false, idleSteps: 0 });

  useEffect(() => {
    if (!enabled) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const conn = (navigator as Navigator & { connection?: Connection }).connection;
    const read = () =>
      setS((p) => ({ ...p, reducedMotion: motion.matches, hidden: document.visibilityState !== "visible", saveData: conn?.saveData === true }));
    read();
    motion.addEventListener("change", read);
    document.addEventListener("visibilitychange", read);
    conn?.addEventListener?.("change", read);

    const active = () => setS((p) => (p.idleSteps === 0 ? p : { ...p, idleSteps: 0 }));
    for (const t of ACTIVITY) window.addEventListener(t, active, { passive: true });

    let io: IntersectionObserver | null = null;
    const el = ref.current;
    if (el && "IntersectionObserver" in window) {
      io = new IntersectionObserver((entries) => {
        const e = entries[entries.length - 1];
        if (e) setS((p) => (p.inView === e.isIntersecting ? p : { ...p, inView: e.isIntersecting }));
      });
      io.observe(el);
    } else {
      setS((p) => ({ ...p, inView: true }));
    }

    return () => {
      motion.removeEventListener("change", read);
      document.removeEventListener("visibilitychange", read);
      conn?.removeEventListener?.("change", read);
      for (const t of ACTIVITY) window.removeEventListener(t, active);
      io?.disconnect();
    };
  }, [ref, enabled]);

  const stepped = useCallback(() => setS((p) => ({ ...p, idleSteps: p.idleSteps + 1 })), []);
  return { running: enabled && ambientMayAdvance(s), stepped };
}
