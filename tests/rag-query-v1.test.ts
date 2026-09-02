import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ragQuery,
  loadZonePatterns,
  isPathExcluded,
  resolveExcludes,
} from '../src/tools/rag-query-v1.js';

/** Ecrit un zone-a-patterns.json temporaire et retourne son chemin. */
function writePatterns(obj: unknown, withBom = false): string {
  const dir = mkdtempSync(join(tmpdir(), 'zonea-'));
  const file = join(dir, 'zone-a-patterns.json');
  writeFileSync(file, (withBom ? '\uFEFF' : '') + JSON.stringify(obj), 'utf8');
  return file;
}

/** Fixtures fictives (aucun nom de zone reelle du vault). */
const PATTERNS = {
  version: 'test-2026-09-02',
  ragQueryExcludeContains: [
    'from-vendor-copilot',
    'zone-alpha-sensitive',
    'user-profile\\journal',
    'private-life-zone',
  ],
  ragAlwaysExcludeContains: ['zone-alpha-sensitive', 'user-profile\\journal', 'private-life-zone'],
};

const V = 'D:\\Vault\\Example\\';

function qdrantPayload(paths: string[]) {
  return {
    result: paths.map((p, i) => ({
      score: 0.9 - i * 0.01,
      payload: { sourceFile: p, source_filename: p.split('\\').pop(), text: 'extrait ' + i },
    })),
  };
}

/** Mock fetch : 1er appel = embeddings Ollama, 2e = recherche Qdrant. */
function stubFetch(paths: string[], capture?: { body?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).includes('/api/embeddings')) {
        return { ok: true, json: async () => ({ embedding: [0.1, 0.2, 0.3] }) };
      }
      if (capture && init?.body) capture.body = JSON.parse(init.body);
      return { ok: true, json: async () => qdrantPayload(paths) };
    }),
  );
}

describe('rag-query-v1 / zone patterns', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.ZONE_A_PATTERNS_FILE;
  });

  it('lit la source unique zone-a-patterns.json', () => {
    const p = loadZonePatterns(writePatterns(PATTERNS));
    expect(p.version).toBe('test-2026-09-02');
    expect(p.queryExclude).toContain('from-vendor-copilot');
    expect(p.alwaysExclude).toContain('zone-alpha-sensitive');
    expect(p.error).toBeUndefined();
  });

  it('supporte un BOM UTF-8 (fichier ecrit par PowerShell)', () => {
    const p = loadZonePatterns(writePatterns(PATTERNS, true));
    expect(p.version).toBe('test-2026-09-02');
    expect(p.error).toBeUndefined();
  });

  it('config illisible => fail-closed generique', () => {
    const p = loadZonePatterns(join(tmpdir(), 'nexiste-pas-du-tout.json'));
    expect(p.error).toBeTruthy();
    expect(p.alwaysExclude).toContain('conversations/');
    expect(p.queryExclude).toContain('_prive');
    expect(p.alwaysExclude).not.toContain('zone-alpha-sensitive');
  });

  it('sans ZONE_A_PATTERNS_FILE => fail-closed generique', () => {
    const p = loadZonePatterns();
    expect(p.version).toBe('env-missing');
    expect(p.alwaysExclude).toContain('conversations\\');
    expect(p.error).toContain('ZONE_A_PATTERNS_FILE');
  });

  it('fichier sans ragAlwaysExcludeContains => repli fail-closed', () => {
    const p = loadZonePatterns(
      writePatterns({ version: 'vieux', ragQueryExcludeContains: ['private-life-zone'] }),
    );
    expect(p.alwaysExclude).toContain('conversations/');
    expect(p.alwaysExclude).not.toContain('zone-alpha-sensitive');
  });

  it('isPathExcluded : contains, insensible casse et separateur', () => {
    expect(
      isPathExcluded(`${V}conversations/from-vendor/by-model/zone-alpha-sensitive/x.md`, [
        'zone-alpha-sensitive',
      ]),
    ).toBe(true);
    expect(
      isPathExcluded(`${V}00-Meta\\user-profile\\journal\\2026-08-03.md`, ['user-profile/journal']),
    ).toBe(true);
    expect(
      isPathExcluded(`${V}02-Projets\\Example.md`, ['zone-alpha-sensitive', 'private-life-zone']),
    ).toBe(false);
    expect(isPathExcluded('', ['x'])).toBe(true);
  });

  it('resolveExcludes : includeZoneA bascule sur la liste sensible, pas sur une liste vide', () => {
    const p = loadZonePatterns(writePatterns(PATTERNS));
    expect(resolveExcludes(p, false)).toContain('from-vendor-copilot');
    const opened = resolveExcludes(p, true);
    expect(opened).not.toContain('from-vendor-copilot');
    expect(opened).toContain('zone-alpha-sensitive');
    expect(opened.length).toBeGreaterThan(0);
  });
});

