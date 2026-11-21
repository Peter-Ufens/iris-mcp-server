/**
 * Garde des fichiers d'etat sous test (review Bob 16/11, puis review Gaby 21/11).
 *
 * Bob a trouve 34 lignes de tests dans le vrai journal des moteurs (0044 : dossier par defaut interdit sous test).
 * Trou restant : un dossier CHOISI par variable (IRIS_JOURNAL_MOTEURS_DIR, IRIS_RAG_JOURNAL_DIR) restait accepte
 * sous test. Si la suite est lancee depuis un terminal qui porte la config MCP reelle, les tests ecrivent dans le
 * vrai journal (et le journal RAG garde le TEXTE des requetes). Regle : sous test, seul un dossier place dans le
 * dossier temporaire du systeme est permis.
 */
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

/** Vrai sous vitest, meme si un test passe son propre env ou vide VITEST (variables posees par worker). */
export function sousTest(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VITEST || process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.VITEST_POOL_ID);
}

/** Sous test : le dossier doit etre dans le dossier temporaire du systeme. Hors test : toujours vrai. */
export function dossierPermisSousTest(dossier: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!sousTest(env)) return true;
  try {
    const norm = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
    const tmp = norm(tmpdir());
    const d = norm(dossier);
    return d === tmp || d.startsWith(tmp.endsWith(sep) ? tmp : tmp + sep);
  } catch {
    return false;
  }
}