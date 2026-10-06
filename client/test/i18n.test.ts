import { describe, expect, it } from 'vitest';
import { LANGS } from '../../shared/src/constants';
import { ROOM_IDS } from '../../shared/src/map';
import { ERROR_CODES } from '../../shared/src/protocol';
import { DICTS, getLang, setLang, t } from '../src/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n dictionaries', () => {
  it('have identical key sets in kk, ru and en', () => {
    const kk = Object.keys(DICTS.kk).sort();
    for (const l of LANGS) expect(Object.keys(DICTS[l]).sort(), l).toEqual(kk);
  });

  it('have no empty strings and matching placeholders', () => {
    for (const key of Object.keys(DICTS.kk)) {
      for (const l of LANGS) {
        expect(DICTS[l][key].trim(), `${l}:${key}`).not.toBe('');
        expect(placeholders(DICTS[l][key]), `${l}:${key}`).toEqual(placeholders(DICTS.kk[key]));
      }
    }
  });

  it('cover every error code, room and floor', () => {
    for (const code of [...ERROR_CODES, 'NETWORK']) expect(DICTS.kk[`error.${code}`], code).toBeDefined();
    for (const id of ROOM_IDS) expect(DICTS.kk[`room.${id}`], id).toBeDefined();
    for (const f of ['lobby', 'f1', 'f2']) expect(DICTS.kk[`floor.${f}`]).toBeDefined();
  });
});

describe('t', () => {
  it('translates, interpolates and switches language', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    expect(t('results.yourPlace', { place: 7 })).toBe('Your place: 7');
    setLang('kk');
    expect(t('results.yourPlace', { place: 7 })).toBe('Сіздің орныңыз: 7');
  });

  it('falls back to the key for unknown entries', () => {
    expect(t('nope.nothing')).toBe('nope.nothing');
  });
});
