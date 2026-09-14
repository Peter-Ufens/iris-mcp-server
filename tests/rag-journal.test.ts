import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// fs reel, mais observe : prouve qu'aucune ecriture n'a lieu sans la variable d'environnement
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    appendFileSync: vi.fn(actual.appendFileSync),
    mkdirSync: vi.fn(actual.mkdirSync),
  };
});

import {
  JOURNAL_ENV,
  FENETRE_ENV,
  avecJournal,
  classer,
  journaliser,
  lierManuellement,
  reinitialiserJournal,
} from '../src/utils/rag-journal.js';
import { tool as linkTool } from '../src/tools/rag-journal-link-v1.js';
import { tool as v1 } from '../src/tools/rag-query-v1.js';
import { tool as v2 } from '../src/tools/rag-search-v2.js';
import { tool as hybride } from '../src/tools/rag-hybrid-v1.js';

/** Donnees FICTIVES : mots inventes, chemins d'exemple. */
const V = 'X:\\Coffre\\';
const succes = (sources = ['02-Projets\\Zorblat.md', '02-Projets\\Kordex.md']) => ({
  hits: sources.map((s) => ({ sourceFile: `${V}${s}`, excerpt: 'extrait fictif tres long '.repeat(20) })),
  meta: { count: sources.length, confiance: 'bonne', needsClarification: false },
});
const clarification = { hits: [{ sourceFile: `${V}01-Autre\\Bruit.md` }], meta: { count: 1, confiance: 'faible', needsClarification: true } };
const vide = { hits: [], meta: { count: 0 } };
const panne = { hits: [], meta: { count: 0, error: 'Qdrant injoignable (fictif)' } };

const faux = (payload: unknown) => async () => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });
const lignes = (dir: string, f: string) => {
  try {
    return readFileSync(join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'iris-journal-'));
  reinitialiserJournal();
  vi.mocked(fs.appendFileSync).mockClear();
  vi.mocked(fs.mkdirSync).mockClear();
});
afterEach(() => {
  delete process.env[JOURNAL_ENV];
  delete process.env[FENETRE_ENV];
  vi.unstubAllGlobals();
});

describe('journal RAG / desactive par defaut', () => {
  it('sans variable : resultat identique (meme objet), aucune ecriture, aucun dossier cree', async () => {
    const out = { content: [{ type: 'text' as const, text: JSON.stringify(succes()) }] };
    const exec = avecJournal('rag-search-v2', async () => out);
    const r = await exec({ query: 'ou est le zorblat' });
    expect(r).toBe(out);
    expect(fs.appendFileSync).not.toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
    expect(journaliser('rag-query-v1', { query: 'x' }, succes(), 1)).toBeNull();
  });

  it('sans variable : les trois vrais outils RAG ne touchent pas au disque et ne portent pas meta.journal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    for (const t of [v1, v2, hybride]) {
      const payload = JSON.parse((await t.execute({ query: 'kordex du matin' })).content[0]!.text);
      expect(payload.meta.journal).toBeUndefined();
    }
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });

  it('outil de lien sans variable : refuse proprement, rien ecrit', async () => {
    const payload = JSON.parse((await linkTool.execute({})).content[0]!.text);
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/desactive/);
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });
});

