import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';

const DEFAULT_OLLAMA_BASE = 'http://127.0.0.1:11434';

function resolveBase(endpoint?: string): string {
  if (endpoint?.trim()) return endpoint.trim().replace(/\/+$/, '');
  const fromEnv = process.env.OLLAMA_BASE_URL?.trim();
  return (fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_OLLAMA_BASE).replace(/\/+$/, '');
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
    'Liste les modeles Ollama installes sur la machine locale (GET /api/tags). Retourne une erreur propre si Ollama est eteint.',
  category: 'ollama',
  inputSchema: {
    endpoint: z
      .string()
      .optional()
      .describe('URL de base Ollama (optionnel ; sinon OLLAMA_BASE_URL ou 127.0.0.1:11434)'),
  },
  execute: async (input) => {
    const base = resolveBase(input.endpoint as string | undefined);
    const result = await fetchOllamaModels(base);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
};
