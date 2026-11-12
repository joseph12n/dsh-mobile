import { describe, expect, it } from 'vitest';
import { translator } from './index.js';

/**
 * A notice stored as a **key** instead of as translated text.
 *
 * The bug this guards against: the pairing notice was translated when the failure
 * happened, so switching language afterwards left it behind in the old one. Same
 * screen, two languages.
 */

describe('a notice kept as a key', () => {
  /** How the view renders it: translate at paint time, not at failure time. */
  const render = (locale: 'en' | 'es' | 'zh-Hans'): string => translator(locale)('error.authLost');

  it('follows the language it is painted in', () => {
    expect(render('en')).toMatch(/no longer recognises/);
    expect(render('es')).toMatch(/ya no reconoce/);
    expect(render('zh-Hans')).toMatch(/不识别/);
  });

  it('is not frozen in the language it was created in', () => {
    // The failure "happens" in Portuguese; the paint happens in English.
    const createdAt = translator('pt-BR')('error.authLost');
    expect(createdAt).toMatch(/não reconhece/);
    expect(render('en')).not.toBe(createdAt);
  });
});
