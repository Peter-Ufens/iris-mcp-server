import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ragQuery, tool as ragQueryTool } from '../src/tools/rag-query-v1.js';
import { estPanneRag } from '../src/utils/rag-http.js';
import { fetchJson, messageReseau } from '../src/utils/http-fetch.js';
import { estConnexionRefusee } from '../src/utils/searxng-reveil.js';
import { _resetOllamaKoCachePourTests } from '../src/utils/local-embeddings.js';

// Bob 20/11 : scenarios de panne du lot O rejoues sur le vrai vault (banc a part).
// C2 : un moteur d'embeddings de mauvaise taille faisait dire « Qdrant injoignable » alors que Qdrant allait bien.
// C3 : un outil RAG sans aucun moteur repondait « 0 resultat » sans drapeau d'erreur MCP.
// Donnees FICTIVES, faux Ollama et faux Qdrant (fetch remplace), aucune vraie base.

const PATTERNS = { version: 'test-pannes-c2-c3', ragQueryExcludeContains: ['zone-alpha-sensitive'], ragAlwaysExcludeContains: ['zone-alpha-sensitive'] };
let patternsFile: string;

type Reponse = { ok: boolean; status?: number; statusText?: string; json?: () => Promise<unknown>; body?: null };
function stub(opts: { dimOllama?: number; ollamaDown?: boolean; search: 'ok' | 400 | 'refus'; dimCollection?: number; capture?: string[] }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }): Promise<Reponse> => {
      const u = String(url);
      opts.capture?.push(`${init?.method ?? 'GET'} ${u.replace(/^https?:\/\/[^/]+/, '')}`);
      if (u.endsWith('/api/embeddings') || u.endsWith('/v1/embeddings')) {
        if (opts.ollamaDown) throw new TypeError('fetch failed');
        const v = Array.from({ length: opts.dimOllama ?? 768 }, (_, i) => (i + 1) / 1000);
        return { ok: true, json: async () => (u.endsWith('/v1/embeddings') ? { data: [{ embedding: v }] } : { embedding: v }) };
      }
      if (u.endsWith('/health')) throw new TypeError('fetch failed'); // pas de secours Hermes
      if (u.includes('/points/search')) {
        if (opts.search === 'refus') throw new TypeError('fetch failed');
        if (opts.search === 400) return { ok: false, status: 400, statusText: 'Bad Request', body: null };
        return { ok: true, json: async () => ({ result: [{ score: 0.9, payload: { sourceFile: 'D:\\Vault\\Ex\\02-Projets\\A.md', source_filename: 'A.md', text: 'texte fictif' } }] }) };
      }
      if (/\/collections\/[^/]+$/.test(u)) {
        return { ok: true, json: async () => ({ result: { config: { params: { vectors: { size: opts.dimCollection ?? 768, distance: 'Cosine' } } } } }) };
      }
      throw new Error(`url inattendue ${u}`);
    }),
  );
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'pannes-c2c3-'));
  patternsFile = join(dir, 'zone-a-patterns.json');
  writeFileSync(patternsFile, JSON.stringify(PATTERNS), 'utf8');
  _resetOllamaKoCachePourTests();
  vi.stubEnv('IRIS_RAG_JOURNAL_DIR', '');
  vi.stubEnv('IRIS_JOURNAL_MOTEURS_DIR', '');
  vi.stubEnv('OLLAMA_BASE_URL', '');
  vi.stubEnv('QDRANT_URL', '');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  _resetOllamaKoCachePourTests();
});

