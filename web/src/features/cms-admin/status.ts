import type { Tone } from "@/features/admin/ui";

export type Dated = { starts_on: string | null; ends_on: string | null };
export type ScheduleState = "active" | "scheduled" | "expired";

/** Same rule as the DB: inclusive dates, compared to Hebron today (yyyy-mm-dd strings sort lexically). */
export function scheduleState(r: Dated, today: string): ScheduleState {
  if (r.starts_on && r.starts_on > today) return "scheduled";
  if (r.ends_on && r.ends_on < today) return "expired";
  return "active";
}

export type OfferStatus = "draft" | "published" | "archived";

export function offerBadge(o: Dated & { status: OfferStatus }, today: string): { label: string; tone: Tone; key: string } {
  if (o.status === "draft") return { label: "مسودة", tone: "neutral", key: "draft" };
  if (o.status === "archived") return { label: "مؤرشف", tone: "neutral", key: "archived" };
  const s = scheduleState(o, today);
  if (s === "scheduled") return { label: "مجدول", tone: "gold", key: s };
  if (s === "expired") return { label: "منتهي", tone: "danger", key: s };
  return { label: "ساري", tone: "success", key: s };
}

export function visibleBadge(r: Dated & { is_visible: boolean }, today: string): { label: string; tone: Tone } {
  if (!r.is_visible) return { label: "مخفي", tone: "neutral" };
  const s = scheduleState(r, today);
  if (s === "scheduled") return { label: "مجدول", tone: "gold" };
  if (s === "expired") return { label: "منتهي", tone: "danger" };
  return { label: "ظاهر الآن", tone: "success" };
}

export type PackageStatus = "draft" | "published" | "hidden";
export function packageBadge(p: { status: PackageStatus }): { label: string; tone: Tone; key: PackageStatus } {
  if (p.status === "published") return { label: "منشور", tone: "success", key: "published" };
  if (p.status === "hidden") return { label: "مخفي", tone: "neutral", key: "hidden" };
  return { label: "مسودة", tone: "neutral", key: "draft" };
}
