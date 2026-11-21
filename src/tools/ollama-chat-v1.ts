import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { retirerInvisibles } from '../utils/texte-invisible.js';
import { resoudreBaseOllama } from '../utils/ollama-base.js';
import { journaliser } from '../utils/journal-moteurs.js';

/**
 * Bornes (review Bob 16/11, RT pre-G 097 « prompt enorme ») : sans elles, un agent pouvait envoyer
 * un texte sans limite (carte graphique occupee 120 s) et un faux service sur le port d Ollama
 * pouvait renvoyer un corps sans fin ou geant.
 */
export const OLLAMA_MAX_MESSAGES = 50;
export const OLLAMA_MAX_CONTENU_TOTAL = 200_000;
export const OLLAMA_MAX_REPONSE = 100_000;
const OLLAMA_MAX_CORPS_OCTETS = 8_000_000;
const OLLAMA_MAX_ERREUR = 300;

/**
 * Limite d'appels en vol (review Gaby 16/11, decision Peter 07:58) : la carte graphique ne se partage pas sans fin.
 * 2 appels en vol, 4 en attente (60 s au plus), le reste est refuse tout de suite (isError). Par processus.
 */
export const limitesOllama = { enVol: 2, file: 4, attenteMs: 60_000 };
let appelsEnVol = 0;
const attente: Array<{ lib: () => void; t: NodeJS.Timeout }> = [];

export function etatOllamaPourTests(): { enVol: number; enAttente: number } {
  return { enVol: appelsEnVol, enAttente: attente.length };
}

async function prendreUnePlace(): Promise<void> {
  if (appelsEnVol < limitesOllama.enVol) {
    appelsEnVol += 1;
    return;
  }
  if (attente.length >= limitesOllama.file) {
    throw new Error(
      `Ollama occupe : ${appelsEnVol} appels en cours et ${attente.length} en attente (file pleine). Reessayer plus tard.`,
    );
  }
  await new Promise<void>((ok, ko) => {
    const entree = {
      lib: ok,
      t: setTimeout(() => {
        const i = attente.indexOf(entree);
        if (i >= 0) attente.splice(i, 1);
        ko(new Error(`Ollama occupe : attente de plus de ${Math.round(limitesOllama.attenteMs / 1000)} s. Reessayer plus tard.`));
      }, limitesOllama.attenteMs),
    };
    attente.push(entree);
  });
}

function rendreLaPlace(): void {
  const suivant = attente.shift();
  if (suivant) {
    clearTimeout(suivant.t);
    suivant.lib(); // la place passe directement au suivant : appelsEnVol ne change pas
  } else {
    appelsEnVol = Math.max(0, appelsEnVol - 1);
  }
}

export interface ChatSuccess {
  response: string;
  model: string;
  duration_ms: number;
  /** Vrai si la reponse du modele depassait OLLAMA_MAX_REPONSE caracteres. */
  response_tronquee?: true;
  /** Present seulement quand la reponse est venue du format standard OpenAI (/v1/chat/completions). */
  format?: 'openai';
}

export interface ChatFailure {
  error: string;
}

/** Lit le corps par morceaux avec un plafond ; null si le corps n est pas un flux (simulations de test). */
async function lireTexteBorne(res: Response, maxBytes: number): Promise<string | null> {
  const body = (res as { body?: ReadableStream<Uint8Array> | null }).body;
  if (!body || typeof body.getReader !== 'function') return null;
  const reader = body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) throw new Error('reponse trop volumineuse');
        morceaux.push(value);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const texte = Buffer.concat(morceaux).toString('utf-8');
  return texte.charCodeAt(0) === 0xfeff ? texte.slice(1) : texte;
}

/** Reponse d'un appel de chat : le statut, puis soit les donnees JSON, soit l'erreur deja nettoyee. */
type ReponseChat = { ok: true; donnees: unknown } | { ok: false; statut: number; erreur: string };