describe('rag-query-v1 / requete', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('filtre les conversations brutes par defaut', async () => {
    stubFetch([
      `${V}conversations\\from-vendor-copilot\\Test.md`,
      `${V}02-Projets\\Example-HyperV.md`,
    ]);
    const r = await ragQuery({ query: 'hyper-v', patternsFile: writePatterns(PATTERNS) });
    expect(r.meta.filterZoneA).toBe(true);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.sourceFile).toContain('Example-HyperV.md');
  });

  it('includeZoneA ouvre Copilot', async () => {
    stubFetch([
      `${V}conversations\\from-vendor-copilot\\Test.md`,
      `${V}02-Projets\\Example-HyperV.md`,
    ]);
    const r = await ragQuery({ query: 'hyper-v', includeZoneA: true, patternsFile: writePatterns(PATTERNS) });
    expect(r.meta.filterZoneA).toBe(false);
    expect(r.hits.map((h) => h.sourceFile).join('|')).toContain('from-vendor-copilot');
  });

  it('GARDE-FOU : includeZoneA n ouvre JAMAIS la zone sensible', async () => {
    stubFetch([
      `${V}conversations\\from-vendor\\zone-alpha-sensitive\\secret.md`,
      `${V}00-Meta\\user-profile\\journal\\2026-08-03.md`,
      `${V}private-life-zone\\note.md`,
      `${V}conversations\\from-vendor-copilot\\Test.md`,
    ]);
    const r = await ragQuery({ query: 'peu importe', includeZoneA: true, patternsFile: writePatterns(PATTERNS) });
    const joined = r.hits.map((h) => h.sourceFile).join('|');
    expect(joined).not.toContain('zone-alpha-sensitive');
    expect(joined).not.toContain('journal');
    expect(joined).not.toContain('private-life-zone');
    expect(joined).toContain('from-vendor-copilot');
    expect(r.meta.intimeAlwaysFiltered).toBe(true);
  });

  it('GARDE-FOU : zone sensible filtree meme si Qdrant ignore le filtre serveur', async () => {
    stubFetch([`${V}conversations\\from-vendor\\zone-alpha-sensitive\\fuite.md`]);
    const r = await ragQuery({ query: 'x', includeZoneA: true, patternsFile: writePatterns(PATTERNS) });
    expect(r.hits).toHaveLength(0);
  });

  it('envoie un filtre must_not a Qdrant et sur-echantillonne', async () => {
    const cap: { body?: unknown } = {};
    stubFetch([`${V}02-Projets\\A.md`], cap);
    await ragQuery({ query: 'x', limit: 5, patternsFile: writePatterns(PATTERNS) });
    const body = cap.body as { filter?: { must_not?: unknown[] }; limit?: number };
    expect(body.filter?.must_not).toHaveLength(PATTERNS.ragQueryExcludeContains.length);
    expect(body.limit).toBe(20);
  });

  it('project et sourceContains filtrent les chemins', async () => {
    stubFetch([`${V}02-Projets\\Example-HyperV.md`, `${V}02-Projets\\Gaming.md`]);
    const r = await ragQuery({
      query: 'x',
      project: 'Example-HyperV',
      patternsFile: writePatterns(PATTERNS),
    });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.sourceFile).toContain('Example-HyperV');
  });

  it('respecte limit', async () => {
    stubFetch(Array.from({ length: 10 }, (_, i) => `${V}02-Projets\\P${i}.md`));
    const r = await ragQuery({ query: 'x', limit: 3, patternsFile: writePatterns(PATTERNS) });
    expect(r.hits).toHaveLength(3);
    expect(r.meta.count).toBe(3);
  });

  it('Ollama eteint => erreur propre, pas de crash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const r = await ragQuery({ query: 'x', patternsFile: writePatterns(PATTERNS) });
    expect(r.hits).toEqual([]);
    expect(r.meta.error).toContain('Ollama');
  });

  it('Qdrant eteint => erreur propre, pas de crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/embeddings')) {
          return { ok: true, json: async () => ({ embedding: [0.1] }) };
        }
        throw new Error('ECONNREFUSED 6334');
      }),
    );
    const r = await ragQuery({ query: 'x', patternsFile: writePatterns(PATTERNS) });
    expect(r.hits).toEqual([]);
    expect(r.meta.error).toContain('Qdrant');
  });

  it('query vide => erreur propre', async () => {
    const r = await ragQuery({ query: '   ', patternsFile: writePatterns(PATTERNS) });
    expect(r.hits).toEqual([]);
    expect(r.meta.error).toContain('vide');
  });
});
