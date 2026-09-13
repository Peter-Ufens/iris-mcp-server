import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ragSearch,
  parseGlossary,
  loadGlossary,
  resolveGlossaryFile,
  matchGlossary,
  cleanQuery,
  parseReformulations,
  assessConfidence,
  tool,
} from '../src/tools/rag-search-v2.js';

/** Glossaire FICTIF : aucun vocabulaire reel de l'utilisateur dans ce depot public. */
const GLOSSARY_MD = `---
version: test-glossaire-1
---

# Glossaire de test

## Comment lire

| Colonne | Sens |
|---|---|
| Tu dis | formes |

## 1. Outils

| Tu dis | Terme vault | Où chercher | Preuve | Statut |
|---|---|---|---|---|
| meteo perso · **mon appli météo** · MP | **MeteoPerso** (application) | \`02-Projets/MeteoPerso.md\` | 12 | confirmé |
| le frigo connecté · frigo | **FrigoBox** | \`02-Projets/FrigoBox.md\` | 4 | à valider (ambigu) |
| la tondeuse | **Robot-Tondeuse** | \`02-Projets/Robot-Tondeuse.md\` | 3 | confirmé |

## 3. Formulations de demande (intentions)

| Tu dis | Ce que Peter veut | Où regarder | Preuve | Statut |
|---|---|---|---|---|
| on en avait parlé · tu te souviens | requête de souvenir | outil \`rag-query-v1\` | 9 | confirmé |

## 4. Sens historiques

| Mot | Avant | Maintenant | Repère |
|---|---|---|---|
| **Tondeuse** | manuelle | robot | 2025 |

## 5. Pièges de dictée

| Forme | Pourquoi |
|---|---|
| frigo | peut etre le vrai frigo |

## 6. Tics de langage

\`genre\` (10) · \`du coup\` (5) · marqueurs \`;o\` (3)
`;

function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ragv2-'));
  const f = join(dir, name);
  writeFileSync(f, content, 'utf8');
  return f;
}

const PATTERNS = {
  version: 'test-zones-1',
  ragQueryExcludeContains: ['from-vendor-chat', 'zone-alpha-sensitive'],
  ragAlwaysExcludeContains: ['zone-alpha-sensitive'],
  ragSourcePriority: { '\\02-Projets\\': 1.05, '\\conversations\\': 0.98 },
};

const V = 'D:\\Vault\\Example\\';

interface Point {
  score: number;
  path: string;
  text: string;
}

/**
 * Faux Ollama + Qdrant. `searches` recoit chaque corps de recherche Qdrant ;
 * `pointsFor(body)` decide des points renvoyes (permet de simuler la recherche ciblee).
 */
function stubServices(opts: {
  pointsFor: (body: any) => Point[];
  generate?: (body: any) => { ok: boolean; json?: unknown; abort?: boolean };
  capture?: { generate?: any; searches: any[] };
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string; signal?: AbortSignal }) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      const u = String(url);
      if (u.endsWith('/api/embed')) {
        return { ok: true, json: async () => ({ embeddings: body.input.map(() => [0.1, 0.2, 0.3]) }) };
      }
      if (u.endsWith('/api/generate')) {
        if (opts.capture) opts.capture.generate = body;
        const g = opts.generate?.(body) ?? { ok: true, json: { response: '{"requetes":[]}' } };
        if (g.abort) {
          const err = new Error('aborted');
          err.name = 'AbortError';
          throw err;
        }
        return { ok: g.ok, status: g.ok ? 200 : 500, statusText: g.ok ? 'OK' : 'KO', json: async () => g.json };
      }
      if (u.includes('/points/search')) {
        opts.capture?.searches.push(body);
        const pts = opts.pointsFor(body);
        return {
          ok: true,
          json: async () => ({
            result: pts.map((p) => ({
              score: p.score,
              payload: { sourceFile: p.path, source_filename: p.path.split('\\').pop(), text: p.text },
            })),
          }),
        };
      }
      throw new Error(`url inattendue ${u}`);
    }),
  );
}

let patternsFile: string;
let glossaryFile: string;

beforeEach(() => {
  patternsFile = tmpFile('zone-a-patterns.json', JSON.stringify(PATTERNS));
  glossaryFile = tmpFile('glossaire-recherche.md', GLOSSARY_MD);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RAG_GLOSSARY_FILE;
  delete process.env.ZONE_A_PATTERNS_FILE;
  delete process.env.RAG_REFORMULATE_TIMEOUT_MS;
});

