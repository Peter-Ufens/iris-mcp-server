import type { IrisTool } from './_types.js';
import { resoudreBaseOllama } from '../utils/ollama-base.js';
import { lireJsonBorne } from '../utils/http-fetch.js';
import { retirerInvisibles } from '../utils/texte-invisible.js';
import { journaliser, type CauseJournal } from '../utils/journal-moteurs.js';

/**
 * Base Ollama : OLLAMA_BASE_URL loopback, ou loopback par defaut (voir utils/ollama-base.ts).
 * Pas d'URL client (F3 Gaby 22/10 : endpoint libre = SSRF). Une valeur refusee donne une erreur,
 * plus de repli silencieux (review Gaby 16/11).
 */
export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
}

export async function fetchOllamaModels(
  baseUrl: string,
  timeoutMs = 8000,
): Promise<{ models: OllamaModel[]; error?: string }> {
  const url = `${baseUrl}/api/tags`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Aucune redirection, 1 Mo au plus, delai valable jusqu a la fin du corps (review Gaby 16/11).
    const res = await fetch(url, { signal: controller.signal, redirect: 'error' });

    if (!res.ok) {
      return { models: [], error: `HTTP ${res.status} ${res.statusText}` };
    }

    const data = await lireJsonBorne<{
      models?: Array<{ name: string; size?: number; modified_at?: string; digest?: string }>;
    }>(res, 1_000_000, 'Ollama');
    const models = Array.isArray(data?.models) ? data.models : [];
    return {
      models: models
        .filter((m) => m !== null && typeof m === 'object' && typeof m.name === 'string')
        .map((m) => ({
          name: retirerInvisibles(m.name.slice(0, 200)),
          size: typeof m.size === 'number' ? m.size : 0,
          modified_at: typeof m.modified_at === 'string' ? m.modified_at.slice(0, 64) : '',
          digest: typeof m.digest === 'string' ? m.digest.slice(0, 128) : '',
        })),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { models: [], error: `Ollama unreachable: ${msg.slice(0, 300)}` };
  } finally {
    clearTimeout(t);
  }
}

export interface OllamaCharge {
  name: string;
  size: number;
  size_vram: number;
  expires_at: string;
}

export interface OllamaEtat {
  /** Version d'Ollama (`GET /api/version`), si valide. */
  version?: string;
  /** Modeles charges en memoire maintenant (`GET /api/ps`, comme `ollama ps`). Au plus 50. */
  charges?: OllamaCharge[];
  /** Pourquoi l'etat n'a pas pu etre lu (n'empeche pas la liste des modeles). */
  etat_erreur?: string;
}

const VERSION_OK = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;

/**
 * Etat d'Ollama : version et modeles charges. Memes regles que la liste : base validee, aucune redirection,
 * 1 Mo au plus, delai jusqu'a la fin du corps, noms nettoyes des invisibles. Une panne ici ne casse pas la liste.
 */
export async function fetchOllamaEtat(baseUrl: string, timeoutMs = 8000): Promise<OllamaEtat> {
  const lire = async <T>(chemin: string): Promise<T> => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}${chemin}`, { signal: controller.signal, redirect: 'error' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await lireJsonBorne<T>(res, 1_000_000, 'Ollama');
    } finally {
      clearTimeout(t);
    }
  };
  const [ps, ver] = await Promise.allSettled([
    lire<{ models?: Array<Record<string, unknown>> }>('/api/ps'),
    lire<{ version?: unknown }>('/api/version'),
  ]);
  const etat: OllamaEtat = {};
  const echecs: string[] = [];
  if (ver.status === 'fulfilled') {
    const v = ver.value?.version;
    if (typeof v === 'string' && VERSION_OK.test(v)) etat.version = v;
  } else echecs.push('version');
  if (ps.status === 'fulfilled') {
    const liste = Array.isArray(ps.value?.models) ? ps.value.models : [];
    etat.charges = liste
      .filter((m) => m !== null && typeof m === 'object' && typeof m.name === 'string')
      .slice(0, 50)
      .map((m) => ({
        name: retirerInvisibles(String(m.name).slice(0, 200)),
        size: typeof m.size === 'number' ? m.size : 0,
        size_vram: typeof m.size_vram === 'number' ? m.size_vram : 0,
        expires_at: typeof m.expires_at === 'string' ? m.expires_at.slice(0, 64) : '',
      }));
  } else echecs.push('modeles charges');
  if (echecs.length) etat.etat_erreur = `lecture impossible : ${echecs.join(', ')}`;
  return etat;
}

function causeListe(erreur: string): { cause: CauseJournal; http?: number } {
  const m = /^HTTP (\d{3})/.exec(erreur);
  if (m) return { cause: 'http', http: Number(m[1]) };
  if (/abort/i.test(erreur)) return { cause: 'delai' };
  if (/trop volumineuse|JSON|Unexpected/i.test(erreur)) return { cause: 'reponse_invalide' };
  return { cause: 'refuse' };
}
export const tool: IrisTool = {
  id: 'ollama-list-v1',
  description:
    'Liste les modeles Ollama installes en local (GET /api/tags sur 127.0.0.1, ou OLLAMA_BASE_URL loopback), avec la version (/api/version) et les modeles charges en memoire (/api/ps, comme ollama ps). Pas d URL client (anti-SSRF). ' +
    'Une autre machine exige IRIS_OLLAMA_HORS_LOOPBACK=1.',
  category: 'ollama',
  inputSchema: {},
  execute: async () => {
    const base = resoudreBaseOllama();
    if (!base.ok) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ models: [], error: base.erreur }, null, 2) }],
        isError: true as const,
      };
    }
    const [result, etat] = await Promise.all([fetchOllamaModels(base.url), fetchOllamaEtat(base.url)]);
    if (result.error) journaliser({ outil: 'ollama-list-v1', etape: 'liste', moteur: 'ollama', ...causeListe(result.error) });
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ ...result, ...etat }, null, 2) }],
    };
  },
};