import { describe, it, expect } from 'vitest';
import { decodeEntities, htmlToText, isHtmlContentType } from '../src/utils/html-text.js';

describe('html-text', () => {
  it('retire script et style', () => {
    const html = '<html><head><style>body{color:red}</style></head><body><script>alert(1)</script><p>Bonjour</p></body></html>';
    const text = htmlToText(html);
    expect(text).toContain('Bonjour');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
  });

  it('retire les commentaires et les balises', () => {
    const text = htmlToText('<!-- cache --><div class="x">Titre</div>');
    expect(text).toBe('Titre');
  });

  it('transforme les blocs en sauts de ligne', () => {
    const text = htmlToText('<p>Ligne 1</p><p>Ligne 2</p><br>Ligne 3');
    expect(text.split('\n').filter((l) => l.length > 0)).toEqual(['Ligne 1', 'Ligne 2', 'Ligne 3']);
  });

  it('decode les entites courantes et numeriques', () => {
    expect(decodeEntities('Caf&eacute; &amp; th&#233; &#x21;')).toBe('Café & thé !');
    expect(decodeEntities('a&nbsp;b')).toBe('a b');
  });

  it('ne double-decode pas &amp;lt;', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
  });

  it('normalise les espaces multiples', () => {
    expect(htmlToText('<p>  trop    d   espaces  </p>')).toBe('trop d espaces');
  });

  it('gere un script non ferme sans planter', () => {
    expect(htmlToText('<script>var a = 1;<p>texte')).toContain('texte');
  });

  it('isHtmlContentType', () => {
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true);
    expect(isHtmlContentType('application/xhtml+xml')).toBe(true);
    expect(isHtmlContentType('application/json')).toBe(false);
  });
});
