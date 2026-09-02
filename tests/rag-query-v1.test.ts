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

const PATTERNS = {
  version: '2026-09-02b',
  ragQueryExcludeContains: ['from-microsoft-copilot', 'lana-amante', 'profil-peter\\journal', '03-Vie'],
  ragAlwaysExcludeContains: ['lana-amante', 'profil-peter\\journal', '03-Vie'],
};

const V = 'D:\\Obsidian\\Obsidian\\Peter-Vault-Local\\';

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
  });

  it('lit la source unique zone-a-patterns.json', () => {
    const p = loadZonePatterns(writePatterns(PATTERNS));
    expect(p.version).toBe('2026-09-02b');
    expect(p.queryExclude).toContain('from-microsoft-copilot');
    expect(p.alwaysExclude).toContain('lana-amante');
    expect(p.error).toBeUndefined();
  });

  it('supporte un BOM UTF-8 (fichier ecrit par PowerShell)', () => {
    const p = loadZonePatterns(writePatterns(PATTERNS, true));
    expect(p.version).toBe('2026-09-02b');
    expect(p.error).toBeUndefined();
  });

  it('config illisible => se ferme au lieu de s ouvrir', () => {
    const p = loadZonePatterns(join(tmpdir(), 'nexiste-pas-du-tout.json'));
    expect(p.error).toBeTruthy();
    expect(p.alwaysExclude).toContain('lana-amante');
    // le repli doit AUSSI fermer la query par defaut, pas seulement l intime
    expect(p.queryExclude).toContain('lana-amante');
  });

  it('fichier sans ragAlwaysExcludeContains => repli de secours sur l intime', () => {
    const p = loadZonePatterns(writePatterns({ version: 'vieux', ragQueryExcludeContains: ['03-Vie'] }));
    expect(p.alwaysExclude).toContain('lana-amante');
    expect(p.alwaysExclude).toContain('personnes.md');
  });

  it('isPathExcluded : contains, insensible casse et separateur', () => {
    expect(isPathExcluded(`${V}conversations/from-ollama-desktop/by-model/lana-amante/x.md`, ['lana-amante'])).toBe(true);
    expect(isPathExcluded(`${V}00-Meta\\profil-peter\\journal\\2026-08-03.md`, ['profil-peter/journal'])).toBe(true);
    expect(isPathExcluded(`${V}02-Projets\\Virtualisation-HyperV.md`, ['lana-amante', '03-Vie'])).toBe(false);
    expect(isPathExcluded('', ['x'])).toBe(true);
  });

  it('resolveExcludes : includeZoneA bascule sur la liste intime, pas sur une liste vide', () => {
    const p = loadZonePatterns(writePatterns(PATTERNS));
    expect(resolveExcludes(p, false)).toContain('from-microsoft-copilot');
    const opened = resolveExcludes(p, true);
    expect(opened).not.toContain('from-microsoft-copilot');
    expect(opened).toContain('lana-amante');
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
      `${V}conversations\\from-microsoft-copilot\\Test_de_Fonctionnement.md`,
      `${V}02-Projets\\Virtualisation-HyperV.md`,
    ]);
    const r = await ragQuery({ query: 'hyper-v', patternsFile: writePatterns(PATTERNS) });
    expect(r.meta.filterZoneA).toBe(true);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.sourceFile).toContain('Virtualisation-HyperV.md');
  });

  it('includeZoneA ouvre Copilot', async () => {
    stubFetch([
      `${V}conversations\\from-microsoft-copilot\\Test_de_Fonctionnement.md`,
      `${V}02-Projets\\Virtualisation-HyperV.md`,
    ]);
    const r = await ragQuery({ query: 'hyper-v', includeZoneA: true, patternsFile: writePatterns(PATTERNS) });
    expect(r.meta.filterZoneA).toBe(false);
    expect(r.hits.map((h) => h.sourceFile).join('|')).toContain('from-microsoft-copilot');
  });

  it('GARDE-FOU : includeZoneA n ouvre JAMAIS la zone intime', async () => {
    stubFetch([
      `${V}conversations\\from-ollama-desktop\\by-model\\lana-amante\\intime.md`,
      `${V}00-Meta\\profil-peter\\journal\\2026-08-03.md`,
      `${V}03-Vie\\sante.md`,
      `${V}conversations\\from-microsoft-copilot\\Test_de_Fonctionnement.md`,
    ]);
    const r = await ragQuery({ query: 'peu importe', includeZoneA: true, patternsFile: writePatterns(PATTERNS) });
    const joined = r.hits.map((h) => h.sourceFile).join('|');
    expect(joined).not.toContain('lana-amante');
    expect(joined).not.toContain('journal');
    expect(joined).not.toContain('03-Vie');
    expect(joined).toContain('from-microsoft-copilot');
    expect(r.meta.intimeAlwaysFiltered).toBe(true);
  });

  it('GARDE-FOU : intime filtre meme si Qdrant ignore le filtre serveur', async () => {
    // Qdrant renvoie de l intime malgre le must_not => le filet post-requete doit tenir.
    stubFetch([`${V}conversations\\from-ollama-desktop\\by-model\\lana-amante\\fuite.md`]);
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
    stubFetch([`${V}02-Projets\\Virtualisation-HyperV.md`, `${V}02-Projets\\Gaming.md`]);
    const r = await ragQuery({
      query: 'x',
      project: 'Virtualisation-HyperV',
      patternsFile: writePatterns(PATTERNS),
    });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.sourceFile).toContain('Virtualisation-HyperV');
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
