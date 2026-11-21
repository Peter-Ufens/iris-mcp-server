import { describe, it, expect, beforeEach } from 'vitest';
import {
  CACHE_TTL_MS,
  MAX_CALLS_PER_HOST_PER_WINDOW,
  assertHostCallAllowed,
  cacheKey,
  getCachedFetchText,
  resetHttpCacheForTests,
  setCachedFetchText,
} from '../src/utils/http-cache.js';
import type { FetchTextResult } from '../src/utils/http-fetch.js';

const sample = (url: string): FetchTextResult => ({
  url,
  finalUrl: url,
  status: 200,
  contentType: 'text/plain',
  text: 'ok',
  truncated: false,
  bytesApprox: 2,
  redirects: 0,
});

describe('http-cache F13', () => {
  beforeEach(() => resetHttpCacheForTests());

  it('stocke et renvoie un hit avant expiration', () => {
    const key = cacheKey('https://example.com/a', 1000);
    setCachedFetchText(key, sample('https://example.com/a'), 1_000);
    expect(getCachedFetchText(key, 1_000 + CACHE_TTL_MS - 1)?.text).toBe('ok');
    expect(getCachedFetchText(key, 1_000 + CACHE_TTL_MS + 1)).toBeUndefined();
  });

  it('borne les appels par hote', () => {
    const url = 'https://news.example.com/rss';
    for (let i = 0; i < MAX_CALLS_PER_HOST_PER_WINDOW; i++) {
      assertHostCallAllowed(url, 10_000);
    }
    expect(() => assertHostCallAllowed(url, 10_000)).toThrow(/Trop d appels/);
  });

  it('RT pre-G : meme borne utilisable pour web-search (SearXNG loopback)', () => {
    const url = 'http://127.0.0.1:8080/search?q=x';
    for (let i = 0; i < MAX_CALLS_PER_HOST_PER_WINDOW; i++) {
      assertHostCallAllowed(url, 20_000);
    }
    expect(() => assertHostCallAllowed(url, 20_000)).toThrow(/127\.0\.0\.1/);
  });
});
