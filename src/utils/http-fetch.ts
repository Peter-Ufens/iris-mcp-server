import { SERVER_VERSION } from '../version.js';
import { assertSafeUrl } from './url-guard.js';
import { pinnedFetch } from './pinned-fetch.js';
import {
  assertHostCallAllowed,
  cacheKey,
  getCachedFetchText,
  setCachedFetchText,
} from './http-cache.js';

/** User-Agent honnete : pas d'usurpation de navigateur (ADR-0005). */
export const USER_AGENT = `iris-mcp-server/${SERVER_VERSION}`;

/** Plafond dur du texte retourne par fetchText (caracteres). */
export const MAX_TEXT_CHARS = 200_000;

/** Timeout des appels web (ms). */
export const WEB_TIMEOUT_MS = 10_000;

/** Nombre maximum de redirections suivies (chacune revalidee). */
export const MAX_REDIRECTS = 3;

/**
 * Client HTTP JSON minimal pour les outils cloud (timeout 8s).
 * Reserve aux URL construites par le code (hote fixe), cf. ADR-0005.
 */
export const MAX_JSON_BYTES = 4_000_000;

export interface FetchJsonOptions {
  /** Plafond d'octets lus (defaut MAX_JSON_BYTES). Review Gaby 16/11 : plus de lecture sans borne. */
  maxBytes?: number;
  /** 'error' refuse toute redirection (a utiliser pour une cible locale, ex. SearXNG). Defaut : suivre. */
  redirect?: 'follow' | 'error';
}

/**
 * Correction C4 (Bob 20/11, scenarios CP4 et CP5 rejoues) : « fetch failed » seul ne dit rien a une agente ni a Peter.
 * On traduit la cause reseau en une phrase simple, sans URL ni cle. La cause d'origine reste attachee (`cause`),
 * pour que le reveil de SearXNG (`estConnexionRefusee`, qui lit `e.cause.code`) marche comme avant.
 */
export function messageReseau(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = err?.cause?.code;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'delai depasse (reseau lent ou coupe)';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `pas d'acces Internet ou nom de site introuvable (${code})`;
  if (code === 'ECONNREFUSED') return 'service eteint ou connexion refusee (ECONNREFUSED)';
  if (code === 'ECONNRESET') return 'connexion coupee en cours de route (ECONNRESET)';
  if (/bad port/i.test(String(err?.cause?.message ?? ''))) return 'port refuse par le client HTTP (bad port)';
  // Review Gaby 21/11 : autres causes (EHOSTUNREACH, certificat, socket...) : « fetch failed » seul ne dit rien, on ajoute le code.
  const brut = String(err?.message ?? e);
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(code) ? `reseau : ${brut} (${code})` : brut;
}

export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const cap = options.maxBytes ?? MAX_JSON_BYTES;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      redirect: options.redirect ?? 'follow',
    });
  } catch (e) {
    const cause = (e as { cause?: unknown })?.cause ?? e;
    throw new Error(messageReseau(e), { cause });
  }
  if (!res.ok) {
    await discardBody(res);
    throw new Error(`HTTP ${res.status} depuis ${url}`);
  }
  return lireJsonBorne<T>(res, cap, new URL(url).origin);
}

/**
 * Lit le corps d'une reponse JSON avec un plafond d'octets (Content-Length verifie, lecture en flux,
 * BOM retire). Review Gaby 16/11 : partage entre fetchJson et les appels qui ont leurs propres en-tetes (Brave).
 */
export async function lireJsonBorne<T>(res: Response, cap: number, origine: string): Promise<T> {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    await discardBody(res);
    throw new Error(`Reponse JSON trop volumineuse (plus de ${cap} octets) depuis ${origine}`);
  }
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') {
    return (await res.json()) as T;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > cap) {
          throw new Error(`Reponse JSON trop volumineuse (plus de ${cap} octets) depuis ${origine}`);
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // flux deja termine
    }
  }
  // res.json() retirait une marque d'ordre d'octets (BOM, U+FEFF) en tete ; la lecture par morceaux doit faire pareil.
  const texte = Buffer.concat(chunks).toString('utf-8');
  return JSON.parse(texte.charCodeAt(0) === 0xfeff ? texte.slice(1) : texte) as T;
}
export interface FetchTextOptions {
  /** Plafond de caracteres (borne a MAX_TEXT_CHARS). */
  maxChars?: number;
  /** Timeout en ms (defaut WEB_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Allowlist d'hotes (defaut : WEB_ALLOWED_HOSTS). */
  allowedHosts?: string[];
  /**
   * F13 : cache court (5 min) + borne par hote. Defaut true.
   * Mettre false dans un test qui doit forcer le reseau.
   */
  useCache?: boolean;
}

export interface FetchTextResult {
  /** URL demandee (apres normalisation). */
  url: string;
  /** URL finale apres redirections. */
  finalUrl: string;
  status: number;
  contentType: string;
  text: string;
  truncated: boolean;
  /** Octets lus sur le reseau (lecture interrompue si troncature). */
  bytesApprox: number;
  redirects: number;
}

