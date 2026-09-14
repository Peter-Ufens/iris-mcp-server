import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ragQuery, loadZonePatterns, resolveExcludes, tool as toolV1 } from '../src/tools/rag-query-v1.js';
import { ragSearch, tool as toolV2 } from '../src/tools/rag-search-v2.js';
import { ragHybrid, tool as toolHy } from '../src/tools/rag-hybrid-v1.js';

/**
 * Zone contentieux (v0.9.0). Donnees FICTIVES : aucun nom de zone, de dossier ou de chemin reel.
 *
 * | appel              | A-1 brut | contentieux | A-2 intime |
 * | defaut             | ferme    | ferme       | ferme      |
 * | includeZoneA       | ouvert   | ferme       | ferme      |
 * | includeContentieux | ferme    | ouvert      | ferme      |
 * | les deux           | ouvert   | ouvert      | ferme      |
 */
const PATTERNS = {
  version: 'test-contentieux',
  ragQueryExcludeContains: ['from-vendor-copilot', 'zone-alpha-sensitive'],
  // « secret-only-always » n'est volontairement PAS recopie dans la liste A-1 : il doit rester ferme partout
  ragAlwaysExcludeContains: ['zone-alpha-sensitive', 'secret-only-always'],
  ragContentieuxContains: ['dossier-contentieux-fictif', 'uuid-fictif-0001'],
};

const V = 'X:\\Coffre\\';
const DOCS: Record<string, string> = {
  B: `${V}02-Projets\\Tondeuse.md`,
  A1: `${V}conversations\\from-vendor-copilot\\c1.md`,
  A2: `${V}zone-alpha-sensitive\\s.md`,
  A2seul: `${V}02-Projets\\secret-only-always\\x.md`,
  C: `${V}04-Idees\\atoms\\dossier-contentieux-fictif\\a1.md`,
  Cuuid: `${V}conversations\\ws\\uuid-fictif-0001\\t.md`,
  CetA1: `${V}conversations\\from-vendor-copilot\\dossier-contentieux-fictif\\c2.md`,
  CetA2: `${V}zone-alpha-sensitive\\dossier-contentieux-fictif\\s2.md`,
};
const ATTENDU: Record<string, string[]> = {
  defaut: ['B'],
  includeZoneA: ['A1', 'B'],
  includeContentieux: ['B', 'C', 'Cuuid'],
  lesDeux: ['A1', 'B', 'C', 'CetA1', 'Cuuid'],
};
const CAS: Array<[string, { includeZoneA?: boolean; includeContentieux?: boolean }]> = [
  ['defaut', {}],
  ['includeZoneA', { includeZoneA: true }],
  ['includeContentieux', { includeContentieux: true }],
  ['lesDeux', { includeZoneA: true, includeContentieux: true }],
];

function ecrirePatterns(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'zonec-'));
  const f = join(dir, 'zone-a-patterns.json');
  writeFileSync(f, JSON.stringify(obj), 'utf8');
  return f;
}

const libelle = (path: string) => Object.entries(DOCS).find(([, p]) => p === path)?.[0] ?? path;
const visibles = (hits: Array<{ sourceFile: string }>) => [...new Set(hits.map((h) => libelle(h.sourceFile)))].sort();

/** Faux Ollama + Qdrant qui IGNORE le filtre serveur : seul le refiltrage cote Iris protege. */
function stub(capture: { mustNot: string[][] } = { mustNot: [] }) {
  const points = Object.values(DOCS).map((p, i) => ({ score: 0.9 - i * 0.01, payload: { sourceFile: p, source_filename: p.split('\\').pop(), text: `zorblat extrait ${i}` } }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(init.body) : {};
      if (u.endsWith('/api/embed')) return { ok: true, json: async () => ({ embeddings: body.input.map(() => [0.1, 0.2]) }) };
      if (u.endsWith('/api/embeddings')) return { ok: true, json: async () => ({ embedding: [0.1, 0.2] }) };
      if (u.endsWith('/api/generate')) return { ok: true, json: async () => ({ response: '{"requetes":[]}' }) };
      if (u.includes('/points/search') || u.includes('/points/scroll')) {
        capture.mustNot.push((body.filter?.must_not ?? []).map((m: { match: { text: string } }) => m.match.text));
        if (u.includes('/points/scroll')) return { ok: true, json: async () => ({ result: { points: points.map((p) => ({ payload: p.payload })) } }) };
        return { ok: true, json: async () => ({ result: points }) };
      }
      throw new Error(`url inattendue ${u}`);
    }),
  );
  return capture;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('zone contentieux / fichier de zones', () => {
  it('lit ragContentieuxContains ; cle absente = aucun motif ; fichier illisible = aucun motif (rien a ouvrir)', () => {
    expect(loadZonePatterns(ecrirePatterns(PATTERNS)).contentieux).toEqual(['dossier-contentieux-fictif', 'uuid-fictif-0001']);
    const { ragContentieuxContains: _c, ...sans } = PATTERNS;
    expect(loadZonePatterns(ecrirePatterns(sans)).contentieux).toEqual([]);
    const illisible = loadZonePatterns(join(tmpdir(), 'nexiste-pas-contentieux.json'));
    expect(illisible.contentieux).toEqual([]);
    expect(resolveExcludes(illisible, false, true)).toContain('conversations\\'); // repli fail-closed conserve
  });

  it('resolveExcludes : les 4 lignes du tableau', () => {
    const p = loadZonePatterns(ecrirePatterns(PATTERNS));
    const def = resolveExcludes(p, false);
    expect(def).toEqual(expect.arrayContaining(['from-vendor-copilot', 'zone-alpha-sensitive', 'secret-only-always', 'dossier-contentieux-fictif', 'uuid-fictif-0001']));
    const za = resolveExcludes(p, true);
    expect(za).not.toContain('from-vendor-copilot');
    expect(za).toEqual(expect.arrayContaining(['zone-alpha-sensitive', 'secret-only-always', 'dossier-contentieux-fictif']));
    const ct = resolveExcludes(p, false, true);
    expect(ct).not.toContain('dossier-contentieux-fictif');
    expect(ct).toEqual(expect.arrayContaining(['from-vendor-copilot', 'zone-alpha-sensitive', 'secret-only-always']));
    const deux = resolveExcludes(p, true, true);
    expect(deux.sort()).toEqual(['secret-only-always', 'zone-alpha-sensitive']);
    expect(new Set(def).size).toBe(def.length); // sans doublon
  });
});

