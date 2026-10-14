import * as z from 'zod/v4';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { IrisTool } from './_types.js';
import { validatePath, PathGuardError } from '../utils/path-guard.js';
import { matchSimpleGlob } from '../utils/simple-glob.js';

/** R1 Bob 14/10 : 10 * gelait encore ; seuil sûr = 4 (+ glob sans regex). */
const MAX_GLOB_STARS = 4;
const MAX_GLOB_LEN = 80;

export const tool: IrisTool = {
  id: 'fs-list-v1',
  description:
    "Liste le contenu d'un repertoire dans les repertoires autorises (ALLOWED_ROOTS). Supporte un pattern glob simple optionnel.",
  category: 'filesystem',
  inputSchema: {
    path: z.string().describe('Chemin absolu du repertoire a lister'),
    pattern: z
      .string()
      .max(MAX_GLOB_LEN)
      .optional()
      .describe(
        `Pattern glob simple pour filtrer (ex: *.ts) · max ${MAX_GLOB_LEN} car. · max ${MAX_GLOB_STARS} *`,
      ),
  },
  execute: async (input) => {
    const inputPath = input.path as string;
    const pattern = input.pattern as string | undefined;

    try {
      const safePath = await validatePath(inputPath);
      const dirEntries = await readdir(safePath, { withFileTypes: true });

      let entries = await Promise.all(
        dirEntries.map(async (entry) => {
          const fullPath = join(safePath, entry.name);
          const type = entry.isDirectory() ? ('dir' as const) : ('file' as const);
          let size_bytes = 0;
          if (type === 'file') {
            try {
              const s = await stat(fullPath);
              size_bytes = s.size;
            } catch {
              /* stat peut echouer sur certains fichiers speciaux */
            }
          }
          return { name: entry.name, type, size_bytes };
        }),
      );

      if (pattern) {
        // R1 : borne stricte + matchSimpleGlob (pas de ReDoS regex).
        const starCount = (pattern.match(/\*/g) ?? []).length;
        if (starCount > MAX_GLOB_STARS || pattern.length > MAX_GLOB_LEN) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Pattern trop complexe (max ${MAX_GLOB_LEN} caracteres, max ${MAX_GLOB_STARS} *). Simplifiez le filtre.`,
                }),
              },
            ],
          };
        }
        entries = entries.filter((e) => matchSimpleGlob(e.name, pattern));
      }

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ entries }, null, 2) },
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
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Listage impossible : ${msg}` }, null, 2) }],
      };
    }
  },
};
