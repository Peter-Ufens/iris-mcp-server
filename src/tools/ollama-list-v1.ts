import type { IrisTool } from './_types.js';

const DEFAULT_OLLAMA_BASE = 'http://127.0.0.1:11434';

/**
 * Base Ollama : uniquement env OLLAMA_BASE_URL ou loopback local.
 * Pas d'URL client (F3 Gaby 22/10 : endpoint libre = SSRF).
 */
export function resolveOllamaBaseUrl(): string {
  const fromEnv = process.env.OLLAMA_BASE_URL?.trim();
  const base = (fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_OLLAMA_BASE).replace(/\/+$/, '');
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return DEFAULT_OLLAMA_BASE;
  }
  const host = u.hostname.toLowerCase();
  const loopback =
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]';
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return DEFAULT_OLLAMA_BASE;
  }
  if (!loopback) {
    // Env pointe hors loopback : on refuse (SSRF) et on retombe sur le defaut local.
    return DEFAULT_OLLAMA_BASE;
  }
  return base;
}

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
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);

    if (!res.ok) {
      return { models: [], error: `HTTP ${res.status} ${res.statusText}` };
    }

    const data = (await res.json()) as {
      models?: Array<{ name: string; size?: number; modified_at?: string; digest?: string }>;
    };
    const models = Array.isArray(data.models) ? data.models : [];
    return {
      models: models.map((m) => ({
        name: m.name,
        size: m.size ?? 0,
        modified_at: m.modified_at ?? '',
        digest: m.digest ?? '',
      })),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { models: [], error: `Ollama unreachable: ${msg}` };
  }
}

export const tool: IrisTool = {
  id: 'ollama-list-v1',
  description:
    'Liste les modeles Ollama installes en local (GET /api/tags sur 127.0.0.1 ou OLLAMA_BASE_URL loopback). Pas d URL client (anti-SSRF).',
  category: 'ollama',
  inputSchema: {},
  execute: async () => {
    const base = resolveOllamaBaseUrl();
    const result = await fetchOllamaModels(base);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
};
