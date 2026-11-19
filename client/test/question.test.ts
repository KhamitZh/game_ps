import { describe, expect, it } from 'vitest';
import { splitQuestion } from '../src/ui/question';

describe('splitQuestion', () => {
  it('keeps a one-line question as text', () => {
    expect(splitQuestion('Екілік жүйеде неше цифр бар?')).toEqual({ text: 'Екілік жүйеде неше цифр бар?', code: null });
  });

  it('splits the prompt line from the code, keeping indentation', () => {
    expect(splitQuestion('Программа нені шығарады?\nfor i in range(3):\n    print(i)')).toEqual({
      text: 'Программа нені шығарады?',
      code: 'for i in range(3):\n    print(i)',
    });
  });
});