describe('rag-search-v2 / glossaire', () => {
  it('lit les tableaux, les pieges et les tics', () => {
    const g = parseGlossary(GLOSSARY_MD);
    expect(g.version).toBe('test-glossaire-1');
    expect(g.entries).toHaveLength(4);
    const meteo = g.entries.find((e) => e.term.startsWith('MeteoPerso'))!;
    expect(meteo.forms).toEqual(['meteo perso', 'mon appli météo', 'MP']);
    expect(meteo.where).toEqual(['02-Projets/MeteoPerso.md']);
    expect(meteo.pointsToNotes).toBe(true);
    const souvenir = g.entries.find((e) => e.intent)!;
    expect(souvenir.pointsToNotes).toBe(false);
    expect(g.traps).toEqual(['frigo']);
    expect(g.tics).toEqual(['genre', 'du coup']);
  });

  it('chemin : RAG_GLOSSARY_FILE, sinon voisin de ZONE_A_PATTERNS_FILE, sinon absent', () => {
    process.env.ZONE_A_PATTERNS_FILE = patternsFile;
    expect(resolveGlossaryFile().source).toBe('absent'); // pas de voisin dans ce dossier temporaire
    const dir = mkdtempSync(join(tmpdir(), 'ragv2-voisin-'));
    writeFileSync(join(dir, 'zone-a-patterns.json'), '{}');
    writeFileSync(join(dir, 'glossaire-recherche.md'), GLOSSARY_MD);
    process.env.ZONE_A_PATTERNS_FILE = join(dir, 'zone-a-patterns.json');
    expect(resolveGlossaryFile().source).toBe('voisin-zone-patterns');
    process.env.RAG_GLOSSARY_FILE = glossaryFile;
    expect(resolveGlossaryFile()).toEqual({ path: glossaryFile, source: 'env' });
  });

  it('glossaire illisible => erreur propre, pas de plantage', () => {
    const g = loadGlossary(join(tmpdir(), 'nexiste-pas-ragv2.md'));
    expect(g.entries).toHaveLength(0);
    expect(g.error).toMatch(/illisible/);
  });

  it('correspondance sans accents, apostrophe = espace, formes courtes en majuscules seulement', () => {
    const g = loadGlossary(glossaryFile);
    expect(matchGlossary('ou en est mon appli meteo', g).map((m) => m.entry.term)).toEqual(['MeteoPerso application']);
    expect(matchGlossary('la TONDEUSE', g)).toHaveLength(1);
    // « mp » en minuscules : trop court et ambigu
    expect(matchGlossary('une mp3 et mp', g)).toHaveLength(0);
    expect(matchGlossary('le MP plante', g)).toHaveLength(1);
  });

  it('piege ou ligne « a valider » : indice pour le modele, jamais de reecriture deterministe', () => {
    const g = loadGlossary(glossaryFile);
    const m = matchGlossary('le frigo fait du bruit', g);
    expect(m).toHaveLength(1);
    expect(m[0]!.deterministic).toBe(false);
  });

  it('retire tics et smileys, garde la question si tout serait retire', () => {
    expect(cleanQuery('genre du coup la tondeuse ;o', ['genre', 'du coup'])).toBe('la tondeuse');
    expect(cleanQuery('genre', ['genre'])).toBe('genre');
  });

  it('reformulations : JSON invalide => 0, doublons et question elle-meme retires, 3 max', () => {
    expect(parseReformulations('pas du json', 'q')).toEqual([]);
    expect(parseReformulations('{"requetes":["Q", "a b c", "a b c", "d e f", "g h i", "j k l"]}', 'q')).toEqual([
      'a b c', 'd e f', 'g h i',
    ]);
  });
});

