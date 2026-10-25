"use client";

import { useStudio, useStudioState } from "./StudioProvider";

/**
 * «عرض مبسّط» / «تجربة الاستوديو»: the visitor can turn the 3D room off (remembered in this browser) or back on.
 * Shown only when a choice exists: hidden on reading pages and when the device cannot show the scene at all.
 */
export function StudioToggle() {
  const ctx = useStudio();
  const st = useStudioState();
  if (!ctx || !st.station || st.mode === "pending") return null;
  const on = st.mode === "scene";
  let canScene = true;
  if (!on && typeof window !== "undefined") canScene = Boolean(window.WebGLRenderingContext);
  if (!on && !canScene) return null;
  return (
    <div className="bg-night">
      <div className="mx-auto flex w-full max-w-[var(--content-max)] justify-end px-[var(--gutter)] py-3">
        <button
          type="button"
          data-studio-toggle={on ? "on" : "off"}
          onClick={() => ctx.setPreference(on ? "static" : "scene")}
          className="inline-flex min-h-11 items-center gap-2 text-sm text-ivory-muted underline decoration-1 underline-offset-8 transition-colors hover:text-gold hover:decoration-gold"
        >
          {on ? "عرض مبسّط بدون مشهد ثلاثي الأبعاد" : "تشغيل تجربة الاستوديو ثلاثية الأبعاد"}
        </button>
      </div>
    </div>
  );
}
