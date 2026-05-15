/**
 * Client HTTP JSON minimal pour les outils cloud (timeout 8s).
 */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'iris-mcp-server/0.4.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} depuis ${url}`);
  }
  return (await res.json()) as T;
}
