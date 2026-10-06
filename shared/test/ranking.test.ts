import { describe, expect, it } from 'vitest';
import { rank, type RankInput } from '../src/ranking';

const p = (id: string, keys: number, lastKeyAt: number | null): RankInput => ({
  id, name: id, character: 0, keys, lastKeyAt,
});

describe('rank', () => {
  it('orders by keys descending', () => {
    expect(rank([p('a', 3, 100), p('b', 5, 200)]).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('breaks key ties by the earlier last key', () => {
    const r = rank([p('slow', 10, 360), p('fast', 10, 300)]);
    expect(r.map((x) => [x.id, x.place])).toEqual([['fast', 1], ['slow', 2]]);
  });

  it('gives an equal place for equal keys and seconds, then skips', () => {
    const r = rank([p('a', 5, 60), p('b', 4, 30), p('c', 4, 30), p('d', 1, 10)]);
    expect(r.map((x) => x.place)).toEqual([1, 2, 2, 4]);
  });

  it('puts all zero-key players on the same place', () => {
    const r = rank([p('a', 0, null), p('b', 1, 50), p('c', 0, null)]);
    expect(r.map((x) => [x.id, x.place])).toEqual([['b', 1], ['a', 2], ['c', 2]]);
  });

  it('does not mutate input and handles an empty list', () => {
    const input = [p('a', 1, 5), p('b', 2, 5)];
    rank(input);
    expect(input.map((x) => x.id)).toEqual(['a', 'b']);
    expect(rank([])).toEqual([]);
  });

  it('keeps extra fields of the input objects', () => {
    const r = rank([{ ...p('a', 1, 5), rooms: 3 }]);
    expect(r[0].rooms).toBe(3);
  });
});
