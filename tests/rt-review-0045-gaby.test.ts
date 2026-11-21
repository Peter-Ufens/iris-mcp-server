import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { estPanneRag, causeErreurQdrant } from '../src/utils/rag-http.js';
import { fetchJson, messageReseau } from '../src/utils/http-fetch.js';
import { estConnexionRefusee } from '../src/utils/searxng-reveil.js';
import { ragHybrid, tool as hybridTool } from '../src/tools/rag-hybrid-v1.js';
import { dossierJournal as dossierMoteurs } from '../src/utils/journal-moteurs.js';
import { dossierJournal as dossierRag, JOURNAL_ENV } from '../src/utils/rag-journal.js';
import { dossierPermisSousTest } from '../src/utils/garde-test.js';
import { _resetOllamaKoCachePourTests } from '../src/utils/local-embeddings.js';

// Review Gaby 21/11 du patch 0045 (corrections C1 a C4 de Bob, commit Karen). Donnees FICTIVES, serveurs loopback.

const F5_HYBRIDE = 'includeReserved ignore : IRIS_ALLOW_RESERVED=1 requis (F5).';
const F5_QUERY = 'includeReserved ignore : definir IRIS_ALLOW_RESERVED=1 pour autoriser (F5).';

describe('C3 : isError seulement pour une vraie panne', () => {
  it('rag-hybrid joint par « | » : F5 + Ollama injoignable = panne (avant : masquee)', () => {
    expect(estPanneRag({ hits: [], meta: { error: `${F5_HYBRIDE} | Ollama injoignable ou modele absent (x) | canal lexical indisponible (y)` } })).toBe(true);
  });
  it('rag-query joint par « · » : F5 + Qdrant = panne', () => {
    expect(estPanneRag({ hits: [], meta: { error: `${F5_QUERY} · Qdrant injoignable (z)` } })).toBe(true);
  });
  it('note F5 seule, ou F5 deux fois (hybride + vectoriel) : PAS une panne', () => {
    expect(estPanneRag({ hits: [], meta: { error: F5_QUERY } })).toBe(false);
    expect(estPanneRag({ hits: [], meta: { error: `${F5_HYBRIDE} | ${F5_QUERY}` } })).toBe(false);
  });
  it('des resultats : jamais isError, meme avec une erreur jointe', () => {
    expect(estPanneRag({ hits: [{}], meta: { error: 'Ollama injoignable' } })).toBe(false);
  });
});

describe('C3 de bout en bout : rag-hybrid, includeReserved refuse ET Ollama coupe', () => {
  let patternsFile = '';
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'rv0045-'));
    patternsFile = join(dir, 'zone-a-patterns.json');
    writeFileSync(patternsFile, JSON.stringify({ version: 't', ragQueryExcludeContains: ['zone-alpha-sensitive'], ragAlwaysExcludeContains: ['zone-alpha-sensitive'] }));
    _resetOllamaKoCachePourTests();
    vi.stubEnv('ZONE_A_PATTERNS_FILE', patternsFile);
    vi.stubEnv('IRIS_ALLOW_RESERVED', '');
    vi.stubEnv('IRIS_RAG_JOURNAL_DIR', '');
    vi.stubEnv('IRIS_JOURNAL_MOTEURS_DIR', '');
    vi.stubEnv('OLLAMA_BASE_URL', '');
    vi.stubEnv('QDRANT_URL', '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/api/embeddings') || u.includes('/v1/embeddings') || u.endsWith('/health')) throw new TypeError('fetch failed');
        if (u.includes('/points/scroll')) return { ok: true, json: async () => ({ result: { points: [] } }) };
        if (u.includes('/points/search')) return { ok: true, json: async () => ({ result: [] }) };
        throw new Error(`url inattendue ${u}`);
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    _resetOllamaKoCachePourTests();
  });
  it('0 resultat, Ollama en panne, note F5 : isError vrai', async () => {
    const r = await hybridTool.execute({ query: 'Tondeuse', includeReserved: true });
    expect(String((r.content[0] as { text: string }).text)).toMatch(/F5/);
    expect(r.isError).toBe(true);
  });
});

