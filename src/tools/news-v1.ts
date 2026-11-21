import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';
import { retirerInvisibles } from '../utils/texte-invisible.js';

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
    'Hacker News seulement (front page Algolia HN API) : pas une presse generale. Pour l actualite FR/monde, utiliser actu-rss-v1. Gratuit, sans cle API.',
  category: 'cloud',
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
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
        contenu_non_fiable: true,
        articles: hits.map((h) => ({
          title: retirerInvisibles(h.title ?? ''),
          url: retirerInvisibles(h.url ?? ''),
          points: h.points,
          comments: h.num_comments,
          contenu_non_fiable: true,
        })),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  },
};
