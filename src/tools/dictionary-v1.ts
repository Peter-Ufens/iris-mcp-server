import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchJson } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

interface DictionaryEntry {
  word: string;
  phonetic?: string;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{ definition?: string; example?: string }>;
  }>;
}

export const tool: IrisTool = {
  id: 'dictionary-v1',
  description:
    'Retourne la definition d un mot en anglais (dictionaryapi.dev, sans cle API).',
  category: 'cloud',
  inputSchema: {
    word: z.string().min(1).describe('Mot en anglais a definir'),
  },
  execute: async (input) => {
    const word = (input.word as string).trim().toLowerCase();
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    try {
      const data = await fetchJson<DictionaryEntry[]>(url);
      const entry = data[0];
      if (!entry) {
        return errorResult(`Mot introuvable : ${word}`);
      }
      const definitions: Array<{
        partOfSpeech: string;
        definition: string;
        example: string | null;
      }> = [];
      for (const meaning of entry.meanings ?? []) {
        for (const def of meaning.definitions ?? []) {
          if (definitions.length >= 3) break;
          if (def.definition) {
            definitions.push({
              partOfSpeech: meaning.partOfSpeech ?? '',
              definition: def.definition,
              example: def.example ?? null,
            });
          }
        }
        if (definitions.length >= 3) break;
      }
      return jsonResult({
        word: entry.word,
        phonetic: entry.phonetic ?? null,
        definitions,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('404')) {
        return errorResult(`Mot introuvable : ${word}`);
      }
      return errorResult(msg);
    }
  },
};
