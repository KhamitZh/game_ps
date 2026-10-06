import type { QuestionView } from '../../../shared/src/protocol';
import { t } from '../i18n';
import { escapeHtml } from './dom';

const SHAPES = ['▲', '◆', '●', '■'];

export class QuestionModal {
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private locked = false;

  constructor(private readonly root: HTMLElement) {}

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(q: QuestionView, onAnswer: (i: number) => void, onClose: () => void): void {
    this.close();
    this.locked = false;
    this.root.innerHTML = `
      <div class="panel q-card" role="dialog" aria-modal="true">
        <div class="q-head">
          <span>${t('question.title')} · ${t(`room.${q.roomId}`)}</span>
          <button class="btn q-close" type="button" aria-label="${t('question.close')}">✕</button>
        </div>
        <div class="q-text">${escapeHtml(q.q)}</div>
        <div class="q-opts">
          ${q.options
            .map((o, i) => `<button class="btn q-opt" type="button" data-i="${i}"><span class="shape">${SHAPES[i]}</span><span>${escapeHtml(o)}</span></button>`)
            .join('')}
        </div>
        <div class="q-result"></div>
      </div>`;
    this.root.hidden = false;

    const pick = (i: number) => {
      if (this.locked) return;
      this.locked = true;
      this.root.querySelectorAll<HTMLButtonElement>('.q-opt').forEach((b) => {
        b.disabled = true;
        b.classList.toggle('picked', Number(b.dataset.i) === i);
      });
      this.root.querySelector<HTMLButtonElement>('.q-close')!.disabled = true;
      onAnswer(i);
    };
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

  close(): void {
    if (this.onKey) window.removeEventListener('keydown', this.onKey);
    this.onKey = null;
    this.root.hidden = true;
    this.root.innerHTML = '';
  }
}
