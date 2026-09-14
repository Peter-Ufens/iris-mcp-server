import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ragQuery } from '../src/tools/rag-query-v1.js';
import {
  ragHybrid,
  extractTokens,
  caseVariants,
  transpositionVariants,
  tool,
} from '../src/tools/rag-hybrid-v1.js';

/** Donnees FICTIVES : aucun chemin ni vocabulaire reel dans ce depot public. */
const PATTERNS = {
  version: 'test-zones-hybride',
  ragQueryExcludeContains: ['from-vendor-chat', 'zone-alpha-sensitive'],
  ragAlwaysExcludeContains: ['zone-alpha-sensitive'],
  ragSourcePriority: { '\\02-Projets\\': 1.05, '\\conversations\\': 0.98 },
};
const V = 'D:\\Vault\\Example\\';

interface Doc {
  path: string;
  text: string;
  score?: number;
}

/**
 * Faux Qdrant : `vector` = liste ordonnee renvoyee par la recherche vectorielle ;
 * `corpus` = passages ou le filtre texte cherche (sous-chaine sensible a la casse, comme Qdrant),
 * en ignorant volontairement le filtre de zone serveur quand `ignoreServerFilter` est vrai.
 */
function stub(opts: { vector: Doc[]; corpus: Doc[]; ignoreServerFilter?: boolean; capture?: any[] }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(init.body) : {};
      if (u.endsWith('/api/embeddings')) return { ok: true, json: async () => ({ embedding: [0.1, 0.2] }) };
      if (u.includes('/points/search')) {
        return {
          ok: true,
          json: async () => ({
            result: opts.vector.map((d, i) => ({
              score: d.score ?? 0.9 - i * 0.01,
              payload: { sourceFile: `${V}${d.path}`, source_filename: d.path.split('\\').pop(), text: d.text },
            })),
          }),
        };
      }
      if (u.includes('/points/scroll')) {
        opts.capture?.push(body);
        const should: Array<{ key: string; match: { text: string } }> = body.filter.must[0].should;
        const mustNot: Array<{ match: { text: string } }> = body.filter.must_not ?? [];
        const points = opts.corpus
          .map((d) => ({ sourceFile: `${V}${d.path}`, source_filename: d.path.split('\\').pop(), text: d.text }))
          .filter((p) => should.some((c) => String((p as any)[c.key]).includes(c.match.text)))
          .filter((p) => opts.ignoreServerFilter || !mustNot.some((m) => p.sourceFile.includes(m.match.text)));
        return { ok: true, json: async () => ({ result: { points: points.map((payload) => ({ payload })) } }) };
      }
      throw new Error(`url inattendue ${u}`);
    }),
  );
}

let patternsFile: string;
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'raghy-'));
  patternsFile = join(dir, 'zone-a-patterns.json');
  writeFileSync(patternsFile, JSON.stringify(PATTERNS), 'utf8');
});
afterEach(() => vi.unstubAllGlobals());

describe('rag-hybrid-v1 / termes', () => {
  it('garde les identifiants en premier, retire les mots vides et les elisions', () => {
    const t = extractTokens("ou est-ce que j'ai note SRV-042 et la variable BUILD_MODE dans Tondeuse ?");
    // « note » est un mot vide ; « variable » (mot long) passe apres les identifiants et le nom propre
    expect(t.map((x) => x.token)).toEqual(['SRV-042', 'BUILD_MODE', 'Tondeuse', 'variable']);
    expect(t[0]!.priority).toBe(2);
    expect(t[2]!.priority).toBe(1.5);
  });

  it('nom de fichier avec point et extension garde entier', () => {
    expect(extractTokens('config-zones.json').map((x) => x.token)).toEqual(['config-zones.json']);
  });

  it('casses et inversions de lettres voisines', () => {
    expect(caseVariants('Srv42')).toEqual(['Srv42', 'srv42', 'SRV42']);
    const typo = transpositionVariants('ABCD');
    expect(typo).toContain('BACD');
    expect(typo).toContain('ACBD');
    expect(typo).not.toContain('ABCD');
    expect(transpositionVariants('ab')).toEqual([]);
  });
});

