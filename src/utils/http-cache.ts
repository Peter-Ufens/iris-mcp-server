/**
 * F13 (lot Q) : cache court + borne d'appels par hote pour les GET texte
 * (actu-rss, fetch-url). But : Airbox / boucles d'agente.
 */

import type { FetchTextResult } from './http-fetch.js';

export const CACHE_TTL_MS = 5 * 60_000;
export const HOST_WINDOW_MS = 10 * 60_000;
/** Au-dela : refus explicite (pas de boucle silencieuse). */
export const MAX_CALLS_PER_HOST_PER_WINDOW = 30;
const MAX_ENTRIES = 64;

interface CacheEntry {
  expiresAt: number;
  value: FetchTextResult;
}

interface HostBucket {
  windowStart: number;
  count: number;
}

const cache = new Map<string, CacheEntry>();
const hosts = new Map<string, HostBucket>();

export function resetHttpCacheForTests(): void {
  cache.clear();
  hosts.clear();
}

function hostOf(url: string): string {
  try {
    // Point final retire : example.com. et example.com sont le meme hote (review Gaby 16/11).
    return new URL(url).hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    return 'inconnu';
  }
}

/** Cle de cache : URL demandee + plafond de caracteres. */
export function cacheKey(url: string, maxChars: number): string {
  return `${url}#${maxChars}`;
}

export function getCachedFetchText(key: string, now = Date.now()): FetchTextResult | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (e.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  return { ...e.value };
}

export function setCachedFetchText(key: string, value: FetchTextResult, now = Date.now()): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, value: { ...value } });
}

/**
 * Compte un appel reseau vers cet hote. Lance si la borne de la fenetre est depassee.
 */
export function assertHostCallAllowed(url: string, now = Date.now()): void {
  const host = hostOf(url);
  let b = hosts.get(host);
  if (!b || now - b.windowStart >= HOST_WINDOW_MS) {
    b = { windowStart: now, count: 0 };
    hosts.set(host, b);
  }
  if (b.count >= MAX_CALLS_PER_HOST_PER_WINDOW) {
    throw new Error(
      `Trop d appels vers ${host} (${MAX_CALLS_PER_HOST_PER_WINDOW} / ${HOST_WINDOW_MS / 60_000} min). ` +
        `Attendre ou reutiliser le cache (F13). Pas de boucle.`,
    );
  }
  b.count += 1;
}