const TEXTUAL_TYPES = [
  'text/',
  'application/json',
  'application/xml',
  'application/xhtml+xml',
  'application/ld+json',
];

/** Content-Type accepte : text/*, JSON (et *+json), XML, XHTML. Vide = accepte. */
export function isTextualContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase().split(';')[0]!.trim();
  if (ct.length === 0) return true; // en-tete absent : traite comme du texte
  if (TEXTUAL_TYPES.some((t) => ct.startsWith(t))) return true;
  return ct.endsWith('+json') || ct.endsWith('+xml');
}

function charsetOf(contentType: string): string {
  const m = /charset=["']?([\w-]+)/i.exec(contentType);
  return m?.[1]?.toLowerCase() ?? 'utf-8';
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Message d'erreur HTTP lisible par une agente (review I1 14/11). Un refus 401/403
 * n'est pas une panne reseau : Iris ne le contourne pas (ADR-0005, pas de faux navigateur).
 */
export function httpErrorMessage(status: number, url: string): string {
  const base = `HTTP ${status} depuis ${url}`;
  if (status === 401 || status === 403) {
    return `${base} : le site refuse les lecteurs automatiques. Iris ne contourne pas ce refus (ADR-0005) : lire la page au navigateur.`;
  }
  if (status === 429) {
    return `${base} : le site demande de ralentir. Reessayer plus tard, sans boucle.`;
  }
  return base;
}

async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // corps deja consomme ou reponse simulee : rien a liberer
  }
}

/**
 * GET d'une URL fournie par le client : garde SSRF, redirections revalidees,
 * timeout, plafond de taille avec interruption du flux.
 *
 * @throws UrlGuardError si l'URL est refusee, Error sinon (HTTP, timeout, type)
 */
export async function fetchText(
  rawUrl: string,
  options: FetchTextOptions = {},
): Promise<FetchTextResult> {
  const maxChars = Math.min(Math.max(options.maxChars ?? MAX_TEXT_CHARS, 1), MAX_TEXT_CHARS);
  const timeoutMs = options.timeoutMs ?? WEB_TIMEOUT_MS;
  const guardOptions = { allowedHosts: options.allowedHosts };
  const useCache = options.useCache !== false;

  // Garde SSRF d'abord : une URL refusee ne doit ni toucher le cache ni le compteur.
  let current = await assertSafeUrl(rawUrl, guardOptions);
  const requested = current.href;
  const key = cacheKey(requested, maxChars);
  if (useCache) {
    const hit = getCachedFetchText(key);
    if (hit) return hit;
  }
  if (useCache) assertHostCallAllowed(requested);

  let redirects = 0;
  let res: Response;

  for (;;) {
    // D2 : connexion via resolution epinglee (pas de second lookup non controle).
    res = await pinnedFetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.1',
        'Accept-Language': 'fr,en;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    const location = isRedirectStatus(res.status) ? res.headers.get('location') : null;
    if (!location) break;

    if (redirects >= MAX_REDIRECTS) {
      await discardBody(res);
      throw new Error(`Trop de redirections (max ${MAX_REDIRECTS}) depuis ${requested}`);
    }
    redirects += 1;
    await discardBody(res);
    current = await assertSafeUrl(new URL(location, current), guardOptions);
  }

  if (!res.ok) {
    await discardBody(res);
    throw new Error(httpErrorMessage(res.status, current.href));
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!isTextualContentType(contentType)) {
    await discardBody(res);
    throw new Error(
      `Content-Type non supporte : "${contentType}" (attendu text/*, application/json, application/xml, application/xhtml+xml)`,
    );
  }

  const { text, truncated, bytes } = await readCapped(res, maxChars, charsetOf(contentType));

  const result: FetchTextResult = {
    url: requested,
    finalUrl: current.href,
    status: res.status,
    contentType,
    text,
    truncated,
    bytesApprox: bytes,
    redirects,
  };
  if (useCache) setCachedFetchText(key, result);
  return result;
}

/** Lit le corps par morceaux et coupe des que le plafond de caracteres est atteint. */
async function readCapped(
  res: Response,
  maxChars: number,
  charset: string,
): Promise<{ text: string; truncated: boolean; bytes: number }> {
  const body = res.body;

  if (!body || typeof body.getReader !== 'function') {
    const full = await res.text();
    const truncated = full.length > maxChars;
    return {
      text: truncated ? full.slice(0, maxChars) : full,
      truncated,
      bytes: Buffer.byteLength(full, 'utf-8'),
    };
  }

  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset, { fatal: false });
  } catch {
    decoder = new TextDecoder('utf-8', { fatal: false });
  }

  const reader = body.getReader();
  let text = '';
  let bytes = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        bytes += value.byteLength;
        text += decoder.decode(value, { stream: true });
      }
      if (text.length >= maxChars) {
        truncated = true;
        break;
      }
    }
    if (!truncated) text += decoder.decode();
  } finally {
    try {
      await reader.cancel();
    } catch {
      // flux deja termine
    }
  }

  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }

  return { text, truncated, bytes };
}
