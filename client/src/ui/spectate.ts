import type { PublicPlayer } from '../../../shared/src/protocol';
import { t } from '../i18n';
import { escapeHtml } from './dom';

export class SpectateBar {
  private targets: PublicPlayer[] = [];
  private current: string | null = null;

  constructor(private readonly root: HTMLElement, private readonly onChange: (id: string | null) => void) {}

  show(): void {
    if (!this.root.hidden) return;
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  setRoster(players: PublicPlayer[]): void {
    this.targets = players.filter((p) => p.status === 'playing' && p.online);
    if (this.current && !this.targets.some((p) => p.id === this.current)) this.choose(null);
    this.render();
  }

  render(): void {
    if (this.root.hidden) return;
    const cur = this.targets.find((p) => p.id === this.current);
    let inner: string;
    if (cur) {
      inner = `
        <button class="btn prev" type="button">◀</button>
        <div class="who">${t('spectate.watching', { name: escapeHtml(cur.name) })}<br>🔑 ${cur.keys} · 🚪 ${cur.rooms} · ${t(`floor.${cur.floor}`)}</div>
        <button class="btn next" type="button">▶</button>
        <button class="btn back" type="button">${t('spectate.stop')}</button>`;
    } else if (this.targets.length) {
      inner = `<button class="btn btn-gold watch" type="button">${t('spectate.watch')}</button>`;
    } else {
      inner = `<div class="who">${t('spectate.none')}</div>`;
    }
    this.root.innerHTML = `<div class="bar">${inner}</div>`;
    this.root.querySelector('.prev')?.addEventListener('click', () => this.cycle(-1));
    this.root.querySelector('.next')?.addEventListener('click', () => this.cycle(1));
    this.root.querySelector('.watch')?.addEventListener('click', () => this.cycle(1));
    this.root.querySelector('.back')?.addEventListener('click', () => this.choose(null));
  }

  private cycle(step: number): void {
    const n = this.targets.length;
    if (!n) return;
    const i = this.targets.findIndex((p) => p.id === this.current);
    const base = i < 0 ? (step > 0 ? -1 : 0) : i;
    this.choose(this.targets[(base + step + n) % n].id);
  }

  private choose(id: string | null): void {
    this.current = id;
    this.onChange(id);
    this.render();
  }
}
