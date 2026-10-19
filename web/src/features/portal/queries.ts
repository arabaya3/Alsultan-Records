import "server-only";
import { cache } from "react";
import { isUuid, requireCustomer } from "./session";

export const EVENT_COLUMNS = "id, title, event_type, event_date, venue, city, status" as const;

export type PortalEvent = {
  id: string;
  title: string;
  event_type: string | null;
  event_date: string | null;
  venue: string | null;
  city: string | null;
  status: string;
};

export type DeliverableSummary = { id: string; kind: string; title: string; status: string; due_at: string | null };

export type MyEvent = PortalEvent & { deliverables: DeliverableSummary[] };

export type Result<T> = { status: "ok"; data: T } | { status: "unavailable" };

export async function listMyEvents(): Promise<Result<MyEvent[]>> {
  const { session, supabase } = await requireCustomer("/portal");
  const { data: cust } = await supabase.from("customers").select("id").eq("user_id", session.userId).maybeSingle();
  if (!cust) return { status: "ok", data: [] };
  const { data, error } = await supabase
    .from("events")
    .select(`${EVENT_COLUMNS}, deliverables(id, kind, title, status, due_at)`)
    .eq("customer_id", cust.id)
    .order("event_date", { ascending: false, nullsFirst: false });
  if (error) return { status: "unavailable" };
  return { status: "ok", data: (data ?? []) as MyEvent[] };
}

export type EventTabs = {
  gallery: boolean;
  selection: boolean;
  videos: boolean;
  files: boolean;
  quotes: boolean;
  contracts: boolean;
  payments: boolean;
};

export type EventOverview = { event: PortalEvent; deliverables: DeliverableSummary[]; tabs: EventTabs; imageCount: number };

/**
 * Event + which tabs have data. Returns null when the event does not exist OR belongs to someone
 * else (RLS hides it) — callers render notFound() for both, so existence is never leaked.
 */
export const getEventOverview = cache(async (eventId: string): Promise<Result<EventOverview | null>> => {
  const { supabase } = await requireCustomer(`/portal/events/${eventId}`);
  if (!isUuid(eventId)) return { status: "ok", data: null };
  const { data: event, error } = await supabase.from("events").select(EVENT_COLUMNS).eq("id", eventId).maybeSingle();
  if (error) return { status: "unavailable" };
  if (!event) return { status: "ok", data: null };

  const head = { count: "exact", head: true } as const;
  const [deliv, images, docs, quotes, contracts, payments, selection] = await Promise.all([
    supabase.from("deliverables").select("id, kind, title, status, due_at").eq("event_id", eventId).order("created_at"),
    supabase.from("media_assets").select("id", head).eq("event_id", eventId).eq("kind", "image"),
    supabase.from("media_assets").select("id", head).eq("event_id", eventId).eq("kind", "document"),
    supabase.from("quotes").select("id", head).eq("event_id", eventId),
    supabase.from("contracts").select("id", head).eq("event_id", eventId),
    supabase.from("payments").select("id", head).eq("event_id", eventId),
    supabase.from("album_selections").select("id", head).eq("event_id", eventId),
  ]);
  const deliverables = (deliv.data ?? []) as DeliverableSummary[];
  const imageCount = images.count ?? 0;
  return {
    status: "ok",
    data: {
      event: event as PortalEvent,
      deliverables,
      imageCount,
      tabs: {
        gallery: imageCount > 0,
        selection: imageCount > 0 || (selection.count ?? 0) > 0,
        videos: deliverables.some((d) => d.kind === "video"),
        files: (docs.count ?? 0) > 0 || deliverables.some((d) => d.kind === "files" || d.kind === "album"),
        quotes: (quotes.count ?? 0) > 0,
        contracts: (contracts.count ?? 0) > 0,
        payments: (payments.count ?? 0) > 0 || (contracts.count ?? 0) > 0,
      },
    },
  };
});
