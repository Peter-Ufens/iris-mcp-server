import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool } from '../src/tools/random-fact-v1.js';

const mockFetch = vi.mocked(fetchJson);

describe('random-fact-v1', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('retourne un fait aleatoire', async () => {
    mockFetch.mockResolvedValue({
      id: '1',
      text: 'Honey never spoils.',
      source: 'science',
      source_url: 'https://example.com',
      language: 'en',
      permalink: 'https://example.com/fact/1',
    });
    const result = await tool.execute({ language: 'en' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.fact).toContain('Honey');
    expect(payload.language).toBe('en');
  });

  it('retourne une erreur si l API echoue', async () => {
    mockFetch.mockRejectedValue(new Error('HTTP 500'));
    const result = await tool.execute({});
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBeTruthy();
  });

  it('appelle l API avec la langue demandee', async () => {
    mockFetch.mockResolvedValue({
      id: '2',
      text: 'Fakt',
      source: 'x',
      source_url: 'https://x.com',
      language: 'de',
      permalink: 'https://x.com/2',
    });
    await tool.execute({ language: 'de' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('language=de'),
    );
  });

  it('utilise language en par defaut', async () => {
    mockFetch.mockResolvedValue({
      id: '3',
      text: 'Fact',
      source: 'x',
      source_url: 'https://x.com',
      language: 'en',
      permalink: 'https://x.com/3',
    });
    await tool.execute({});
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('language=en'),
    );
  });
});
