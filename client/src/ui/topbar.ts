import { LANGS, type Lang } from '../../../shared/src/constants';
import { isMuted, setMuted } from '../audio/sfx';
import { getLang, onLangChange, setLang } from '../i18n';

const LABEL: Record<Lang, string> = { kk: 'Қаз', ru: 'Рус', en: 'Eng' };

export function mountTopBar(root: HTMLElement, withSound = true): void {
  const render = () => {
    root.innerHTML = '';
    for (const lang of LANGS) {
      const b = document.createElement('button');
      b.className = `chip${lang === getLang() ? ' on' : ''}`;
      b.textContent = LABEL[lang];
      b.onclick = () => setLang(lang);
      root.append(b);
    }
    if (withSound) {
      const s = document.createElement('button');
      s.className = 'chip';
      s.textContent = isMuted() ? '🔇' : '🔊';
      s.onclick = () => {
        setMuted(!isMuted());
        render();
      };
      root.append(s);
    }
  };
  render();
  onLangChange(render);
}
