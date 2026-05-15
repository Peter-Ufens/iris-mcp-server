import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

interface ApodResponse {
  title: string;
  date: string;
  explanation: string;
  url: string;
  media_type: string;
  copyright?: string;
}

function truncateExplanation(text: string, max = 300): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export const tool: IrisTool = {
  id: 'nasa-apod-v1',
  description:
    "Retourne l image astronomique du jour NASA (APOD). Cle DEMO_KEY integree, 30 requetes/heure.",
  category: 'cloud',
  inputSchema: {
    date: z
      .string()
      .optional()
      .describe('Date YYYY-MM-DD (defaut : jour courant NASA)'),
  },
  execute: async (input) => {
    const date = input.date as string | undefined;
    const base = 'https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY';
    const url = date ? `${base}&date=${encodeURIComponent(date)}` : base;
    try {
      const data = await fetchJson<ApodResponse>(url);
      const out: Record<string, unknown> = {
        title: data.title,
        date: data.date,
        media_type: data.media_type,
        url: data.url,
        explanation: truncateExplanation(data.explanation),
      };
      if (data.media_type === 'video') {
        out.note = 'media_type: video';
      }
      if (data.copyright) {
        out.copyright = data.copyright;
      }
      return jsonResult(out);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
