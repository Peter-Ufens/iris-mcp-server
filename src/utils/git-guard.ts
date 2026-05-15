import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePath, PathGuardError } from './path-guard.js';

export { PathGuardError };

/**
 * Valide repo_path sous ALLOWED_ROOTS et verifie la presence de .git.
 */
export async function validateRepoPath(repoPath: string): Promise<string> {
  const safePath = await validatePath(repoPath);
  try {
    await access(join(safePath, '.git'));
  } catch {
    throw new PathGuardError(
      `"${repoPath}" n'est pas un depot Git valide (dossier .git introuvable).`,
    );
  }
  return safePath;
}
