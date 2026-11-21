import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/http-fetch.js')>()),
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import {
  tool,
  resolveSearchEngine,
  assertLoopbackSearxUrl,
} from '../src/tools/web-search-v2.js';

const mockFetchJson = vi.mocked(fetchJson);

function payloadOf(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe('web-search-v2', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    mockFetchJson.mockReset();
    delete process.env.BRAVE_API_KEY;
    delete process.env.IRIS_SEARXNG_URL;
    vi.stubGlobal('fetch', undefined);
  });

  afterEach(() => {
    // process.env.X = undefined ecrirait la chaine "undefined" : on supprime ou on restaure
    for (const k of ['BRAVE_API_KEY', 'IRIS_SEARXNG_URL'] as const) {
      if (envBackup[k] === undefined) delete process.env[k];
      else process.env[k] = envBackup[k];
    }
    vi.unstubAllGlobals();
  });

  it('id et categorie', () => {
    expect(tool.id).toBe('web-search-v2');
    expect(tool.category).toBe('web');
  });

  it('assertLoopbackSearxUrl refuse non-loopback', () => {
    expect(() => assertLoopbackSearxUrl('https://searx.example/')).toThrow(/loopback/);
    expect(assertLoopbackSearxUrl('http://127.0.0.1:8080/').hostname).toBe('127.0.0.1');
    // IPv6 loopback accepte (crochets), voisins refuses
    expect(assertLoopbackSearxUrl('http://[::1]:8080/').port).toBe('8080');
    expect(() => assertLoopbackSearxUrl('http://[::2]:8080/')).toThrow(/loopback/);
    expect(() => assertLoopbackSearxUrl('http://127.0.0.1.nip.io/')).toThrow(/loopback/);
    expect(() => assertLoopbackSearxUrl('http://user:pw@127.0.0.1/')).toThrow(/credentials/);
  });

  it('resolveSearchEngine : brave > searx > ddg', () => {
    expect(resolveSearchEngine({}).engine).toBe('duckduckgo-instant-answer');
    expect(
      resolveSearchEngine({ IRIS_SEARXNG_URL: 'http://127.0.0.1:8080' }).engine,
    ).toBe('searxng');
    expect(resolveSearchEngine({ BRAVE_API_KEY: 'x', IRIS_SEARXNG_URL: 'http://127.0.0.1:8080' }).engine).toBe(
      'brave',
    );
  });

  it('sans cle : repli DDG', async () => {
    mockFetchJson.mockResolvedValue({
      Heading: 'Test',
      AbstractText: 'Resume',
      AbstractURL: 'https://example.com/a',
      RelatedTopics: [],
    });
    const p = payloadOf(await tool.execute({ query: 'test iris', limit: 3 }));
    expect(p.engine).toBe('duckduckgo-instant-answer');
    expect(p.count).toBeGreaterThanOrEqual(1);
  });

  it('SearXNG loopback : mappe les resultats https', async () => {
    process.env.IRIS_SEARXNG_URL = 'http://127.0.0.1:8080/';
    mockFetchJson.mockResolvedValue({
      results: [
        { title: 'A', url: 'https://example.com/1', content: 'un' },
        { title: 'B', url: 'http://insecure.example/', content: 'skip' },
      ],
    });
    const p = payloadOf(await tool.execute({ query: 'kit', limit: 5 }));
    expect(p.engine).toBe('searxng');
    expect(p.count).toBe(1);
    expect((p.results as { url: string }[])[0]!.url).toBe('https://example.com/1');
  });

  it('Brave : utilise fetch + token (jamais dans la sortie)', async () => {
    process.env.BRAVE_API_KEY = 'secret-test-key-not-real';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
        expect(init?.headers?.['X-Subscription-Token']).toBe('secret-test-key-not-real');
        expect((init as { redirect?: string })?.redirect).toBe('error');
        return {
          ok: true,
          json: async () => ({
            web: {
              results: [{ title: 'Brave hit', url: 'https://example.com/b', description: 'ok' }],
            },
          }),
        };
      }),
    );
    const p = payloadOf(await tool.execute({ query: 'mcp', limit: 3 }));
    expect(p.engine).toBe('brave');
    expect(p.count).toBe(1);
    expect(JSON.stringify(p)).not.toContain('secret-test-key');
  });
});
