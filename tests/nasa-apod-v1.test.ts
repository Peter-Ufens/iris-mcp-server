import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool } from '../src/tools/nasa-apod-v1.js';

const mockFetch = vi.mocked(fetchJson);

describe('nasa-apod-v1', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('retourne l APOD du jour', async () => {
    mockFetch.mockResolvedValue({
      title: 'Galaxy',
      date: '2026-05-15',
      explanation: 'A'.repeat(400),
      url: 'https://apod.nasa.gov/image.jpg',
      media_type: 'image',
    });
    const result = await tool.execute({});
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.title).toBe('Galaxy');
    expect(payload.explanation.length).toBeLessThanOrEqual(303);
    expect(payload.explanation.endsWith('...')).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.not.stringContaining('&date='),
    );
  });

  it('retourne l APOD pour une date donnee', async () => {
    mockFetch.mockResolvedValue({
      title: 'Moon',
      date: '2020-01-01',
      explanation: 'Short text',
      url: 'https://example.com',
      media_type: 'image',
    });
    await tool.execute({ date: '2020-01-01' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('date=2020-01-01'),
    );
  });

  it('note media_type video', async () => {
    mockFetch.mockResolvedValue({
      title: 'Video APOD',
      date: '2026-05-15',
      explanation: 'Video explanation',
      url: 'https://youtube.com/watch',
      media_type: 'video',
    });
    const result = await tool.execute({});
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.media_type).toBe('video');
    expect(payload.note).toBe('media_type: video');
  });

  it('retourne une erreur si l API echoue', async () => {
    mockFetch.mockRejectedValue(new Error('Rate limit'));
    const result = await tool.execute({});
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('Rate limit');
  });
});
