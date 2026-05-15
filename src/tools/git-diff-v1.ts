import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { validateRepoPath, PathGuardError } from '../utils/git-guard.js';
import { runGit, jsonResult, errorResult } from '../utils/git-run.js';

const MAX_DIFF_CHARS = 8000;

function truncateDiff(diff: string): { diff: string; truncated: boolean } {
  if (diff.length <= MAX_DIFF_CHARS) {
    return { diff, truncated: false };
  }
  return {
    diff:
      diff.slice(0, MAX_DIFF_CHARS) +
      '\n\n[diff tronquee apres 8000 chars]',
    truncated: true,
  };
}

export const tool: IrisTool = {
  id: 'git-diff-v1',
  description:
    "Retourne la diff Git d un repo local. Mode staged, unstaged ou head (tout vs HEAD).",
  category: 'git',
  inputSchema: {
    repo_path: z.string().describe('Chemin absolu vers le repo Git local'),
    mode: z
      .enum(['staged', 'unstaged', 'head'])
      .optional()
      .default('unstaged')
      .describe('Type de diff a retourner'),
  },
  execute: async (input) => {
    const repoPath = input.repo_path as string;
    const mode = (input.mode as 'staged' | 'unstaged' | 'head' | undefined) ?? 'unstaged';
    try {
      const safePath = await validateRepoPath(repoPath);
      const args =
        mode === 'staged'
          ? ['diff', '--staged']
          : mode === 'head'
            ? ['diff', 'HEAD']
            : ['diff'];
      const raw = runGit(safePath, args);
      const { diff, truncated } = truncateDiff(raw);
      return jsonResult({ repo_path: safePath, mode, diff, truncated });
    } catch (e) {
      if (e instanceof PathGuardError) {
        return errorResult(e.message);
      }
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
