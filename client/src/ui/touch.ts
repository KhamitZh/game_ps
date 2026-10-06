export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

const RADIUS = 50;

export class TouchControls {
  private readonly act: HTMLButtonElement;
  private pointerId: number | null = null;

  constructor(root: HTMLElement, onVector: (v: { x: number; y: number }) => void, onAction: () => void) {
    root.innerHTML = `<div class="joy"><div class="knob"></div></div><button class="act" type="button" aria-label="action">✋</button>`;
    root.hidden = false;
    const joy = root.querySelector<HTMLElement>('.joy')!;
    const knob = root.querySelector<HTMLElement>('.knob')!;
    this.act = root.querySelector<HTMLButtonElement>('.act')!;

    const update = (e: PointerEvent) => {
      const r = joy.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        dx = (dx / len) * RADIUS;
        dy = (dy / len) * RADIUS;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      onVector({ x: dx / RADIUS, y: dy / RADIUS });
    };
    const reset = () => {
      this.pointerId = null;
      knob.style.transform = '';
      onVector({ x: 0, y: 0 });
    };
    joy.addEventListener('pointerdown', (e) => {
      this.pointerId = e.pointerId;
      joy.setPointerCapture(e.pointerId);
      update(e);
    });
    joy.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointerId) update(e);
    });
    joy.addEventListener('pointerup', reset);
    joy.addEventListener('pointercancel', reset);
    this.act.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onAction();
    });
  }

  setReady(on: boolean): void {
    this.act.classList.toggle('ready', on);
  }
}
