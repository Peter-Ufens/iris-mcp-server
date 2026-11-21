import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ragHybrid } from '../src/tools/rag-hybrid-v1.js';
import { causeErreurQdrant } from '../src/utils/rag-http.js';
import { _resetOllamaKoCachePourTests } from '../src/utils/local-embeddings.js';

// Review Gaby 21/11 du patch 0047 (Bob, casse du perimetre) et du nit de Bob (messages Qdrant bruts au test Docker reel).
// Donnees FICTIVES, faux Qdrant qui respecte la casse comme le vrai.

const V = 'D:\\Vault\\Example\\';
let patternsFile = '';
let scrolls = 0;
let qdrantMort = false;
const corpus = (docs: Array<{ path: string; text: string }>) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes('/api/embeddings') || u.includes('/v1/embeddings') || u.endsWith('/health')) throw new TypeError('fetch failed');
      if (qdrantMort) throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
      if (u.includes('/points/search')) return { ok: true, json: async () => ({ result: [] }) };
      if (u.includes('/points/scroll')) {
        scrolls++;
        const body = JSON.parse(init!.body!);
        const groupes: Array<Array<{ key: string; match: { text: string } }>> = body.filter.must.map((m: any) => m.should);
        const pts = docs
          .map((d) => ({ sourceFile: `${V}${d.path}`, source_filename: d.path.split('\\').pop(), text: d.text }))
          .filter((p) => groupes.every((g) => g.some((c) => String((p as any)[c.key]).includes(c.match.text))))
          .slice(0, body.limit ?? 256);
        return { ok: true, json: async () => ({ result: { points: pts.map((payload) => ({ payload })) } }) };
      }
      throw new Error(`url inattendue ${u}`);
    }),
  );
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'rv0047-'));
  patternsFile = join(dir, 'zone-a-patterns.json');
  writeFileSync(patternsFile, JSON.stringify({ version: 't', ragQueryExcludeContains: ['zone-alpha-sensitive'], ragAlwaysExcludeContains: ['zone-alpha-sensitive'] }));
  scrolls = 0;
  qdrantMort = false;
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
const cible = [
  { path: '02-Projets\\Iris-MCP\\note.md', text: 'Lyra dans le projet' },
  { path: '02-Projets\\Virtualisation-HyperV\\n.md', text: 'Lyra rare' },
];

describe('0047 : le repli sans filtre serveur est decide une seule fois (sonde en parallele)', () => {
  it('6 mots absents du projet : 1 sonde + 6 + 6 lectures au plus (avant : 24)', async () => {
    corpus(cible);
    const r = await ragHybrid({ query: 'Zorglub Quixote Wumpus Blorb Frobnitz Xyzzy', patternsFile, project: 'iris-mcp' });
    expect(r.hits).toHaveLength(0);
    expect(scrolls).toBeLessThanOrEqual(13);
  });
  it('projet inconnu : pas pire que 0047 (1 sonde + 2 x 12 lectures au plus), 0 resultat, rien dehors', async () => {
    corpus(cible);
    const r = await ragHybrid({ query: 'Zorglub Quixote Wumpus Blorb Frobnitz Xyzzy', patternsFile, project: 'projet-inexistant-zz' });
    expect(r.hits).toHaveLength(0);
    expect(scrolls).toBeLessThanOrEqual(25);
  });
  it('casse en « bosses » (hyperv) : la sonde echoue, lecture sans filtre serveur, le perimetre local tient', async () => {
    corpus([...cible, { path: 'conversations\\x.md', text: 'Lyra ailleurs' }]);
    const r = await ragHybrid({ query: 'Lyra', patternsFile, project: 'hyperv' });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((h) => h.sourceFile.toLowerCase().includes('hyperv'))).toBe(true);
  });
  it('sans perimetre : pas de sonde', async () => {
    corpus(cible);
    await ragHybrid({ query: 'Zorglub', patternsFile });
    expect(scrolls).toBeLessThanOrEqual(2);
  });
});

describe('Nit Bob (test Docker reel) : messages Qdrant traduits', () => {
  it('Qdrant eteint : « service eteint ou connexion refusee (ECONNREFUSED) », plus « fetch failed » seul', async () => {
    const e = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const m = await causeErreurQdrant(e, 'http://127.0.0.1:1', 'c');
    expect(m).toMatch(/Qdrant injoignable/);
    expect(m).toMatch(/ECONNREFUSED/);
    expect(m).not.toMatch(/\(fetch failed\)/);
  });
  it('rag-hybrid, Qdrant eteint : le canal lexical dit aussi la vraie cause', async () => {
    corpus([]);
    qdrantMort = true;
    const r = await ragHybrid({ query: 'Lyra', patternsFile });
    expect(String(r.meta.error)).toMatch(/canal lexical indisponible \(service eteint/);
  });
});