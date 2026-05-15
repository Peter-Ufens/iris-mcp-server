import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

interface SunriseResponse {
  status: string;
  results?: {
    sunrise: string;
    sunset: string;
    solar_noon: string;
    day_length: number;
  };
}

function formatDayLength(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export const tool: IrisTool = {
  id: 'sunrise-v1',
  description:
    'Retourne les heures de lever et coucher du soleil pour des coordonnees GPS et une date donnee. sunrise-sunset.org, gratuit, sans cle API.',
  category: 'cloud',
  inputSchema: {
    latitude: z.number().describe('Latitude GPS'),
    longitude: z.number().describe('Longitude GPS'),
    date: z
      .string()
      .optional()
      .default('today')
      .describe('Date YYYY-MM-DD ou "today"'),
  },
  execute: async (input) => {
    const latitude = input.latitude as number;
    const longitude = input.longitude as number;
    const date = (input.date as string | undefined) ?? 'today';
    const url = `https://api.sunrise-sunset.org/json?lat=${latitude}&lng=${longitude}&date=${encodeURIComponent(date)}&formatted=0`;
    try {
      const data = await fetchJson<SunriseResponse>(url);
      if (data.status !== 'OK' || !data.results) {
        return errorResult(`sunrise-sunset.org : ${data.status}`);
      }
      const r = data.results;
      return jsonResult({
        date,
        sunrise: r.sunrise,
        sunset: r.sunset,
        solar_noon: r.solar_noon,
        day_length: formatDayLength(r.day_length),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
