import { describe, it, expect } from 'vitest';
import { matchSimpleGlob } from '../src/utils/simple-glob.js';

describe('matchSimpleGlob', () => {
  it('match exact et * / ?', () => {
    expect(matchSimpleGlob('fichier.ts', '*.ts')).toBe(true);
    expect(matchSimpleGlob('fichier.ts', '*.js')).toBe(false);
    expect(matchSimpleGlob('a.txt', '?.txt')).toBe(true);
    expect(matchSimpleGlob('ab.txt', '?.txt')).toBe(false);
    expect(matchSimpleGlob('foo-bar.ts', 'foo-*.ts')).toBe(true);
  });

  it('reste rapide avec beaucoup de * (pas de ReDoS)', () => {
    const nom = `${'a'.repeat(60)}.txt`;
    const motif = `${'*a'.repeat(20)}*b`;
    const t0 = Date.now();
    expect(matchSimpleGlob(nom, motif)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(50);
  });
});
