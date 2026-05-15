import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool } from '../src/tools/dictionary-v1.js';

const mockFetch = vi.mocked(fetchJson);

describe('dictionary-v1', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('retourne les definitions d un mot', async () => {
    mockFetch.mockResolvedValue([
      {
        word: 'hello',
        phonetic: '/həˈləʊ/',
        meanings: [
          {
            partOfSpeech: 'exclamation',
            definitions: [{ definition: 'used as a greeting', example: 'hello there' }],
          },
        ],
      },
    ]);
    const result = await tool.execute({ word: 'hello' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.word).toBe('hello');
    expect(payload.definitions.length).toBeGreaterThan(0);
  });

  it('retourne une erreur si mot introuvable', async () => {
    mockFetch.mockRejectedValue(new Error('HTTP 404 depuis url'));
    const result = await tool.execute({ word: 'xyznotaword123' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('introuvable');
  });

  it('a l ID et la categorie corrects', () => {
    expect(tool.id).toBe('dictionary-v1');
    expect(tool.category).toBe('cloud');
  });
});
