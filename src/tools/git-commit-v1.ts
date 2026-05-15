import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { validateRepoPath, PathGuardError } from '../utils/git-guard.js';
import { runGit, GitCommandError, jsonResult, errorResult } from '../utils/git-run.js';

export const tool: IrisTool = {
  id: 'git-commit-v1',
  description:
    'Cree un commit Git dans un repo local avec le message fourni. Commit uniquement les fichiers deja stages (pas de git add implicite).',
  category: 'git',
  inputSchema: {
    repo_path: z.string().describe('Chemin absolu vers le repo Git local'),
    message: z
      .string()
      .min(5)
      .describe('Message de commit (minimum 5 caracteres)'),
  },
  execute: async (input) => {
    const repoPath = input.repo_path as string;
    const message = input.message as string;
    try {
      const safePath = await validateRepoPath(repoPath);
      const staged = runGit(safePath, ['diff', '--staged', '--name-only']).trim();
      if (!staged) {
        return errorResult(
          'Rien a committer. Utilisez git-status-v1 pour verifier l etat du repo.',
        );
      }
      try {
        const output = runGit(safePath, ['commit', '-m', message]);
        const hash = runGit(safePath, ['rev-parse', '--short', 'HEAD']).trim();
        return jsonResult({
          repo_path: safePath,
          commit_hash: hash,
          output: output.trim(),
        });
      } catch (e) {
        if (e instanceof GitCommandError) {
          const combined = `${e.stdout}\n${e.stderr}`.toLowerCase();
          if (combined.includes('nothing to commit')) {
            return errorResult(
              'Rien a committer. Utilisez git-status-v1 pour verifier l etat du repo.',
            );
          }
          return errorResult(e.message);
        }
        throw e;
      }
    } catch (e) {
      if (e instanceof PathGuardError) {
        return errorResult(e.message);
      }
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