describe('C4 : la cause reseau reste lisible et attachee', () => {
  it('code inconnu (EHOSTUNREACH) : le code est ajoute a « fetch failed »', () => {
    expect(messageReseau({ message: 'fetch failed', cause: { code: 'EHOSTUNREACH' } })).toMatch(/EHOSTUNREACH/);
  });
  it('code bizarre (injection) : jamais recopie', () => {
    expect(messageReseau({ message: 'fetch failed', cause: { code: 'x\n<script>' } })).toBe('fetch failed');
  });
  it('localhost (IPv6 puis IPv4, erreur groupee) sur un port ferme : estConnexionRefusee reste vrai', async () => {
    const tmp = createServer();
    const port = await new Promise<number>((ok) => tmp.listen(0, '127.0.0.1', () => ok((tmp.address() as AddressInfo).port)));
    await new Promise((ok) => tmp.close(ok));
    let err: unknown;
    try {
      await fetchJson(`http://localhost:${port}/x`);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toMatch(/ECONNREFUSED/);
    expect(estConnexionRefusee(err)).toBe(true);
  });
});

describe('C2 : lecture de la collection Qdrant (GET), cas hostiles', () => {
  type Srv = { srv: Server; port: number; recus: Array<{ url: string; cle: string }>; mode: string };
  let q: Srv;
  let autre: Srv;
  const demarrer = async (h: (s: Srv, req: IncomingMessage, res: ServerResponse) => void): Promise<Srv> => {
    const s: Srv = { srv: undefined as unknown as Server, port: 0, recus: [], mode: '' };
    s.srv = createServer((req, res) => {
      s.recus.push({ url: req.url ?? '', cle: String(req.headers['api-key'] ?? '') });
      h(s, req, res);
    });
    s.port = await new Promise<number>((ok) => s.srv.listen(0, '127.0.0.1', () => ok((s.srv.address() as AddressInfo).port)));
    return s;
  };
  beforeAll(async () => {
    autre = await demarrer((_s, _req, res) => void res.writeHead(200, { 'content-type': 'application/json' }).end('{"result":{"config":{"params":{"vectors":{"size":768}}}}}'));
    q = await demarrer((s, _req, res) => {
      const ok = (o: unknown) => void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
      if (s.mode === 'nomme') return ok({ result: { config: { params: { vectors: { dense: { size: 768, distance: 'Cosine' } } } } } });
      if (s.mode === 'enorme') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return void res.end('{"result":{"x":"' + 'A'.repeat(2_000_000) + '"}}');
      }
      if (s.mode === 'redirect') return void res.writeHead(302, { location: `http://127.0.0.1:${autre.port}/collections/c` }).end();
      if (s.mode === 'muet') return; // ne repond jamais
      return ok({ result: { config: { params: { vectors: { size: 768 } } } } });
    });
  });
  afterAll(async () => {
    for (const s of [q, autre]) {
      s.srv.closeAllConnections();
      await new Promise((ok) => s.srv.close(ok));
    }
  });
  beforeEach(() => {
    q.recus = [];
    autre.recus = [];
    vi.stubEnv('QDRANT_API_KEY', 'cle-factice-0045');
  });
  afterEach(() => vi.unstubAllEnvs());
  const base = () => `http://127.0.0.1:${q.port}`;
  const http400 = new Error('HTTP 400 Bad Request');

  it('vecteurs nommes : la taille du premier est comparee, message vrai, cle envoyee a Qdrant seulement', async () => {
    q.mode = 'nomme';
    const m = await causeErreurQdrant(http400, base(), 'c', 384);
    expect(m).toMatch(/384 nombres.*768/);
    expect(q.recus[0]!.cle).toBe('cle-factice-0045');
  });
  it('reponse enorme (2 Mo) : plafond, message general, pas de plantage', async () => {
    q.mode = 'enorme';
    expect(await causeErreurQdrant(http400, base(), 'c', 384)).toMatch(/Qdrant a refuse la recherche/);
  });
  it('redirection : refusee, la cle ne part jamais vers l autre serveur', async () => {
    q.mode = 'redirect';
    expect(await causeErreurQdrant(http400, base(), 'c', 384)).toMatch(/Qdrant a refuse la recherche/);
    expect(autre.recus).toHaveLength(0);
  });
  it('Qdrant muet sur /collections : abandon en 5 s environ, message general', async () => {
    q.mode = 'muet';
    const t0 = Date.now();
    expect(await causeErreurQdrant(http400, base(), 'c', 384)).toMatch(/Qdrant a refuse la recherche/);
    const ms = Date.now() - t0;
    expect(ms).toBeGreaterThanOrEqual(4_500);
    expect(ms).toBeLessThan(7_000);
  }, 10_000);
  it('meme taille : pas d accusation du moteur d embeddings', async () => {
    q.mode = '';
    expect(await causeErreurQdrant(http400, base(), 'c', 768)).toMatch(/Qdrant a refuse la recherche/);
  });
  it('reponse trop grosse ou illisible : « inutilisable », pas « injoignable »', async () => {
    expect(await causeErreurQdrant(new Error('reponse trop volumineuse (> 16777216 octets)'), base(), 'c')).toMatch(/inutilisable/);
    expect(await causeErreurQdrant(new TypeError('fetch failed'), base(), 'c')).toMatch(/injoignable/);
  });
});

