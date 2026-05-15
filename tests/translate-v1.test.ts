import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool } from '../src/tools/translate-v1.js';

const mockFetch = vi.mocked(fetchJson);

describe('translate-v1', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('retourne le texte traduit', async () => {
    mockFetch.mockResolvedValue({
      responseStatus: 200,
      responseData: { translatedText: 'Hello', match: 1 },
    });
    const result = await tool.execute({ text: 'Bonjour', from: 'fr', to: 'en' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.translated).toBe('Hello');
    expect(payload.original).toBe('Bonjour');
  });

  it('retourne une erreur si responseStatus != 200', async () => {
    mockFetch.mockResolvedValue({ responseStatus: 403 });
    const result = await tool.execute({ text: 'test' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('403');
  });

  it('retourne une erreur si l API echoue', async () => {
    mockFetch.mockRejectedValue(new Error('Timeout'));
    const result = await tool.execute({ text: 'hello' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('Timeout');
  });

  it('utilise fr vers en par defaut', async () => {
    mockFetch.mockResolvedValue({
      responseStatus: 200,
      responseData: { translatedText: 'Hi', match: 1 },
    });
    await tool.execute({ text: 'Salut' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('langpair=fr|en'),
    );
  });
});
