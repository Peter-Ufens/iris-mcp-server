import * as z from 'zod/v4';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { IrisTool } from './_types.js';
import { validatePath, PathGuardError } from '../utils/path-guard.js';

export const tool: IrisTool = {
  id: 'fs-list-v1',
  description:
    "Liste le contenu d'un repertoire dans les repertoires autorises (ALLOWED_ROOTS). Supporte un pattern glob simple optionnel.",
  category: 'filesystem',
  inputSchema: {
    path: z.string().describe('Chemin absolu du repertoire a lister'),
    pattern: z
      .string()
      .max(80)
      .optional()
      .describe('Pattern glob simple pour filtrer (ex: *.ts) · max 80 car. · max 10 *'),
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
        // F3 red team 14/10 : ReDoS via trop de `*` (ex. *a*a…*b).
        const starCount = (pattern.match(/\*/g) ?? []).length;
        if (starCount > 10 || pattern.length > 80) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error:
                    'Pattern trop complexe (max 80 caracteres, max 10 *). Simplifiez le filtre.',
                }),
              },
            ],
          };
        }
        const escaped = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        const regex = new RegExp(`^${escaped}$`);
        entries = entries.filter((e) => regex.test(e.name));
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
