import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as z from 'zod/v4';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchText: vi.fn(),
}));

import { fetchText } from '../src/utils/http-fetch.js';
import { tool as actu } from '../src/tools/actu-rss-v1.js';

const mockFetch = vi.mocked(fetchText);

const SAMPLE_RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item>
  <title>Article frais Alsace</title>
  <link>https://www.dna.fr/article-frais</link>
  <pubDate>${new Date().toUTCString()}</pubDate>
  <description>Resume frais</description>
</item>
<item>
  <title>Article trop vieux</title>
  <link>https://www.dna.fr/vieux</link>
  <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
  <description>Vieux</description>
</item>
<item>
  <title>Sans date</title>
  <link>https://www.dna.fr/nodate</link>
  <description>No date</description>
</item>
</channel></rss>`;

function okText(url: string, text: string) {
  return {
    url,
    finalUrl: url,
    status: 200,
    contentType: 'application/rss+xml',
    text,
    truncated: false,
    bytesApprox: text.length,
    redirects: 0,
  };
}

describe('actu-rss-v1', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('filtre since_hours et garde date_inconnue', async () => {
    mockFetch.mockResolvedValue(okText('https://www.dna.fr/rss', SAMPLE_RSS));
    const result = await actu.execute({
      zone: 'alsace',
      since_hours: 48,
      limit: 10,
      google_news: false,
    });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBeUndefined();
    const titles = payload.items.map((i: { title: string }) => i.title);
    expect(titles).toContain('Article frais Alsace');
    expect(titles).not.toContain('Article trop vieux');
    expect(titles).toContain('Sans date');
  });

  it('filtre query sans accents', async () => {
    mockFetch.mockResolvedValue(okText('https://www.dna.fr/rss', SAMPLE_RSS));
    const result = await actu.execute({
      zone: 'alsace',
      query: 'alsace',
      since_hours: 48,
      limit: 10,
    });
    const payload = JSON.parse(result.content[0]!.text);
    expect(
      payload.items.every((i: { title: string }) => /alsace/i.test(i.title)),
    ).toBe(true);
    expect(payload.recoupement).toBeGreaterThanOrEqual(1);
  });

  it('dedoublonne par titre normalise', async () => {
    const dup = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Même Titre</title><link>https://a.example/1</link><pubDate>${new Date().toUTCString()}</pubDate></item>
<item><title>meme titre</title><link>https://b.example/2</link><pubDate>${new Date().toUTCString()}</pubDate></item>
</channel></rss>`;
    mockFetch.mockResolvedValue(okText('https://www.dna.fr/rss', dup));
    const result = await actu.execute({
      zone: 'alsace',
      since_hours: 48,
      limit: 10,
    });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.items).toHaveLength(1);
  });

  it('un flux en erreur n empêche pas les autres', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('lemonde')) throw new Error('timeout');
      return okText(url, SAMPLE_RSS);
    });
    const result = await actu.execute({
      zone: 'france',
      since_hours: 48,
      limit: 5,
    });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBeUndefined();
    expect(payload.items.length).toBeGreaterThan(0);
    expect(
      payload.feeds.some((f: { status: string }) => f.status === 'erreur'),
    ).toBe(true);
  });

  it('tous en erreur = erreur propre', async () => {
    mockFetch.mockRejectedValue(new Error('down'));
    const result = await actu.execute({
      zone: 'alsace',
      since_hours: 48,
      limit: 5,
    });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBeTruthy();
  });

  it('id et categorie web', () => {
    expect(actu.id).toBe('actu-rss-v1');
    expect(actu.category).toBe('web');
  });

  // --- Review Bob 08/10 ---

  function rss(items: { title: string; link: string; pub?: string; extra?: string }[]) {
    const body = items
      .map(
        (i) =>
          `<item><title>${i.title}</title><link>${i.link}</link>` +
          `<pubDate>${i.pub ?? new Date().toUTCString()}</pubDate>${i.extra ?? ''}</item>`,
      )
      .join('\n');
    return `<?xml version="1.0"?><rss version="2.0"><channel>${body}</channel></rss>`;
  }

  async function run(input: Record<string, unknown>) {
    const result = await actu.execute({ since_hours: 48, limit: 10, ...input });
    return JSON.parse(result.content[0]!.text);
  }

  it('query courte = mot entier : IA ne trouve ni social ni medias', async () => {
    const xml = rss([
      { title: "L'IA de Mistral progresse", link: 'https://a.example/ia' },
      { title: 'Climat social tendu dans les médias', link: 'https://a.example/social' },
    ]);
    mockFetch.mockResolvedValue(okText('https://www.dna.fr/rss', xml));
    const payload = await run({ zone: 'alsace', query: 'IA' });
    expect(payload.items.map((i: { title: string }) => i.title)).toEqual([
      "L'IA de Mistral progresse",
    ]);
  });

  it('query longue = debut de mot : lycée trouve lycées', async () => {
    const xml = rss([
      { title: 'Blocage des lycées à Strasbourg', link: 'https://a.example/1' },
      { title: 'Match de basket', link: 'https://a.example/2' },
    ]);
    mockFetch.mockResolvedValue(okText('https://www.dna.fr/rss', xml));
    const payload = await run({ zone: 'alsace', query: 'lycée' });
    expect(payload.items).toHaveLength(1);
  });

  it('recoupement = nombre de domaines distincts', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.includes('dna.fr')
        ? okText(url, rss([{ title: 'Grève des trams', link: 'https://www.dna.fr/a' }]))
        : okText(
            url,
            rss([{ title: 'Strasbourg : grève', link: 'https://france3-regions.franceinfo.fr/b' }]),
          ),
    );
    const payload = await run({ zone: 'alsace', query: 'grève' });
    expect(payload.recoupement).toBe(2);
  });

  it('Google Actualites a part (decouverte), sans chasser les liens editeurs', async () => {
    const google = rss(
      [1, 2, 3].map((n) => ({
        title: `Grève nationale ${n} - RMC`,
        link: `https://news.google.com/rss/articles/X${n}?oc=5`,
        extra: '<source url="https://rmc.bfmtv.com">RMC</source>',
      })),
    );
    mockFetch.mockImplementation(async (url: string) =>
      url.includes('news.google.com')
        ? okText(url, google)
        : okText(url, rss([{ title: 'Grève à Mulhouse', link: 'https://www.dna.fr/g' }])),
    );
    const payload = await run({ zone: 'alsace', query: 'grève', google_news: true, limit: 2 });
    expect(payload.items.map((i: { url: string }) => i.url)).toEqual(['https://www.dna.fr/g']);
    expect(payload.decouverte).toHaveLength(2);
    expect(payload.decouverte[0].source).toBe('RMC');
    expect(payload.recoupement).toBe(1);
  });

  it('google_news sans query : pas d appel, et feeds[] le dit', async () => {
    mockFetch.mockResolvedValue(okText('https://www.dna.fr/rss', SAMPLE_RSS));
    const payload = await run({ zone: 'alsace', google_news: true });
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('news.google.com'))).toBe(false);
    const g = payload.feeds.find((f: { id: string }) => f.id === 'google-news');
    expect(g.status).toBe('erreur');
  });

  it('tous en erreur : feeds[] est rendu avec l erreur', async () => {
    mockFetch.mockRejectedValue(new Error('down'));
    const payload = await run({ zone: 'alsace' });
    expect(payload.error).toBeTruthy();
    expect(payload.feeds.length).toBeGreaterThanOrEqual(2);
  });

  it('article ancien republie : date_douteuse + date_url', async () => {
    const xml = rss([{ title: 'Vieux sujet', link: 'https://www.dna.fr/eco/2020/01/01/vieux' }]);
    mockFetch.mockResolvedValue(okText('https://www.dna.fr/rss', xml));
    const payload = await run({ zone: 'alsace' });
    expect(payload.items[0].date_douteuse).toBe(true);
    expect(payload.items[0].date_url).toBe('2020-01-01');
  });

  it('un flux bavard ne cache pas les autres sources', async () => {
    const vieux = new Date(Date.now() - 2 * 3_600_000).toUTCString();
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('france3')) {
        return okText(url, rss([1, 2].map((n) => ({ title: `F3 ${n}`, link: `https://f3.example/${n}`, pub: vieux }))));
      }
      if (url.includes('lemonde')) {
        return okText(url, rss([1, 2].map((n) => ({ title: `LM ${n}`, link: `https://lm.example/${n}`, pub: vieux }))));
      }
      return okText(url, rss([1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ title: `FI ${n}`, link: `https://fi.example/${n}` }))));
    });
    const payload = await run({ zone: 'france', limit: 6 });
    const sources = new Set(payload.items.map((i: { source: string }) => i.source));
    expect(payload.items).toHaveLength(6);
    expect(sources.size).toBe(3);
  });

  it('entrees hors bornes refusees par le schema', () => {
    const schema = z.object(actu.inputSchema);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ since_hours: 0 }).success).toBe(false);
    expect(schema.safeParse({ since_hours: 169 }).success).toBe(false);
    expect(schema.safeParse({ limit: 31 }).success).toBe(false);
    expect(schema.safeParse({ zone: 'mars' }).success).toBe(false);
    expect(schema.safeParse({ query: '' }).success).toBe(false);
    expect(schema.safeParse({ query: 'x'.repeat(121) }).success).toBe(false);
  });

  it('zones guadeloupe / usa / asie_ia acceptees par le schema', () => {
    const schema = z.object(actu.inputSchema);
    expect(schema.safeParse({ zone: 'guadeloupe' }).success).toBe(true);
    expect(schema.safeParse({ zone: 'usa' }).success).toBe(true);
    expect(schema.safeParse({ zone: 'asie_ia' }).success).toBe(true);
  });

  it('zone guadeloupe : La 1ère + decouverte, sans filtre implicite qui jette les communes', async () => {
    // Review Bob 08/10 : l'ancien filtre "Guadeloupe" par defaut jetait 21 articles
    // Google sur 100 et 13 articles La 1ère sur 30 (titres qui ne citent que la commune).
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('news.google.com')) {
        return okText(
          url,
          rss([
            {
              title: 'Municipales au Gosier : le scrutin annulé - Outre-mer La 1ère',
              link: 'https://news.google.com/rss/articles/G1',
              extra: '<source url="https://la1ere.franceinfo.fr">Outre-mer La 1ère</source>',
            },
          ]),
        );
      }
      return okText(
        url,
        rss([
          { title: 'Mobilisation devant les lycées des Abymes', link: 'https://la1ere.franceinfo.fr/guadeloupe/abymes' },
          { title: 'Coupure électrique en Guadeloupe', link: 'https://la1ere.franceinfo.fr/guadeloupe/edf' },
        ]),
      );
    });
    const payload = await run({ zone: 'guadeloupe', limit: 5 });
    expect(payload.query).toBeNull();
    expect(payload.items).toHaveLength(2);
    expect(payload.items.every((i: { source: string }) => i.source === 'Guadeloupe La 1ère')).toBe(true);
    expect(payload.decouverte[0].title).toMatch(/Gosier/);
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('la1ere.franceinfo.fr/guadeloupe/last-articles/rss'))).toBe(true);
    expect(urls.some((u) => u.includes('franceinfo.fr/titres.rss'))).toBe(false);
  });

  it('zone asie_ia : seulement les articles a la fois IA et Asie', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('channelnewsasia')) {
        return okText(url, rss([
          { title: 'Bollywood actor dies at 75', link: 'https://cna.example/1' },
          { title: 'Singapore regulator expands use of AI', link: 'https://cna.example/2' },
        ]));
      }
      if (url.includes('techcrunch')) {
        return okText(url, rss([
          { title: 'Microsoft releases new AI PCs', link: 'https://tc.example/1' },
          { title: 'DeepSeek ships 16 new models in China', link: 'https://tc.example/2' },
        ]));
      }
      return okText(url, rss([]));
    });
    const payload = await run({ zone: 'asie_ia', limit: 10 });
    const titles = payload.items.map((i: { title: string }) => i.title).sort();
    expect(titles).toEqual(['DeepSeek ships 16 new models in China', 'Singapore regulator expands use of AI']);
    expect(payload.items.every((i: { zone: string }) => i.zone === 'asie_ia')).toBe(true);
  });

  it('le filtre asie_ia ne s applique pas en zone ia', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.includes('techcrunch')
        ? okText(url, rss([{ title: 'Microsoft releases new AI PCs', link: 'https://tc.example/1' }]))
        : okText(url, rss([])),
    );
    const payload = await run({ zone: 'ia', limit: 10 });
    expect(payload.items.map((i: { title: string }) => i.title)).toContain('Microsoft releases new AI PCs');
    expect(payload.items.every((i: { zone: string }) => i.zone === 'ia')).toBe(true);
  });

  it('zone alsace : France 3 seulement Bas-Rhin / Haut-Rhin / alsace (pas Reims/Nancy)', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('france3') || url.includes('grand-est/rss')) {
        return okText(
          url,
          rss([
            {
              title: 'Policier blesse a Reims',
              link: 'https://france3-regions.franceinfo.fr/grand-est/marne/reims/policier.html',
            },
            {
              title: 'Nancy : greve des trams',
              link: 'https://france3-regions.franceinfo.fr/grand-est/meurthe-et-moselle/nancy/greve.html',
            },
            {
              title: 'Strasbourg : lycees bloques',
              link: 'https://france3-regions.franceinfo.fr/grand-est/bas-rhin/strasbourg/lycees.html',
            },
            {
              title: 'Colmar : marche',
              link: 'https://france3-regions.franceinfo.fr/grand-est/haut-rhin/colmar/marche.html',
            },
          ]),
        );
      }
      return okText(url, rss([]));
    });
    const payload = await run({ zone: 'alsace', limit: 10 });
    const urls = payload.items.map((i: { url: string }) => i.url);
    expect(urls).toContain(
      'https://france3-regions.franceinfo.fr/grand-est/bas-rhin/strasbourg/lycees.html',
    );
    expect(urls).toContain(
      'https://france3-regions.franceinfo.fr/grand-est/haut-rhin/colmar/marche.html',
    );
    expect(urls.some((u: string) => u.includes('/marne/'))).toBe(false);
    expect(urls.some((u: string) => u.includes('/nancy/'))).toBe(false);
  });

  it('zone france : France 3 Grand Est sans filtre Alsace (Reims OK)', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('france3') || url.includes('grand-est/rss')) {
        return okText(
          url,
          rss([
            {
              title: 'Reims',
              link: 'https://france3-regions.franceinfo.fr/grand-est/marne/reims/x.html',
            },
          ]),
        );
      }
      return okText(url, rss([]));
    });
    const payload = await run({ zone: 'france', limit: 5 });
    expect(
      payload.items.some((i: { url: string }) => i.url.includes('/marne/reims/')),
    ).toBe(true);
  });

  it('zone usa appelle BBC et NYT', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      okText(url, rss([{ title: 'US Senate vote', link: `${url}/item1` }])),
    );
    const payload = await run({ zone: 'usa', limit: 5 });
    expect(payload.error).toBeUndefined();
    const ids = payload.feeds.map((f: { id: string }) => f.id);
    expect(ids).toContain('bbc-us-canada');
    expect(ids).toContain('nyt-us');
  });

  it('zone asie_ia appelle TechCrunch, Verge, CNA, Japan Times + Google', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const tag = url.includes('techcrunch')
        ? 'tc'
        : url.includes('theverge')
          ? 'verge'
          : url.includes('channelnewsasia')
            ? 'cna'
            : url.includes('japantimes')
              ? 'jt'
              : 'ggl';
      return okText(
        url,
        rss([
          {
            title: `AI chip Asia ${tag}`,
            link: `https://example.com/${tag}/ai`,
          },
        ]),
      );
    });
    const payload = await run({ zone: 'asie_ia', limit: 8 });
    expect(payload.error).toBeUndefined();
    const ids = payload.feeds.map((f: { id: string }) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'techcrunch-ai',
        'verge-ai',
        'cna-asia',
        'japan-times',
        'google-asie-ia',
      ]),
    );
    expect(payload.decouverte.length).toBeGreaterThanOrEqual(1);
  });

  it('refuse les liens non https et titres gabarit casses', async () => {
    const xml = rss([
      { title: 'OK https', link: 'https://www.dna.fr/ok' },
      { title: 'HTTP only', link: 'http://www.dna.fr/http' },
      { title: 'Vidéo. $content.TitleNoTags', link: 'https://www.dna.fr/casse' },
      { title: '(sans titre)', link: 'https://www.dna.fr/a' },
      { title: '(sans titre)', link: 'https://www.dna.fr/b' },
    ]);
    mockFetch.mockResolvedValue(okText('https://www.dna.fr/rss', xml));
    const payload = await run({ zone: 'alsace', limit: 10 });
    const urls = payload.items.map((i: { url: string }) => i.url);
    expect(urls.every((u: string) => u.startsWith('https://'))).toBe(true);
    expect(urls).not.toContain('http://www.dna.fr/http');
    expect(urls).toContain('https://www.dna.fr/casse');
    expect(urls).toContain('https://www.dna.fr/a');
    expect(urls).toContain('https://www.dna.fr/b');
    const casse = payload.items.find(
      (i: { url: string }) => i.url === 'https://www.dna.fr/casse',
    );
    expect(casse.title).toBe('(sans titre)');
  });

  // --- Bing / recherche (ADR-0008) ---

  function bingItem(title: string, editor: string, source: string) {
    const apiclick = `http://www.bing.com/news/apiclick?articleid=1&url=${encodeURIComponent(editor)}&from=RSS`;
    return {
      title,
      link: apiclick,
      extra: `<News:Source>${source}</News:Source>`,
    };
  }

  it('recherche=bing : items editeur, pas decouverte, interval 7 si since<=24', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('bing.com/news')) {
        return okText(
          url,
          rss([
            bingItem('Greve tram Strasbourg', 'https://www.dna.fr/tram', 'DNA'),
            bingItem('Greve nationale', 'https://www.lemonde.fr/greve', 'Le Monde'),
          ]),
        );
      }
      return okText(url, rss([]));
    });
    const payload = await run({
      zone: 'alsace',
      query: 'greve',
      recherche: 'bing',
      since_hours: 24,
      limit: 5,
    });
    expect(payload.recherche).toBe('bing');
    expect(payload.decouverte).toHaveLength(0);
    expect(payload.items.length).toBeGreaterThanOrEqual(2);
    expect(payload.items.every((i: { url: string }) => i.url.startsWith('https://'))).toBe(
      true,
    );
    expect(payload.items.map((i: { source: string }) => i.source)).toEqual(
      expect.arrayContaining(['DNA', 'Le Monde']),
    );
    const bingUrl = mockFetch.mock.calls.map((c) => String(c[0])).find((u) =>
      u.includes('bing.com'),
    );
    expect(bingUrl).toMatch(/format=rss/);
    expect(bingUrl).toMatch(/interval%3D%227%22|interval%3D"7"/);
    expect(payload.feeds.some((f: { id: string }) => f.id === 'bing-news')).toBe(
      true,
    );
  });

  it('recherche=bing : zone « tout » (recherche nationale) et date_approx, flux A gardent leur zone', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('bing.com/news')) {
        return okText(url, rss([bingItem('Greve a Bordeaux', 'https://www.sudouest.fr/greve', 'Sud Ouest')]));
      }
      if (url.includes('dna.fr')) {
        return okText(url, rss([{ title: 'Greve des trams', link: 'https://www.dna.fr/trams' }]));
      }
      return okText(url, rss([]));
    });
    const payload = await run({ zone: 'alsace', query: 'greve', recherche: 'bing', limit: 10 });
    const bing = payload.items.find((i: { url: string }) => i.url === 'https://www.sudouest.fr/greve');
    const dna = payload.items.find((i: { url: string }) => i.url === 'https://www.dna.fr/trams');
    expect(bing.zone).toBe('tout');
    expect(bing.date_approx).toBe(true);
    expect(bing.age_hours).toBeGreaterThanOrEqual(0);
    expect(dna.zone).toBe('alsace');
    expect(dna.date_approx).toBeUndefined();
  });

  it('recherche=bing since>24 → interval 8', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.includes('bing.com')
        ? okText(url, rss([bingItem('X', 'https://www.dna.fr/x', 'DNA')]))
        : okText(url, rss([])),
    );
    await run({
      zone: 'alsace',
      query: 'x',
      recherche: 'bing',
      since_hours: 48,
    });
    const bingUrl = mockFetch.mock.calls.map((c) => String(c[0])).find((u) =>
      u.includes('bing.com'),
    );
    expect(bingUrl).toMatch(/interval%3D%228%22|interval%3D"8"/);
  });

  it('recherche=bing sans query : pas d appel, feeds[] le dit', async () => {
    mockFetch.mockResolvedValue(okText('https://www.dna.fr/rss', SAMPLE_RSS));
    const payload = await run({ zone: 'alsace', recherche: 'bing' });
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('bing.com'))).toBe(false);
    const b = payload.feeds.find((f: { id: string }) => f.id === 'bing-news');
    expect(b.status).toBe('erreur');
    expect(payload.recherche).toBe('aucune');
  });

  it('recherche=les_deux : Bing en items, Google en decouverte', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('bing.com')) {
        return okText(
          url,
          rss([bingItem('Greve Bing', 'https://www.dna.fr/bing', 'DNA')]),
        );
      }
      if (url.includes('news.google.com')) {
        return okText(
          url,
          rss([
            {
              title: 'Greve Google - RMC',
              link: 'https://news.google.com/rss/articles/X1',
              extra: '<source url="https://rmc.bfmtv.com">RMC</source>',
            },
          ]),
        );
      }
      return okText(url, rss([]));
    });
    const payload = await run({
      zone: 'alsace',
      query: 'greve',
      recherche: 'les_deux',
      limit: 5,
    });
    expect(payload.recherche).toBe('les_deux');
    expect(payload.items.some((i: { url: string }) => i.url === 'https://www.dna.fr/bing')).toBe(
      true,
    );
    expect(payload.decouverte.some((i: { source: string }) => i.source === 'RMC')).toBe(
      true,
    );
  });

  it('schema accepte recherche bing/google/les_deux', () => {
    const schema = z.object(actu.inputSchema);
    expect(schema.safeParse({ recherche: 'bing' }).success).toBe(true);
    expect(schema.safeParse({ recherche: 'les_deux' }).success).toBe(true);
    expect(schema.safeParse({ recherche: 'yahoo' }).success).toBe(false);
  });
});
