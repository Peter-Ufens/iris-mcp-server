/**
 * Journal des recherches RAG (opt-in).
 *
 * But : garder une trace des recherches qui echouent ou demandent une clarification, puis de celle
 * qui reussit ensuite, pour construire plus tard des paires « formulation ratee -> formulation qui marche ».
 *
 * Regles :
 *  - AUCUNE ecriture si la variable d'environnement IRIS_RAG_JOURNAL_DIR n'est pas definie :
 *    le resultat de l'outil est renvoye tel quel, sans relecture ni ecriture.
 *  - Best-effort : une erreur du journal n'empeche jamais l'outil RAG de repondre.
 *  - Le texte des requetes est une donnee privee : le dossier doit etre hors de tout depot.
 *  - includeZoneA=true : rien n'est journalise.
 *  - Aucune decision ici : le journal ne modifie ni glossaire, ni index.
 *
 * Fichiers (JSONL en ajout seul) dans IRIS_RAG_JOURNAL_DIR :
 *  - evenements.jsonl : un appel RAG = une ligne
 *  - paires.jsonl     : echec ou clarification suivi d'un succes (auto, meme processus MCP, fenetre courte)
 *                       ou lien confirme par l'outil rag-journal-link-v1 (manuel)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { ToolResult } from '../tools/_types.js';

export const JOURNAL_ENV = 'IRIS_RAG_JOURNAL_DIR';
export const FENETRE_ENV = 'IRIS_RAG_JOURNAL_FENETRE_MIN';
const FENETRE_DEFAUT_MIN = 15;
const MAX_REQUETE = 2000;
const MAX_SOURCES = 5;
const MAX_MEMOIRE = 500;
export const FICHIER_EVENEMENTS = 'evenements.jsonl';
export const FICHIER_PAIRES = 'paires.jsonl';

export type StatutRecherche = 'succes' | 'echec' | 'clarification' | 'erreur';

export interface EvenementRecherche {
  v: 1;
  id: string;
  ts: string;
  sessionId: string;
  outil: string;
  requete: string;
  statut: StatutRecherche;
  needsClarification: boolean;
  confiance: string | null;
  nbResultats: number;
  topSources: string[];
  options: { limit?: number; project?: string; sourceContains?: string; reformulate?: boolean };
  dureeMs: number;
}

export interface PaireRecherche {
  v: 1;
  id: string;
  ts: string;
  sessionId: string;
  lien: 'auto-session' | 'manuel';
  echec: { id: string; outil: string; requete: string; statut: StatutRecherche; ts: string };
  succes: { id: string; outil: string; requete: string; ts: string; topSources: string[] };
  ecartSecondes: number;
  note?: string;
}

export interface InfoJournal {
  actif: true;
  id?: string;
  statut?: StatutRecherche;
  pairesAuto?: number;
  conseil?: string;
  nonJournalise?: string;
  erreur?: string;
}

// Etat du processus MCP (une connexion client = un processus = une session)
let sessionId = randomUUID();
let enAttente: EvenementRecherche[] = [];
let dernierEchec: EvenementRecherche | null = null;
let dernierSucces: EvenementRecherche | null = null;
let memoire = new Map<string, EvenementRecherche>();

/** Remet l'etat de session a zero (tests). */
export function reinitialiserJournal(): void {
  sessionId = randomUUID();
  enAttente = [];
  dernierEchec = null;
  dernierSucces = null;
  memoire = new Map();
}

export function dossierJournal(): string | null {
  const d = process.env[JOURNAL_ENV]?.trim();
  return d ? d : null;
}

function fenetreMs(): number {
  const n = Number(process.env[FENETRE_ENV]);
  return (Number.isFinite(n) && n > 0 ? n : FENETRE_DEFAUT_MIN) * 60_000;
}

