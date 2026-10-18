import Link from "next/link";
import { getActiveAnnouncements } from "@/features/public-content/cms-queries";
import { DismissButton } from "./DismissButton";

/**
 * Owner announcements (fixed templates: thin «bar» or larger «banner»), top of every public page.
 * Text is rendered as text; the link is an allow-listed internal path or /offers/<slug> (resolved in
 * cms-queries). Dismissal is per announcement id in localStorage; the inline script hides dismissed
 * ones before paint so there is no flash.
 */
const HIDE_SCRIPT = `try{document.querySelectorAll("[data-announcement]").forEach(function(e){if(localStorage.getItem("ann-dismissed:"+e.getAttribute("data-announcement")))e.hidden=true})}catch(e){}`;

export async function Announcements() {
  const list = await getActiveAnnouncements();
  if (!list.length) return null;
  return (
    <>
      {list.map((a) => {
        const banner = a.template === "banner";
        return (
          <aside
            key={a.id}
            data-announcement={a.id}
            data-template={a.template}
            aria-label="إعلان"
            className={banner ? "border-b border-gold-press bg-gold text-ink" : "border-b border-hairline bg-surface text-ivory"}
          >
            <div
              className={`mx-auto flex w-full max-w-[var(--content-max)] items-center gap-3 px-[var(--gutter)] ${banner ? "py-4 md:py-5" : "py-2"}`}
            >
              <p className={`min-w-0 flex-1 break-words ${banner ? "text-lg font-semibold md:text-xl" : "text-sm md:text-base"}`}>
                {a.href ? (
                  <Link href={a.href} data-announcement-link className={`inline-flex min-h-11 items-center underline decoration-1 underline-offset-4 transition-colors hover:decoration-2 ${banner ? "" : "decoration-gold/70 hover:text-gold"}`}>
                    <bdi>{a.text}</bdi>
                  </Link>
                ) : (
                  <bdi>{a.text}</bdi>
                )}
              </p>
              {a.dismissible ? <DismissButton id={a.id} dark={!banner} /> : null}
            </div>
          </aside>
        );
      })}
      <script dangerouslySetInnerHTML={{ __html: HIDE_SCRIPT }} />
    </>
  );
}
