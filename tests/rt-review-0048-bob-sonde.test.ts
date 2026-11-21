import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ragHybrid } from '../src/tools/rag-hybrid-v1.js';
import { _resetOllamaKoCachePourTests } from '../src/utils/local-embeddings.js';

// Review Bob 21/11 du patch 0048 (Gaby) : la sonde de perimetre (16 passages) decide UNE fois pour toutes les
// lectures. Question de Gaby : un cas ou la sonde est vide alors que le filtre serveur trouverait des passages utiles ?
// Oui : le projet est decoupe en morceaux (0047), donc la sonde ramene aussi des chemins qui portent les morceaux
// SEPARES (`Iris\MCP-...`), que le filtre local refuse (il veut `iris-mcp` en entier). Si les 16 premiers sont de ce
// genre, la sonde dit « vide », et un terme frequent hors projet remplit la page sans filtre : la note est perdue,
// alors que la lecture filtree l'avait trouvee. Donnees FICTIVES, faux Qdrant qui respecte la casse comme le vrai.

describe('rag-hybrid sans Ollama : sonde de perimetre trompee par des chemins aux morceaux separes', () => {
  const V = 'D:\\Vault\\Example\\';
  let patternsFile = '';
  let scrolls = 0;
  const corpus = (docs: Array<{ path: string; text: string }>) =>
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
            .slice(0, body.limit ?? 256);
          return { ok: true, json: async () => ({ result: { points: pts.map((payload) => ({ payload })) } }) };
        }
        throw new Error(`url inattendue ${u}`);
      }),
    );
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'rv0048sonde-'));
    patternsFile = join(dir, 'zone-a-patterns.json');
    writeFileSync(patternsFile, JSON.stringify({ version: 't', ragQueryExcludeContains: ['zone-alpha-sensitive'], ragAlwaysExcludeContains: ['zone-alpha-sensitive'] }));
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
  // 20 chemins qui portent `Iris` et `MCP` SEPARES (refuses par le filtre local), places en tete de l'index.
  const leurres = Array.from({ length: 20 }, (_, i) => ({ path: `notes\\Iris\\MCP-${i}.md`, text: `sujet ${i}` }));
  // 300 passages hors projet qui portent le mot cherche : sans filtre serveur, ils remplissent la page de 256.
  const bruit = Array.from({ length: 300 }, (_, i) => ({ path: `conversations\\ws\\Lyra-${i}.md`, text: `Lyra ${i}` }));
  const cible = { path: '02-Projets\\Iris-MCP\\note.md', text: 'Lyra dans le projet' };

  it('la note du projet reste trouvee (la lecture filtree l avait, la sonde ne doit pas la jeter)', async () => {
    corpus([...leurres, ...bruit, cible]);
    const r = await ragHybrid({ query: 'Lyra', patternsFile, project: 'iris-mcp' });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((h) => h.sourceFile.toLowerCase().includes('iris-mcp'))).toBe(true);
  });
  it('sonde trompee et terme absent : 0 resultat, et pas plus de lectures que le 0048', async () => {
    corpus([...leurres, cible]);
    const r = await ragHybrid({ query: 'Zorglub', patternsFile, project: 'iris-mcp' });
    expect(r.hits).toHaveLength(0);
    // sonde 1 + exact (1 filtree + 1 repli) + faute de frappe (1 filtree + 1 repli)
    expect(scrolls).toBeLessThanOrEqual(5);
  });
});
