import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool, mapDdgResponse } from '../src/tools/web-search-ddg-v1.js';

const mockFetch = vi.mocked(fetchJson);

function payloadOf(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

interface Result {
  title: string;
  url: string;
  snippet: string;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('web-search-ddg-v1 : metadonnees outil', () => {
  it('a l identite attendue', () => {
    expect(tool.id).toBe('web-search-ddg-v1');
    expect(tool.category).toBe('web');
    expect(Object.keys(tool.inputSchema)).toEqual(['query', 'limit']);
  });
});

describe('web-search-ddg-v1 : cas nominal', () => {
  it('retourne resume et sujets lies', async () => {
    mockFetch.mockResolvedValue({
      Heading: 'Model Context Protocol',
      AbstractText: 'Protocole ouvert pour brancher des LLM sur des outils.',
      AbstractURL: 'https://modelcontextprotocol.io/',
      AbstractSource: 'Wikipedia',
      RelatedTopics: [
        {
          FirstURL: 'https://example.com/mcp-servers',
          Text: 'Serveurs MCP - liste de serveurs compatibles',
        },
      ],
    });

    const payload = payloadOf(await tool.execute({ query: 'model context protocol', limit: 5 }));
    const results = payload.results as Result[];
    expect(payload.count).toBe(2);
    expect(results[0]!.url).toBe('https://modelcontextprotocol.io/');
    expect(results[0]!.title).toBe('Model Context Protocol');
    expect(results[0]!.snippet).toContain('Protocole ouvert');
    expect(results[1]!.title).toBe('Serveurs MCP');
    expect(payload.note).toBeUndefined();
  });

  it('construit l URL DuckDuckGo attendue', async () => {
    mockFetch.mockResolvedValue({});
    await tool.execute({ query: 'iris mcp' });
    const called = mockFetch.mock.calls[0]![0] as string;
    expect(called).toContain('https://api.duckduckgo.com/?q=iris%20mcp');
    expect(called).toContain('format=json');
    expect(called).toContain('no_html=1');
  });

  it('utilise limit 5 par defaut et respecte la limite demandee', async () => {
    const topics = Array.from({ length: 12 }, (_, i) => ({
      FirstURL: `https://example.com/${i}`,
      Text: `Sujet ${i} - description`,
    }));
    mockFetch.mockResolvedValue({ RelatedTopics: topics });

    const parDefaut = payloadOf(await tool.execute({ query: 'test' }));
    expect(parDefaut.count).toBe(5);

    const limite = payloadOf(await tool.execute({ query: 'test', limit: 3 }));
    expect(limite.count).toBe(3);
  });

  it('aplatit les groupes de sujets imbriques et dedoublonne', async () => {
    mockFetch.mockResolvedValue({
      RelatedTopics: [
        { FirstURL: 'https://example.com/a', Text: 'A - un' },
        {
          Name: 'Groupe',
          Topics: [
            { FirstURL: 'https://example.com/b', Text: 'B - deux' },
            { FirstURL: 'https://example.com/a', Text: 'A doublon' },
          ],
        },
      ],
    });
    const payload = payloadOf(await tool.execute({ query: 'test' }));
    expect((payload.results as Result[]).map((r) => r.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('nettoie le HTML des extraits', () => {
    const results = mapDdgResponse(
      {
        RelatedTopics: [
          {
            FirstURL: 'https://example.com/x',
            Result: '<a href="https://example.com/x">Iris</a> messagere des dieux',
          },
        ],
      },
      'iris',
      5,
    );
    expect(results[0]!.snippet).toBe('Iris messagere des dieux');
    expect(results[0]!.snippet).not.toContain('<a');
  });

  it('retourne la definition quand DuckDuckGo en fournit une', () => {
    const results = mapDdgResponse(
      {
        Definition: 'Petit oiseau.',
        DefinitionURL: 'https://dictionnaire.example/mesange',
        DefinitionSource: 'Wiktionary',
      },
      'mesange',
      5,
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.snippet).toContain('Petit oiseau');
    expect(results[0]!.snippet).toContain('Wiktionary');
  });
});

describe('web-search-ddg-v1 : limites et erreurs', () => {
  it('retourne une liste vide avec une note explicative', async () => {
    mockFetch.mockResolvedValue({ RelatedTopics: [], Results: [] });
    const payload = payloadOf(await tool.execute({ query: 'requete tres pointue 12345' }));
    expect(payload.count).toBe(0);
    expect(payload.results).toEqual([]);
    expect(String(payload.note)).toContain('wikipedia-search-v1');
    expect(payload.error).toBeUndefined();
  });

  it('retourne une erreur propre si l API echoue', async () => {
    mockFetch.mockRejectedValue(new Error('HTTP 500 depuis https://api.duckduckgo.com/'));
    const payload = payloadOf(await tool.execute({ query: 'test' }));
    expect(String(payload.error)).toContain('DuckDuckGo');
    expect(String(payload.error)).toContain('HTTP 500');
  });

  it('retourne une erreur propre sur timeout', async () => {
    mockFetch.mockRejectedValue(new Error('The operation was aborted due to timeout'));
    const payload = payloadOf(await tool.execute({ query: 'test' }));
    expect(String(payload.error)).toContain('timeout');
  });

  it('refuse une requete vide', async () => {
    const payload = payloadOf(await tool.execute({ query: '   ' }));
    expect(payload.error).toBe('Requete vide.');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
