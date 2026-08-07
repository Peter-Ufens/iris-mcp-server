import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { htmlToText } from '../utils/html-text.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

/**
 * DuckDuckGo Instant Answer API : gratuite, sans cle, hote fixe.
 * Choix documente dans ADR-0005 : pas de parsing HTML de html.duckduckgo.com
 * (page anti-robot, il faudrait maquiller le User-Agent).
 */
const DDG_ENDPOINT = 'https://api.duckduckgo.com/';

interface DdgTopic {
  FirstURL?: string;
  Text?: string;
  Result?: string;
  Name?: string;
  Topics?: DdgTopic[];
}

interface DdgResponse {
  Heading?: string;
  Abstract?: string;
  AbstractText?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  Answer?: string;
  AnswerType?: string;
  Definition?: string;
  DefinitionURL?: string;
  DefinitionSource?: string;
  Results?: DdgTopic[];
  RelatedTopics?: DdgTopic[];
}

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

function clean(value: string | undefined): string {
  if (!value) return '';
  return htmlToText(value).replace(/\s+/g, ' ').trim();
}

/** "Iris (mythologie) - Dans la mythologie..." donne le titre avant le premier tiret. */
function splitTitle(text: string, fallback: string): string {
  const cut = text.split(' - ')[0]?.trim() ?? '';
  if (cut.length > 0 && cut.length <= 120) return cut;
  return fallback;
}

/** Les RelatedTopics contiennent parfois des groupes imbriques (champ Topics). */
function flattenTopics(topics: DdgTopic[] | undefined): DdgTopic[] {
  const out: DdgTopic[] = [];
  for (const topic of topics ?? []) {
    if (Array.isArray(topic.Topics)) {
      out.push(...flattenTopics(topic.Topics));
    } else if (topic.FirstURL) {
      out.push(topic);
    }
  }
  return out;
}

/** Transforme une reponse Instant Answer en liste de resultats normalises. */
export function mapDdgResponse(data: DdgResponse, query: string, limit: number): WebResult[] {
  const results: WebResult[] = [];
  const seen = new Set<string>();

  const push = (title: string, url: string, snippet: string): void => {
    if (url.length === 0 || seen.has(url) || results.length >= limit) return;
    seen.add(url);
    results.push({ title: title.length > 0 ? title : query, url, snippet });
  };

  const abstract = clean(data.AbstractText ?? data.Abstract);
  if (abstract.length > 0 && data.AbstractURL) {
    const source = data.AbstractSource ? ` (${data.AbstractSource})` : '';
    push(clean(data.Heading) || query, data.AbstractURL, `${abstract}${source}`);
  }

  const answer = clean(data.Answer);
  if (answer.length > 0 && data.AbstractURL) {
    push(`Reponse : ${query}`, data.AbstractURL, answer);
  }

  const definition = clean(data.Definition);
  if (definition.length > 0 && data.DefinitionURL) {
    const source = data.DefinitionSource ? ` (${data.DefinitionSource})` : '';
    push(`Definition : ${query}`, data.DefinitionURL, `${definition}${source}`);
  }

  for (const topic of [...flattenTopics(data.Results), ...flattenTopics(data.RelatedTopics)]) {
    const text = clean(topic.Text ?? topic.Result);
    push(splitTitle(text, query), topic.FirstURL ?? '', text);
  }

  return results;
}

export const tool: IrisTool = {
  id: 'web-search-ddg-v1',
  description:
    'Recherche web via l API Instant Answer de DuckDuckGo (gratuite, sans cle). ' +
    'Retourne resume, resultats officiels et sujets lies. Ce n est pas un index web complet : ' +
    'sur une requete pointue la liste peut etre vide (utiliser wikipedia-search-v1 ou fetch-url-v1).',
  category: 'web',
  inputSchema: {
    query: z.string().min(1).max(200).describe('Termes de recherche (1 a 200 caracteres)'),
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
    const limit = (input.limit as number | undefined) ?? 5;

    if (query.length === 0) {
      return errorResult('Requete vide.');
    }

    const url =
      `${DDG_ENDPOINT}?q=${encodeURIComponent(query)}` +
      '&format=json&no_html=1&no_redirect=1&t=iris-mcp-server';

    try {
      const data = await fetchJson<DdgResponse>(url);
      const results = mapDdgResponse(data, query, limit);
      return jsonResult({
        query,
        source: 'duckduckgo-instant-answer',
        count: results.length,
        results,
        ...(results.length === 0
          ? {
              note:
                'Aucune reponse instantanee DuckDuckGo pour cette requete. ' +
                'L API Instant Answer ne couvre pas tout le web : essayer wikipedia-search-v1, ' +
                'reformuler avec un terme plus general, ou lire une URL connue avec fetch-url-v1.',
            }
          : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(`DuckDuckGo : ${msg}`);
    }
  },
};
