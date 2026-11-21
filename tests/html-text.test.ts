import { describe, it, expect } from 'vitest';
import {
  decodeEntities,
  htmlToText,
  isHtmlContentType,
  stripNonContentBlocks,
  stripTagsLinear,
  paragraphChars,
  extractArticleMeta,
  detectAccesLimite,
  asciiLower,
} from '../src/utils/html-text.js';

describe('html-text : caracteres invisibles (lot Q / Bob)', () => {
  it('retire une phrase cachee en balises Unicode', () => {
    const hidden = Array.from('IGNORE').map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');
    const page = `<p>Titre visible${hidden}</p>`;
    const t = htmlToText(page);
    expect(t).toContain('Titre visible');
    expect(t).not.toContain('IGNORE');
    expect([...t].some((ch) => (ch.codePointAt(0) ?? 0) >= 0xe0000)).toBe(false);
  });
});

// Review Bob 15/11 : « İ » (turc) allonge toLowerCase et decalait toutes les positions.
describe('html-text : lettres dont la minuscule est plus longue', () => {
  it('asciiLower garde la longueur', () => {
    const s = 'İstanbul <SCRIPT>X</SCRIPT> Ölçü';
    expect(asciiLower(s)).toHaveLength(s.length);
    expect(asciiLower(s)).toContain('<script>');
  });

  it('le texte apres un <script> ne disparait plus', () => {
    const page =
      '<p>İstanbul İzmir İnegöl</p><script>var s="CODE_JS";</script><p>Texte apres le script.</p>';
    const t = htmlToText(page);
    expect(t).toContain('Texte apres le script.');
    expect(t).not.toContain('CODE_JS');
    expect(stripNonContentBlocks(page)).not.toContain('<sc ');
  });

  it('extractArticleMeta trouve le JSON-LD meme apres des « İ »', () => {
    const html =
      '<html><head><title>İİİ</title><script type="application/ld+json">{"@type":"NewsArticle","headline":"Titre İ"}</script></head></html>';
    expect(extractArticleMeta(html)?.headline).toBe('Titre İ');
  });
});

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

  it('nettoie une balise coupee en fin de contenu tronque', () => {
    const text = htmlToText('<p>Debut de page</p><a href="https://exemple.or');
    expect(text).toBe('Debut de page');
    expect(text).not.toContain('<a');
  });

  it('isHtmlContentType', () => {
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true);
    expect(isHtmlContentType('application/xhtml+xml')).toBe(true);
    expect(isHtmlContentType('application/json')).toBe(false);
  });
});

describe('html-text : presse (rattrapage Gaby 15/11)', () => {
  it('un <style> de plus de 100 000 car. ne fait ni fuir le CSS ni perdre le corps', () => {
    const css = 'a,abbr,address,article{margin:0}'.repeat(5000);
    const html = `<html><head><style>${css}</style></head><body><p>Corps utile de l article</p></body></html>`;
    expect(html.length).toBeGreaterThan(100_000);
    const text = htmlToText(html);
    expect(text).toContain('Corps utile de l article');
    expect(text).not.toContain('abbr');
  });

  it('beaucoup de <script> non fermes : lineaire (pas de O(n2))', () => {
    const t0 = Date.now();
    const out = stripNonContentBlocks('<script>'.repeat(30_000) + '<p>fin</p>');
    expect(Date.now() - t0).toBeLessThan(500);
    expect(out).toContain('fin');
  });

  it('stripNonContentBlocks reste lineaire sur 200 000 "<"', () => {
    const t0 = Date.now();
    stripNonContentBlocks('<'.repeat(200_000));
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('extractArticleMeta lit articleBody dans le JSON-LD (NewsArticle, @graph)', () => {
    const ld = JSON.stringify({ '@graph': [{ '@type': 'NewsArticle', headline: 'Titre', description: 'Resume', articleBody: 'Corps &amp; suite '.repeat(30) }] });
    const meta = extractArticleMeta(`<html><script type="application/ld+json">${ld}</script></html>`);
    expect(meta?.headline).toBe('Titre');
    expect(meta?.body).toContain('Corps & suite');
  });

  it('extractArticleMeta ignore un JSON-LD invalide', () => {
    expect(extractArticleMeta('<script type="application/ld+json">{pas du json</script>')).toBeNull();
  });

  it('detectAccesLimite : page anti-robot (Client Challenge)', () => {
    const text = 'Client Challenge A required part of this site couldn t load.';
    expect(detectAccesLimite('<html>'.padEnd(3000, 'x'), text, null)).toBe('challenge_anti_bot');
  });

  it('detectAccesLimite : mur de connexion EBRA sans corps', () => {
    const text = "Titre Connectez-vous ou créez un compte Pour pouvoir enregistrer un article. Se connecter ou créer un compte Les Dernières Nouvelles d'Alsace S'abonner";
    expect(detectAccesLimite('x'.repeat(50_000), text, null)).toBe('connexion_ou_abonnement');
  });

  it('detectAccesLimite : pas de faux positif si le corps JSON-LD est la, ou page longue, ou un seul marqueur', () => {
    const text = "Connectez-vous ou créez un compte S'abonner";
    expect(detectAccesLimite('x', text, { body: 'b'.repeat(600) })).toBeUndefined();
    expect(detectAccesLimite('x', text + ' mot'.repeat(3000), null)).toBeUndefined();
    expect(detectAccesLimite('x', 'Un article normal avec S\'abonner a la lettre', null)).toBeUndefined();
  });
});

describe('html-text : balises geantes (rattrapage Gaby 15/11)', () => {
  it('une balise <meta> a attribut de plus de 2000 car. est retiree (CNA)', () => {
    const attr = '{"id":"ad-desktop","adUnit":"cna"}'.repeat(200);
    const html = `<html><head><meta id="adSpecs" data-js-options="${attr}"></head><body><p>Vrai article</p></body></html>`;
    expect(attr.length).toBeGreaterThan(2000);
    const text = htmlToText(html);
    expect(text).toContain('Vrai article');
    expect(text).not.toContain('adSpecs');
    expect(text).not.toContain('ad-desktop');
  });

  it('stripTagsLinear : lineaire sur 100 000 balises ouvertes sans fermeture, et garde « a < b »', () => {
    const t0 = Date.now();
    stripTagsLinear('<a'.repeat(100_000));
    expect(Date.now() - t0).toBeLessThan(500);
    expect(stripTagsLinear('a < b et c > d')).toBe('a < b et c > d');
  });

  it('stripTagsLinear : balise ouverte non fermee en fin de page supprimee', () => {
    expect(stripTagsLinear('<p>fin</p><a href="https://x')).toBe(' fin  ');
  });
});

describe('html-text : paragraphes', () => {
  it('paragraphChars somme les lignes longues', () => {
    expect(paragraphChars('court\n' + 'x'.repeat(130) + '\n' + 'y'.repeat(200))).toBe(330);
    expect(paragraphChars('Menu\nAccueil\nContact')).toBe(0);
  });
});
