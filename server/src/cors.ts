/** Echoes the caller's origin when it is on the allow list (a list cannot go into one header). */
export function allowOrigin(allowed: string | undefined, origin: string | null): string {
  const list = (allowed || '*').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  if (list.includes('*')) return '*';
  return origin && list.includes(origin) ? origin : list[0] ?? '*';
}
