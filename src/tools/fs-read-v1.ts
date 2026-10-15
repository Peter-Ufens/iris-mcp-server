import * as z from 'zod/v4';
import { open, stat } from 'node:fs/promises';
import type { IrisTool } from './_types.js';
import { validatePath, PathGuardError } from '../utils/path-guard.js';

const DEFAULT_MAX_CHARS = 200_000;
const HARD_MAX_CHARS = 200_000;

/**
 * R4 Bob : ne pas charger tout le fichier en RAM.
 * Lit assez d'octets pour decoder jusqu'a max_chars (+1 pour detecter la coupe).
 */
async function readUtf8Capped(
  path: string,
  maxChars: number,
): Promise<{ content: string; truncated: boolean; size_bytes: number }> {
  const stats = await stat(path);
  const byteBudget = Math.min(stats.size, (maxChars + 1) * 4);
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(byteBudget);
    const { bytesRead } = await fh.read(buf, 0, byteBudget, 0);
    const slice = buf.subarray(0, bytesRead);
    // Karen redteam 15/10 scenario 050 : refuser le binaire (NUL dans les premiers octets)
    const probe = slice.subarray(0, Math.min(512, slice.length));
    if (probe.includes(0)) {
      throw new PathGuardError(
        `Fichier binaire refuse (octet NUL detecte). fs-read-v1 lit du texte UTF-8 seulement.`,
      );
    }
    let content = slice.toString('utf-8');
    const truncatedByChars = content.length > maxChars;
    if (truncatedByChars) {
      content = content.slice(0, maxChars);
    }
    const truncated = truncatedByChars || stats.size > bytesRead;
    return { content, truncated, size_bytes: stats.size };
  } finally {
    await fh.close();
  }
}

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
      const { content, truncated, size_bytes } = await readUtf8Capped(safePath, maxChars);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                content,
                size_bytes,
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
