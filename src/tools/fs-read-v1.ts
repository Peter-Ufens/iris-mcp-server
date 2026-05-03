import * as z from 'zod/v4';
import { readFile, stat } from 'node:fs/promises';
import type { IrisTool } from './_types.js';
import { validatePath, PathGuardError } from '../utils/path-guard.js';

export const tool: IrisTool = {
  id: 'fs-read-v1',
  description:
    "Lit le contenu d'un fichier dans les repertoires autorises (ALLOWED_ROOTS). Securise contre le path traversal et les symlinks sortants.",
  category: 'filesystem',
  inputSchema: {
    path: z.string().describe('Chemin absolu du fichier a lire'),
  },
  execute: async (input) => {
    const inputPath = input.path as string;
    try {
      const safePath = await validatePath(inputPath);
      const [content, stats] = await Promise.all([
        readFile(safePath, 'utf-8'),
        stat(safePath),
      ]);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { content, size_bytes: stats.size, encoding: 'utf-8' },
              null,
              2,
            ),
          },
        ],
      };
    } catch (e) {
      if (e instanceof PathGuardError) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }, null, 2) }],
        };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Lecture impossible : ${msg}` }, null, 2) }],
      };
    }
  },
};