describe('zone contentieux / les trois outils RAG (Qdrant qui ignore le filtre serveur)', () => {
  it('rag-query-v1 : visibilite par cas, filtre serveur et meta', async () => {
    const patternsFile = ecrirePatterns(PATTERNS);
    for (const [nom, opts] of CAS) {
      const cap = stub();
      const r = await ragQuery({ query: 'zorblat', limit: 25, patternsFile, ...opts });
      expect(visibles(r.hits), nom).toEqual(ATTENDU[nom]);
      expect(r.meta.filterContentieux).toBe(opts.includeContentieux !== true);
      expect(r.meta.filterZoneA).toBe(opts.includeZoneA !== true);
      const envoye = cap.mustNot[0]!;
      expect(envoye.includes('dossier-contentieux-fictif')).toBe(opts.includeContentieux !== true);
      expect(envoye).toContain('zone-alpha-sensitive');
    }
  });

  it('rag-search-v2 : visibilite par cas et meta', async () => {
    const patternsFile = ecrirePatterns(PATTERNS);
    for (const [nom, opts] of CAS) {
      stub();
      const r = await ragSearch({ query: 'zorblat', limit: 25, patternsFile, reformulate: false, ...opts });
      expect(visibles(r.hits), nom).toEqual(ATTENDU[nom]);
      expect(r.meta.filterContentieux).toBe(opts.includeContentieux !== true);
    }
  });

  it('rag-hybrid-v1 : visibilite par cas (canal vectoriel ET canal lexical) et meta', async () => {
    const patternsFile = ecrirePatterns(PATTERNS);
    for (const [nom, opts] of CAS) {
      const cap = stub();
      const r = await ragHybrid({ query: 'zorblat', limit: 25, patternsFile, ...opts });
      expect(visibles(r.hits), nom).toEqual(ATTENDU[nom]);
      expect(r.meta.filterContentieux).toBe(opts.includeContentieux !== true);
      // le scroll lexical recoit le meme perimetre que la recherche vectorielle
      expect(cap.mustNot.every((m) => m.includes('dossier-contentieux-fictif') === (opts.includeContentieux !== true))).toBe(true);
    }
  });

  it('A-2 jamais ouverte, meme contentieux + includeZoneA, meme si le chemin est aussi contentieux', async () => {
    const patternsFile = ecrirePatterns(PATTERNS);
    stub();
    const r = await ragQuery({ query: 'zorblat', limit: 25, patternsFile, includeZoneA: true, includeContentieux: true });
    const v = visibles(r.hits);
    for (const interdit of ['A2', 'A2seul', 'CetA2']) expect(v).not.toContain(interdit);
  });

  it('les trois outils MCP exposent includeContentieux et le transmettent', async () => {
    for (const t of [toolV1, toolV2, toolHy]) expect(Object.keys(t.inputSchema)).toContain('includeContentieux');
    process.env.ZONE_A_PATTERNS_FILE = ecrirePatterns(PATTERNS);
    try {
      for (const t of [toolV1, toolV2, toolHy]) {
        stub();
        const out = JSON.parse((await t.execute({ query: 'zorblat', limit: 25, includeContentieux: true, reformulate: false })).content[0]!.text);
        expect(out.meta.filterContentieux, t.id).toBe(false);
        expect(visibles(out.hits), t.id).toEqual(ATTENDU.includeContentieux);
      }
    } finally {
      delete process.env.ZONE_A_PATTERNS_FILE;
    }
  });
});
