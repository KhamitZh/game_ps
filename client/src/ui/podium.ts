import type { RankedPlayer } from '../../../shared/src/ranking';
import { characterPreview } from '../art/characters';
import { t } from '../i18n';
import { el, fmtTime } from './dom';

export function podium(ranking: RankedPlayer[]): HTMLElement {
  const wrap = el('div', 'podium');
  for (const place of [2, 1, 3]) {
    const group = ranking.filter((r) => r.place === place);
    const col = el('div', `pod p${place}`);
    const figs = el('div');
    group.slice(0, 3).forEach((r) => figs.append(characterPreview(r.character)));
    const names = el('div', 'names');
    names.textContent = group.length ? group.map((r) => r.name).join(', ') : '—';
    const meta = el('div', 'meta');
    meta.textContent = group.length ? `🔑 ${group[0].keys} · ⏱ ${fmtTime(group[0].lastKeyAt)}` : '';
    const block = el('div', 'block');
    block.textContent = String(place);
    col.append(figs, names, meta, block);
    wrap.append(col);
  }
  return wrap;
}

export function renderResults(root: HTMLElement, ranking: RankedPlayer[], myId: string | null): void {
  const me = myId ? ranking.find((r) => r.id === myId) : undefined;
  root.innerHTML = `
    <div class="results panel">
      <h1 class="logo">${t('results.title')}</h1>
      <div class="podium-slot"></div>
      ${me ? `<div class="myplace">${t('results.yourPlace', { place: me.place })}</div><div class="label">🔑 ${me.keys} · ⏱ ${fmtTime(me.lastKeyAt)}</div>` : ''}
    </div>`;
  root.querySelector('.podium-slot')!.replaceWith(podium(ranking));
}
