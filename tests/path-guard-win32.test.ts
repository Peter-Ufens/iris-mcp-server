import { describe, it, expect } from 'vitest';
import { assertWindowsPathSyntax, isPathUnderRoot, PathGuardError } from '../src/utils/path-guard.js';

/**
 * Dette D4 (Windows) : fonctions pures testees sous Linux via path.win32.
 * Smoke manuel a faire sur le PC Windows de Peter : voir SECURITY.md (8.3 via realpath natif,
 * jonction vers un partage UNC, casse des lecteurs).
 */
describe('D4 assertWindowsPathSyntax', () => {
  const refuses = [
    '\\\\serveur\\partage\\f.txt',
    '//serveur/partage/f.txt',
    '\\\\?\\C:\\Data\\f.txt',
    '\\\\.\\C:\\Data\\f.txt',
    '\\\\.\\PhysicalDrive0',
    'C:\\Data\\f.txt:flux',
    'C:\\Data\\f.txt::$DATA',
    'C:f.txt',
    'C:\\Data\\secret.',
    'C:\\Data\\secret ',
    'C:\\Data\\CON',
    'C:\\Data\\nul.txt',
    'C:\\Data\\com1',
    'C:\\Data\\LPT9.log',
  ];
  for (const p of refuses) {
    it(`refuse ${JSON.stringify(p)}`, () => {
      expect(() => assertWindowsPathSyntax(p)).toThrow(PathGuardError);
    });
  }

  const acceptes = ['C:\\Data\\f.txt', 'D:/Projets/notes.md', 'C:\\Data\\..\\Data\\.\\f.txt', 'C:\\Data\\console.md', 'C:\\Data\\v1.2\\a'];
  for (const p of acceptes) {
    it(`accepte ${JSON.stringify(p)}`, () => {
      expect(() => assertWindowsPathSyntax(p)).not.toThrow();
    });
  }
});

describe('D4 isPathUnderRoot (win32 : insensible a la casse)', () => {
  it('casse et separateurs differents : meme racine', () => {
    expect(isPathUnderRoot('c:\\data\\Sous\\f.txt', 'C:\\Data', true)).toBe(true);
    expect(isPathUnderRoot('C:/DATA/f.txt', 'c:\\data\\', true)).toBe(true);
    expect(isPathUnderRoot('C:\\Data', 'c:\\DATA', true)).toBe(true);
  });
  it('prefixe trompeur refuse', () => {
    expect(isPathUnderRoot('C:\\Data2\\f.txt', 'C:\\Data', true)).toBe(false);
    expect(isPathUnderRoot('D:\\Data\\f.txt', 'C:\\Data', true)).toBe(false);
  });
  it('racine de lecteur', () => {
    expect(isPathUnderRoot('C:\\x\\y', 'C:\\', true)).toBe(true);
  });
  it('mode posix inchange (sensible a la casse)', () => {
    expect(isPathUnderRoot('/data/f', '/data', false)).toBe(true);
    expect(isPathUnderRoot('/DATA/f', '/data', false)).toBe(false);
  });
});
