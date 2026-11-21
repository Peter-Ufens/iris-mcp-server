import { qdrantApiKeyHeader } from '../qdrant-auth.js';
import { lireJsonBorne, messageReseau } from './http-fetch.js';
import { resoudreBase, resoudreBaseOllama, type BaseOllama } from './ollama-base.js';

/**
 * Appels HTTP des outils RAG vers Qdrant et Ollama (review Gaby 16/11, decision Peter 08:11) :
 * - bases d'URL en loopback par defaut (opt-in explicite pour une autre machine) ;
 * - aucune redirection ; plafond d'octets ; delai valable jusqu'a la fin du corps ;
 * - la cle Qdrant n'est ajoutee QUE pour un appel Qdrant (jamais deduite d'un motif dans l'URL).
 */
export const QDRANT_DEFAUT = 'http://127.0.0.1:6334';
export const QDRANT_OPT_IN = 'IRIS_QDRANT_HORS_LOOPBACK';
export const RAG_MAX_OCTETS_QDRANT = 16_000_000;
export const RAG_MAX_OCTETS_OLLAMA = 2_000_000;

export function resoudreBaseQdrant(env: NodeJS.ProcessEnv = process.env, explicite?: string): BaseOllama {
  return resoudreBase(explicite ?? env.QDRANT_URL, { variable: 'QDRANT_URL', optIn: QDRANT_OPT_IN, defaut: QDRANT_DEFAUT }, env);
}

export { resoudreBaseOllama };

async function postJsonRag(
  url: string,
  body: unknown,
  timeoutMs: number,
  opts: { cleQdrant: boolean; maxOctets: number },
): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.cleQdrant ? qdrantApiKeyHeader() : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {
        // corps deja consomme
      }
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await lireJsonBorne<unknown>(res, opts.maxOctets, new URL(url).origin);
  } finally {
    clearTimeout(t);
  }
}

/** Appel Qdrant : `base` vient de resoudreBaseQdrant ; la cle n'est envoyee qu'ici. */
export function postQdrant(base: string, chemin: string, body: unknown, timeoutMs: number): Promise<unknown> {
  return postJsonRag(`${base}${chemin}`, body, timeoutMs, { cleQdrant: true, maxOctets: RAG_MAX_OCTETS_QDRANT });
}

/** Appel Ollama : jamais de cle. */
export function postOllama(base: string, chemin: string, body: unknown, timeoutMs: number): Promise<unknown> {
  return postJsonRag(`${base}${chemin}`, body, timeoutMs, { cleQdrant: false, maxOctets: RAG_MAX_OCTETS_OLLAMA });
}

/** Lecture Qdrant (GET), memes regles que postQdrant : pas de redirection, plafond d'octets, cle seulement ici. */
async function getQdrant(base: string, chemin: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${chemin}`, { method: 'GET', headers: { ...qdrantApiKeyHeader() }, signal: controller.signal, redirect: 'error' });
    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {
        // corps deja consomme
      }
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await lireJsonBorne<unknown>(res, 1_000_000, new URL(base).origin);
  } finally {
    clearTimeout(t);
  }
}

/** Taille des vecteurs de la collection (vecteur unique ou vecteurs nommes : le premier), ou undefined. */
function tailleCollection(info: unknown): number | undefined {
  const v = (info as { result?: { config?: { params?: { vectors?: unknown } } } })?.result?.config?.params?.vectors;
  if (v && typeof v === 'object') {
    const direct = (v as { size?: unknown }).size;
    if (typeof direct === 'number') return direct;
    const premier = Object.values(v as Record<string, unknown>)[0] as { size?: unknown } | undefined;
    if (premier && typeof premier.size === 'number') return premier.size;
  }
  return undefined;
}

/**
 * Correction C2 (Bob 20/11, scenario CP8 rejoue) : une REPONSE HTTP de Qdrant n'est pas « injoignable ».
 * Pour un 400, on compare la taille du vecteur de la question a celle de la collection : un moteur d'embeddings
 * d'une autre taille est la cause la plus probable. Le message ne contient ni URL ni cle.
 */
export async function causeErreurQdrant(e: unknown, base: string, collection: string, tailleVecteur?: number): Promise<string> {
  const msg = e instanceof Error ? e.message : String(e);
  const http = /^HTTP (\d{3})/.exec(msg);
  if (!http) {
    // Review Gaby 21/11 : Qdrant a REPONDU, mais trop gros ou illisible : ce n'est pas « injoignable ».
    if (/trop volumineuse|JSON|Unexpected token/i.test(msg)) return `Qdrant a repondu de facon inutilisable (${msg})`;
    // Review Gaby 21/11 (nit Bob, test Docker reel : « Qdrant injoignable (fetch failed) ») : cause reseau traduite.
    return `Qdrant injoignable (${messageReseau(e)})`;
  }
  if (http[1] === '400' && typeof tailleVecteur === 'number') {
    try {
      const attendu = tailleCollection(await getQdrant(base, `/collections/${encodeURIComponent(collection)}`, 5_000));
      if (attendu !== undefined && attendu !== tailleVecteur) {
        return `moteur d'embeddings refuse : il donne ${tailleVecteur} nombres, l'index en attend ${attendu} (Qdrant ${msg}). Aucun resultat faux. Verifier le modele d'embeddings (nomic-embed-text).`;
      }
    } catch {
      // lecture de la collection impossible : message general ci-dessous
    }
  }
  return `Qdrant a refuse la recherche (${msg})`;
}

/**
 * Correction C3 (Bob 20/11) : un outil RAG qui n'a AUCUN resultat parce qu'un moteur manque (Ollama, Qdrant,
 * motifs de zones...) doit etre marque en erreur MCP, sinon une agente lit « rien dans le vault ».
 * La simple note F5 (includeReserved ignore) n'est pas une panne.
 */
export function estPanneRag(result: { hits?: unknown[]; meta?: { error?: unknown } }): boolean {
  const hits = Array.isArray(result.hits) ? result.hits.length : 0;
  // Review Gaby 21/11 : on retire SEULEMENT la phrase F5 (jusqu'a « (F5). »). Avant, tout le reste jusqu'au prochain « · »
  // partait avec elle ; rag-hybrid joint ses erreurs par « | », donc « F5 | Ollama injoignable » n'etait plus une panne.
  const err = typeof result.meta?.error === 'string' ? result.meta.error.replace(/includeReserved ignore[^·|]*?\(F5\)\.?/g, '').trim() : '';
  return hits === 0 && err.replace(/[·|\s]/g, '').length > 0;
}