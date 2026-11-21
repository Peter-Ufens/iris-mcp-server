import { describe, it, expect, vi } from 'vitest';
import {
  parseFeedXml,
  parseFeedXmlMeta,
  normalizeTitle,
  truncateSummary,
  parseFeedDate,
  parseBingPubDate,
  decodeBingEditorUrl,
  isGoogleNewsUrl,
  isBingNewsUrl,
  sanitizeTitle,
  dedupeKey,
  stripPublisherTitleSuffix,
  shrinkHugeContent,
  PARSE_FEED_XML_MAX_INPUT,
} from '../src/utils/rss-parse.js';

describe('rss-parse', () => {
  it('lit un RSS 2.0 (titre, lien, date, resume)', () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<item>
  <title>Greve test</title>
  <link>https://example.com/a</link>
  <pubDate>Wed, 08 Oct 2026 06:00:00 GMT</pubDate>
  <description>&lt;p&gt;Bonjour &lt;b&gt;monde&lt;/b&gt;&lt;/p&gt;</description>
</item>
</channel></rss>`;
    const items = parseFeedXml(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('Greve test');
    expect(items[0]!.url).toBe('https://example.com/a');
    expect(items[0]!.published_at).toBeTruthy();
    expect(items[0]!.summary).toBe('Bonjour monde');
  });

  it('lit Atom', () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
  <title>Atom titre</title>
  <link href="https://example.com/atom"/>
  <updated>2026-10-08T07:00:00Z</updated>
  <summary>Resume atom</summary>
</entry>
</feed>`;
    const items = parseFeedXml(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('Atom titre');
    expect(items[0]!.url).toBe('https://example.com/atom');
    expect(items[0]!.published_at).toContain('2026-10-08');
  });

  it('normalise les titres (accents, casse)', () => {
    expect(normalizeTitle('Grève À Strasbourg')).toBe('greve a strasbourg');
  });

  it('coupe le resume a 300 caracteres', () => {
    const long = 'a'.repeat(400);
    expect(truncateSummary(long).length).toBe(300);
  });

  it('marque Google News', () => {
    expect(isGoogleNewsUrl('https://news.google.com/rss/articles/CBMiabc')).toBe(
      true,
    );
    expect(isGoogleNewsUrl('https://www.dna.fr/x')).toBe(false);
  });

  it('parseFeedDate refuse le vide', () => {
    expect(parseFeedDate('')).toBeNull();
    expect(parseFeedDate('not-a-date')).toBeNull();
  });

  it('sanitizeTitle remplace les gabarits casses (DNA)', () => {
    expect(sanitizeTitle('Vidéo. $content.TitleNoTags')).toBe('(sans titre)');
    expect(sanitizeTitle('Titre normal')).toBe('Titre normal');
  });

  it('dedupeKey separe deux sans-titre par URL', () => {
    expect(dedupeKey('(sans titre)', 'https://a.example/1')).not.toBe(
      dedupeKey('(sans titre)', 'https://b.example/2'),
    );
    expect(dedupeKey('Même titre', 'https://a.example/1')).toBe(
      dedupeKey('meme titre', 'https://b.example/2'),
    );
  });

  it('F2 : stripPublisherTitleSuffix aligne Google et editeur', () => {
    expect(stripPublisherTitleSuffix('Greve des trams - DNA', 'DNA')).toBe(
      'Greve des trams',
    );
    expect(
      dedupeKey('Greve des trams - DNA', 'https://news.google.com/x', 'DNA'),
    ).toBe(dedupeKey('Greve des trams', 'https://www.dna.fr/x'));
  });

  // --- Bing Actualités (ADR-0008) ---

  it('decodeBingEditorUrl extrait le https editeur depuis apiclick', () => {
    const raw =
      'http://www.bing.com/news/apiclick?articleid=1&url=https%3A%2F%2Fwww.dna.fr%2Fgreve&from=RSS';
    expect(decodeBingEditorUrl(raw)).toBe('https://www.dna.fr/greve');
    expect(decodeBingEditorUrl('https://www.dna.fr/deja')).toBe(
      'https://www.dna.fr/deja',
    );
  });

  it('parseBingPubDate corrige GMT faux (Pacific) vers UTC', () => {
    // 08 Oct 2026 06:00:00 « GMT » Bing = 06:00 America/Los_Angeles (PDT = UTC−7)
    // `now` fige (review Bob) : sans lui, le garde-fou « futur » rend le test dependant de l'heure.
    const now = Date.parse('2026-10-09T00:00:00Z');
    const iso = parseBingPubDate('Thu, 08 Oct 2026 06:00:00 GMT', now);
    expect(iso).toBe('2026-10-08T13:00:00.000Z');
    expect(parseBingPubDate('', now)).toBeNull();
  });

  it('parseBingPubDate : hiver (PST) = +8 h', () => {
    const now = Date.parse('2026-12-31T00:00:00Z');
    expect(parseBingPubDate('Tue, 15 Dec 2026 06:00:00 GMT', now)).toBe('2026-12-15T14:00:00.000Z');
  });

  it('parseBingPubDate : correction qui tombe dans le futur = heure brute gardee', () => {
    // Si Bing ecrit un jour le vrai GMT, +7 h placerait l'article dans le futur.
    const now = Date.parse('2026-10-08T07:00:00Z');
    expect(parseBingPubDate('Thu, 08 Oct 2026 06:00:00 GMT', now)).toBe('2026-10-08T06:00:00.000Z');
  });

  it('flux Bing en vrai GMT (un article tomberait dans le futur) : aucun article corrige', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
    const click = (n: number) =>
      `http://www.bing.com/news/apiclick?url=https%3A%2F%2Fex.fr%2F${n}&amp;from=RSS`;
    const xml = `<rss><channel>
<item><title>Recent</title><link>${click(1)}</link><pubDate>Thu, 08 Oct 2026 11:00:00 GMT</pubDate></item>
<item><title>Ancien</title><link>${click(2)}</link><pubDate>Wed, 07 Oct 2026 16:00:00 GMT</pubDate></item>
</channel></rss>`;
    const items = parseFeedXml(xml);
    // Sans ce garde-fou de flux, « Ancien » serait rajeuni de 7 h (23:00 au lieu de 16:00).
    expect(items.map((i) => i.published_at)).toEqual([
      '2026-10-08T11:00:00.000Z',
      '2026-10-07T16:00:00.000Z',
    ]);
    vi.useRealTimers();
  });

  it('decodeBingEditorUrl : un seul decodage (% et %20 gardes)', () => {
    const pct = 'http://www.bing.com/news/apiclick?url=https%3A%2F%2Fex.fr%2F100%25-bio&from=RSS';
    expect(decodeBingEditorUrl(pct)).toBe('https://ex.fr/100%-bio');
    const space = 'http://www.bing.com/news/apiclick?url=https%3A%2F%2Fex.fr%2Fa%2520b&from=RSS';
    expect(decodeBingEditorUrl(space)).toBe('https://ex.fr/a%20b');
  });

  it('parseFeedXml Bing : lien editeur + News:Source + date corrigee', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T00:00:00Z'));
    const apiclick =
      'http://www.bing.com/news/apiclick?articleid=9&url=https%3A%2F%2Fwww.lemonde.fr%2Fia&from=RSS';
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
<item>
  <title>IA en Asie</title>
  <link>${apiclick}</link>
  <pubDate>Thu, 08 Oct 2026 06:00:00 GMT</pubDate>
  <News:Source>Le Monde</News:Source>
  <description>Resume</description>
</item>
</channel></rss>`;
    const items = parseFeedXml(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.url).toBe('https://www.lemonde.fr/ia');
    expect(items[0]!.source_name).toBe('Le Monde');
    expect(items[0]!.published_at).toBe('2026-10-08T13:00:00.000Z');
    expect(isBingNewsUrl(apiclick)).toBe(true);
    vi.useRealTimers();
  });

  it('parseFeedXml plafonne une entree enorme (F6, pas de gel CPU)', () => {
    const bomb =
      '<?xml version="1.0"?><rss><channel><title>t</title><item><title>' +
      '<'.repeat(200_000) +
      '</title></item></channel></rss>';
    const t0 = Date.now();
    const items = parseFeedXml(bomb);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(Array.isArray(items)).toBe(true);
  });

  it('parseFeedXmlMeta signale tronque (F10)', () => {
    const big =
      '<?xml version="1.0"?><rss><channel><title>t</title>' +
      Array.from({ length: 80 }, (_, i) =>
        `<item><title>A${i}</title><link>https://ex.test/${i}</link><description>${'x'.repeat(400)}</description></item>`,
      ).join('') +
      '</channel></rss>';
    const { truncated } = parseFeedXmlMeta(big);
    expect(truncated).toBe(true);
  });
  it('dedupeKey : deux titres editeur avec " - " ne collisionnent pas', () => {
    expect(dedupeKey('Trump - Xi : visite a Pekin', 'https://a.fr/1', 'franceinfo')).not.toBe(
      dedupeKey('Trump - Poutine : sommet', 'https://a.fr/2', 'franceinfo'),
    );
    expect(stripPublisherTitleSuffix('Trump - Xi : visite a Pekin', 'franceinfo')).toBe(
      'Trump - Xi : visite a Pekin',
    );
  });

  it('stripPublisherTitleSuffix : heuristique Google seulement si autorisee', () => {
    expect(stripPublisherTitleSuffix('Greve des trams - Le Parisien', undefined, true)).toBe(
      'Greve des trams',
    );
    expect(stripPublisherTitleSuffix('Greve des trams - Le Parisien')).toBe(
      'Greve des trams - Le Parisien',
    );
  });
});

