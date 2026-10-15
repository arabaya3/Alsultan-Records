/** Client-only: hard navigation to login (drops all client state) keeping a same-origin return path. */
export function goToLogin() {
  const next = window.location.pathname + window.location.search;
  // Intentional hard navigation: discards all client state for the expired session.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `/login?next=${encodeURIComponent(next)}`;
}
