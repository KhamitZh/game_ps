import { QUESTION_TIME_MS } from '../../../shared/src/constants';
import type { QuestionView } from '../../../shared/src/protocol';
import { t } from '../i18n';
import { escapeHtml } from './dom';

const SHAPES = ['▲', '◆', '●', '■'];
const LOW_TIME_MS = 10_000;

/** A multi-line question is a prompt line followed by code: the code is shown in a monospace block. */
export function splitQuestion(q: string): { text: string; code: string | null } {
  const nl = q.indexOf('\n');
  if (nl < 0) return { text: q, code: null };
  return { text: q.slice(0, nl), code: q.slice(nl + 1) };
}

export class QuestionModal {
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private locked = false;
  private timer: number | null = null;

  constructor(private readonly root: HTMLElement) {}

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** An answer was picked and the modal is waiting for the server's verdict. */
  get isLocked(): boolean {
    return this.isOpen && this.locked;
  }

  /**
   * `offset` = server clock − local clock. When the deadline passes the modal locks and calls
   * onAnswer(-1): the server then counts the room as answered wrong.
   */
  open(q: QuestionView, offset: number, onAnswer: (i: number) => void, onClose: () => void): void {
    this.close();
    this.locked = false;
    const { text, code } = splitQuestion(q.q);
    this.root.innerHTML = `
      <div class="panel q-card" role="dialog" aria-modal="true">
        <div class="q-head">
          <span>${t('question.title')} · ${t(`room.${q.roomId}`)}</span>
          <span class="q-left"></span>
          <button class="btn q-close" type="button" aria-label="${t('question.close')}">✕</button>
        </div>
        <div class="q-timer" role="progressbar" aria-label="${t('question.timeLeft')}"><div></div></div>
        <div class="q-text">${escapeHtml(text)}</div>
        ${code !== null ? `<pre class="q-code"><code>${escapeHtml(code)}</code></pre>` : ''}
        <div class="q-opts">
          ${q.options
            .map((o, i) => `<button class="btn q-opt" type="button" data-i="${i}"><span class="shape">${SHAPES[i]}</span><span class="opt-text${code !== null ? ' mono' : ''}">${escapeHtml(o)}</span></button>`)
            .join('')}
        </div>
        <div class="q-result"></div>
      </div>`;
    this.root.hidden = false;

    const pick = (i: number) => {
      if (this.locked) return;
      this.locked = true;
      this.stopTimer();
      this.root.querySelectorAll<HTMLButtonElement>('.q-opt').forEach((b) => {
        b.disabled = true;
        b.classList.toggle('picked', Number(b.dataset.i) === i);
      });
      this.root.querySelector<HTMLButtonElement>('.q-close')!.disabled = true;
      onAnswer(i);
    };

    const bar = this.root.querySelector<HTMLElement>('.q-timer')!;
    const left = this.root.querySelector<HTMLElement>('.q-left')!;
    const timed = Number.isFinite(q.deadline);
    bar.hidden = !timed;
    const tick = () => {
      if (!timed) return;
      const ms = Math.max(0, q.deadline - (Date.now() + offset));
      bar.firstElementChild!.setAttribute('style', `width:${(100 * ms) / QUESTION_TIME_MS}%`);
      bar.classList.toggle('low', ms <= LOW_TIME_MS);
      left.textContent = `⏱ ${Math.ceil(ms / 1000)}`;
      if (ms > 0 || this.locked) return;
      this.root.querySelector('.q-result')!.textContent = t('question.timeUp');
      pick(-1);
    };
    tick();
    if (timed && !this.locked) this.timer = window.setInterval(tick, 250);
    const dismiss = () => {
      if (this.locked) return;
      this.close();
      onClose();
    };
    this.root.querySelectorAll<HTMLButtonElement>('.q-opt').forEach((b) => b.addEventListener('click', () => pick(Number(b.dataset.i))));
    this.root.querySelector('.q-close')!.addEventListener('click', dismiss);
    this.onKey = (e) => {
      if (e.key >= '1' && e.key <= '4') pick(Number(e.key) - 1);
      else if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', this.onKey);
  }

  showResult(correct: boolean): void {
    const r = this.root.querySelector('.q-result');
    if (!r) return;
    r.className = `q-result ${correct ? 'good' : 'bad'}`;
    r.textContent = t(correct ? 'answer.correct' : 'answer.wrong');
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  close(): void {
    this.stopTimer();
    if (this.onKey) window.removeEventListener('keydown', this.onKey);
    this.onKey = null;
    this.root.hidden = true;
    this.root.innerHTML = '';
  }
}
