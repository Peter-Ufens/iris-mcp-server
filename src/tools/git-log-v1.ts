import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { validateRepoPath, PathGuardError } from '../utils/git-guard.js';
import { runGit, jsonResult, errorResult } from '../utils/git-run.js';

export const tool: IrisTool = {
  id: 'git-log-v1',
  description:
    'Retourne les N derniers commits d un repo Git local (hash court, auteur, date, message).',
  category: 'git',
  inputSchema: {
    repo_path: z.string().describe('Chemin absolu vers le repo Git local'),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Nombre de commits a retourner (defaut: 10, max: 50)'),
  },
  execute: async (input) => {
    const repoPath = input.repo_path as string;
    const requested = (input.limit as number | undefined) ?? 10;
    const limit = Math.min(Math.max(1, requested), 50);
    try {
      const safePath = await validateRepoPath(repoPath);
      const raw = runGit(safePath, [
        'log',
        `--pretty=format:%h|%an|%ai|%s`,
        `-${limit}`,
      ]);
      const commits = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [hash, author, date, ...rest] = line.split('|');
          return {
            hash: hash ?? '',
            author: author ?? '',
            date: date ?? '',
            message: rest.join('|'),
          };
        });
      return jsonResult({ repo_path: safePath, limit, commits });
    } catch (e) {
      if (e instanceof PathGuardError) {
        return errorResult(e.message);
      }
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
