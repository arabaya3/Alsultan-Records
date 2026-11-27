import Link from "next/link";
import type { ReactNode } from "react";
import { bidiDir } from "@/lib/bidi";

/** Admin UI primitives: calm, dense, ink/cream/gold. Server-safe (no hooks). */

export function PageHeader({
  title,
  lead,
  actions,
  back,
}: {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-1 inline-block text-sm text-on-cream-muted hover:text-on-cream">
            → {back.label}
          </Link>
        ) : null}
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight md:text-[2.75rem]">{title}</h1>
        {lead ? <div className="mt-2 text-base text-on-cream-muted md:text-lg">{lead}</div> : null}
        <span aria-hidden="true" className="mt-4 block h-0.5 w-20 rounded-full bg-gold" />
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  children,
  actions,
  className = "",
  id,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`min-w-0 rounded-xl border border-cream-line bg-[#fffdf8] shadow-[0_8px_24px_-20px_rgb(60_45_20/0.4)] ${className}`}>
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-5">
          <div>
            <h2 className="font-display text-xl font-bold">{title}</h2>
            <span aria-hidden="true" className="mt-2 block h-0.5 w-12 rounded-full bg-gold" />
          </div>
          {actions}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

const TONES = {
  neutral: "bg-cream-2 text-on-cream border-cream-line",
  gold: "bg-gold/20 text-on-cream border-gold/60",
  success: "bg-success/10 text-success border-success/40",
  danger: "bg-danger/10 text-danger border-danger/40",
  ink: "bg-ink text-on-dark border-ink",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Table({ head, children, empty, label }: { head: string[]; children: ReactNode; empty?: boolean; label?: string }) {
  return (
    // Focusable scroll region: keyboard users can scroll the table horizontally on narrow screens.
    <div role="region" tabIndex={0} aria-label={label ?? `جدول: ${head.join("، ")}`} className="overflow-x-auto rounded-md border border-cream-line bg-[#fffdf8]">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-cream-line bg-cream-2 text-start text-xs text-on-cream-muted">
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 text-start font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-cream-line [&>tr:last-child]:border-0 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top">
          {children}
        </tbody>
      </table>
      {empty ? <p className="px-4 py-8 text-center text-on-cream-muted">لا توجد سجلات مطابقة.</p> : null}
    </div>
  );
}

export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium underline decoration-cream-line underline-offset-4 hover:decoration-gold">
      <bdi dir={bidiDir(children)}>{children}</bdi>
    </Link>
  );
}

