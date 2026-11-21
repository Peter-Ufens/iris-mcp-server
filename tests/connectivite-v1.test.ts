import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  tool,
  classerDebit,
  resetConnectiviteForTests,
  CONNECTIVITE_TAILLES,
  CONNECTIVITE_PAUSE_MS,
} from '../src/tools/connectivite-v1.js';
import { resetHttpCacheForTests } from '../src/utils/http-cache.js';

/** Bob 16/11 : sonde de connectivite, base Hermes (ADR-0006 de Hermes-Agent). */

function corps(octets: number): Response {
  return new Response(new Uint8Array(octets), { status: 200 });
}
const P = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text) as Record<string, unknown>;

beforeEach(() => {
  resetConnectiviteForTests();
  resetHttpCacheForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('connectivite-v1', () => {
  it('memes seuils que Hermes : OK >= 5, SLOW 1 a 5, DOWN < 1', () => {
    expect(classerDebit(13.7)).toBe('OK');
    expect(classerDebit(5)).toBe('OK');
    expect(classerDebit(4.99)).toBe('SLOW');
    expect(classerDebit(1)).toBe('SLOW');
    expect(classerDebit(0.99)).toBe('DOWN');
    expect(classerDebit(null)).toBe('DOWN');
  });

  it('URL fixe : seul hote speed.cloudflare.com, 1 Mio comme Hermes, pas de redirection', async () => {
    const f = vi.fn(async () => corps(CONNECTIVITE_TAILLES.standard));
    vi.stubGlobal('fetch', f);
    const r = P(await tool.execute({}));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://speed.cloudflare.com/__down?bytes=1048576');
    expect(init.redirect).toBe('error');
    expect(r.octets_recus).toBe(1048576);
    expect(['OK', 'SLOW', 'DOWN']).toContain(r.etat);
  });

  it('un telechargement complet et rapide donne OK', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => corps(CONNECTIVITE_TAILLES.standard)));
    const r = P(await tool.execute({}));
    expect(r.etat).toBe('OK');
    expect(r.conseil).toMatch(/web complet/);
    expect(r.cache).toBe(false);
  });

  it('HTTP 503 : DOWN, sans echec de l outil (c est une mesure)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 503 })));
    const res = await tool.execute({});
    expect(res.isError).toBeUndefined();
    expect(P(res)).toMatchObject({ etat: 'DOWN', http: 503, cause: 'http_503' });
  });

  it('reseau coupe : DOWN avec une cause courte', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(P(await tool.execute({}))).toMatchObject({ etat: 'DOWN', cause: 'reseau', debit_mbps: 0 });
  });

  it('telechargement incomplet : DOWN, cause dite', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => corps(1000)));
    expect(P(await tool.execute({}))).toMatchObject({ etat: 'DOWN', cause: 'telechargement_incomplet' });
  });

  it('jamais plus que prevu : un serveur qui envoie trop est coupe peu apres la taille demandee', async () => {
    const MORCEAU = 65536;
    let lus = 0;
    const flux = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        lus += 1;
        if (lus > 160) ctrl.close(); // 160 x 64 Kio = 10 Mio au plus
        else ctrl.enqueue(new Uint8Array(MORCEAU));
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(flux, { status: 200 })));
    const r = P(await tool.execute({}));
    expect(Number(r.octets_recus)).toBeLessThanOrEqual(CONNECTIVITE_TAILLES.standard + 2 * MORCEAU);
    expect(lus).toBeLessThan(24); // 1 Mio = 16 morceaux : on s'arrete bien avant les 160
  });

  it('Airbox : deux appels en moins d une minute = un seul telechargement (le 2e rend la mesure en cache)', async () => {
    const f = vi.fn(async () => corps(CONNECTIVITE_TAILLES.standard));
    vi.stubGlobal('fetch', f);
    await tool.execute({});
    const r2 = P(await tool.execute({}));
    expect(f).toHaveBeenCalledTimes(1);
    expect(r2.cache).toBe(true);
    vi.useFakeTimers({ now: Date.now() + CONNECTIVITE_PAUSE_MS + 1000, toFake: ['Date'] });
    await tool.execute({});
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('annotations : lecture seule, monde ouvert', () => {
    expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
  });
});
