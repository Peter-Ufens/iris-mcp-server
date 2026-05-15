import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

interface GeocodingResult {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  timezone: string;
  country_code: string;
}

interface GeocodingResponse {
  results?: GeocodingResult[];
}

export const tool: IrisTool = {
  id: 'geocoding-v1',
  description:
    'Convertit un nom de ville en coordonnees GPS (latitude, longitude, fuseau horaire). Open-Meteo Geocoding, gratuit, sans cle API.',
  category: 'cloud',
  inputSchema: {
    city: z.string().describe('Nom de la ville (ex: Paris, Haguenau)'),
    language: z
      .string()
      .optional()
      .default('fr')
      .describe('Langue des resultats (ex: fr, en)'),
  },
  execute: async (input) => {
    const city = input.city as string;
    const language = (input.language as string | undefined) ?? 'fr';
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=${encodeURIComponent(language)}&format=json`;
    try {
      const data = await fetchJson<GeocodingResponse>(url);
      const first = data.results?.[0];
      if (!first) {
        return errorResult(`Ville introuvable : ${city}`);
      }
      return jsonResult({
        city: first.name,
        latitude: first.latitude,
        longitude: first.longitude,
        country: first.country,
        timezone: first.timezone,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
