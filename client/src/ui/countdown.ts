import { sfx } from '../audio/sfx';
import { t } from '../i18n';
import { escapeHtml } from './dom';

/** Shows 3-2-1-Go using the server's countdown end time. Returns a cancel function. */
export function runCountdown(root: HTMLElement, endsAtServer: number, offset: number, onDone: () => void): () => void {
  root.hidden = false;
  let shown = '';
  const finish = () => {
    clearInterval(id);
    root.hidden = true;
    root.innerHTML = '';
  };
  const tick = () => {
    const ms = endsAtServer - (Date.now() + offset);
    const label = ms > 0 ? String(Math.ceil(ms / 1000)) : t('countdown.go');
    if (label !== shown) {
      shown = label;
      root.innerHTML = `<div class="cd-num">${escapeHtml(label)}</div>`;
      if (ms > 0) sfx.beep();
      else sfx.go();
    }
    if (ms <= -800) {
      finish();
      onDone();
    }
  };
  const id = window.setInterval(tick, 100);
  tick();
  return finish;
}
