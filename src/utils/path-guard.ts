import { resolve, normalize, dirname, basename, join, win32, posix } from 'node:path';
import { realpath } from 'node:fs/promises';
import { loadEnv } from './env.js';

export class PathGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathGuardError';
  }
}

/**
 * Resout le vrai chemin (realpath) du plus long prefixe existant, puis rejoint les
 * segments encore inexistants. Couvre le cas d'un parent symlink / jonction meme quand
 * la feuille n'existe pas encore (faille F1b Gaby 22/10 : sinon le chemin logique passait
 * et un TOCTOU create-after-check pouvait fuiter).
 */
async function realpathLongestPrefix(inputPath: string): Promise<string> {
  let current = resolve(inputPath);
  const tail: string[] = []; // segments inexistants, de la feuille vers la racine
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length > 0 ? join(real, ...tail.slice().reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        // Rien n'existe (meme pas le lecteur) : on garde le chemin logique.
        return resolve(inputPath);
      }
      tail.push(basename(current));
      current = parent;
    }
  }
}

/** Forme canonique d'une racine : realpath si elle existe, sinon resolve. */
async function canonicalRoot(root: string): Promise<string> {
  try {
    return normalize(await realpath(resolve(root)));
  } catch {
    return normalize(resolve(root));
  }
}

/** Noms de peripheriques Windows (CON, NUL, COM1...) : jamais des fichiers normaux. */
const WIN_DEVICE_NAMES = /^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$)(\..*)?$/i;

/**
 * Dette D4 : formes de chemin Windows refusees avant toute resolution.
 * - UNC `\\serveur\partage` et `//serveur/partage` (aussi via realpath d'une jonction) ;
 * - chemins peripherique `\\?\` et `\\.\` (contournent la normalisation Win32) ;
 * - flux alternatifs NTFS `fichier:flux` et chemins relatifs a un lecteur `C:fichier` ;
 * - noms reserves (CON, NUL, COM1...) et segments finissant par un point ou un espace
 *   (Windows les retire en silence : `secret.` = `secret`).
 * Fonction pure, testable sous Linux.
 */
export function assertWindowsPathSyntax(inputPath: string): void {
  const p = inputPath;
  if (/^[\\/]{2}/.test(p)) {
    throw new PathGuardError(
      `Acces refuse : "${inputPath}" chemin UNC ou peripherique (\\\\serveur, \\\\?\\, \\\\.\\) non autorise.`,
    );
  }
  // Seul un ':' en position 1 apres une lettre de lecteur, suivi d'un separateur, est admis.
  const sansLecteur = /^[A-Za-z]:[\\/]/.test(p) ? p.slice(2) : p;
  if (sansLecteur.includes(':')) {
    throw new PathGuardError(
      `Acces refuse : "${inputPath}" contient ':' (flux alternatif NTFS ou chemin relatif a un lecteur).`,
    );
  }
  for (const seg of sansLecteur.split(/[\\/]+/)) {
    if (seg === '' || seg === '.' || seg === '..') continue;
    if (/[. ]$/.test(seg)) {
      throw new PathGuardError(
        `Acces refuse : "${inputPath}" segment "${seg}" termine par un point ou un espace (ambigu sous Windows).`,
      );
    }
    if (WIN_DEVICE_NAMES.test(seg)) {
      throw new PathGuardError(`Acces refuse : "${inputPath}" nom de peripherique Windows reserve.`);
    }
  }
}

/**
 * Comparaison chemin / racine. Sous Windows (`win32Mode`) : insensible a la casse et
 * aux separateurs (C:\Data == c:/data), car NTFS l'est par defaut.
 */
export function isPathUnderRoot(path: string, root: string, win32Mode = process.platform === 'win32'): boolean {
  if (win32Mode) {
    const norm = (x: string) => win32.normalize(x).replace(/[\\]+$/, '').toLowerCase();
    const p = norm(path);
    const r = norm(root);
    // Racine de lecteur `c:` : tout le lecteur.
    return p === r || p.startsWith(r + '\\');
  }
  // Mode posix : separateur '/' quelle que soit la plateforme (smoke Windows 22/10 :
  // `sep` valait la barre inverse sous Windows et faussait le mode posix explicite).
  return path === root || path.startsWith(root + posix.sep);
}

/**
 * Valide qu'un chemin est sous l'un des ALLOWED_ROOTS.
 * Refuse les symlinks / jonctions qui sortent des roots (y compris dossier intermediaire,
 * et meme si la feuille n'existe pas encore) et les path traversal. Les racines elles-memes
 * sont resolues par realpath, donc une racine qui est une jonction reste autorisee.
 *
 * @param inputPath  Chemin brut de l'utilisateur
 * @param allowedRoots  Racines autorisees (defaut: ALLOWED_ROOTS env var)
 * @returns Le chemin reel resolu (apres realpath)
 * @throws PathGuardError si le chemin est interdit
 */
export async function validatePath(
  inputPath: string,
  allowedRoots?: string[],
): Promise<string> {
  const roots = allowedRoots ?? loadEnv().allowedRoots;

  if (roots.length === 0) {
    throw new PathGuardError(
      "ALLOWED_ROOTS non configure. Definir la variable d'environnement ALLOWED_ROOTS.",
    );
  }

  if (process.platform === 'win32') {
    assertWindowsPathSyntax(inputPath);
  }

  // realpath du plus long prefixe existant : couvre symlink / jonction sur un dossier
  // intermediaire (F1 Gaby), que la feuille existe ou non (F1b).
  const normalizedPath = normalize(await realpathLongestPrefix(inputPath));

  const normalizedRoots = await Promise.all(roots.map((r) => canonicalRoot(r)));

  // Sous Windows, realpath (natif, GetFinalPathNameByHandle) developpe aussi les noms
  // courts 8.3 (PROGRA~1) des deux cotes ; la comparaison est insensible a la casse (D4).
  const isAllowed = normalizedRoots.some((normalizedRoot) =>
    isPathUnderRoot(normalizedPath, normalizedRoot),
  );

  if (!isAllowed) {
    throw new PathGuardError(
      `Acces refuse : "${inputPath}" est hors des repertoires autorises (ALLOWED_ROOTS).`,
    );
  }

  return normalizedPath;
}
