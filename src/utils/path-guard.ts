import { resolve, normalize, sep } from 'node:path';
import { realpath, lstat } from 'node:fs/promises';
import { loadEnv } from './env.js';

export class PathGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathGuardError';
  }
}

/**
 * Valide qu'un chemin est sous l'un des ALLOWED_ROOTS.
 * Refuse les symlinks qui sortent des roots et les path traversal.
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

  const resolved = resolve(inputPath);

  // Resolve symlinks — si le fichier existe
  let realResolved: string;
  try {
    const stats = await lstat(resolved);
    if (stats.isSymbolicLink()) {
      realResolved = await realpath(resolved);
    } else {
      realResolved = resolved;
    }
  } catch {
    // Le fichier n'existe pas encore : on valide le chemin tel quel
    realResolved = resolved;
  }

  const normalizedPath = normalize(realResolved);

  const isAllowed = roots.some((root) => {
    const normalizedRoot = normalize(resolve(root));
    return (
      normalizedPath === normalizedRoot ||
      normalizedPath.startsWith(normalizedRoot + sep)
    );
  });

  if (!isAllowed) {
    throw new PathGuardError(
      `Acces refuse : "${inputPath}" est hors des repertoires autorises (ALLOWED_ROOTS).`,
    );
  }

  return normalizedPath;
}
