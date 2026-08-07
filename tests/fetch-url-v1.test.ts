import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { tool } from '../src/tools/fetch-url-v1.js';

const mockLookup = vi.mocked(lookup);
const mockFetch = vi.fn();

function response(body: string | null, contentType = 'text/plain; charset=utf-8', status = 200): Response {
  const headers: Record<string, string> = {};
  if (contentType.length > 0) headers['content-type'] = contentType;
  return new Response(body, { status, headers });
}

function payloadOf(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

beforeEach(() => {
  mockLookup.mockReset();
  mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetch-url-v1 : metadonnees outil', () => {
  it('a l identite attendue', () => {
    expect(tool.id).toBe('fetch-url-v1');
    expect(tool.category).toBe('web');
    expect(Object.keys(tool.inputSchema)).toEqual(['url', 'max_chars']);
  });
});

describe('fetch-url-v1 : cas nominal', () => {
  it('retourne le texte d une page HTML converti', async () => {
    mockFetch.mockResolvedValue(
      response(
        '<html><head><title>T</title><style>p{color:red}</style></head><body><p>Bonjour Iris</p></body></html>',
        'text/html; charset=utf-8',
      ),
    );
    const payload = payloadOf(await tool.execute({ url: 'https://example.com/page' }));
    expect(payload.status).toBe(200);
    expect(payload.format).toBe('html_vers_texte');
    expect(payload.text).toContain('Bonjour Iris');
    expect(payload.text).not.toContain('<p>');
    expect(payload.truncated).toBe(false);
    expect(payload.final_url).toBe('https://example.com/page');
    expect(payload.error).toBeUndefined();
  });

  it('retourne le corps brut d une API JSON', async () => {
    mockFetch.mockResolvedValue(response('{"ok":true}', 'application/json'));
    const payload = payloadOf(await tool.execute({ url: 'https://example.com/api' }));
    expect(payload.format).toBe('brut');
    expect(payload.text).toBe('{"ok":true}');
    expect(payload.content_type).toBe('application/json');
  });

  it('signale l URL finale apres redirection', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://example.org/ici' } }))
      .mockResolvedValueOnce(response('arrivee'));
    const payload = payloadOf(await tool.execute({ url: 'https://example.com/depart' }));
    expect(payload.url).toBe('https://example.com/depart');
    expect(payload.final_url).toBe('https://example.org/ici');
    expect(payload.redirects).toBe(1);
  });
});

describe('fetch-url-v1 : URL refusees (SSRF)', () => {
  const refuses = [
    'http://127.0.0.1/api/tags',
    'http://localhost:11434/api/tags',
    'https://192.168.0.1/admin',
    'https://10.0.0.5/',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/',
    'https://nas.local/',
    'file:///C:/Windows/win.ini',
  ];

  for (const url of refuses) {
    it(`refuse ${url} avec une erreur JSON propre`, async () => {
      const result = await tool.execute({ url });
      const payload = payloadOf(result);
      expect(typeof payload.error).toBe('string');
      expect(payload.text).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  }

  it('refuse une redirection vers une IP privee', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://192.168.1.1/interne' } }),
    );
    const payload = payloadOf(await tool.execute({ url: 'https://example.com/piege' }));
    expect(String(payload.error)).toMatch(/Hote refuse/);
  });

  it('refuse un nom public qui resout vers une IP privee', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    const payload = payloadOf(await tool.execute({ url: 'https://rebind.example.com/' }));
    expect(String(payload.error)).toMatch(/privee ou reservee/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('fetch-url-v1 : erreurs reseau', () => {
  it('HTTP 500 donne une erreur propre', async () => {
    mockFetch.mockResolvedValue(response('erreur serveur', 'text/plain', 500));
    const payload = payloadOf(await tool.execute({ url: 'https://example.com/' }));
    expect(String(payload.error)).toContain('HTTP 500');
  });

  it('timeout donne une erreur propre', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted', 'TimeoutError'));
    const payload = payloadOf(await tool.execute({ url: 'https://example.com/lent' }));
    expect(typeof payload.error).toBe('string');
  });

  it('Content-Type binaire donne une erreur propre', async () => {
    mockFetch.mockResolvedValue(response('%PDF-1.7', 'application/pdf'));
    const payload = payloadOf(await tool.execute({ url: 'https://example.com/doc.pdf' }));
    expect(String(payload.error)).toContain('Content-Type non supporte');
  });
});

describe('fetch-url-v1 : plafond de taille', () => {
  it('tronque et signale truncated', async () => {
    mockFetch.mockResolvedValue(response('x'.repeat(50_000)));
    const payload = payloadOf(await tool.execute({ url: 'https://example.com/gros', max_chars: 1000 }));
    expect(payload.truncated).toBe(true);
    expect(String(payload.text)).toHaveLength(1000);
    expect(Number(payload.bytes_approx)).toBeGreaterThan(0);
  });

  it('ne signale pas de troncature sous le plafond', async () => {
    mockFetch.mockResolvedValue(response('petit contenu'));
    const payload = payloadOf(await tool.execute({ url: 'https://example.com/petit' }));
    expect(payload.truncated).toBe(false);
  });
});