function nouvelId(prefixe: string): string {
  return `${prefixe}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

function ajouter(dir: string, fichier: string, obj: unknown): void {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, fichier), `${JSON.stringify(obj)}\n`, 'utf8');
}

/** Classe le resultat d'un outil RAG (objet JSON renvoye par l'outil). */
export function classer(outil: string, result: unknown): { statut: StatutRecherche; confiance: string | null } {
  const r = (result ?? {}) as { hits?: unknown[]; meta?: Record<string, unknown> };
  const meta = r.meta ?? {};
  const confiance = typeof meta.confiance === 'string' ? meta.confiance : null;
  if (meta.error) return { statut: 'erreur', confiance };
  if (meta.needsClarification === true) return { statut: 'clarification', confiance };
  const count = Number(meta.count ?? (Array.isArray(r.hits) ? r.hits.length : 0));
  if (!count) return { statut: 'echec', confiance };
  if (outil === 'rag-hybrid-v1' && Array.isArray(meta.termesLexicaux)) {
    const termes = meta.termesLexicaux as Array<{ documents?: number; courant?: boolean }>;
    // termes distinctifs cherches tels quels (et avec inversions) sans aucun document : l'identifiant n'existe pas
    if (termes.length > 0 && termes.every((t) => !t.courant && (t.documents ?? 0) === 0)) {
      return { statut: 'echec', confiance };
    }
  }
  return { statut: 'succes', confiance };
}

function sourcesDe(result: unknown): string[] {
  const hits = ((result ?? {}) as { hits?: Array<{ sourceFile?: unknown }> }).hits ?? [];
  return hits
    .map((h) => (typeof h?.sourceFile === 'string' ? h.sourceFile : ''))
    .filter(Boolean)
    .slice(0, MAX_SOURCES);
}

function memoriser(e: EvenementRecherche): void {
  memoire.set(e.id, e);
  if (memoire.size > MAX_MEMOIRE) memoire.delete(memoire.keys().next().value as string);
}

function construirePaire(echec: EvenementRecherche, succes: EvenementRecherche, lien: PaireRecherche['lien'], note?: string): PaireRecherche {
  return {
    v: 1,
    id: nouvelId('paire'),
    ts: new Date().toISOString(),
    sessionId: succes.sessionId,
    lien,
    echec: { id: echec.id, outil: echec.outil, requete: echec.requete, statut: echec.statut, ts: echec.ts },
    succes: { id: succes.id, outil: succes.outil, requete: succes.requete, ts: succes.ts, topSources: succes.topSources },
    ecartSecondes: Math.round((Date.parse(succes.ts) - Date.parse(echec.ts)) / 1000),
    ...(note ? { note } : {}),
  };
}

/**
 * Journalise un appel RAG. Renvoie null si le journal est desactive (aucune I/O).
 * Ne leve jamais : une erreur est renvoyee dans `erreur`.
 */
export function journaliser(
  outil: string,
  input: Record<string, unknown>,
  result: unknown,
  dureeMs: number,
  maintenant: Date = new Date(),
): InfoJournal | null {
  const dir = dossierJournal();
  if (!dir) return null;
  if (input.includeZoneA === true) return { actif: true, nonJournalise: 'includeZoneA=true : recherche non journalisee' };
  try {
    const { statut, confiance } = classer(outil, result);
    const meta = ((result ?? {}) as { meta?: Record<string, unknown> }).meta ?? {};
    const evt: EvenementRecherche = {
      v: 1,
      id: nouvelId('evt'),
      ts: maintenant.toISOString(),
      sessionId,
      outil,
      requete: String(input.query ?? '').slice(0, MAX_REQUETE),
      statut,
      needsClarification: meta.needsClarification === true,
      confiance,
      nbResultats: Number(meta.count ?? 0) || 0,
      topSources: sourcesDe(result),
      options: {
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(typeof input.project === 'string' ? { project: input.project } : {}),
        ...(typeof input.sourceContains === 'string' ? { sourceContains: input.sourceContains } : {}),
        ...(typeof input.reformulate === 'boolean' ? { reformulate: input.reformulate } : {}),
      },
      dureeMs,
    };
    ajouter(dir, FICHIER_EVENEMENTS, evt);
    memoriser(evt);
    const info: InfoJournal = { actif: true, id: evt.id, statut };

    const limite = maintenant.getTime() - fenetreMs();
    if (statut === 'echec' || statut === 'clarification') {
      enAttente = [...enAttente.filter((e) => Date.parse(e.ts) >= limite), evt];
      dernierEchec = evt;
    } else if (statut === 'succes') {
      const liees = enAttente.filter((e) => Date.parse(e.ts) >= limite);
      for (const echec of liees) ajouter(dir, FICHIER_PAIRES, construirePaire(echec, evt, 'auto-session'));
      enAttente = [];
      dernierSucces = evt;
      if (liees.length) {
        info.pairesAuto = liees.length;
        info.conseil =
          'Recherche precedente ratee puis celle-ci : paire enregistree automatiquement. ' +
          'Si ces extraits repondent vraiment a la question, confirmer avec rag-journal-link-v1.';
      }
    }
    return info;
  } catch (e) {
    return { actif: true, erreur: `journal indisponible (${e instanceof Error ? e.message : String(e)}) : recherche non journalisee` };
  }
}

/** Enveloppe l'execute d'un outil RAG. Sans IRIS_RAG_JOURNAL_DIR : renvoie exactement le resultat d'origine. */
export function avecJournal(
  outil: string,
  execute: (input: Record<string, unknown>) => Promise<ToolResult>,
): (input: Record<string, unknown>) => Promise<ToolResult> {
  return async (input) => {
    const t0 = Date.now();
    const out = await execute(input);
    if (!dossierJournal()) return out;
    try {
      const text = out.content?.[0]?.text;
      if (typeof text !== 'string') return out;
      const result = JSON.parse(text) as { meta?: Record<string, unknown> };
      const info = journaliser(outil, input, result, Date.now() - t0);
      if (!info || !result || typeof result !== 'object') return out;
      result.meta = { ...(result.meta ?? {}), journal: info };
      return { ...out, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }, ...out.content.slice(1)] };
    } catch {
      return out;
    }
  };
}

function chercher(dir: string, id: string): EvenementRecherche | null {
  const enMemoire = memoire.get(id);
  if (enMemoire) return enMemoire;
  const f = join(dir, FICHIER_EVENEMENTS);
  if (!existsSync(f)) return null;
  for (const ligne of readFileSync(f, 'utf8').split('\n')) {
    if (!ligne.includes(id)) continue;
    try {
      const e = JSON.parse(ligne) as EvenementRecherche;
      if (e.id === id) return e;
    } catch {
      /* ligne illisible ignoree */
    }
  }
  return null;
}

export interface ResultatLien {
  ok: boolean;
  error?: string;
  paire?: { id: string; lien: 'manuel'; echecId: string; succesId: string; ecartSecondes: number };
}

/** Lien manuel confirme : par defaut, dernier echec et dernier succes de ce processus. */
export function lierManuellement(opts: { echecId?: string; succesId?: string; note?: string }): ResultatLien {
  const dir = dossierJournal();
  if (!dir) return { ok: false, error: `journal desactive (${JOURNAL_ENV} absent) : rien ecrit` };
  try {
    const echec = opts.echecId ? chercher(dir, opts.echecId) : dernierEchec;
    const succes = opts.succesId ? chercher(dir, opts.succesId) : dernierSucces;
    if (!echec) return { ok: false, error: opts.echecId ? `evenement introuvable : ${opts.echecId}` : 'aucune recherche ratee dans cette session' };
    if (!succes) return { ok: false, error: opts.succesId ? `evenement introuvable : ${opts.succesId}` : 'aucune recherche reussie dans cette session' };
    if (echec.statut !== 'echec' && echec.statut !== 'clarification') {
      return { ok: false, error: `${echec.id} n'est pas une recherche ratee (statut ${echec.statut})` };
    }
    if (succes.statut !== 'succes') return { ok: false, error: `${succes.id} n'est pas une recherche reussie (statut ${succes.statut})` };
    if (Date.parse(succes.ts) < Date.parse(echec.ts)) return { ok: false, error: 'le succes precede l echec : lien refuse' };
    const paire = construirePaire(echec, succes, 'manuel', opts.note?.slice(0, 500));
    ajouter(dir, FICHIER_PAIRES, paire);
    return { ok: true, paire: { id: paire.id, lien: 'manuel', echecId: echec.id, succesId: succes.id, ecartSecondes: paire.ecartSecondes } };
  } catch (e) {
    return { ok: false, error: `journal indisponible (${e instanceof Error ? e.message : String(e)})` };
  }
}
