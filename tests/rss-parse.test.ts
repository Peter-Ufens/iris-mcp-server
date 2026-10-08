import { describe, it, expect } from 'vitest';
import {
  parseFeedXml,
  normalizeTitle,
  truncateSummary,
  parseFeedDate,
  parseBingPubDate,
  decodeBingEditorUrl,
  isGoogleNewsUrl,
  isBingNewsUrl,
  sanitizeTitle,
  dedupeKey,
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
    const iso = parseBingPubDate('Thu, 08 Oct 2026 06:00:00 GMT');
    expect(iso).toBe('2026-10-08T13:00:00.000Z');
    expect(parseBingPubDate('')).toBeNull();
  });

  it('parseFeedXml Bing : lien editeur + News:Source + date corrigee', () => {
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
  });
});
