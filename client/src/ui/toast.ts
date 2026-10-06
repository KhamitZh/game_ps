import { byId, el } from './dom';

export function toast(text: string, kind: 'info' | 'good' | 'bad' = 'info', ms = 2600): void {
  const root = byId('toasts');
  const box = el('div', `toast ${kind}`);
  box.textContent = text;
  root.append(box);
  while (root.children.length > 3) root.firstElementChild!.remove();
  setTimeout(() => box.remove(), ms);
}
