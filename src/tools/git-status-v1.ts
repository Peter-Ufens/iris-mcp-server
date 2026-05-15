import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { validateRepoPath, PathGuardError } from '../utils/git-guard.js';
import { runGit, jsonResult, errorResult } from '../utils/git-run.js';

interface ParsedStatus {
  branch: string | null;
  head_oid: string | null;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

function parsePorcelainV2(raw: string): ParsedStatus {
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  let branch: string | null = null;
  let head_oid: string | null = null;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length).trim() || null;
    }
    if (line.startsWith('# branch.oid ')) {
      head_oid = line.slice('# branch.oid '.length).trim() || null;
    }
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ');
      const xy = parts[1] ?? '';
      const path = parts.slice(8).join(' ');
      if (xy[0] && xy[0] !== ' ') staged.push(path);
      if (xy[1] && xy[1] !== ' ') unstaged.push(path);
    }
    if (line.startsWith('? ')) {
      untracked.push(line.slice(2).trim());
    }
  }

  return { branch, head_oid, staged, unstaged, untracked };
}

export const tool: IrisTool = {
  id: 'git-status-v1',
  description:
    'Retourne le statut Git d un repo local (staged, unstaged, untracked, branche courante).',
  category: 'git',
  inputSchema: {
    repo_path: z.string().describe('Chemin absolu vers le repo Git local'),
  },
  execute: async (input) => {
    const repoPath = input.repo_path as string;
    try {
      const safePath = await validateRepoPath(repoPath);
      const raw = runGit(safePath, ['status', '--porcelain=v2', '--branch']);
      const parsed = parsePorcelainV2(raw);
      return jsonResult({ repo_path: safePath, raw, parsed });
    } catch (e) {
      if (e instanceof PathGuardError) {
        return errorResult(e.message);
      }
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
