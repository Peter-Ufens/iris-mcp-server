import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

interface ErApiResponse {
  result: string;
  base_code: string;
  time_last_update_utc?: string;
  rates: Record<string, number>;
}

export const tool: IrisTool = {
  id: 'exchange-rates-v1',
  description:
    'Retourne les taux de change pour une devise de base (open.er-api.com, sans cle API).',
  category: 'cloud',
  inputSchema: {
    base: z
      .string()
      .optional()
      .default('EUR')
      .describe('Devise de base (ex: EUR, USD, GBP)'),
    targets: z
      .array(z.string())
      .optional()
      .describe('Devises cibles (ex: ["USD","GBP"]). Si absent, retourne toutes.'),
  },
  execute: async (input) => {
    const base = ((input.base as string | undefined) ?? 'EUR').toUpperCase();
    const targets = input.targets as string[] | undefined;
    const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;
    try {
      const data = await fetchJson<ErApiResponse>(url);
      if (data.result !== 'success') {
        return errorResult('Echec open.er-api.com');
      }
      let rates = data.rates;
      if (targets && targets.length > 0) {
        const filtered: Record<string, number> = {};
        for (const t of targets) {
          const key = t.toUpperCase();
          if (rates[key] !== undefined) filtered[key] = rates[key]!;
        }
        rates = filtered;
      }
      return jsonResult({
        base: data.base_code,
        date: data.time_last_update_utc ?? null,
        rates,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
