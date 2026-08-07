import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { htmlToText } from '../utils/html-text.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

/**
 * API MediaWiki publique (https only, hote fixe <lang>.wikipedia.org).
 * Le code langue est la seule partie variable du nom d hote : il est valide
 * strictement pour interdire toute injection (ADR-0005).
 */
const LANG_PATTERN = /^[a-z]{2,8}(-[a-z0-9]{2,8})*$/;

interface WikiSearchHit {
  title: string;
  pageid: number;
  snippet?: string;
  wordcount?: number;
}

interface WikiSearchResponse {
  query?: {
    searchinfo?: { totalhits?: number };
    search?: WikiSearchHit[];
  };
  error?: { code?: string; info?: string };
}

export function isValidLang(lang: string): boolean {
  return LANG_PATTERN.test(lang);
}

/** URL lisible de l article (les espaces deviennent des underscores). */
export function articleUrl(lang: string, title: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

export const tool: IrisTool = {
  id: 'wikipedia-search-v1',
  description:
    'Recherche des articles Wikipedia via l API MediaWiki publique (gratuite, sans cle). ' +
    'Retourne titre, pageid, URL et extrait. Langue par defaut : fr.',
  category: 'web',
  inputSchema: {
    query: z.string().min(1).max(200).describe('Termes de recherche (1 a 200 caracteres)'),
    lang: z
      .string()
      .min(2)
      .max(12)
      .optional()
      .default('fr')
      .describe('Code langue Wikipedia (fr, en, de, pt-br...). Defaut fr'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .default(5)
      .describe('Nombre maximum de resultats (1 a 8, defaut 5)'),
  },
  execute: async (input) => {
    const query = (input.query as string).trim();
    const lang = ((input.lang as string | undefined) ?? 'fr').trim().toLowerCase();
    const limit = (input.limit as number | undefined) ?? 5;

    if (query.length === 0) {
      return errorResult('Requete vide.');
    }
    if (!isValidLang(lang)) {
      return errorResult(`Code langue invalide : "${lang}" (attendu fr, en, de, pt-br...).`);
    }

    const url =
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=search` +
      `&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&utf8=1`;

    try {
      const data = await fetchJson<WikiSearchResponse>(url);

      if (data.error) {
        return errorResult(`Wikipedia : ${data.error.info ?? data.error.code ?? 'erreur API'}`);
      }

      const hits = data.query?.search ?? [];
      const results = hits.slice(0, limit).map((hit) => ({
        title: hit.title,
        pageid: hit.pageid,
        url: articleUrl(lang, hit.title),
        snippet: htmlToText(hit.snippet ?? '').replace(/\s+/g, ' ').trim(),
      }));

      return jsonResult({
        query,
        lang,
        count: results.length,
        total_hits: data.query?.searchinfo?.totalhits ?? results.length,
        results,
        ...(results.length === 0
          ? { note: `Aucun article Wikipedia (${lang}) pour cette requete. Essayer une autre langue ou reformuler.` }
          : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(`Wikipedia : ${msg}`);
    }
  },
};
