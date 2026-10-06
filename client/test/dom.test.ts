import { describe, expect, it } from 'vitest';
import { escapeHtml, fmtTime } from '../src/ui/dom';

describe('escapeHtml', () => {
  it('neutralises markup in player names', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;',
    );
  });
});

describe('fmtTime', () => {
  it('formats seconds as mm:ss and null as a dash', () => {
    expect(fmtTime(0)).toBe('00:00');
    expect(fmtTime(75)).toBe('01:15');
    expect(fmtTime(3600)).toBe('60:00');
    expect(fmtTime(null)).toBe('—');
  });
});
