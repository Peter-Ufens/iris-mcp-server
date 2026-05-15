import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

interface WorldTimeResponse {
  timezone: string;
  datetime: string;
  utc_offset: string;
  day_of_week: number;
  week_number: number;
}

export const tool: IrisTool = {
  id: 'time-v1',
  description:
    "Retourne l'heure courante pour un fuseau horaire donne (WorldTimeAPI, sans cle API).",
  category: 'cloud',
  inputSchema: {
    timezone: z
      .string()
      .optional()
      .default('Europe/Paris')
      .describe('Fuseau horaire IANA (ex: Europe/Paris, America/New_York)'),
  },
  execute: async (input) => {
    const timezone = (input.timezone as string | undefined) ?? 'Europe/Paris';
    const url = `http://worldtimeapi.org/api/timezone/${encodeURIComponent(timezone)}`;
    try {
      const data = await fetchJson<WorldTimeResponse>(url);
      return jsonResult({
        timezone: data.timezone,
        datetime: data.datetime,
        utc_offset: data.utc_offset,
        day_of_week: data.day_of_week,
        week_number: data.week_number,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
