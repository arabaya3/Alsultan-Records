export type ReorderItem = { id: string; thumb: string | null; label: string };

/** New server list (an upload finished, a photo was trashed) merged into the admin's working order: their order is
 *  kept, photos that are gone are dropped, new photos are appended at the end, thumbs/labels are refreshed. */
export function mergeOrder(current: ReorderItem[], items: ReorderItem[]): ReorderItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const kept = current.filter((c) => byId.has(c.id)).map((c) => byId.get(c.id)!);
  const seen = new Set(kept.map((k) => k.id));
  return [...kept, ...items.filter((i) => !seen.has(i.id))];
}
