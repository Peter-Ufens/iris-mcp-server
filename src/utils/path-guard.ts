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

/** Lisibles malgre un nom proche : modeles sans valeur, cles SSH PUBLIQUES. */
const SECRET_NAME_ALLOWED: readonly RegExp[] = [
  /^\.env\.(example|sample|template|dist)$/i, // .env.example...
  /^id_[a-z0-9]+.*\.pub$/i, // id_rsa.pub, id_ed25519_github.pub
];

/**
 * S0 (Bob 14/11) : fichiers de secrets que fs-read-v1 ne lit jamais, meme sous
 * ALLOWED_ROOTS. Avant, un `.env` sous une racine large (ex. dossier des projets) etait
 * lu en entier : une agente (ou une page web piegee qui la pousse) pouvait recuperer
 * une cle d'ecriture. Comparaison sur le NOM du fichier, insensible a la casse.
 * S0-bis (review Gaby + Bob 14/11) : copies (.env~, .bak), cles SSH avec suffixe,
 * jetons d'outils, fichiers de comptes de service, etats Terraform.
 */
const SECRET_NAME_PATTERNS: readonly RegExp[] = [
  /^\.env$/i, // .env
  /^\.env[.~_-]/i, // .env.local, .env~, .env_backup, .env-prod
  /^\.envrc$/i, // direnv
  /\.env$/i, // prod.env, docker.env
  /\.env(~|\.(bak|old|orig|save|backup|prev|tmp|swp|copy))$/i, // prod.env.bak, docker.env.old
  /\.(pem|key|p12|pfx|ppk|kdbx|keystore|jks)$/i, // cles, certificats, coffres
  /\.(tfvars|tfstate)$/i, // Terraform : variables et etat (secrets d'infra)
  /\.(tfvars\.json|tfstate\.backup)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)([._-].*)?$/i, // cles SSH privees (+ id_rsa_old, id_ed25519_github)
  /^\.(git-credentials|netrc|npmrc|pypirc|pgpass|htpasswd|dockercfg)$/i, // jetons d'outils
  /^secrets?\.[a-z0-9]+$/i, // secrets.json, secret.yaml, secrets.h
  /^credentials(\.[a-z0-9]+)?$/i, // credentials, credentials.json
  /credentials?[^\\/]*\.(json|ya?ml|ini|txt|xml|csv)$/i, // gcp-credentials.json
  /^service[-_]?account[^\\/]*\.json$/i, // service-account.json
  /^client[-_]?secrets?[^\\/]*\.json$/i, // client_secret_123.json
  /^(api[-_]?keys?|(access[-_]?|auth[-_]?)?tokens?)\.(txt|env)$/i, // token.txt, api-key.txt
  /^(api[-_]?keys?|(access|auth)[-_]?tokens?)\.(json|ya?ml)$/i, // api-keys.json (pas tokens.json : design)
  /^(mcp\.json|claude_desktop_config\.json)$/i, // configs MCP (portent des cles)
];

/**
 * Dossiers dont fs-read-v1 ne lit aucun fichier : `.git` (config avec jeton possible),
 * dossiers de cles (.ssh, .aws, .gnupg...), et tout dossier nomme `secrets`.
 */
const SECRET_DIR_SEGMENTS: ReadonlySet<string> = new Set([
  '.git',
  '.ssh',
  '.aws',
  '.azure',
  '.gnupg',
  '.kube',
  '.docker',
  'secrets',
  'secret',
]);

function segments(p: string): string[] {
  return p.split(/[\\/]+/).filter((s) => s !== '');
}

/** Dernier segment d'un chemin, quel que soit le separateur (pur, testable sous Linux). */
function lastSegment(p: string): string {
  const parts = segments(p);
  return parts.length > 0 ? parts[parts.length - 1]! : '';
}

/** Vrai si le nom de fichier designe un secret (voir SECRET_NAME_PATTERNS). */
export function isSecretFileName(name: string): boolean {
  const n = lastSegment(name);
  if (n === '' || SECRET_NAME_ALLOWED.some((re) => re.test(n))) return false;
  return SECRET_NAME_PATTERNS.some((re) => re.test(n));
}

/** Nom du dossier de secrets traverse par le chemin (hors dernier segment), sinon null. */
export function secretDirectoryIn(p: string): string | null {
  const parts = segments(p);
  for (const s of parts.slice(0, -1)) {
    if (SECRET_DIR_SEGMENTS.has(s.toLowerCase())) return s;
  }
  return null;
}

/**
 * Refuse la lecture si l'un des chemins (demande ET resolu par realpath) est un fichier
 * de secrets ou passe par un dossier de secrets. Les deux sont testes : un lien
 * `notes.txt` vers `.env` est refuse aussi. Limite connue : un lien PHYSIQUE (hardlink)
 * au nom innocent n'est pas detectable par le nom (Iris ne sait pas en creer).
 */
export function assertNotSecretFile(...paths: string[]): void {
  const consigne =
    "Iris ne le lit jamais : ne pas chercher a contourner (copie, autre outil). Demander a l'utilisateur.";
  for (const p of paths) {
    if (isSecretFileName(p)) {
      throw new PathGuardError(
        `Acces refuse : "${lastSegment(p)}" est un fichier de secrets (cle, mot de passe, configuration). ${consigne}`,
      );
    }
    const dossier = secretDirectoryIn(p);
    if (dossier) {
      throw new PathGuardError(
        `Acces refuse : le dossier "${dossier}" contient des secrets (cles, jetons, configuration). ${consigne}`,
      );
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
