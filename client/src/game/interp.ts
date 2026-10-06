import type { Point } from '../../../shared/src/map';

interface Sample { t: number; x: number; y: number }

/** Buffers timestamped positions of a remote player and samples them slightly in the past. */
export class Interp {
  private buf: Sample[] = [];

  push(t: number, x: number, y: number): void {
    this.buf.push({ t, x, y });
    if (this.buf.length > 20) this.buf.shift();
  }

  reset(): void {
    this.buf = [];
  }

  last(): Point | null {
    const s = this.buf[this.buf.length - 1];
    return s ? { x: s.x, y: s.y } : null;
  }

  sample(t: number): Point | null {
    const b = this.buf;
    if (b.length === 0) return null;
    if (t <= b[0].t) return { x: b[0].x, y: b[0].y };
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].t > t) continue;
      const a = b[i];
      const n = b[i + 1];
      if (!n) return { x: a.x, y: a.y };
      const k = (t - a.t) / (n.t - a.t);
      return { x: a.x + (n.x - a.x) * k, y: a.y + (n.y - a.y) * k };
    }
    return null;
  }
}
