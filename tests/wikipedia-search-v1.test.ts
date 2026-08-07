import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool, isValidLang, articleUrl } from '../src/tools/wikipedia-search-v1.js';

const mockFetch = vi.mocked(fetchJson);

function payloadOf(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

interface Result {
  title: string;
  pageid: number;
  url: string;
  snippet: string;
}

const reponseIris = {
  query: {
    searchinfo: { totalhits: 42 },
    search: [
      {
        title: 'Iris (mythologie)',
        pageid: 12345,
        snippet: 'Dans la <span class="searchmatch">mythologie</span> grecque, Iris est la messagere.',
        wordcount: 500,
      },
    ],
  },
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe('wikipedia-search-v1 : metadonnees outil', () => {
  it('a l identite attendue', () => {
    expect(tool.id).toBe('wikipedia-search-v1');
    expect(tool.category).toBe('web');
    expect(Object.keys(tool.inputSchema)).toEqual(['query', 'lang', 'limit']);
  });
});

describe('wikipedia-search-v1 : cas nominal', () => {
  it('retourne titre, pageid, url et extrait nettoye', async () => {
    mockFetch.mockResolvedValue(reponseIris);
    const payload = payloadOf(await tool.execute({ query: 'iris mythologie' }));
    const results = payload.results as Result[];
    expect(payload.lang).toBe('fr');
    expect(payload.count).toBe(1);
    expect(payload.total_hits).toBe(42);
    expect(results[0]!.title).toBe('Iris (mythologie)');
    expect(results[0]!.pageid).toBe(12345);
    expect(results[0]!.url).toBe('https://fr.wikipedia.org/wiki/Iris_(mythologie)');
    expect(results[0]!.snippet).toBe('Dans la mythologie grecque, Iris est la messagere.');
    expect(results[0]!.snippet).not.toContain('<span');
  });

  it('interroge l API MediaWiki en https avec la langue demandee', async () => {
    mockFetch.mockResolvedValue(reponseIris);
    await tool.execute({ query: 'model context protocol', lang: 'en', limit: 3 });
    const called = mockFetch.mock.calls[0]![0] as string;
    expect(called).toContain('https://en.wikipedia.org/w/api.php');
    expect(called).toContain('action=query&list=search');
    expect(called).toContain('srsearch=model%20context%20protocol');
    expect(called).toContain('srlimit=3');
  });

  it('utilise fr et limit 5 par defaut', async () => {
    mockFetch.mockResolvedValue(reponseIris);
    const payload = payloadOf(await tool.execute({ query: 'test' }));
    const called = mockFetch.mock.calls[0]![0] as string;
    expect(called).toContain('https://fr.wikipedia.org/');
    expect(called).toContain('srlimit=5');
    expect(payload.lang).toBe('fr');
  });

  it('normalise la langue en minuscules', async () => {
    mockFetch.mockResolvedValue(reponseIris);
    const payload = payloadOf(await tool.execute({ query: 'test', lang: 'EN' }));
    expect(payload.lang).toBe('en');
    expect(mockFetch.mock.calls[0]![0] as string).toContain('https://en.wikipedia.org/');
  });

  it('articleUrl encode les titres a espaces et caracteres speciaux', () => {
    expect(articleUrl('fr', 'Jeux olympiques')).toBe('https://fr.wikipedia.org/wiki/Jeux_olympiques');
    expect(articleUrl('fr', 'C++')).toBe('https://fr.wikipedia.org/wiki/C%2B%2B');
  });
});

describe('wikipedia-search-v1 : langue et injection', () => {
  it('accepte les codes langue valides', () => {
    for (const lang of ['fr', 'en', 'de', 'pt-br', 'zh-yue']) {
      expect(isValidLang(lang)).toBe(true);
    }
  });

  it('refuse une langue qui tenterait d injecter un hote', async () => {
    for (const lang of ['fr.evil.com', 'fr/../../x', 'fr@evil', '../fr', 'f']) {
      const payload = payloadOf(await tool.execute({ query: 'test', lang }));
      expect(String(payload.error)).toContain('Code langue invalide');
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('wikipedia-search-v1 : limites et erreurs', () => {
  it('retourne une liste vide avec une note', async () => {
    mockFetch.mockResolvedValue({ query: { searchinfo: { totalhits: 0 }, search: [] } });
    const payload = payloadOf(await tool.execute({ query: 'zzzzz introuvable' }));
    expect(payload.count).toBe(0);
    expect(payload.results).toEqual([]);
    expect(String(payload.note)).toContain('Aucun article');
    expect(payload.error).toBeUndefined();
  });

  it('remonte une erreur API MediaWiki', async () => {
    mockFetch.mockResolvedValue({ error: { code: 'nosrsearch', info: 'Le parametre srsearch manque.' } });
    const payload = payloadOf(await tool.execute({ query: 'test' }));
    expect(String(payload.error)).toContain('Le parametre srsearch manque');
  });

  it('retourne une erreur propre si l API echoue', async () => {
    mockFetch.mockRejectedValue(new Error('HTTP 500 depuis https://fr.wikipedia.org/w/api.php'));
    const payload = payloadOf(await tool.execute({ query: 'test' }));
    expect(String(payload.error)).toContain('Wikipedia');
    expect(String(payload.error)).toContain('HTTP 500');
  });

  it('retourne une erreur propre sur timeout', async () => {
    mockFetch.mockRejectedValue(new Error('The operation was aborted due to timeout'));
    const payload = payloadOf(await tool.execute({ query: 'test' }));
    expect(String(payload.error)).toContain('timeout');
  });

  it('refuse une requete vide', async () => {
    const payload = payloadOf(await tool.execute({ query: '  ' }));
    expect(payload.error).toBe('Requete vide.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('tolere une reponse sans champ query', async () => {
    mockFetch.mockResolvedValue({});
    const payload = payloadOf(await tool.execute({ query: 'test' }));
    expect(payload.count).toBe(0);
  });
});