describe('C2 : la vraie cause quand Qdrant refuse (CP8)', () => {
  it('moteur de 384 nombres contre un index de 768 : message de taille, pas « injoignable », aucun resultat', async () => {
    stub({ dimOllama: 384, search: 400, dimCollection: 768 });
    const r = await ragQuery({ query: 'question fictive', patternsFile });
    expect(r.hits).toHaveLength(0);
    expect(String(r.meta.error)).toMatch(/384 nombres.*768/);
    expect(String(r.meta.error)).not.toMatch(/injoignable/);
  });

  it('Qdrant vraiment absent (connexion refusee) : « Qdrant injoignable »', async () => {
    stub({ search: 'refus' });
    const r = await ragQuery({ query: 'question fictive', patternsFile });
    expect(String(r.meta.error)).toMatch(/Qdrant injoignable/);
  });

  it('400 avec la bonne taille : « Qdrant a refuse la recherche », sans inventer une cause', async () => {
    stub({ dimOllama: 768, search: 400, dimCollection: 768 });
    const r = await ragQuery({ query: 'question fictive', patternsFile });
    expect(String(r.meta.error)).toMatch(/Qdrant a refuse la recherche \(HTTP 400/);
    expect(String(r.meta.error)).not.toMatch(/nombres/);
  });

  it("le message ne contient ni l'adresse de Qdrant ni d'Ollama", async () => {
    stub({ dimOllama: 384, search: 400, dimCollection: 768 });
    const r = await ragQuery({ query: 'question fictive', patternsFile });
    expect(String(r.meta.error)).not.toMatch(/127\.0\.0\.1|localhost|6334|11434|http:/);
  });
});

describe('C3 : drapeau d erreur MCP quand le RAG ne peut pas chercher', () => {
  it('Ollama absent : rag-query repond avec isError', async () => {
    vi.stubEnv('ZONE_A_PATTERNS_FILE', patternsFile);
    stub({ ollamaDown: true, search: 'ok' });
    const out = await ragQueryTool.execute({ query: 'question fictive' });
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toMatch(/Ollama injoignable/);
  });

  it('recherche qui marche : pas de drapeau d erreur', async () => {
    vi.stubEnv('ZONE_A_PATTERNS_FILE', patternsFile);
    stub({ search: 'ok' });
    const out = await ragQueryTool.execute({ query: 'question fictive' });
    expect(out.isError).toBeUndefined();
  });

  it('estPanneRag : 0 resultat + seule la note F5 = pas une panne ; resultats + erreur = pas une panne', () => {
    expect(estPanneRag({ hits: [], meta: { error: 'includeReserved ignore : IRIS_ALLOW_RESERVED=1 requis (F5).' } })).toBe(false);
    expect(estPanneRag({ hits: [{}], meta: { error: 'Ollama injoignable ou modele absent (x)' } })).toBe(false);
    expect(estPanneRag({ hits: [], meta: { error: 'includeReserved ignore : IRIS_ALLOW_RESERVED=1 requis (F5). · Qdrant injoignable (fetch failed)' } })).toBe(true);
    expect(estPanneRag({ hits: [], meta: {} })).toBe(false);
  });
});

describe('C4 : messages reseau compréhensibles (CP4, CP5)', () => {
  const panne = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });

  it('traduit les causes courantes en phrases simples, sans URL', () => {
    expect(messageReseau(panne('ENOTFOUND'))).toMatch(/pas d'acces Internet/);
    expect(messageReseau(panne('ECONNREFUSED'))).toMatch(/service eteint/);
    expect(messageReseau(panne('ECONNRESET'))).toMatch(/connexion coupee/);
    expect(messageReseau(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toMatch(/delai depasse/);
    expect(messageReseau(new Error('autre chose'))).toBe('autre chose');
  });

  it('fetchJson : message clair ET cause gardee (le reveil de SearXNG la lit toujours)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw panne('ECONNREFUSED'); }));
    let err: unknown;
    try {
      await fetchJson('http://127.0.0.1:59998/x');
    } catch (e) {
      err = e;
    }
    expect(String((err as Error).message)).toMatch(/service eteint/);
    expect(String((err as Error).message)).not.toMatch(/127\.0\.0\.1|59998/);
    expect(estConnexionRefusee(err)).toBe(true);
  });

  it('Internet coupe : ENOTFOUND devient « pas d acces Internet »', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw panne('ENOTFOUND'); }));
    await expect(fetchJson('https://exemple.invalid/')).rejects.toThrow(/pas d'acces Internet/);
  });
});
