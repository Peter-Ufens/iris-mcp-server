import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

interface IpApiResponse {
  status: string;
  country?: string;
  regionName?: string;
  city?: string;
  lat?: number;
  lon?: number;
  isp?: string;
  query?: string;
  message?: string;
}

export const tool: IrisTool = {
  id: 'ip-info-v1',
  description:
    "Retourne la geolocalisation d'une adresse IP (ip-api.com, sans cle API).",
  category: 'cloud',
  inputSchema: {
    ip: z
      .string()
      .optional()
      .describe('Adresse IP a analyser. Si absent, utilise l IP courante.'),
  },
  execute: async (input) => {
    const ip = input.ip as string | undefined;
    const fields = 'status,country,regionName,city,lat,lon,isp,query,message';
    const url = ip
      ? `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`
      : `http://ip-api.com/json/?fields=${fields}`;
    try {
      const data = await fetchJson<IpApiResponse>(url);
      if (data.status !== 'success') {
        return errorResult(data.message ?? 'Echec ip-api.com');
      }
      return jsonResult({
        ip: data.query,
        country: data.country,
        region: data.regionName,
        city: data.city,
        latitude: data.lat,
        longitude: data.lon,
        isp: data.isp,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
