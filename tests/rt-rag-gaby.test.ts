import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ragQuery } from '../src/tools/rag-query-v1.js';
import { ragSearch, isOllamaModelLoaded } from '../src/tools/rag-search-v2.js';
import { ragHybrid } from '../src/tools/rag-hybrid-v1.js';
import { resoudreBaseQdrant, resoudreBaseOllama, QDRANT_OPT_IN } from '../src/utils/rag-http.js';

// Lot RAG (decision Peter 08:11) : vrai faux Qdrant et faux Ollama sur loopback.
// Donnees fictives, cle Qdrant FACTICE, aucun contenu du vault, aucun reseau externe.

const CLE = 'cle-qdrant-factice-0000';
const MIO = 1_048_576;
const PATTERNS = {
  version: 'test-rag-gaby',
  ragQueryExcludeContains: ['zone-alpha-sensitive'],
  ragAlwaysExcludeContains: ['zone-alpha-sensitive'],
};

let srv: Server;
let port = 0;
let mode = 'ok';
let autreHits = 0;
let rec: Array<{ path: string; cle: string }> = [];
let dossier = '';
let patternsFile = '';

function bloc(res: ServerResponse, octets: number, suite: string) {
  const b = Buffer.alloc(65_536, 65);
  let n = 0;
  const pousse = () => {
    while (n < octets) {
      const k = Math.min(b.length, octets - n);
      n += k;
      if (!res.write(b.subarray(0, k))) return void res.once('drain', pousse);
    }
    res.end(suite);
  };
  pousse();
}

function repondre(req: IncomingMessage, res: ServerResponse) {
  const path = req.url ?? '';
  if (path.startsWith('/autre')) {
    autreHits += 1;
    rec.push({ path: '/autre', cle: String(req.headers['api-key'] ?? '') });
    res.writeHead(200);
    return res.end('{}');
  }
  rec.push({ path, cle: String(req.headers['api-key'] ?? '') });
  const json = (o: unknown) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(o));
  };
  const qdrant = path.includes('/points/');
  if (mode === 'redirect' && (qdrant || path.includes('/api/'))) {
    res.writeHead(302, { location: '/autre' });
    return res.end();
  }
  if (mode === 'enorme') {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (qdrant) {
      res.write('{"result":[{"score":0.5,"payload":{"sourceFile":"D:\\\\Fictif\\\\a.md","text":"');
      return bloc(res, 20 * MIO, '"}}]}');
    }
    res.write('{"embedding":[0.1],"models":[],"x":"');
    return bloc(res, 3 * MIO, '"}');
  }
  if (mode === 'goutte' && qdrant) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"result":[');
    const t = setInterval(() => res.write(' '), 300);
    res.on('close', () => clearInterval(t));
    return;
  }
  if (path.endsWith('/api/embeddings')) return json({ embedding: [0.1, 0.2, 0.3] });
  if (path.endsWith('/api/embed')) return json({ embeddings: [[0.1, 0.2, 0.3], [0.1, 0.2, 0.3], [0.1, 0.2, 0.3], [0.1, 0.2, 0.3]] });
  if (path.endsWith('/api/ps')) return json({ models: [{ name: 'fictif:1b' }] });
  if (path.endsWith('/points/search')) {
    return json({ result: [{ score: 0.9, payload: { sourceFile: 'D:\\Fictif\\note-a.md', source_filename: 'note-a.md', text: 'texte fictif' } }] });
  }
  if (path.endsWith('/points/scroll')) {
    return json({ result: { points: [{ payload: { sourceFile: 'D:\\Fictif\\note-b.md', source_filename: 'note-b.md', text: 'autre texte fictif' } }] } });
  }
  res.writeHead(404);
  res.end();
}