function buildHref(base: string, params: Record<string, string>, patch: Record<string, string | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export function Pagination({
  base,
  page,
  total,
  size,
  params,
  param = "page",
}: {
  base: string;
  page: number;
  total: number;
  size: number;
  params: Record<string, string>;
  param?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return <p className="mt-3 text-xs text-on-cream-muted">{total} سجل</p>;
  return (
    <nav aria-label="الصفحات" className="mt-3 flex items-center justify-between gap-3 text-sm">
      <span className="text-on-cream-muted">
        صفحة {page} من {pages} · {total} سجل
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link className={btn("ghost")} href={buildHref(base, params, { [param]: String(page - 1) })}>
            السابق
          </Link>
        ) : null}
        {page < pages ? (
          <Link className={btn("ghost")} href={buildHref(base, params, { [param]: String(page + 1) })}>
            التالي
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

/** Status filter chips driven by URL params. */
export function FilterChips({
  base,
  param,
  current,
  options,
  params,
}: {
  base: string;
  param: string;
  current: string;
  options: { value: string; label: string }[];
  params: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="تصفية">
      {[{ value: "", label: "الكل" }, ...options].map((o) => {
        const active = current === o.value;
        return (
          <Link
            key={o.value || "all"}
            href={buildHref(base, params, { [param]: o.value || null, page: null })}
            aria-current={active ? "true" : undefined}
            className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors ${
              active ? "border-navy bg-navy text-ivory" : "border-cream-line bg-[#fffdf8] hover:border-on-cream-muted"
            }`}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

/** GET search form; keeps other params as hidden inputs. */
export function SearchBox({
  base,
  q,
  params,
  placeholder = "بحث بالاسم أو الهاتف",
}: {
  base: string;
  q: string;
  params: Record<string, string>;
  placeholder?: string;
}) {
  return (
    <form action={base} method="get" role="search" className="relative flex w-full max-w-md items-center">
      {Object.entries(params)
        .filter(([k, v]) => k !== "q" && k !== "page" && v)
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <label className="sr-only" htmlFor="admin-q">
        بحث
      </label>
      <input id="admin-q" name="q" type="search" defaultValue={q} placeholder={placeholder} className="field !min-h-11 !rounded-xl !ps-11" />
      <button type="submit" aria-label="بحث" className="absolute start-1 inline-flex size-10 items-center justify-center rounded-lg text-on-cream-muted hover:text-on-cream">
        <SearchIcon />
      </button>
    </form>
  );
}

export function SearchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/**
 * Section tabs (links): «الألبومات · التصنيفات · الأرشيف · سلة المحذوفات». The current one is the navy pill.
 * Icons optional. Server-safe.
 */
export function Segmented({
  label,
  tabs,
  current,
  testId = "page-tabs",
}: {
  label: string;
  tabs: { href: string; label: ReactNode; icon?: ReactNode; key?: string }[];
  current: string;
  testId?: string;
}) {
  return (
    <nav aria-label={label} className="mb-6 flex flex-wrap gap-2 border-b border-cream-line pb-4" data-testid={testId}>
      {tabs.map((t) => {
        const on = (t.key ?? t.href) === current;
        return (
          <a
            key={t.key ?? t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-5 text-sm font-semibold transition-colors ${
              on ? "border-navy bg-navy text-ivory shadow-[inset_0_-2px_0_var(--color-gold)]" : "border-cream-line bg-[#fffdf8] text-on-cream hover:border-on-cream-muted"
            }`}
          >
            {t.icon ? <span aria-hidden="true" className={on ? "text-gold" : "text-on-cream-muted"}>{t.icon}</span> : null}
            {t.label}
          </a>
        );
      })}
    </nav>
  );
}

/** A compact list: one bordered rounded block, rows separated by hairlines (the designs' list cards). */
export function ListCard({ children, label, testId }: { children: ReactNode; label?: string; testId?: string }) {
  return (
    <ul aria-label={label} data-testid={testId} className="divide-y divide-cream-line overflow-visible rounded-2xl border border-cream-line bg-[#fffdf8] shadow-[0_8px_24px_-20px_rgb(60_45_20/0.4)]">
      {children}
    </ul>
  );
}

/** Empty list / day: an icon in a soft circle, a title and one line of help. */
export function EmptyState({ title, body, icon, action }: { title: string; body?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center" role="status">
      {icon ? (
        <span aria-hidden="true" className="mb-4 inline-flex size-24 items-center justify-center rounded-full bg-gold/15 text-gold-press">
          {icon}
        </span>
      ) : null}
      <p className="font-display text-xl font-bold text-on-cream">{title}</p>
      {body ? <p className="mt-2 max-w-sm text-on-cream-muted">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function btn(kind: "primary" | "secondary" | "ghost" | "danger" = "secondary", extra = "") {
  const base =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const k =
    kind === "primary"
      ? "bg-gradient-to-b from-[#f0c865] to-gold text-ink shadow-[0_6px_16px_-10px_rgb(150_110_20/0.8)] hover:from-gold hover:to-gold-press"
      : kind === "danger"
        ? "border border-danger/50 text-danger hover:bg-danger/10"
        : kind === "ghost"
          ? "border border-cream-line bg-[#fffdf8] hover:border-on-cream-muted"
          : "bg-ink text-on-dark hover:bg-ink-2";
  return `${base} ${k} ${extra}`;
}

export function Field({
  label,
  children,
  hint,
  className = "",
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-on-cream-muted">{hint}</span> : null}
    </label>
  );
}

export const inputCls = "field !min-h-11 !py-1.5 text-sm";

export function Stat({ label, value, href, tone }: { label: string; value: ReactNode; href?: string; tone?: Tone }) {
  const inner = (
    <div
      className={`h-full rounded-md border bg-[#fffdf8] p-4 ${tone === "gold" ? "border-gold" : tone === "danger" ? "border-danger/50" : "border-cream-line"}`}
    >
      <p className="text-xs text-on-cream-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-90">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-on-cream-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`rounded-md border px-4 py-3 text-sm ${TONES[tone]}`}>{children}</div>;
}

export function LoadError({ what = "البيانات" }: { what?: string }) {
  return (
    <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-4 py-6 text-sm">
      تعذّر تحميل {what} الآن. حدّث الصفحة بعد قليل.
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="جارِ التحميل" className="space-y-4">
      <div className="h-8 w-48 animate-pulse rounded-sm bg-cream-line/70" />
      <div className="h-40 animate-pulse rounded-md bg-cream-line/50" />
      <div className="h-64 animate-pulse rounded-md bg-cream-line/40" />
    </div>
  );
}
