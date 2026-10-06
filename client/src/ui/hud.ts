import { TOTAL_ROOMS } from '../../../shared/src/constants';
import type { FloorId } from '../../../shared/src/map';
import { t } from '../i18n';
import { escapeHtml, fmtTime } from './dom';

export interface HudData {
  keys: number;
  rooms: number;
  floor: FloorId;
  hint: string;
}

export class Hud {
  private data: HudData = { keys: 0, rooms: 0, floor: 'lobby', hint: '' };
  private endsAt: number | null = null;
  private offset = 0;
  private timer: number | null = null;

  constructor(private readonly root: HTMLElement) {}

  show(): void {
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
    this.stopTimer();
  }

  set(d: Partial<HudData>): void {
    Object.assign(this.data, d);
    this.render();
  }

  setDeadline(endsAt: number, offset: number): void {
    this.endsAt = endsAt;
    this.offset = offset;
    this.stopTimer();
    this.timer = window.setInterval(() => this.renderTime(), 250);
    this.render();
  }

  stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  render(): void {
    if (this.root.hidden) return;
    const d = this.data;
    this.root.innerHTML = `
      <div class="hud-row">
        <span>🔑 ${d.keys}/${TOTAL_ROOMS}</span>
        <span>🚪 ${d.rooms}/${TOTAL_ROOMS}</span>
        <span class="hud-time">⏱ ${fmtTime(this.remaining())}</span>
        <span>${t(`floor.${d.floor}`)}</span>
      </div>
      <div><span class="hud-hint">${escapeHtml(d.hint)}</span></div>`;
  }

  private remaining(): number | null {
    if (this.endsAt === null) return null;
    return Math.max(0, Math.ceil((this.endsAt - (Date.now() + this.offset)) / 1000));
  }

  private renderTime(): void {
    const el = this.root.querySelector('.hud-time');
    if (el) el.textContent = `⏱ ${fmtTime(this.remaining())}`;
  }
}