beforeAll(async () => {
  srv = createServer(repondre);
  port = await new Promise<number>((ok) => srv.listen(0, '127.0.0.1', () => ok((srv.address() as AddressInfo).port)));
  dossier = mkdtempSync(join(tmpdir(), 'iris-rag-gaby-'));
  patternsFile = join(dossier, 'zone-a-patterns.json');
  writeFileSync(patternsFile, JSON.stringify(PATTERNS), 'utf8');
});
afterAll(async () => {
  srv.closeAllConnections();
  await new Promise((ok) => srv.close(ok));
  rmSync(dossier, { recursive: true, force: true });
});
beforeEach(() => {
  mode = 'ok';
  autreHits = 0;
  rec = [];
  for (const v of ['QDRANT_URL', 'OLLAMA_BASE_URL', 'IRIS_QDRANT_HORS_LOOPBACK', 'IRIS_OLLAMA_HORS_LOOPBACK', 'QDRANT_READ_ONLY_API_KEY'])
    vi.stubEnv(v, '');
  vi.stubEnv('QDRANT_API_KEY', CLE);
  vi.stubEnv('QDRANT_URL', `http://127.0.0.1:${port}`);
  vi.stubEnv('OLLAMA_BASE_URL', `http://127.0.0.1:${port}`);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const cleSurQdrantSeulement = () => {
  const qd = rec.filter((r) => r.path.includes('/points/'));
  const autres = rec.filter((r) => !r.path.includes('/points/'));
  expect(qd.length).toBeGreaterThan(0);
  expect(qd.every((r) => r.cle === CLE)).toBe(true);
  expect(autres.every((r) => r.cle === '')).toBe(true);
};
const erreur = (r: { meta: Record<string, unknown> }) => String(r.meta.error ?? '');

describe('rag-query-v1', () => {
  const q = () => ragQuery({ query: 'test', limit: 3, patternsFile });
  it('cas normal : la cle va a Qdrant, jamais a Ollama, jamais dans le resultat', async () => {
    const r = await q();
    expect(r.hits.length).toBe(1);
    cleSurQdrantSeulement();
    expect(JSON.stringify(r)).not.toContain(CLE);
  });
  it('base Ollama dont le chemin contient /collections/ : la cle ne part PAS vers Ollama (avant : motif dans l URL)', async () => {
    vi.stubEnv('OLLAMA_BASE_URL', `http://127.0.0.1:${port}/collections/x`);
    await q();
    cleSurQdrantSeulement();
  });
  it.each([
    ['QDRANT_URL', 'http://192.168.1.5:6334', /IRIS_QDRANT_HORS_LOOPBACK/],
    ['OLLAMA_BASE_URL', 'http://192.168.1.5:11434', /IRIS_OLLAMA_HORS_LOOPBACK/],
    ['QDRANT_URL', 'http://u:pw@127.0.0.1:6334', /identifiants/],
    ['OLLAMA_BASE_URL', '\\\\hote\\partage', /reseau/],
    ['QDRANT_URL', 'file:///C:/x', /http/],
  ])('%s = %s : refus avant tout reseau, sans echo de l URL', async (nom, valeur, motif) => {
    vi.stubEnv(nom, valeur);
    const f = vi.fn(globalThis.fetch);
    vi.stubGlobal('fetch', f);
    const r = await q();
    expect(erreur(r)).toMatch(motif);
    expect(erreur(r)).not.toContain('pw@');
    expect(f).not.toHaveBeenCalled();
    expect(rec).toHaveLength(0);
  });
  it('redirection Qdrant : refusee, rien n est envoye a la cible', async () => {
    mode = 'redirect';
    const r = await q();
    expect(erreur(r)).toMatch(/injoignable|Ollama/);
    expect(autreHits).toBe(0);
  });
  it('reponse geante (Ollama 3 Mio, Qdrant 20 Mio) : refusee', async () => {
    mode = 'enorme';
    const r = await q();
    expect(erreur(r)).toMatch(/trop volumineuse/);
  });
  it('Qdrant goutte a goutte : coupe par le delai (reduit a 1,5 s dans ce test)', async () => {
    mode = 'goutte';
    const orig = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...a: unknown[]) =>
      orig(fn, ms === 60_000 ? 1_500 : ms, ...a)) as typeof setTimeout);
    const t0 = Date.now();
    const r = await q();
    expect(erreur(r)).toMatch(/Qdrant injoignable/);
    expect(Date.now() - t0).toBeLessThan(6_000);
  }, 15_000);
});

