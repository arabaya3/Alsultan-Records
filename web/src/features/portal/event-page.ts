import "server-only";
import { notFound } from "next/navigation";
import { getEventOverview } from "./queries";
import { requireCustomer } from "./session";

/**
 * Resolves the event for a portal sub-page. Missing and foreign events both 404
 * (RLS hides other customers' rows, so they are indistinguishable by design).
 * Returns null when the backend is unavailable (caller renders a retry state).
 */
export async function loadEventPage(params: Promise<{ eventId: string }>, sub = "") {
  const { eventId } = await params;
  const path = `/portal/events/${encodeURIComponent(eventId)}${sub ? `/${sub}` : ""}`;
  const { supabase } = await requireCustomer(path);
  const res = await getEventOverview(eventId);
  if (res.status === "unavailable") return { path, overview: null, supabase, eventId };
  if (!res.data) notFound();
  return { path, overview: res.data, supabase, eventId };
}
