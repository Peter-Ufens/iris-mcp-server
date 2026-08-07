import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { fetchText, isTextualContentType, MAX_TEXT_CHARS, USER_AGENT } from '../src/utils/http-fetch.js';
import { UrlGuardError } from '../src/utils/url-guard.js';

const mockLookup = vi.mocked(lookup);
const mockFetch = vi.fn();

function textResponse(body: string, contentType = 'text/plain; charset=utf-8', status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
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

describe('isTextualContentType', () => {
  it('accepte text/*, json, xml, xhtml', () => {
    expect(isTextualContentType('text/html; charset=utf-8')).toBe(true);
    expect(isTextualContentType('application/json')).toBe(true);
    expect(isTextualContentType('application/xhtml+xml')).toBe(true);
    expect(isTextualContentType('application/vnd.api+json')).toBe(true);
    expect(isTextualContentType('')).toBe(true);
  });

  it('refuse le binaire', () => {
    expect(isTextualContentType('application/pdf')).toBe(false);
    expect(isTextualContentType('image/png')).toBe(false);
    expect(isTextualContentType('application/zip')).toBe(false);
  });
});

describe('fetchText : cas nominal', () => {
  it('retourne le texte, le statut et le content-type', async () => {
    mockFetch.mockResolvedValue(textResponse('Bonjour Iris'));
    const result = await fetchText('https://example.com/page');
    expect(result.status).toBe(200);
    expect(result.text).toBe('Bonjour Iris');
    expect(result.truncated).toBe(false);
    expect(result.finalUrl).toBe('https://example.com/page');
    expect(result.redirects).toBe(0);
    expect(result.bytesApprox).toBeGreaterThan(0);
  });

  it('envoie le User-Agent Iris et ne suit pas les redirects automatiquement', async () => {
    mockFetch.mockResolvedValue(textResponse('ok'));
    await fetchText('https://example.com/');
    const init = mockFetch.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers['User-Agent']).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^iris-mcp-server\/\d+\.\d+\.\d+/);
    expect(init.redirect).toBe('manual');
  });
});

describe('fetchText : garde SSRF', () => {
  it('refuse localhost sans appeler fetch', async () => {
    await expect(fetchText('http://127.0.0.1:11434/api/tags')).rejects.toThrow(UrlGuardError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuse une IP privee sans appeler fetch', async () => {
    await expect(fetchText('https://192.168.0.1/admin')).rejects.toThrow(UrlGuardError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuse les metadonnees cloud', async () => {
    await expect(fetchText('https://169.254.169.254/latest/meta-data/')).rejects.toThrow(UrlGuardError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuse un hote hors allowlist', async () => {
    await expect(fetchText('https://example.com/', { allowedHosts: ['wikipedia.org'] })).rejects.toThrow(
      /allowlist/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('fetchText : redirections', () => {
  it('suit une redirection et revalide la cible', async () => {
    mockFetch
      .mockResolvedValueOnce(redirectResponse('https://example.org/final'))
      .mockResolvedValueOnce(textResponse('contenu final'));
    const result = await fetchText('https://example.com/depart');
    expect(result.redirects).toBe(1);
    expect(result.finalUrl).toBe('https://example.org/final');
    expect(result.url).toBe('https://example.com/depart');
    expect(result.text).toBe('contenu final');
  });

  it('accepte une redirection relative', async () => {
    mockFetch
      .mockResolvedValueOnce(redirectResponse('/suite', 301))
      .mockResolvedValueOnce(textResponse('suite'));
    const result = await fetchText('https://example.com/depart');
    expect(result.finalUrl).toBe('https://example.com/suite');
  });

  it('refuse une redirection vers une IP privee', async () => {
    mockFetch.mockResolvedValueOnce(redirectResponse('https://10.0.0.5/interne'));
    await expect(fetchText('https://example.com/piege')).rejects.toThrow(UrlGuardError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refuse une redirection vers http', async () => {
    mockFetch.mockResolvedValueOnce(redirectResponse('http://example.org/clair'));
    await expect(fetchText('https://example.com/piege')).rejects.toThrow(/https/);
  });

  it('coupe au dela de 3 redirections', async () => {
    mockFetch.mockResolvedValue(redirectResponse('https://example.com/boucle'));
    await expect(fetchText('https://example.com/boucle')).rejects.toThrow(/Trop de redirections/);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe('fetchText : erreurs HTTP et types', () => {
  it('remonte une erreur sur HTTP 500', async () => {
    mockFetch.mockResolvedValue(textResponse('boom', 'text/plain', 500));
    await expect(fetchText('https://example.com/')).rejects.toThrow(/HTTP 500/);
  });

  it('remonte une erreur sur HTTP 404', async () => {
    mockFetch.mockResolvedValue(textResponse('absent', 'text/plain', 404));
    await expect(fetchText('https://example.com/')).rejects.toThrow(/HTTP 404/);
  });

  it('refuse un Content-Type binaire', async () => {
    mockFetch.mockResolvedValue(textResponse('%PDF-1.7', 'application/pdf'));
    await expect(fetchText('https://example.com/doc.pdf')).rejects.toThrow(/Content-Type non supporte/);
  });

  it('propage un timeout', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted', 'TimeoutError'));
    await expect(fetchText('https://example.com/lent')).rejects.toThrow(/abort/i);
  });
});

describe('fetchText : plafond de taille', () => {
  it('tronque au plafond demande', async () => {
    mockFetch.mockResolvedValue(textResponse('a'.repeat(5000)));
    const result = await fetchText('https://example.com/gros', { maxChars: 1000 });
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(1000);
  });

  it('ne tronque pas un contenu plus petit que le plafond', async () => {
    mockFetch.mockResolvedValue(textResponse('court'));
    const result = await fetchText('https://example.com/petit', { maxChars: 1000 });
    expect(result.truncated).toBe(false);
    expect(result.text).toBe('court');
  });

  it('borne max_chars au plafond dur du serveur', async () => {
    mockFetch.mockResolvedValue(textResponse('b'.repeat(MAX_TEXT_CHARS + 5000)));
    const result = await fetchText('https://example.com/enorme', { maxChars: 10_000_000 });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(MAX_TEXT_CHARS);
  });
});
