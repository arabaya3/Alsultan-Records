import Link from "next/link";
import { getActiveOffers } from "@/features/public-content/cms-queries";
import { formatDayAr } from "@/features/public-content/cms-model";
import { offerPath } from "@/lib/site-targets";
import { bidiDir } from "@/lib/bidi";

function TagIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
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
 */
export async function OfferBar() {
  const res = await getActiveOffers();
  if (res.status !== "ok" || !res.data.length) return null;
  const [first, ...rest] = res.data;
  return (
    <aside aria-label="عروض لفترة محدودة" data-offer-bar className="border-b border-gold-press bg-gold text-ink">
      <div className="mx-auto flex w-full max-w-[var(--content-max)] flex-wrap items-center gap-x-5 gap-y-1 px-[var(--gutter)] py-1.5">
        <Link
          href={offerPath(first.slug)}
          data-offer-bar-link={first.slug}
          className="group inline-flex min-h-11 min-w-0 flex-1 items-center gap-2.5 py-1"
        >
          <TagIcon />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            <span className="font-semibold">عرض لفترة محدودة: </span>
            <bdi dir={bidiDir(first.title)} className="underline decoration-1 underline-offset-4 group-hover:decoration-2">
              {first.title}
            </bdi>
            {first.ends_on ? <span data-offer-bar-ends className="whitespace-nowrap"> · ينتهي {formatDayAr(first.ends_on)}</span> : null}
          </span>
          {rest.length ? null : <ChevronStart />}
        </Link>
        {rest.length ? (
          <Link
            href="/offers"
            data-offer-bar-all
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-semibold underline decoration-1 underline-offset-4 hover:decoration-2"
          >
            كل العروض ({(rest.length + 1).toLocaleString("ar-PS")})
            <ChevronStart />
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
