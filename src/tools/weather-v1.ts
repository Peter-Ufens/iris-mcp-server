import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';
import { retirerInvisibles } from '../utils/texte-invisible.js';

/** Sortie en liste blanche : nombres finis ou texte court, sans invisibles (review Gaby 16/11). */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function court(v: unknown, max = 40): string {
  if (typeof v !== 'string') return '';
  return retirerInvisibles(v).replace(/[\x00-\x1F\x7F]/g, '').slice(0, max);
}
function pickCurrent(c: unknown) {
  if (!c || typeof c !== 'object') return undefined;
  const o = c as Record<string, unknown>;
  return {
    time: court(o.time),
    interval: num(o.interval),
    temperature_2m: num(o.temperature_2m),
    apparent_temperature: num(o.apparent_temperature),
    wind_speed_10m: num(o.wind_speed_10m),
    weather_code: num(o.weather_code),
  };
}

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature?: number;
    wind_speed_10m: number;
    weather_code: number;
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    apparent_temperature?: number[];
    precipitation_probability?: (number | null)[];
    weather_code?: number[];
  };
}

export const tool: IrisTool = {
  id: 'weather-v1',
  description:
    'Meteo (Open-Meteo) : actuelle, et optionnellement horaire (forecast_hours 1..48). ' +
    'Entree = latitude, longitude ET fuseau (sortie geocoding-v1 + country_code). ' +
    'Sans fuseau, Europe/Paris. Ne jamais enchainer depuis ip-info-v1.',
  category: 'cloud',
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
    idempotentHint: true,
  },
  inputSchema: {
    latitude: z.number().describe('Latitude (sortie de geocoding-v1)'),
    longitude: z.number().describe('Longitude (sortie de geocoding-v1)'),
    timezone: z
      .string()
      .optional()
      .default('Europe/Paris')
      .describe('Fuseau IANA (sortie geocoding, ex: Europe/Paris)'),
    forecast_hours: z
      .number()
      .int()
      .min(0)
      .max(48)
      .optional()
      .default(0)
      .describe('0 = meteo actuelle seulement ; 1..48 = heures locales (temp, ressenti, pluie %, code ciel)'),
  },
  execute: async (input) => {
    const latitude = input.latitude as number;
    const longitude = input.longitude as number;
    const timezone = (input.timezone as string | undefined) ?? 'Europe/Paris';
    const forecastHours = (input.forecast_hours as number | undefined) ?? 0;
    const tz = encodeURIComponent(timezone);
    // Review Bob 16/11 (mesure 05:45) : sans forecast_hours cote API, la liste horaire commence
    // a minuit ; « 3 heures » rendait 00:00, 01:00, 02:00 (le passe). forecast_hours=N part de
    // l heure en cours (et la reponse est ~20 fois plus legere sur l Airbox).
    const hourly =
      forecastHours > 0
        ? `&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code&forecast_hours=${forecastHours}`
        : '';
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,apparent_temperature,wind_speed_10m,weather_code&timezone=${tz}${hourly}`;
    try {
      const data = await fetchJson<OpenMeteoResponse>(url);
      const payload: Record<string, unknown> = {
        latitude: num(data.latitude),
        longitude: num(data.longitude),
        timezone: court(data.timezone, 64),
        current: pickCurrent(data.current),
      };
      if (forecastHours > 0 && data.hourly?.time) {
        // Garde en plus de l API : jamais une heure avant l heure en cours (meme fuseau, ISO local).
        const heureEnCours = typeof data.current?.time === 'string' ? data.current.time.slice(0, 13) : '';
        let debut = 0;
        if (heureEnCours) {
          while (debut < data.hourly.time.length && String(data.hourly.time[debut]).slice(0, 13) < heureEnCours) {
            debut++;
          }
        }
        const n = Math.min(forecastHours, data.hourly.time.length - debut);
        const hours = [];
        for (let i = debut; i < debut + n; i++) {
          hours.push({
            time: court(data.hourly.time[i]),
            temperature_2m: num(data.hourly.temperature_2m?.[i]),
            apparent_temperature: num(data.hourly.apparent_temperature?.[i]),
            precipitation_probability: num(data.hourly.precipitation_probability?.[i]),
            weather_code: num(data.hourly.weather_code?.[i]),
          });
        }
        payload.forecast_hours = forecastHours;
        payload.hourly = hours;
      }
      return jsonResult(payload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