describe('rag-search-v2 / confiance', () => {
  it('question absurde : aucun extrait ne porte ses termes => faible', () => {
    const c = assessConfidence('recette du gateau aux pruneaux', [], [
      { evidence: 'D:\\x\\note.md\nconfiguration du serveur et des sauvegardes', trouvePar: ['question'] },
    ], ['configuration du serveur et des sauvegardes']);
    expect(c.level).toBe('faible');
  });

  it('termes courants trouves mais pas le plus distinctif => faible', () => {
    // « kyoto » n'apparait dans aucun extrait recupere : c'est lui qui distingue la question
    const pool = ['prix du ticket de bus metro', 'prix des tickets restaurant', 'ticket metro prix'];
    const c = assessConfidence('prix du ticket de metro a Kyoto', [], [
      { evidence: 'prix du ticket de bus metro', trouvePar: ['question'] },
    ], pool);
    expect(c.level).toBe('faible');
  });

  it('extrait qui porte les termes de la question => bonne', () => {
    const c = assessConfidence('panne de la tondeuse robot', [], [
      { evidence: 'D:\\x\\Robot-Tondeuse.md\nla tondeuse robot est en panne depuis mardi', trouvePar: ['question'] },
    ], ['la tondeuse robot est en panne depuis mardi', 'autre chose']);
    expect(c.level).toBe('bonne');
  });

  it('terme du glossaire trouve seulement via la note pointee, question avec un autre terme absent => faible', () => {
    const g = loadGlossary(glossaryFile);
    const matches = matchGlossary('la tondeuse du voisin', g);
    const c = assessConfidence('la tondeuse du voisin', matches, [
      { evidence: 'D:\\x\\Robot-Tondeuse.md\nRobot-Tondeuse reglages', trouvePar: ['note pointee par le glossaire'] },
    ], ['Robot-Tondeuse reglages', 'voisin de palier bruyant']);
    expect(c.level).toBe('faible');
  });
});