describe('journal RAG / active', () => {
  beforeEach(() => {
    process.env[JOURNAL_ENV] = join(dir, 'journal'); // sous-dossier cree a la demande
  });

  it('classe succes, echec, clarification, erreur', () => {
    expect(classer('rag-search-v2', succes()).statut).toBe('succes');
    expect(classer('rag-search-v2', clarification).statut).toBe('clarification');
    expect(classer('rag-query-v1', vide).statut).toBe('echec');
    expect(classer('rag-query-v1', panne).statut).toBe('erreur');
    // hybride : des resultats vectoriels mais aucun terme distinctif trouve dans le texte = echec
    const hy = { hits: [{ sourceFile: 'a' }], meta: { count: 1, termesLexicaux: [{ token: 'QX-9', documents: 0, courant: false }] } };
    expect(classer('rag-hybrid-v1', hy).statut).toBe('echec');
    const hyCourant = { ...hy, meta: { ...hy.meta, termesLexicaux: [{ token: 'mot', documents: 0, courant: true }] } };
    expect(classer('rag-hybrid-v1', hyCourant).statut).toBe('succes');
  });

  it('ecrit un evenement conforme : chemins seulement, pas d extraits, options utiles', async () => {
    const exec = avecJournal('rag-search-v2', faux(succes()));
    const payload = JSON.parse((await exec({ query: 'le zorblat de kordex', limit: 3, reformulate: false })).content[0]!.text);
    const [e] = lignes(process.env[JOURNAL_ENV]!, 'evenements.jsonl');
    expect(Object.keys(e).sort()).toEqual(
      ['confiance', 'dureeMs', 'id', 'nbResultats', 'needsClarification', 'options', 'outil', 'requete', 'sessionId', 'statut', 'topSources', 'ts', 'v'].sort(),
    );
    expect(e).toMatchObject({ v: 1, outil: 'rag-search-v2', requete: 'le zorblat de kordex', statut: 'succes', confiance: 'bonne', nbResultats: 2 });
    expect(e.options).toEqual({ limit: 3, reformulate: false });
    expect(e.topSources).toEqual([`${V}02-Projets\\Zorblat.md`, `${V}02-Projets\\Kordex.md`]);
    expect(JSON.stringify(e)).not.toContain('extrait fictif');
    expect(payload.meta.journal).toMatchObject({ actif: true, id: e.id, statut: 'succes' });
    expect(payload.hits).toHaveLength(2); // la reponse de l outil est intacte
    // le mock de node:fs voit bien les ecritures du journal : les assertions « aucune ecriture » ne sont pas vides
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
  });

  it('includeZoneA=true : rien n est journalise', async () => {
    const exec = avecJournal('rag-query-v1', faux(succes()));
    const payload = JSON.parse((await exec({ query: 'quarzo', includeZoneA: true })).content[0]!.text);
    expect(payload.meta.journal.nonJournalise).toMatch(/includeZoneA/);
    expect(lignes(process.env[JOURNAL_ENV]!, 'evenements.jsonl')).toHaveLength(0);
  });

  it('includeContentieux=true : rien n est journalise, meme avec includeZoneA', async () => {
    for (const opts of [{ includeContentieux: true }, { includeContentieux: true, includeZoneA: true }]) {
      const exec = avecJournal('rag-hybrid-v1', faux(succes()));
      const payload = JSON.parse((await exec({ query: 'dossier kordex', ...opts })).content[0]!.text);
      expect(payload.meta.journal.nonJournalise).toMatch(/includeContentieux/);
    }
    expect(lignes(process.env[JOURNAL_ENV]!, 'evenements.jsonl')).toHaveLength(0);
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });

  it('paire auto : clarification puis echec puis succes dans la fenetre -> 2 paires, pas de doublon ensuite', async () => {
    await avecJournal('rag-search-v2', faux(clarification))({ query: 'le sorblat qui plante' });
    await avecJournal('rag-query-v1', faux(vide))({ query: 'sorblat plantage' });
    await avecJournal('rag-query-v1', faux(panne))({ query: 'panne ignoree' }); // erreur technique : jamais appariee
    const r = JSON.parse((await avecJournal('rag-hybrid-v1', faux(succes()))({ query: 'Zorblat' })).content[0]!.text);
    expect(r.meta.journal.pairesAuto).toBe(2);
    expect(r.meta.journal.conseil).toMatch(/rag-journal-link-v1/);
    await avecJournal('rag-hybrid-v1', faux(succes()))({ query: 'Zorblat encore' });
    const paires = lignes(process.env[JOURNAL_ENV]!, 'paires.jsonl');
    expect(paires).toHaveLength(2);
    expect(paires.map((p) => p.echec.requete)).toEqual(['le sorblat qui plante', 'sorblat plantage']);
    expect(paires.every((p) => p.lien === 'auto-session' && p.succes.requete === 'Zorblat' && p.ecartSecondes >= 0)).toBe(true);
  });

  it('paire auto : echec hors fenetre -> pas de paire', () => {
    process.env[FENETRE_ENV] = '15';
    const t0 = new Date('2026-01-01T10:00:00Z');
    journaliser('rag-query-v1', { query: 'kwarzo' }, vide, 5, t0);
    const info = journaliser('rag-query-v1', { query: 'quarzo' }, succes(), 5, new Date('2026-01-01T10:20:00Z'));
    expect(info?.pairesAuto).toBeUndefined();
    expect(lignes(process.env[JOURNAL_ENV]!, 'paires.jsonl')).toHaveLength(0);
  });

  it('best-effort : dossier impossible a creer -> l outil repond quand meme, erreur signalee', async () => {
    const fichier = join(dir, 'pas-un-dossier');
    writeFileSync(fichier, 'x');
    process.env[JOURNAL_ENV] = join(fichier, 'sous');
    const exec = avecJournal('rag-search-v2', faux(succes()));
    const payload = JSON.parse((await exec({ query: 'zorblat' })).content[0]!.text);
    expect(payload.hits).toHaveLength(2);
    expect(payload.meta.journal.erreur).toMatch(/journal indisponible/);
  });

  it('best-effort : sortie non JSON -> renvoyee telle quelle', async () => {
    const out = { content: [{ type: 'text' as const, text: 'pas du json' }] };
    expect(await avecJournal('rag-query-v1', async () => out)({ query: 'x' })).toBe(out);
  });

  it('lien manuel : par defaut dernier echec -> dernier succes ; ids explicites relus depuis le fichier', async () => {
    await avecJournal('rag-search-v2', faux(clarification))({ query: 'le vimbeau du jeu' });
    const execOk = avecJournal('rag-query-v1', faux(succes(['02-Projets\\Vimbo.md'])));
    const ok = JSON.parse((await execOk({ query: 'Vimbo' })).content[0]!.text);
    const r1 = JSON.parse((await linkTool.execute({ note: 'bonne note trouvee' })).content[0]!.text);
    expect(r1.ok).toBe(true);
    expect(r1.paire.lien).toBe('manuel');
    expect(r1.paire.succesId).toBe(ok.meta.journal.id);

    const [echec] = lignes(process.env[JOURNAL_ENV]!, 'evenements.jsonl');
    reinitialiserJournal(); // autre session : la memoire est vide, il faut relire le fichier
    const r2 = lierManuellement({ echecId: echec.id, succesId: ok.meta.journal.id });
    expect(r2.ok).toBe(true);
    const manuelles = lignes(process.env[JOURNAL_ENV]!, 'paires.jsonl').filter((p) => p.lien === 'manuel');
    expect(manuelles).toHaveLength(2);
    expect(manuelles[0].note).toBe('bonne note trouvee');
  });

  it('lien manuel : refuse un succes a la place d un echec, un id inconnu, une session vide', async () => {
    expect(lierManuellement({}).error).toMatch(/aucune recherche ratee/);
    const a = JSON.parse((await avecJournal('rag-query-v1', faux(succes()))({ query: 'kordex' })).content[0]!.text);
    const b = JSON.parse((await avecJournal('rag-query-v1', faux(succes()))({ query: 'kordex bis' })).content[0]!.text);
    expect(lierManuellement({ echecId: a.meta.journal.id, succesId: b.meta.journal.id }).error).toMatch(/pas une recherche ratee/);
    expect(lierManuellement({ echecId: 'evt-inconnu', succesId: b.meta.journal.id }).error).toMatch(/introuvable/);
  });

  it('les trois vrais outils RAG journalisent (Qdrant et Ollama injoignables = statut erreur)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    for (const t of [v1, v2, hybride]) {
      const payload = JSON.parse((await t.execute({ query: 'kordex du soir', reformulate: false })).content[0]!.text);
      expect(payload.meta.journal.statut).toBe('erreur');
    }
    const ev = lignes(process.env[JOURNAL_ENV]!, 'evenements.jsonl');
    expect(ev.map((e) => e.outil)).toEqual(['rag-query-v1', 'rag-search-v2', 'rag-hybrid-v1']);
    expect(lignes(process.env[JOURNAL_ENV]!, 'paires.jsonl')).toHaveLength(0);
  });
});
