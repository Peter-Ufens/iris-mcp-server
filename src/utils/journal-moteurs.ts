/**
 * Journal des echecs des moteurs locaux (ADR-0014 §4, lot O). Sert a comprendre pourquoi un appel a Ollama ou au
 * moteur de secours a echoue, sans jamais garder de secret.
 *
 * Ce qui entre dans le journal, et RIEN d'autre (liste fermee, tout est borne ou pris dans une liste fixe) :
 * date, outil (liste fixe), etape (liste fixe), tentative (1 a 9), duree en ms, cause (code fixe), moteur (liste fixe),
 * code HTTP (100 a 599). JAMAIS : texte de la question, du prompt ou d'une note, chemin, URL, hote, cle, message d'erreur brut.
 *
 * Emplacement : IRIS_JOURNAL_MOTEURS_DIR (chemin local absolu, jamais UNC), sinon le dossier d'etat de l'utilisateur
 * (%LOCALAPPDATA%\iris-mcp, ou ~/.local/state/iris-mcp). Hors depot Git, hors vault. Desactive sous vitest sauf si la
 * variable est posee, et par IRIS_JOURNAL_MOTEURS=0. 1 Mo au plus, puis rotation vers `.1`. Ne leve jamais d'erreur.
 */
import { appendFileSync, existsSync, lstatSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { estCheminLocalAbsolu } from './chemin-local.js';
import { dossierPermisSousTest, sousTest } from './garde-test.js';

export const JOURNAL_MAX_OCTETS = 1_048_576;
export const JOURNAL_FICHIER = 'journal-moteurs.jsonl';

export const ETAPES_JOURNAL = ['ollama', 'secours-sante', 'secours-appel', 'reference', 'chat', 'liste'] as const;
export const CAUSES_JOURNAL = [
  'refuse',
  'delai',
  'http',
  'reponse_invalide',
  'dimension',
  'reference_fausse',
  'pas_de_reference',
  'base_refusee',
  'cache_ko',
  'charge_en_cours',
  'pause',
  'file_pleine',
  'trop_gros',
  'inconnu',
] as const;
export const MOTEURS_JOURNAL = ['ollama', 'hermes-llamacpp'] as const;
export const OUTILS_JOURNAL = ['embeddings', 'rag-query-v1', 'rag-search-v2', 'rag-hybrid-v1', 'ollama-chat-v1', 'ollama-list-v1'] as const;

export type EtapeJournal = (typeof ETAPES_JOURNAL)[number];
export type CauseJournal = (typeof CAUSES_JOURNAL)[number];
export type MoteurJournal = (typeof MOTEURS_JOURNAL)[number];
export type OutilJournal = (typeof OUTILS_JOURNAL)[number];

export interface EvenementJournal {
  outil: OutilJournal;
  etape: EtapeJournal;
  cause: CauseJournal;
  moteur?: MoteurJournal;
  tentative?: number;
  duree_ms?: number;
  http?: number;
}

/**
 * Sous test, le dossier par defaut (celui de l'utilisateur) est interdit. On regarde l'env passe ET le vrai
 * process.env, et les variables que vitest pose dans chaque worker : un test qui passe son propre env, ou qui
 * vide VITEST, ne doit jamais ecrire dans le vrai journal (review Bob 16/11 : 34 lignes de tests y etaient).
 */
// sousTest() vit maintenant dans garde-test.ts (partage avec le journal RAG).

export function dossierJournal(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.IRIS_JOURNAL_MOTEURS === '0') return null;
  const choisi = env.IRIS_JOURNAL_MOTEURS_DIR?.trim();
  // Review Gaby 21/11 : sous test, un dossier choisi doit etre dans le dossier temporaire (jamais le vrai journal).
  if (choisi) return estCheminLocalAbsolu(choisi) && dossierPermisSousTest(choisi, env) ? choisi : null;
  if (sousTest(env)) return null;
  try {
    if (process.platform === 'win32') {
      const local = env.LOCALAPPDATA?.trim();
      return local && estCheminLocalAbsolu(local) ? join(local, 'iris-mcp') : join(homedir(), 'AppData', 'Local', 'iris-mcp');
    }
    const etat = env.XDG_STATE_HOME?.trim();
    return etat && estCheminLocalAbsolu(etat) ? join(etat, 'iris-mcp') : join(homedir(), '.local', 'state', 'iris-mcp');
  } catch {
    return null;
  }
}

const dans = <T extends string>(liste: readonly T[], v: unknown, defaut: T): T => (liste.includes(v as T) ? (v as T) : defaut);
const entier = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : undefined;

/** Ligne propre a partir d'un evenement : tout ce qui n'est pas dans une liste fixe est remplace ou retire. */
export function ligneJournal(e: EvenementJournal, maintenant: Date = new Date()): string {
  const ligne: Record<string, unknown> = {
    date: maintenant.toISOString(),
    outil: dans(OUTILS_JOURNAL, e.outil, 'embeddings'),
    etape: dans(ETAPES_JOURNAL, e.etape, 'ollama'),
    cause: dans(CAUSES_JOURNAL, e.cause, 'inconnu'),
  };
  if (e.moteur !== undefined) ligne.moteur = dans(MOTEURS_JOURNAL, e.moteur, 'ollama');
  const tentative = entier(e.tentative, 1, 9);
  if (tentative !== undefined) ligne.tentative = tentative;
  const duree = entier(e.duree_ms, 0, 86_400_000);
  if (duree !== undefined) ligne.duree_ms = duree;
  const http = entier(e.http, 100, 599);
  if (http !== undefined) ligne.http = http;
  return JSON.stringify(ligne);
}

/** Ajoute un evenement au journal. Ne leve jamais : un journal en panne ne doit pas casser un outil. */
export function journaliser(e: EvenementJournal, env: NodeJS.ProcessEnv = process.env): void {
  try {
    const dir = dossierJournal(env);
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    const fichier = join(dir, JOURNAL_FICHIER);
    if (existsSync(fichier)) {
      const info = lstatSync(fichier);
      if (!info.isFile()) return; // lien symbolique ou dossier : refuse
      if (info.size >= JOURNAL_MAX_OCTETS) {
        const ancien = `${fichier}.1`;
        if (existsSync(ancien) && !lstatSync(ancien).isFile()) return;
        renameSync(fichier, ancien);
      }
    }
    appendFileSync(fichier, ligneJournal(e) + '\n', { encoding: 'utf-8', mode: 0o600 });
  } catch {
    /* journal best effort */
  }
}