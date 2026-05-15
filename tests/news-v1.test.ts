import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool } from '../src/tools/news-v1.js';

const mockFetch = vi.mocked(fetchJson);

describe('news-v1', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('retourne les articles Hacker News', async () => {
    mockFetch.mockResolvedValue({
      hits: [
        {
          title: 'Test story',
          url: 'https://example.com',
          points: 100,
          num_comments: 42,
          author: 'alice',
        },
      ],
    });
    const result = await tool.execute({ limit: 5 });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.count).toBe(1);
    expect(payload.articles[0].comments).toBe(42);
    expect(payload.articles[0].title).toBe('Test story');
  });

  it('retourne une erreur si l API echoue', async () => {
    mockFetch.mockRejectedValue(new Error('Timeout'));
    const result = await tool.execute({ limit: 3 });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('Timeout');
  });

  it('retourne count 0 si hits vide', async () => {
    mockFetch.mockResolvedValue({ hits: [] });
    const result = await tool.execute({ limit: 5 });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.count).toBe(0);
    expect(payload.articles).toEqual([]);
  });

  it('utilise limit 5 par defaut', async () => {
    mockFetch.mockResolvedValue({ hits: [] });
    await tool.execute({});
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('hitsPerPage=5'),
    );
  });
});
