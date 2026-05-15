import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

interface RandomFactResponse {
  id: string;
  text: string;
  source: string;
  source_url: string;
  language: string;
  permalink: string;
}

export const tool: IrisTool = {
  id: 'random-fact-v1',
  description:
    'Retourne un fait aleatoire et inutile. uselessfacts.jsph.pl, gratuit, sans cle API.',
  category: 'cloud',
  inputSchema: {
    language: z
      .enum(['en', 'de'])
      .optional()
      .default('en')
      .describe('Langue du fait (en ou de)'),
  },
  execute: async (input) => {
    const language = (input.language as 'en' | 'de' | undefined) ?? 'en';
    const url = `https://uselessfacts.jsph.pl/api/v2/facts/random?language=${language}`;
    try {
      const data = await fetchJson<RandomFactResponse>(url);
      return jsonResult({
        fact: data.text,
        source_url: data.source_url,
        language: data.language,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
