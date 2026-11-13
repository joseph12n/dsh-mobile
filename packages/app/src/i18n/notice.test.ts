import { describe, expect, it } from 'vitest';
import { translator } from './index.js';

describe('a notice kept as a key', () => {
  const render = (locale: 'en' | 'es' | 'zh-Hans'): string => translator(locale)('error.authLost');

  it('follows the language it is painted in', () => {
    expect(render('en')).toMatch(/no longer recognises/);
    expect(render('es')).toMatch(/ya no reconoce/);
    expect(render('zh-Hans')).toMatch(/不识别/);
  });

  it('is not frozen in the language it was created in', () => {
    const createdAt = translator('pt-BR')('error.authLost');
    expect(createdAt).toMatch(/não reconhece/);
    expect(render('en')).not.toBe(createdAt);
  });
});
