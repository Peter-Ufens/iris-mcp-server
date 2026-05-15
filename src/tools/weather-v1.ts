import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  current: {
    time: string;
    temperature_2m: number;
    wind_speed_10m: number;
    weather_code: number;
  };
}

export const tool: IrisTool = {
  id: 'weather-v1',
  description:
    'Retourne la meteo actuelle pour une ville (temperature, vent, code meteo). Open-Meteo, gratuit, sans cle API.',
  category: 'cloud',
  inputSchema: {
    latitude: z.number().describe('Latitude de la ville (ex: 48.8566 pour Paris)'),
    longitude: z.number().describe('Longitude de la ville (ex: 2.3522 pour Paris)'),
    timezone: z
      .string()
      .optional()
      .default('Europe/Paris')
      .describe('Fuseau horaire (ex: Europe/Paris)'),
  },
  execute: async (input) => {
    const latitude = input.latitude as number;
    const longitude = input.longitude as number;
    const timezone = (input.timezone as string | undefined) ?? 'Europe/Paris';
    const tz = encodeURIComponent(timezone);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,weather_code&timezone=${tz}`;
    try {
      const data = await fetchJson<OpenMeteoResponse>(url);
      return jsonResult({
        latitude: data.latitude,
        longitude: data.longitude,
        timezone: data.timezone,
        current: data.current,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
