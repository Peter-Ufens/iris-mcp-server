import * as z from 'zod/v4';
import { readFile, stat } from 'node:fs/promises';
import type { IrisTool } from './_types.js';
import { validatePath, PathGuardError } from '../utils/path-guard.js';

const DEFAULT_MAX_CHARS = 200_000;
const HARD_MAX_CHARS = 200_000;

export const tool: IrisTool = {
  id: 'fs-read-v1',
  description:
    "Lit le contenu d'un fichier dans les repertoires autorises (ALLOWED_ROOTS). Securise contre le path traversal et les symlinks sortants. Plafond de caracteres (comme fetch-url).",
  category: 'filesystem',
  inputSchema: {
    path: z.string().describe('Chemin absolu du fichier a lire'),
    max_chars: z
      .number()
      .int()
      .min(200)
      .max(HARD_MAX_CHARS)
      .optional()
      .describe(`Plafond de caracteres (defaut ${DEFAULT_MAX_CHARS}, max ${HARD_MAX_CHARS})`),
  },
  execute: async (input) => {
    const inputPath = input.path as string;
    const maxChars = (input.max_chars as number | undefined) ?? DEFAULT_MAX_CHARS;
    try {
      const safePath = await validatePath(inputPath);
      const [raw, stats] = await Promise.all([
        readFile(safePath, 'utf-8'),
        stat(safePath),
      ]);
      const truncated = raw.length > maxChars;
      const content = truncated ? raw.slice(0, maxChars) : raw;
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                content,
                size_bytes: stats.size,
                encoding: 'utf-8',
                truncated,
                max_chars: maxChars,
              },
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
