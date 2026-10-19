import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export async function listQuotes(supabase: Client, eventId: string) {
  const { data, error } = await supabase
    .from("quotes")
    .select("id, quote_no, status, currency, subtotal, discount, total, valid_until, accepted_at, quote_items(id, description, qty, unit_price, line_total, sort_order)")
    .eq("event_id", eventId)
    .neq("status", "draft")
    .order("created_at", { ascending: false });
  if (error) return null;
  return (data ?? []).map((q) => ({
    ...q,
    quote_items: [...(q.quote_items ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));
}

export async function listContracts(supabase: Client, eventId: string) {
  const { data, error } = await supabase
    .from("contracts")
    .select("id, status, current_version_id, approved_version_id, approved_at")
    .eq("event_id", eventId)
    .neq("status", "draft")
    .order("created_at", { ascending: false });
  if (error) return null;
  const ids = (data ?? []).map((c) => c.current_version_id).filter((x): x is string => Boolean(x));
  const versions = new Map<string, { id: string; version_no: number; body: string; currency: string; total: number; deposit_required: number; content_hash: string; created_at: string }>();
  if (ids.length) {
    const { data: v, error: e } = await supabase
      .from("contract_versions")
      .select("id, version_no, body, currency, total, deposit_required, content_hash, created_at")
      .in("id", ids);
    if (e) return null;
    for (const x of v ?? []) versions.set(x.id, x);
  }
  return (data ?? []).map((c) => ({ ...c, version: c.current_version_id ? (versions.get(c.current_version_id) ?? null) : null }));
}

export async function getPayments(supabase: Client, eventId: string) {
  const [p, f] = await Promise.all([
    supabase
      .from("payments")
      .select("id, kind, amount, currency, method, received_at, reference")
      .eq("event_id", eventId)
      .order("received_at", { ascending: false }),
    supabase.rpc("event_financials", { p_event_id: eventId }),
  ]);
  if (p.error || f.error) return null;
  return { payments: p.data ?? [], totals: f.data?.[0] ?? null };
}
