import { SERVER_VERSION } from '../version.js';
import { assertSafeUrl } from './url-guard.js';

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
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} depuis ${url}`);
  }
  return (await res.json()) as T;
}

export interface FetchTextOptions {
  /** Plafond de caracteres (borne a MAX_TEXT_CHARS). */
  maxChars?: number;
  /** Timeout en ms (defaut WEB_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Allowlist d'hotes (defaut : WEB_ALLOWED_HOSTS). */
  allowedHosts?: string[];
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

  let current = await assertSafeUrl(rawUrl, guardOptions);
  const requested = current.href;
  let redirects = 0;
  let res: Response;

  for (;;) {
    res = await fetch(current, {
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
    throw new Error(`HTTP ${res.status} depuis ${current.href}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!isTextualContentType(contentType)) {
    await discardBody(res);
    throw new Error(
      `Content-Type non supporte : "${contentType}" (attendu text/*, application/json, application/xml, application/xhtml+xml)`,
    );
  }

  const { text, truncated, bytes } = await readCapped(res, maxChars, charsetOf(contentType));

  return {
    url: requested,
    finalUrl: current.href,
    status: res.status,
    contentType,
    text,
    truncated,
    bytesApprox: bytes,
    redirects,
  };
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