export async function ollamaChat(
  model: string,
  messages: Array<{ role: string; content: string }>,
  temperature?: number,
  timeoutMs = 120_000,
): Promise<ChatSuccess | ChatFailure> {
  const total = messages.reduce((n, m) => n + (typeof m?.content === 'string' ? m.content.length : 0), 0);
  if (messages.length > OLLAMA_MAX_MESSAGES || total > OLLAMA_MAX_CONTENU_TOTAL) {
    journaliser({ outil: 'ollama-chat-v1', etape: 'chat', moteur: 'ollama', cause: 'trop_gros' });
    return {
      error:
        `prompt trop gros (${messages.length} messages, ${total} caracteres ; ` +
        `max ${OLLAMA_MAX_MESSAGES} messages et ${OLLAMA_MAX_CONTENU_TOTAL} caracteres)`,
    };
  }

  const baseOllama = resoudreBaseOllama();
  if (!baseOllama.ok) {
    journaliser({ outil: 'ollama-chat-v1', etape: 'chat', moteur: 'ollama', cause: 'base_refusee' });
    return { error: baseOllama.erreur };
  }

  const body: Record<string, unknown> = { model, messages, stream: false };
  if (temperature !== undefined) {
    body.options = { temperature };
  }
  // Format standard OpenAI (ADR-0013 point 1), utilise seulement si l API native repond 404, 405 ou 501.
  const bodyOpenAI: Record<string, unknown> = { model, messages, stream: false };
  if (temperature !== undefined) bodyOpenAI.temperature = temperature;

  try {
    await prendreUnePlace();
  } catch (e) {
    journaliser({ outil: 'ollama-chat-v1', etape: 'chat', moteur: 'ollama', cause: 'file_pleine' });
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const controller = new AbortController();
  // Le delai couvre aussi la lecture du corps (avant : arrete des les en-tetes recus).
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const appeler = async (url: string, corps: Record<string, unknown>): Promise<ReponseChat> => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
        signal: controller.signal,
        // Cible locale : aucune redirection (meme regle que SearXNG, review Gaby 16/11).
        redirect: 'error',
      });
      if (!res.ok) {
        let text = '';
        try {
          const brut = await lireTexteBorne(res, 64_000);
          text = brut ?? (await res.text());
        } catch {
          text = '';
        }
        return {
          ok: false,
          statut: res.status,
          erreur: retirerInvisibles(`HTTP ${res.status}: ${(text || res.statusText || '').slice(0, OLLAMA_MAX_ERREUR)}`),
        };
      }
      const brut = await lireTexteBorne(res, OLLAMA_MAX_CORPS_OCTETS);
      return { ok: true, donnees: brut === null ? await res.json() : JSON.parse(brut) };
    };

    let reponse = await appeler(`${baseOllama.url}/api/chat`, body);
    let format: 'natif' | 'openai' = 'natif';
    if (!reponse.ok && [404, 405, 501].includes(reponse.statut)) {
      const essai = await appeler(`${baseOllama.url}/v1/chat/completions`, bodyOpenAI);
      // Si le format standard echoue aussi, on garde l'erreur de l'API native : c'est la plus parlante (« model not found »).
      if (essai.ok) {
        reponse = essai;
        format = 'openai';
      }
    }
    if (!reponse.ok) {
      journaliser({ outil: 'ollama-chat-v1', etape: 'chat', moteur: 'ollama', cause: 'http', http: reponse.statut, duree_ms: Date.now() - start });
      return { error: reponse.erreur };
    }

    const data = reponse.donnees as {
      message?: { content?: unknown };
      choices?: Array<{ message?: { content?: unknown } }>;
      model?: unknown;
      total_duration?: unknown;
    };
    const elapsed = Date.now() - start;
    const brutContenu = format === 'openai' ? data?.choices?.[0]?.message?.content : data?.message?.content;
    const contenu = typeof brutContenu === 'string' ? brutContenu : '';
    return {
      // Review Gaby CX4 : la sortie du modele peut porter des caracteres invisibles (balises Unicode).
      response: retirerInvisibles(contenu.slice(0, OLLAMA_MAX_REPONSE)),
      ...(contenu.length > OLLAMA_MAX_REPONSE ? { response_tronquee: true as const } : {}),
      model: typeof data?.model === 'string' ? retirerInvisibles(data.model.slice(0, 200)) : model,
      duration_ms:
        typeof data?.total_duration === 'number' && Number.isFinite(data.total_duration) && data.total_duration > 0
          ? Math.round(data.total_duration / 1_000_000)
          : elapsed,
      ...(format === 'openai' ? { format: 'openai' as const } : {}),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const delai = e instanceof Error && e.name === 'AbortError';
    journaliser({
      outil: 'ollama-chat-v1',
      etape: 'chat',
      moteur: 'ollama',
      cause: delai ? 'delai' : /trop volumineuse|JSON|Unexpected|position/i.test(msg) ? 'reponse_invalide' : 'refuse',
      duree_ms: Date.now() - start,
    });
    return { error: retirerInvisibles(`Ollama unreachable: ${msg.slice(0, OLLAMA_MAX_ERREUR)}`) };
  } finally {
    clearTimeout(t);
    rendreLaPlace();
  }
}
export const tool: IrisTool = {
  id: 'ollama-chat-v1',
  description:
    'Envoie un message a un modele Ollama local et recoit la reponse (POST /api/chat, stream: false ; format standard OpenAI /v1/chat/completions si l API native repond 404, 405 ou 501). Erreur propre si Ollama eteint ou modele absent. ' +
    `Au plus ${OLLAMA_MAX_MESSAGES} messages et ${OLLAMA_MAX_CONTENU_TOTAL} caracteres ; reponse coupee a ${OLLAMA_MAX_REPONSE} caracteres.`,
  category: 'ollama',
  inputSchema: {
    model: z.string().min(1).max(200).describe('Nom du modele Ollama (ex: llama3, mistral)'),
    messages: z
      .array(
        z.object({
          role: z.string().max(32).describe('Role: system, user, ou assistant'),
          content: z.string().max(OLLAMA_MAX_CONTENU_TOTAL).describe('Contenu du message'),
        }),
      )
      .max(OLLAMA_MAX_MESSAGES)
      .describe(`Messages de la conversation (au plus ${OLLAMA_MAX_MESSAGES})`),
    temperature: z.number().optional().describe('Temperature (optionnel, ex: 0.7)'),
  },
  execute: async (input) => {
    const model = input.model as string;
    const messages = input.messages as Array<{ role: string; content: string }>;
    const temperature = input.temperature as number | undefined;
    const result = await ollamaChat(model, messages, temperature);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      // A18 : un echec porte isError (le client ne le prend pas pour une reponse du modele).
      ...('error' in result ? { isError: true as const } : {}),
    };
  },
};
