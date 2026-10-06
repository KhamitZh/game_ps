export interface RankInput {
  id: string;
  name: string;
  character: number;
  keys: number;
  /** Whole seconds since game start when the last key was earned; null when no keys. */
  lastKeyAt: number | null;
}

export type RankedPlayer = RankInput & { place: number };

/** Negative when `a` ranks higher. 0 means a true tie (same place). */
export function compareRank(a: RankInput, b: RankInput): number {
  if (a.keys !== b.keys) return b.keys - a.keys;
  // Equal keys > 0 ⇒ both lastKeyAt are numbers; equal keys = 0 ⇒ both null ⇒ tie.
  return (a.lastKeyAt ?? 0) - (b.lastKeyAt ?? 0);
}

export function rank<T extends RankInput>(players: readonly T[]): (T & { place: number })[] {
  const sorted = [...players].sort((a, b) => compareRank(a, b) || a.name.localeCompare(b.name));
  const out: (T & { place: number })[] = [];
  sorted.forEach((player, i) => {
    const prev = out[i - 1];
    const place = prev && compareRank(prev, player) === 0 ? prev.place : i + 1;
    out.push({ ...player, place });
  });
  return out;
}
