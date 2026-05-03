import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';

const DEFAULT_OLLAMA_BASE = 'http://127.0.0.1:11434';

function resolveBase(): string {
  const fromEnv = process.env.OLLAMA_BASE_URL?.trim();
  return (fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_OLLAMA_BASE).replace(/\/+$/, '');
}

export interface ChatSuccess {
  response: string;
  model: string;
  duration_ms: number;
}

export interface ChatFailure {
  error: string;
}

export async function ollamaChat(
  model: string,
  messages: Array<{ role: string; content: string }>,
  temperature?: number,
  timeoutMs = 120_000,
): Promise<ChatSuccess | ChatFailure> {
  const base = resolveBase();
  const url = `${base}/api/chat`;

  const body: Record<string, unknown> = { model, messages, stream: false };
  if (temperature !== undefined) {
    body.options = { temperature };
  }

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(t);
    const elapsed = Date.now() - start;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: `HTTP ${res.status}: ${text || res.statusText}` };
    }

    const data = (await res.json()) as {
      message?: { content?: string };
      model?: string;
      total_duration?: number;
    };
    return {
      response: data.message?.content ?? '',
      model: data.model ?? model,
      duration_ms: data.total_duration
        ? Math.round(data.total_duration / 1_000_000)
        : elapsed,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Ollama unreachable: ${msg}` };
  }
}

export const tool: IrisTool = {
  id: 'ollama-chat-v1',
  description:
    'Envoie un message a un modele Ollama local et recoit la reponse (POST /api/chat, stream: false). Erreur propre si Ollama eteint ou modele absent.',
  category: 'ollama',
  inputSchema: {
    model: z.string().describe('Nom du modele Ollama (ex: llama3, mistral)'),
    messages: z
      .array(
        z.object({
          role: z.string().describe('Role: system, user, ou assistant'),
          content: z.string().describe('Contenu du message'),
        }),
      )
      .describe('Messages de la conversation'),
    temperature: z.number().optional().describe('Temperature (optionnel, ex: 0.7)'),
  },
  execute: async (input) => {
    const model = input.model as string;
    const messages = input.messages as Array<{ role: string; content: string }>;
    const temperature = input.temperature as number | undefined;
    const result = await ollamaChat(model, messages, temperature);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
};
