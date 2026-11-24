import Link from "next/link";
import { getActiveOffers } from "@/features/public-content/cms-queries";
import { formatDayAr } from "@/features/public-content/cms-model";
import { offerPath } from "@/lib/site-targets";
import { bidiDir } from "@/lib/bidi";

function TagIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </svg>
  );
}

function ChevronStart() {
  // "Forward" in RTL points left.
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

/**
 * Time-limited offers as a thin bar under the header, on every public page. It exists only while at least one offer is
 * active (published, today within its dates, Asia/Hebron): the offers cache lasts until the next Hebron midnight and every
 * admin save expires it, so an offer leaves the site on its own when its end date passes. The first offer (owner's order:
 * pinned first) is named with its end date; with more than one, a second link opens the full list.
 * The content sits in a quiet navy panel below the header: a small label, the offer name and end date,
 * and a clear action. The full-list link remains separate when more offers are active.
 */
export async function OfferBar() {
  const res = await getActiveOffers();
  if (res.status !== "ok" || !res.data.length) return null;
  const [first, ...rest] = res.data;
  return (
    <aside aria-label="عروض لفترة محدودة" data-offer-bar className="border-b border-hairline-gold bg-navy-deep text-ivory">
      <div className="mx-auto flex w-full max-w-[var(--content-max)] flex-col gap-3 px-[var(--gutter)] py-4 sm:flex-row sm:items-center sm:gap-5 sm:py-3">
        <span className="inline-flex w-fit shrink-0 items-center gap-2 text-xs font-bold text-gold">
          <TagIcon />
          عرض لفترة محدودة
        </span>
        <span aria-hidden="true" className="hidden h-9 w-px bg-hairline-gold sm:block" />
        <Link
          href={offerPath(first.slug)}
          data-offer-bar-link={first.slug}
          className="group flex min-h-11 min-w-0 flex-1 flex-col items-start justify-between gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold sm:flex-row sm:items-center"
        >
          <span className="min-w-0">
            <bdi dir={bidiDir(first.title)} className="block break-words font-display text-base font-bold leading-snug text-ivory transition-colors group-hover:text-gold sm:text-lg">
              {first.title}
            </bdi>
            {first.ends_on ? (
              <span data-offer-bar-ends className="block text-xs text-ivory-muted sm:text-sm">
                ينتهي {formatDayAr(first.ends_on)}
              </span>
            ) : null}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline-gold px-3 py-2 text-xs font-bold text-gold transition-colors group-hover:border-gold group-hover:bg-gold group-hover:text-ink sm:px-4 sm:text-sm">
            شاهد العرض
            <ChevronStart />
          </span>
        </Link>
        {rest.length ? (
          <Link
            href="/offers"
            data-offer-bar-all
            className="inline-flex min-h-11 w-fit shrink-0 items-center gap-1 text-sm font-semibold text-gold underline decoration-hairline-gold underline-offset-4 transition-colors hover:text-ivory sm:ms-2"
          >
            كل العروض ({(rest.length + 1).toLocaleString("ar-PS")})
            <ChevronStart />
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
