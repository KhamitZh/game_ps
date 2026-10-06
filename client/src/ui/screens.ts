import { CHARACTER_COUNT, NAME_MAX, PIN_LENGTH } from '../../../shared/src/constants';
import { characterPreview } from '../art/characters';
import { t } from '../i18n';
import { escapeHtml } from './dom';

const errorText = (code?: string) => (code ? t(`error.${code}`) : '');

export function renderHome(root: HTMLElement, opts: { pin: string; error?: string }, onSubmit: (pin: string) => void): void {
  root.innerHTML = `
    <form class="card panel stack" novalidate>
      <h1 class="logo">${t('app.title')}</h1>
      <p class="sub">${t('home.subtitle')}</p>
      <label class="label" for="pin">${t('home.pin')}</label>
      <input id="pin" class="input" inputmode="numeric" autocomplete="off" maxlength="${PIN_LENGTH}" placeholder="123456" value="${escapeHtml(opts.pin)}" />
      <p class="error">${errorText(opts.error)}</p>
      <button class="btn btn-gold" type="submit">${t('home.enter')}</button>
    </form>`;
  const input = root.querySelector<HTMLInputElement>('#pin')!;
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
  });
  root.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value.length === PIN_LENGTH) onSubmit(input.value);
    else root.querySelector('.error')!.textContent = errorText('PIN_NOT_FOUND');
  });
  input.focus();
}

export function renderName(
  root: HTMLElement,
  opts: { name: string; error?: string },
  onSubmit: (name: string) => void,
  onBack: () => void,
  onInput: (name: string) => void,
): void {
  root.innerHTML = `
    <form class="card panel stack" novalidate>
      <h1 class="logo">${t('app.title')}</h1>
      <label class="label" for="name">${t('name.title')}</label>
      <input id="name" class="input" autocomplete="off" maxlength="${NAME_MAX}" placeholder="${t('name.placeholder')}" value="${escapeHtml(opts.name)}" />
      <p class="error">${errorText(opts.error)}</p>
      <div class="row">
        <button class="btn" type="button" id="back">${t('common.back')}</button>
        <button class="btn btn-gold" type="submit">${t('common.next')}</button>
      </div>
    </form>`;
  const input = root.querySelector<HTMLInputElement>('#name')!;
  input.addEventListener('input', () => onInput(input.value));
  root.querySelector('#back')!.addEventListener('click', onBack);
  root.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim().replace(/\s+/g, ' ');
    const len = [...name].length;
    if (len >= 1 && len <= NAME_MAX) onSubmit(name);
    else root.querySelector('.error')!.textContent = errorText('NAME_INVALID');
  });
  input.focus();
}

export function renderCharacters(
  root: HTMLElement,
  opts: { selected: number; error?: string },
  onSelect: (i: number) => void,
  onJoin: () => void,
  onBack: () => void,
): void {
  root.innerHTML = `
    <div class="card panel stack">
      <h2 class="sub">${t('char.title')}</h2>
      <div class="chars"></div>
      <p class="error">${errorText(opts.error)}</p>
      <div class="row">
        <button class="btn" type="button" id="back">${t('common.back')}</button>
        <button class="btn btn-gold" type="button" id="join">${t('char.join')}</button>
      </div>
    </div>`;
  const grid = root.querySelector<HTMLElement>('.chars')!;
  const join = root.querySelector<HTMLButtonElement>('#join')!;
  let selected = opts.selected;
  join.disabled = selected < 0;
  for (let i = 0; i < CHARACTER_COUNT; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `char${i === selected ? ' sel' : ''}`;
    b.setAttribute('aria-label', `#${i + 1}`);
    b.append(characterPreview(i));
    b.addEventListener('click', () => {
      selected = i;
      grid.querySelectorAll('.char').forEach((c, j) => c.classList.toggle('sel', j === i));
      join.disabled = false;
      onSelect(i);
    });
    grid.append(b);
  }
  root.querySelector('#back')!.addEventListener('click', onBack);
  join.addEventListener('click', () => {
    if (selected < 0) return;
    join.disabled = true;
    onJoin();
  });
}
