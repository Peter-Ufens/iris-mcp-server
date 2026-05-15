import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

interface HnHit {
  title: string;
  url: string | null;
  points: number;
  num_comments: number;
  author: string;
}

interface HnSearchResponse {
  hits: HnHit[];
}

export const tool: IrisTool = {
  id: 'news-v1',
  description:
    'Retourne les N articles en tete de Hacker News. Algolia HN API, gratuit, sans cle API.',
  category: 'cloud',
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(5)
      .describe('Nombre d articles (1-10)'),
  },
  execute: async (input) => {
    const limit = (input.limit as number | undefined) ?? 5;
    const url = `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${limit}`;
    try {
      const data = await fetchJson<HnSearchResponse>(url);
      const hits = data.hits ?? [];
      return jsonResult({
        count: hits.length,
        articles: hits.map((h) => ({
          title: h.title,
          url: h.url,
          points: h.points,
          comments: h.num_comments,
        })),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
