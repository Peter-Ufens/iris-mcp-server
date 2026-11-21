import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ragHybrid, groupesPerimetre } from '../src/tools/rag-hybrid-v1.js';
import { _resetOllamaKoCachePourTests } from '../src/utils/local-embeddings.js';

// Review Bob 21/11 du patch 0046 (Gaby) : le filtre texte de Qdrant respecte la casse, le filtre local d'Iris non.
// Mesure reelle (Ollama coupe) : project `Iris-MCP` = 2 resultats, `iris-mcp` = 0 ; sourceContains `Hermes-Agent` = 1,
// `hermes-agent` = 0. Donnees FICTIVES ci-dessous, faux Qdrant qui respecte la casse comme le vrai.

describe('groupesPerimetre : un critere en plusieurs morceaux, chacun en plusieurs casses', () => {
  it('`iris-mcp` donne deux groupes (iris, mcp) qui couvrent `Iris` et `MCP`', () => {
    const g = groupesPerimetre(['iris-mcp']);
    expect(g).toHaveLength(2);
    expect(g[0]!.should.map((c) => c.match.text)).toContain('Iris');
    expect(g[1]!.should.map((c) => c.match.text)).toContain('MCP');
    expect(g.every((x) => x.should.every((c) => c.key === 'sourceFile'))).toBe(true);
  });
  it('un critere sans separateur reste un seul groupe', () => {
    expect(groupesPerimetre(['HyperV'])).toHaveLength(1);
  });
  it('un critere fait seulement de separateurs ne casse rien', () => {
    expect(groupesPerimetre(['--'])).toHaveLength(1);
  });
});

describe('rag-hybrid sans Ollama : le perimetre marche quelle que soit la casse tapee', () => {
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
            // comme le vrai Qdrant sans index plein texte : sous-chaine EXACTE, casse comprise
            .filter((p) => groupes.every((g) => g.some((c) => String((p as any)[c.key]).includes(c.match.text))))
            .slice(0, 256);
          return { ok: true, json: async () => ({ result: { points: pts.map((payload) => ({ payload })) } }) };
        }
        throw new Error(`url inattendue ${u}`);
      }),
    );
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'rv0046casse-'));
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
  // 300 passages hors perimetre qui portent le mot : sans filtre serveur, ils remplissent la page de 256.
  const bruit = (mot: string) => Array.from({ length: 300 }, (_, i) => ({ path: `conversations\\ws\\${mot}-${i}.md`, text: `${mot} ${i}` }));
  const cible = [
    { path: '02-Projets\\Iris-MCP\\note.md', text: 'Lyra dans le projet' },
    { path: '02-Projets\\Iris-MCP\\suite.md', text: 'encore Lyra' },
  ];

  for (const project of ['Iris-MCP', 'iris-mcp', 'IRIS-mcp', 'iris-MCP']) {
    it(`project « ${project} » : trouve les notes du projet, rien dehors`, async () => {
      corpus([...bruit('Lyra'), ...cible]);
      const r = await ragHybrid({ query: 'Lyra', patternsFile, project });
      expect(r.hits.length).toBeGreaterThan(0);
      expect(r.hits.every((h) => h.sourceFile.includes('Iris-MCP'))).toBe(true);
    });
  }
  it('sourceContains « hermes-agent » trouve `Hermes-Agent`', async () => {
    corpus([...bruit('Lyra'), { path: 'conversations\\Hermes-Agent\\x.md', text: 'Lyra chez Hermes' }]);
    const r = await ragHybrid({ query: 'Lyra', patternsFile, sourceContains: 'hermes-agent' });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((h) => h.sourceFile.toLowerCase().includes('hermes-agent'))).toBe(true);
  });
  it('nom en « bosses » (`hyperv` pour `HyperV`) : le repli sans filtre serveur garde le comportement d avant, rien dehors', async () => {
    corpus([{ path: '02-Projets\\Virtualisation-HyperV\\n.md', text: 'Lyra rare' }, { path: 'conversations\\autre\\m.md', text: 'Lyra ailleurs' }]);
    const r = await ragHybrid({ query: 'Lyra', patternsFile, project: 'hyperv' });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((h) => h.sourceFile.toLowerCase().includes('hyperv'))).toBe(true);
  });
  it('terme absent du perimetre : 0 resultat, et une seule lecture de repli par lecture vide', async () => {
    corpus([...cible]);
    const r = await ragHybrid({ query: 'Zorglub', patternsFile, project: 'iris-mcp' });
    expect(r.hits).toHaveLength(0);
    // exact (1 + repli 1) + faute de frappe (1 + repli 1) : 4 au plus pour un terme
    expect(scrolls).toBeLessThanOrEqual(4);
  });
  it('sans perimetre : aucune lecture en plus (pas de repli)', async () => {
    corpus([...cible]);
    await ragHybrid({ query: 'Zorglub', patternsFile });
    expect(scrolls).toBeLessThanOrEqual(2);
  });
});
