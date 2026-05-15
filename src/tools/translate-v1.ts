import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

interface TranslateResponse {
  responseStatus: number;
  responseData?: {
    translatedText: string;
    match: number;
  };
}

export const tool: IrisTool = {
  id: 'translate-v1',
  description:
    'Traduit un texte d une langue vers une autre. MyMemory API, gratuit sans cle (1000 mots/jour).',
  category: 'cloud',
  inputSchema: {
    text: z.string().max(500).describe('Texte a traduire (max 500 caracteres)'),
    from: z.string().optional().default('fr').describe('Code langue source (ex: fr, en, de)'),
    to: z.string().optional().default('en').describe('Code langue cible'),
  },
  execute: async (input) => {
    const text = input.text as string;
    const from = (input.from as string | undefined) ?? 'fr';
    const to = (input.to as string | undefined) ?? 'en';
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(from)}|${encodeURIComponent(to)}`;
    try {
      const data = await fetchJson<TranslateResponse>(url);
      if (data.responseStatus !== 200 || !data.responseData) {
        return errorResult(`MyMemory : ${data.responseStatus}`);
      }
      return jsonResult({
        original: text,
        translated: data.responseData.translatedText,
        from,
        to,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