describe('C1 : le rattrapage du mode degrade respecte tous les perimetres', () => {
  const V = 'D:\\Vault\\Example\\';
  let patternsFile = '';
  let scrolls = 0;
  const corpus = (docs: Array<{ path: string; text: string }>, ignoreServerFilter = true) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { body?: string }) => {
        const u = String(url);
        if (u.includes('/api/embeddings') || u.includes('/v1/embeddings') || u.endsWith('/health')) throw new TypeError('fetch failed');
        if (u.includes('/points/search')) return { ok: true, json: async () => ({ result: [] }) };
        if (u.includes('/points/scroll')) {
          scrolls++;
          const body = JSON.parse(init!.body!);
          const groupes: Array<Array<{ key: string; match: { text: string } }>> = body.filter.must.map((m: any) => m.should);
          const pts = docs
            .map((d) => ({ sourceFile: `${V}${d.path}`, source_filename: d.path.split('\\').pop(), text: d.text }))
            .filter((p) => groupes.every((g) => g.some((c) => String((p as any)[c.key]).includes(c.match.text))))
            .filter((p) => ignoreServerFilter || !(body.filter.must_not ?? []).some((m: any) => p.sourceFile.includes(m.match.text)))
            .slice(0, 256);
          return { ok: true, json: async () => ({ result: { points: pts.map((payload) => ({ payload })) } }) };
        }
        throw new Error(`url inattendue ${u}`);
      }),
    );
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'rv0045c1-'));
    patternsFile = join(dir, 'zone-a-patterns.json');
    writeFileSync(patternsFile, JSON.stringify({ version: 't', ragQueryExcludeContains: ['from-vendor-chat', 'zone-alpha-sensitive'], ragAlwaysExcludeContains: ['zone-alpha-sensitive'] }));
    scrolls = 0;
    _resetOllamaKoCachePourTests();
    vi.stubEnv('OLLAMA_BASE_URL', '');
    vi.stubEnv('QDRANT_URL', '');
    vi.stubEnv('IRIS_JOURNAL_MOTEURS_DIR', '');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    _resetOllamaKoCachePourTests();
  });
  const bruit = (mot: string) => Array.from({ length: 300 }, (_, i) => ({ path: `conversations\\ws\\${mot}-${i}.md`, text: `${mot} ${i}` }));

  it('zone Zone A ordinaire (sans includeZoneA) : jamais sortie par le rattrapage, filtre serveur ignore', async () => {
    corpus([...bruit('Lyra'), { path: 'from-vendor-chat\\Lyra.md', text: 'Lyra Orion' }]);
    const r = await ragHybrid({ query: 'Lyra Orion', patternsFile });
    expect(r.hits.some((h) => h.sourceFile.includes('from-vendor-chat'))).toBe(false);
  });
  it('project et sourceContains : le rattrapage ne sort rien hors du perimetre demande', async () => {
    corpus([...bruit('Lyra'), { path: '02-Projets\\Autre\\Lyra.md', text: 'Lyra' }, { path: '02-Projets\\Cible\\note.md', text: 'Lyra ici' }]);
    const r = await ragHybrid({ query: 'Lyra', patternsFile, project: 'Cible' });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((h) => h.sourceFile.includes('Cible'))).toBe(true);
    const s = await ragHybrid({ query: 'Lyra', patternsFile, sourceContains: 'Cible' });
    expect(s.hits.every((h) => h.sourceFile.includes('Cible'))).toBe(true);
  });
  it('6 termes tres frequents : nombre de lectures Qdrant borne (6 + 4 au plus)', async () => {
    const mots = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
    corpus(mots.flatMap((m) => bruit(m)));
    const t0 = Date.now();
    await ragHybrid({ query: mots.join(' '), patternsFile });
    expect(scrolls).toBeLessThanOrEqual(mots.length + 4);
    expect(Date.now() - t0).toBeLessThan(3_000);
  });
});

describe('Journaux : sous test, jamais un vrai dossier, meme choisi par variable (trou restant du 0044)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env[JOURNAL_ENV];
  });
  it('journal des moteurs : dossier choisi hors du temporaire = refuse ; dans le temporaire = permis', () => {
    const vrai = join(homedir(), 'AppData', 'Local', 'iris-mcp');
    expect(dossierMoteurs({ IRIS_JOURNAL_MOTEURS_DIR: vrai })).toBeNull();
    const t = mkdtempSync(join(tmpdir(), 'rv0045j-'));
    expect(dossierMoteurs({ IRIS_JOURNAL_MOTEURS_DIR: t })).toBe(t);
  });
  it('journal RAG (texte des requetes) : meme regle', () => {
    process.env[JOURNAL_ENV] = join(homedir(), 'journal-rag-reel');
    expect(dossierRag()).toBeNull();
    const t = mkdtempSync(join(tmpdir(), 'rv0045r-'));
    process.env[JOURNAL_ENV] = t;
    expect(dossierRag()).toBe(t);
  });
  it('un chemin qui commence comme le temporaire mais en sort (tmp-evil, ..) : refuse', () => {
    expect(dossierPermisSousTest(tmpdir() + '-evil')).toBe(false);
    expect(dossierPermisSousTest(join(tmpdir(), '..', 'ailleurs'))).toBe(false);
  });
});