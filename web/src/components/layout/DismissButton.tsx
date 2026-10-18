"use client";

/** Hides its announcement and remembers it per id (localStorage may be unavailable: still hides). */
export function DismissButton({ id, dark }: { id: string; dark: boolean }) {
  return (
    <button
      type="button"
      aria-label="إخفاء الإعلان"
      data-announcement-dismiss
      onClick={(e) => {
        const box = e.currentTarget.closest<HTMLElement>("[data-announcement]");
        if (box) box.hidden = true;
        try {
          localStorage.setItem(`ann-dismissed:${id}`, "1");
        } catch {
          /* private mode / blocked storage */
        }
      }}
      className={`grid size-11 shrink-0 place-items-center rounded-sm ${dark ? "hover:text-gold" : "hover:bg-ink/10"}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