describe('rag-hybrid-v1 / recherche', () => {
  const noise: Doc[] = Array.from({ length: 6 }, (_, i) => ({ path: `02-Projets\\Bruit-${i}.md`, text: `texte general ${i}` }));

  it('identifiant rare : le document qui le contient passe en tete, trouve par les deux canaux', async () => {
    const target: Doc = { path: '02-Projets\\Serveurs.md', text: 'le serveur SRV-042 heberge le controleur' };
    stub({ vector: [...noise, target], corpus: [...noise, target] });
    const r = await ragHybrid({ query: 'SRV-042', patternsFile });
    expect(r.hits[0]!.sourceFile).toContain('Serveurs.md');
    expect(r.hits[0]!.trouvePar).toEqual(['vectoriel', 'lexical']);
    expect(r.hits[0]!.excerpt).toContain('SRV-042');
    expect(r.meta.poidsLexical).toBe(1);
  });

  it('casse differente dans la note : trouve quand meme', async () => {
    const target: Doc = { path: '02-Projets\\Services.md', text: 'redemarrer le service vmhost apres la mise a jour' };
    stub({ vector: noise, corpus: [...noise, target] });
    const r = await ragHybrid({ query: 'VMHOST', patternsFile });
    expect(r.hits.map((h) => h.sourceFile).some((p) => p.includes('Services.md'))).toBe(true);
  });

  it('faute de frappe (lettres inversees) : rattrapee et signalee', async () => {
    const target: Doc = { path: '02-Projets\\Plateforme.md', text: 'entrainement sur Killerbox pour la certification' };
    stub({ vector: noise, corpus: [...noise, target] });
    const r = await ragHybrid({ query: 'Kilelrbox', patternsFile });
    const hit = r.hits.find((h) => h.sourceFile.includes('Plateforme.md'))!;
    expect(hit).toBeDefined();
    expect(hit.fauteDeFrappe).toBe(true);
    expect((r.meta.termesLexicaux as any[])[0].typo).toBe(true);
  });

  it('pas de variantes de faute si le terme existe tel quel (un seul scan par terme)', async () => {
    const capture: any[] = [];
    const target: Doc = { path: '02-Projets\\Serveurs.md', text: 'SRV-042' };
    stub({ vector: noise, corpus: [target], capture });
    await ragHybrid({ query: 'SRV-042', patternsFile });
    expect(capture).toHaveLength(1);
  });

  it('nom de fichier : correspondance dans le chemin', async () => {
    const target: Doc = { path: '00-Meta\\Carte-Ports.md', text: 'tableau des ports' };
    stub({ vector: noise, corpus: [...noise, target] });
    const r = await ragHybrid({ query: 'Carte-Ports', patternsFile });
    const hit = r.hits.find((h) => h.sourceFile.includes('Carte-Ports.md'))!;
    expect(hit.dansLeChemin).toBe(true);
  });

  it('terme courant (echantillon tronque) ignore : le classement vectoriel de v1 est conserve', async () => {
    const many: Doc[] = Array.from({ length: 300 }, (_, i) => ({ path: `conversations\\ws\\c-${i}.md`, text: `Lyra ${i}` }));
    // dossier sans poids de zone dans les motifs de test : l'ordre vectoriel suit le score
    const vector: Doc[] = [
      { path: '01-Autre\\Decision.md', text: 'decision Lyra' },
      ...noise.map((d) => ({ ...d, path: d.path.replace('02-Projets', '01-Autre') })),
    ];
    stub({ vector, corpus: many });
    const r = await ragHybrid({ query: 'Pourquoi Lyra', patternsFile });
    expect(r.hits[0]!.sourceFile).toContain('Decision.md');
    expect((r.meta.termesLexicaux as any[]).find((t) => t.token === 'Lyra').courant).toBe(true);
  });

  it("sans identifiant, un seul mot rare ne propulse pas un document faible (mode faible, 2 termes minimum)", async () => {
    const weak: Doc = { path: '02-Projets\\Faible.md', text: 'un texte elargi' };
    const vector: Doc[] = [{ path: '02-Projets\\Bonne.md', text: 'la bonne reponse' }, ...noise, weak];
    stub({ vector, corpus: [weak] });
    const r = await ragHybrid({ query: 'Process Complet elargi etape Maison', patternsFile });
    expect(r.meta.poidsLexical).toBe(0.5);
    expect(r.hits[0]!.sourceFile).toContain('Bonne.md');
  });

  it("le poids de zone n'est pas applique deux fois : sans resultat lexical, l'ordre est exactement celui de v1", async () => {
    const vector: Doc[] = [
      { path: 'conversations\\ws-a\\a.md', text: 'un', score: 0.95 },
      { path: '02-Projets\\B.md', text: 'deux', score: 0.88 },
    ];
    // v1 : conversation 0,95 x 0,98 = 0,931 devant projet 0,88 x 1,05 = 0,924 ; repasser le poids sur les
    // rangs RRF (1/61 contre 1/62) inverserait l'ordre
    stub({ vector, corpus: [] });
    const v1 = await ragQuery({ query: 'zzzz introuvable', limit: 25, patternsFile });
    const r = await ragHybrid({ query: 'zzzz introuvable', patternsFile });
    expect(r.hits.map((h) => h.sourceFile)).toEqual(v1.hits.slice(0, 5).map((h) => h.sourceFile));
  });

  it('GARDE-FOU : zone sensible jamais ouverte, meme avec includeZoneA et un Qdrant qui ignore le filtre', async () => {
    const secret: Doc = { path: 'zone-alpha-sensitive\\s.md', text: 'SRV-042 secret' };
    const brut: Doc = { path: 'conversations\\from-vendor-chat\\c.md', text: 'SRV-042 conversation' };
    stub({ vector: [secret, brut], corpus: [secret, brut], ignoreServerFilter: true });
    const def = await ragHybrid({ query: 'SRV-042', patternsFile });
    expect(def.hits).toHaveLength(0);
    const za = await ragHybrid({ query: 'SRV-042', patternsFile, includeZoneA: true });
    expect(za.hits.some((h) => h.sourceFile.includes('zone-alpha-sensitive'))).toBe(false);
    expect(za.hits.some((h) => h.sourceFile.includes('from-vendor-chat'))).toBe(true);
    expect(za.meta.intimeAlwaysFiltered).toBe(true);
  });

  it('question sans terme distinctif : conseil vers rag-search-v2', async () => {
    stub({ vector: noise, corpus: [] });
    const r = await ragHybrid({ query: 'est-ce que tu peux me dire', patternsFile });
    expect(String(r.meta.conseil)).toMatch(/rag-search-v2/);
  });

  it('Qdrant ou Ollama eteint : erreur propre ; query vide : erreur propre', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await ragHybrid({ query: 'SRV-042', patternsFile });
    expect(r.hits).toHaveLength(0);
    expect(r.meta.error).toMatch(/indisponible|injoignable/);
    const e = await ragHybrid({ query: '  ', patternsFile });
    expect(e.meta.error).toBe('query vide');
  });

  it('outil MCP : id, categorie, ne plante jamais', async () => {
    expect(tool.id).toBe('rag-hybrid-v1');
    expect(tool.category).toBe('memory');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    const out = await tool.execute({ query: 'x' });
    expect(JSON.parse(out.content[0]!.text).meta.tool).toBe('rag-hybrid-v1');
  });
});
