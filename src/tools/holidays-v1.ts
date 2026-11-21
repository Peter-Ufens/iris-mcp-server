import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

interface NagerHoliday {
  date: string;
  name: string;
  localName: string;
}

/**
 * Review Bob 16/11 (redirection 1046 du 12/11, retestee) : la reponse FR ne disait rien de l Alsace-Moselle ;
 * seule la description prevenait. Un agent qui lit la reponse aurait dit « le 26/12 n est pas ferie ».
 * Maintenant : une note dans la reponse FR, et region="alsace-moselle" ajoute les 2 jours locaux.
 */
export const NOTE_ALSACE_MOSELLE =
  'France : jours feries nationaux seulement. En Alsace-Moselle (Bas-Rhin, Haut-Rhin, Moselle), 2 jours de plus : ' +
  'le 26 decembre (Saint-Etienne) et le Vendredi saint (dans les communes qui ont un temple protestant ou une eglise mixte). ' +
  'Passer region="alsace-moselle" pour les ajouter. Source : service-public.gouv.fr F2405.';

/** Dimanche de Paques (calendrier gregorien, algorithme anonyme de Meeus-Jones-Butcher), en AAAA-MM-JJ. */
export function dimanchePaques(annee: number): string {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

function moinsJours(isoDate: string, n: number): string {
  const t = new Date(`${isoDate}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - n);
  return t.toISOString().slice(0, 10);
}

/** Les 2 jours propres a l Alsace-Moselle pour une annee. */
export function joursAlsaceMoselle(annee: number) {
  return [
    {
      date: moinsJours(dimanchePaques(annee), 2),
      name: 'Good Friday',
      localName: 'Vendredi saint',
      local: 'Alsace-Moselle',
      condition: 'communes qui ont un temple protestant ou une eglise mixte',
    },
    {
      date: `${annee}-12-26`,
      name: "St. Stephen's Day",
      localName: 'Saint-Etienne',
      local: 'Alsace-Moselle',
    },
  ];
}

export const tool: IrisTool = {
  id: 'holidays-v1',
  description:
    'Jours feries NATIONAUX pour un pays/annee (date.nager.at). FR : la reponse porte une note Alsace-Moselle ; ' +
    'region="alsace-moselle" ajoute le 26 decembre et le Vendredi saint (selon la commune), marques local. Voir service-public F2405.',
  category: 'cloud',
  inputSchema: {
    country_code: z
      .string()
      .regex(/^[A-Za-z]{2}$/, 'Code pays a 2 lettres (ex: FR)')
      .optional()
      .default('FR')
      .describe('Code pays ISO 3166-1 alpha-2 (ex: FR, DE, US)'),
    year: z.number().int().min(1900).max(2200).optional().describe('Annee (defaut : annee courante)'),
    region: z
      .enum(['alsace-moselle'])
      .optional()
      .describe('FR seulement : ajoute les jours propres a l Alsace-Moselle (Bas-Rhin, Haut-Rhin, Moselle)'),
  },
  execute: async (input) => {
    const country_code = (
      (input.country_code as string | undefined) ?? 'FR'
    ).toUpperCase();
    const year = (input.year as number | undefined) ?? new Date().getFullYear();
    const region = input.region as 'alsace-moselle' | undefined;
    // Review Gaby CX3 : 2 caracteres quelconques (.., ?x, %2) changeaient le chemin ou la requete de l URL.
    if (!/^[A-Z]{2}$/.test(country_code)) {
      return errorResult('country_code : 2 lettres attendues (ex: FR).');
    }
    if (region && country_code !== 'FR') {
      return errorResult('region="alsace-moselle" ne vaut que pour country_code FR.');
    }
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${country_code}`;
    try {
      const data = await fetchJson<NagerHoliday[]>(url);
      const holidays: Array<Record<string, unknown>> = data.map((h) => ({
        date: h.date,
        name: h.name,
        localName: h.localName,
      }));
      if (region === 'alsace-moselle') {
        const deja = new Set(holidays.map((h) => h.date));
        for (const j of joursAlsaceMoselle(year)) if (!deja.has(j.date)) holidays.push(j);
        holidays.sort((x, y) => String(x.date).localeCompare(String(y.date)));
      }
      return jsonResult({
        country_code,
        year,
        ...(region ? { region } : {}),
        count: holidays.length,
        holidays,
        ...(country_code === 'FR' && !region ? { note: NOTE_ALSACE_MOSELLE } : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
