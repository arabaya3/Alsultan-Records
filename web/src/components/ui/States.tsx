import type { ReactNode } from "react";

/*
 * States are tone-aware through CSS variables (text-tone-muted, border-tone-line, bg-tone-surface): dark on public
 * pages (.site-public / Section tones), cream in the portal, with no prop needed.
 */

/** Nothing published yet — a normal, calm state. Props: title, body?, action? (e.g. a ButtonLink). */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div role="status" className="rounded-md border border-dashed border-tone-line bg-tone-surface px-6 py-12 text-center">
      <span aria-hidden="true" className="gold-rule mx-auto mb-5" />
      <p className="font-display text-xl font-semibold">{title}</p>
      {body ? <p className="mx-auto mt-2 max-w-md text-tone-muted">{body}</p> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** The service could not be reached — different from "empty". Props: title?, body?, action?. */
export function ErrorState({
  title = "تعذّر تحميل المحتوى الآن",
  body = "حدث خلل مؤقت أثناء جلب البيانات. حاول مرة أخرى بعد قليل، أو تواصل معنا مباشرة.",
  action,
}: {
  title?: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div role="alert" className="rounded-md border border-danger/60 bg-danger/10 px-6 py-10 text-center">
      <p className="font-display text-xl font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-tone-muted">{body}</p>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Placeholder block. Size it with className (e.g. "aspect-video", "h-6 w-1/2"). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-sm bg-tone-line/70 ${className}`} />;
}

/** Grid of placeholder tiles with an accessible busy status. Props: count? (default 2). */
export function TileGridSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="grid gap-6 md:grid-cols-2" role="status" aria-busy="true" aria-label="جارِ التحميل">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="aspect-[4/3] md:aspect-[16/7]" />
      ))}
    </div>
  );
}