describe('rag-search-v2', () => {
  const s = () => ragSearch({ query: 'test', limit: 3, patternsFile, reformulate: false });
  it('cas normal : cle seulement vers Qdrant', async () => {
    const r = await s();
    expect(r.hits.length).toBeGreaterThanOrEqual(1);
    cleSurQdrantSeulement();
    expect(JSON.stringify(r)).not.toContain(CLE);
  });
  it('base Ollama piegee (/collections/) : pas de cle vers Ollama', async () => {
    vi.stubEnv('OLLAMA_BASE_URL', `http://127.0.0.1:${port}/collections/x`);
    await s();
    cleSurQdrantSeulement();
  });
  it('bases hors loopback : refus avant tout reseau', async () => {
    vi.stubEnv('QDRANT_URL', 'http://192.168.1.5:6334');
    const f = vi.fn(globalThis.fetch);
    vi.stubGlobal('fetch', f);
    const r = await s();
    expect(erreur(r)).toMatch(/IRIS_QDRANT_HORS_LOOPBACK/);
    expect(f).not.toHaveBeenCalled();
  });
  it('redirection et reponse geante : refusees', async () => {
    mode = 'redirect';
    await s();
    expect(autreHits).toBe(0);
    mode = 'enorme';
    const r = await s();
    expect(JSON.stringify(r.meta)).toMatch(/trop volumineuse|injoignable|erreur/i);
  });
  it('isOllamaModelLoaded : normal, redirection et corps geant', async () => {
    const base = `http://127.0.0.1:${port}`;
    expect(await isOllamaModelLoaded(base, 'fictif:1b')).toBe(true);
    mode = 'redirect';
    expect(await isOllamaModelLoaded(base, 'fictif:1b')).toBeNull();
    expect(autreHits).toBe(0);
    mode = 'enorme';
    expect(await isOllamaModelLoaded(base, 'fictif:1b')).toBeNull();
  });
});

describe('rag-hybrid-v1', () => {
  const h = () => ragHybrid({ query: 'test', limit: 3, patternsFile });
  it('cas normal : cle seulement vers Qdrant (vectoriel et lexical)', async () => {
    const r = await h();
    expect(r.hits.length).toBeGreaterThanOrEqual(1);
    cleSurQdrantSeulement();
    expect(JSON.stringify(r)).not.toContain(CLE);
  });
  it('QDRANT_URL hors loopback : refus avant tout reseau', async () => {
    vi.stubEnv('QDRANT_URL', 'http://192.168.1.5:6334');
    const f = vi.fn(globalThis.fetch);
    vi.stubGlobal('fetch', f);
    const r = await h();
    expect(erreur(r)).toMatch(/IRIS_QDRANT_HORS_LOOPBACK/);
    expect(f).not.toHaveBeenCalled();
  });
  it('redirection : refusee, cible jamais appelee', async () => {
    mode = 'redirect';
    await h();
    expect(autreHits).toBe(0);
  });
});

describe('resolveurs Qdrant et Ollama', () => {
  const e = (o: Record<string, string>) => resoudreBaseQdrant(o as NodeJS.ProcessEnv);
  it.each([
    [undefined, 'http://127.0.0.1:6334'],
    ['', 'http://127.0.0.1:6334'],
    ['http://127.0.0.1:6334/', 'http://127.0.0.1:6334'],
    ['http://localhost:6333', 'http://localhost:6333'],
    ['http://[::1]:6334', 'http://[::1]:6334'],
  ])('Qdrant accepte %s', (v, attendu) => {
    expect(e(v === undefined ? {} : { QDRANT_URL: v })).toEqual({ ok: true, url: attendu });
  });
  it.each(['http://192.168.1.5:6334', 'http://0.0.0.0:6334', 'http://localhost.:6334', 'http://u:p@127.0.0.1:6334', 'http://127.0.0.1:6334/?a=1', '\\\\h\\s', '//h/x', 'ftp://127.0.0.1', 'pas une url'])(
    'Qdrant refuse %s',
    (v) => {
      expect(e({ QDRANT_URL: v }).ok).toBe(false);
    },
  );
  it('opt-in Qdrant : autre machine acceptee, mais pas les identifiants ni UNC', () => {
    const o = { [QDRANT_OPT_IN]: '1' };
    expect(e({ ...o, QDRANT_URL: 'http://192.168.1.5:6334' }).ok).toBe(true);
    expect(e({ ...o, QDRANT_URL: 'http://u:p@192.168.1.5:6334' }).ok).toBe(false);
    expect(e({ ...o, QDRANT_URL: '\\\\h\\s' }).ok).toBe(false);
  });
  it('valeur explicite (parametre) : memes regles que la variable', () => {
    expect(resoudreBaseOllama({} as NodeJS.ProcessEnv, 'http://192.168.1.5:11434').ok).toBe(false);
    expect(resoudreBaseQdrant({} as NodeJS.ProcessEnv, 'http://127.0.0.1:1234').ok).toBe(true);
  });
});