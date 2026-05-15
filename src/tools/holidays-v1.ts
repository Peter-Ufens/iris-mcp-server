import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

interface NagerHoliday {
  date: string;
  name: string;
  localName: string;
}

export const tool: IrisTool = {
  id: 'holidays-v1',
  description:
    'Retourne les jours feries pour un pays et une annee (date.nager.at, sans cle API).',
  category: 'cloud',
  inputSchema: {
    country_code: z
      .string()
      .length(2)
      .optional()
      .default('FR')
      .describe('Code pays ISO 3166-1 alpha-2 (ex: FR, DE, US)'),
    year: z.number().optional().describe('Annee (defaut : annee courante)'),
  },
  execute: async (input) => {
    const country_code = (
      (input.country_code as string | undefined) ?? 'FR'
    ).toUpperCase();
    const year = (input.year as number | undefined) ?? new Date().getFullYear();
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${country_code}`;
    try {
      const data = await fetchJson<NagerHoliday[]>(url);
      const holidays = data.map((h) => ({
        date: h.date,
        name: h.name,
        localName: h.localName,
      }));
      return jsonResult({
        country_code,
        year,
        count: holidays.length,
        holidays,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