describe('rag-search-v2 / recherche', () => {
  const doc = (score: number, path: string, text: string): Point => ({ score, path: `${V}${path}`, text });

  it('reformulations : think false, temperature 0, JSON ; meta.reformulations rempli ; fusion par consensus', async () => {
    const capture = { searches: [] as any[], generate: undefined as any };
    let call = 0;
    stubServices({
      capture,
      generate: () => ({ ok: true, json: { response: '{"requetes":["application MeteoPerso previsions","MeteoPerso widget"]}' } }),
      pointsFor: (body) => {
        if (body.filter?.must) return [doc(0.7, '02-Projets\\MeteoPerso.md', 'MeteoPerso : application de previsions')];
        call += 1;
        // la note MeteoPerso revient dans toutes les variantes, le bruit change a chaque fois
        return [doc(0.8, `conversations\\bruit-${call}.md`, `bruit ${call}`), doc(0.75, '02-Projets\\MeteoPerso.md', 'MeteoPerso : application de previsions')];
      },
    });
    const r = await ragSearch({ query: 'mon appli météo marche plus', patternsFile, glossaryFile });
    expect(capture.generate.think).toBe(false);
    expect(capture.generate.options.temperature).toBe(0);
    expect(capture.generate.format).toBe('json');
    expect(r.meta.reformulationCount).toBe(2);
    expect(r.meta.reformulations).toEqual(['application MeteoPerso previsions', 'MeteoPerso widget']);
    expect(r.hits[0]!.sourceFile).toContain('MeteoPerso.md');
    expect(r.hits[0]!.trouvePar).toEqual(expect.arrayContaining(['question', 'glossaire', 'note pointee par le glossaire']));
    // recherche ciblee sur la note designee, chemin converti au format Windows
    expect(capture.searches.some((b) => b.filter?.must?.[0]?.match?.text === '02-Projets\\MeteoPerso.md')).toBe(true);
    expect(r.meta.needsClarification).toBe(false);
  });

  it('0 reformulation (reponse vide) => dit en clair, recherche quand meme', async () => {
    stubServices({
      generate: () => ({ ok: true, json: { response: '' } }),
      pointsFor: () => [doc(0.8, '02-Projets\\Robot-Tondeuse.md', 'la tondeuse robot tond le jardin')],
    });
    const r = await ragSearch({ query: 'la tondeuse tond le jardin', patternsFile, glossaryFile });
    expect(r.meta.reformulationCount).toBe(0);
    expect(r.meta.reformulationNote).toMatch(/^0 reformulation/);
    expect(r.hits.length).toBeGreaterThan(0);
  });

  it('timeout du modele => repli signale dans meta.fallback, resultats quand meme', async () => {
    stubServices({
      generate: () => ({ ok: false, abort: true }),
      pointsFor: () => [doc(0.8, '02-Projets\\Robot-Tondeuse.md', 'la tondeuse robot')],
    });
    const r = await ragSearch({ query: 'la tondeuse robot', patternsFile, glossaryFile });
    expect(r.meta.fallback.used).toBe(true);
    expect(r.meta.fallback.reason).toMatch(/au-dela de/);
    expect(r.meta.reformulationNote).toMatch(/^0 reformulation/);
    expect(r.hits).toHaveLength(1);
  });

  it('sans glossaire => aucune reformulation, raison explicite', async () => {
    process.env.ZONE_A_PATTERNS_FILE = patternsFile;
    const capture = { searches: [] as any[], generate: undefined as any };
    stubServices({ capture, pointsFor: () => [doc(0.8, '02-Projets\\Robot-Tondeuse.md', 'tondeuse robot')] });
    const r = await ragSearch({ query: 'tondeuse robot', patternsFile });
    expect(capture.generate).toBeUndefined();
    expect((r.meta.glossary as any).loaded).toBe(false);
    expect(r.meta.reformulationNote).toMatch(/glossaire absent/);
    expect(r.hits).toHaveLength(1);
  });

  it('question hors sujet => needsClarification + message qui demande un contexte et « deja parle »', async () => {
    stubServices({
      pointsFor: () => [doc(0.63, 'conversations\\a.md', 'reglage du routeur wifi'), doc(0.62, '02-Projets\\Robot-Tondeuse.md', 'tondeuse')],
    });
    const r = await ragSearch({ query: 'horaires du musee de Saturne', patternsFile, glossaryFile });
    expect(r.meta.needsClarification).toBe(true);
    const c = r.meta.clarification as any;
    expect(c.message).toMatch(/contexte/);
    expect(c.message).toMatch(/deja parle/);
    expect(c.pistesAVerifier.length).toBeGreaterThan(0);
  });

  it('GARDE-FOU : zone sensible jamais ouverte, meme avec includeZoneA et un Qdrant qui ignore le filtre', async () => {
    stubServices({
      pointsFor: () => [
        doc(0.9, 'zone-alpha-sensitive\\secret.md', 'contenu sensible'),
        doc(0.8, 'conversations\\from-vendor-chat\\c.md', 'conversation brute'),
      ],
    });
    const r = await ragSearch({ query: 'contenu', patternsFile, glossaryFile, includeZoneA: true, reformulate: false });
    expect(r.hits.some((h) => h.sourceFile.includes('zone-alpha-sensitive'))).toBe(false);
    expect(r.hits.some((h) => h.sourceFile.includes('from-vendor-chat'))).toBe(true);
    expect(r.meta.intimeAlwaysFiltered).toBe(true);
  });

  it('par defaut, conversations brutes filtrees', async () => {
    stubServices({ pointsFor: () => [doc(0.8, 'conversations\\from-vendor-chat\\c.md', 'conversation brute')] });
    const r = await ragSearch({ query: 'conversation brute', patternsFile, glossaryFile, reformulate: false });
    expect(r.hits).toHaveLength(0);
    expect(r.meta.filterZoneA).toBe(true);
  });

  it('dedoublonnage : un meme transcript sous deux dossiers = un seul resultat', async () => {
    stubServices({
      pointsFor: () => [
        doc(0.8, 'conversations\\ws-a\\uuid-1.md', 'texte un sur la tondeuse'),
        doc(0.79, 'conversations\\ws-b\\uuid-1.md', 'texte deux sur la tondeuse'),
      ],
    });
    const r = await ragSearch({ query: 'tondeuse', patternsFile, glossaryFile, reformulate: false });
    expect(r.hits.filter((h) => h.source_filename === 'uuid-1.md')).toHaveLength(1);
  });

  it('Ollama eteint => erreur propre ; query vide => erreur propre', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await ragSearch({ query: 'tondeuse', patternsFile, glossaryFile, reformulate: false });
    expect(r.meta.error).toMatch(/Ollama injoignable/);
    const e = await ragSearch({ query: '   ', patternsFile, glossaryFile });
    expect(e.meta.error).toBe('query vide');
  });

  it('outil MCP : id, categorie, ne plante jamais', async () => {
    expect(tool.id).toBe('rag-search-v2');
    expect(tool.category).toBe('memory');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    const out = await tool.execute({ query: 'x' });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.meta.tool).toBe('rag-search-v2');
  });
});