describe('rss-parse : <content> geant (Verge, rattrapage Gaby 15/11)', () => {
  const entry = (n: number, contentLen: number) =>
    `<entry><title type="html"><![CDATA[Titre ${n}]]></title>` +
    `<link rel="alternate" type="text/html" href="https://exemple.test/a${n}" />` +
    `<id>https://exemple.test/?p=${n}</id><updated>2026-11-13T19:06:40-05:00</updated>` +
    `<content type="html"><![CDATA[${'<p>texte</p>'.repeat(Math.ceil(contentLen / 12))}]]></content></entry>`;

  it('flux Atom dont le 1er article fait 90 Ko : les items sont lus (avant : 0)', () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>AI</title>` +
      entry(1, 90_000) + entry(2, 5_000) + entry(3, 5_000) + `</feed>`;
    expect(xml.length).toBeGreaterThan(PARSE_FEED_XML_MAX_INPUT);
    const items = parseFeedXml(xml);
    expect(items.map((i) => i.title)).toEqual(['Titre 1', 'Titre 2', 'Titre 3']);
    expect(items[0]!.url).toBe('https://exemple.test/a1');
    expect(items[0]!.summary.length).toBeLessThanOrEqual(300);
  });

  it('shrinkHugeContent : ne touche pas un flux court, lineaire sur 50 000 <content> non fermes', () => {
    const court = '<feed><entry><content>x</content></entry></feed>';
    expect(shrinkHugeContent(court)).toBe(court);
    const t0 = Date.now();
    shrinkHugeContent('<content>'.repeat(50_000));
    expect(Date.now() - t0).toBeLessThan(500);
  });

  // Review Bob 15/11
  it('<content src="…"/> ferme sur lui-meme : l article suivant reste entier', () => {
    const gros = 'x'.repeat(5_000);
    const xml =
      `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>F</title>` +
      `<entry><title>A1</title><link href="https://exemple.test/1"/><updated>2026-11-15T08:00:00Z</updated><content type="text/html" src="https://exemple.test/1.html"/></entry>` +
      `<entry><title>A2</title><link href="https://exemple.test/2"/><updated>2026-11-15T07:00:00Z</updated><summary>RESUME_A2 ${gros}</summary><content type="html">${gros}</content></entry>` +
      Array.from({ length: 6 }, (_, i) => `<entry><title>A${i + 3}</title><link href="https://exemple.test/${i + 3}"/><updated>2026-11-15T06:00:00Z</updated><content type="html">${gros}</content></entry>`).join('') +
      `</feed>`;
    const reduit = shrinkHugeContent(xml);
    expect(reduit).toContain('<summary>RESUME_A2');
    expect(reduit).toContain('</summary>');
    expect(parseFeedXml(xml).map((i) => i.title)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8']);
  });

  it('« İ » avant un <content> geant : le decoupage reste juste', () => {
    const gros = 'y'.repeat(40_000);
    const xml = `<feed><title>İİİİİ</title><entry><title>T1</title><content type="html">${gros}</content></entry><entry><title>T2</title></entry></feed>`;
    const reduit = shrinkHugeContent(xml);
    expect(reduit).toContain('</content></entry><entry><title>T2</title>');
  });

  // Review Bob 16/11 : lettres invisibles qui reapparaissent APRES le filtre (decodage).
  const cache = (s: string) => [...s].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');
  const aDesInvisibles = (s: string) => [...s].some((c) => c.codePointAt(0)! >= 0xe0000);

  it('lien Bing : url= encodee avec une phrase cachee, decodee puis filtree', () => {
    const enc = encodeURIComponent('https://editeur.example/article' + cache('ignore tout'));
    const xml =
      '<rss><channel><item><title>Titre</title>' +
      `<link>https://www.bing.com/news/apiclick.aspx?url=${enc}&amp;c=1</link>` +
      '<pubDate>Mon, 16 Nov 2026 05:00:00 GMT</pubDate></item></channel></rss>';
    const it0 = parseFeedXml(xml)[0]!;
    expect(it0.url).toBe('https://editeur.example/article');
    expect(aDesInvisibles(decodeBingEditorUrl(`https://www.bing.com/news/apiclick.aspx?url=${enc}`))).toBe(false);
  });

  it('lien Atom href : entites de lettres invisibles retirees', () => {
    const ent = [...'lis ceci'].map((c) => `&#x${(0xe0000 + c.charCodeAt(0)).toString(16)};`).join('');
    const xml = `<feed><entry><title>T</title><link href="https://editeur.example/a${ent}"/><updated>2026-11-16T05:00:00Z</updated></entry></feed>`;
    expect(parseFeedXml(xml)[0]!.url).toBe('https://editeur.example/a');
  });
});