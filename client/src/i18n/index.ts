import { LANGS, type Lang } from '../../../shared/src/constants';
import en from './en.json';
import kk from './kk.json';
import ru from './ru.json';

export const DICTS: Record<Lang, Record<string, string>> = { kk, ru, en };
const STORE_KEY = 'kh.lang';
const listeners = new Set<() => void>();

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && (LANGS as readonly string[]).includes(saved)) return saved as Lang;
  } catch {
    // no storage (tests, privacy mode)
  }
  return 'kk';
}

let current: Lang = detect();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORE_KEY, lang);
  } catch {
    // ignore
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  listeners.forEach((fn) => fn());
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: string, params?: Record<string, string | number>): string {
  const s = DICTS[current][key] ?? DICTS.kk[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (params && k in params ? String(params[k]) : `{${k}}`));
}
