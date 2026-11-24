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
 * Look: the poster's deep navy with a gold rule and a gold «عرض لفترة محدودة» pill, so it reads as part of the header.
 */
export async function OfferBar() {
  const res = await getActiveOffers();
  if (res.status !== "ok" || !res.data.length) return null;
  const [first, ...rest] = res.data;
  return (
    <aside aria-label="عروض لفترة محدودة" data-offer-bar className="relative border-b border-hairline-gold bg-navy-deep text-ivory">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-gold to-transparent" />
      <div className="mx-auto flex w-full max-w-[var(--content-max)] flex-wrap items-center justify-center gap-x-4 gap-y-1 px-[var(--gutter)] py-1.5">
        <Link href={offerPath(first.slug)} data-offer-bar-link={first.slug} className="group inline-flex min-h-11 min-w-0 items-center gap-3 py-1">
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-xs font-bold text-ink sm:text-sm">
            <TagIcon />
            عرض لفترة محدودة
          </span>
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            <bdi dir={bidiDir(first.title)} className="font-semibold transition-colors group-hover:text-gold">
              {first.title}
            </bdi>
            {first.ends_on ? (
              <span data-offer-bar-ends className="text-sm whitespace-nowrap text-ivory-muted">
                {" "}
                · ينتهي {formatDayAr(first.ends_on)}
              </span>
            ) : null}
          </span>
          {rest.length ? null : (
            <span className="text-gold">
              <ChevronStart />
            </span>
          )}
        </Link>
        {rest.length ? (
          <>
            <span aria-hidden="true" className="h-5 w-px bg-hairline-gold max-sm:hidden" />
            <Link
              href="/offers"
              data-offer-bar-all
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-semibold text-gold transition-colors hover:text-ivory"
            >
              كل العروض ({(rest.length + 1).toLocaleString("ar-PS")})
              <ChevronStart />
            </Link>
          </>
        ) : null}
      </div>
    </aside>
  );
}
