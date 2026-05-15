import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool } from '../src/tools/sunrise-v1.js';

const mockFetch = vi.mocked(fetchJson);

describe('sunrise-v1', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('retourne lever et coucher du soleil', async () => {
    mockFetch.mockResolvedValue({
      status: 'OK',
      results: {
        sunrise: '2026-05-15T04:12:00+00:00',
        sunset: '2026-05-15T19:45:00+00:00',
        solar_noon: '2026-05-15T12:00:00+00:00',
        day_length: 55800,
      },
    });
    const result = await tool.execute({ latitude: 48.82, longitude: 7.79, date: '2026-05-15' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.sunrise).toBeTruthy();
    expect(payload.day_length).toBe('15h 30m');
  });

  it('retourne une erreur si status != OK', async () => {
    mockFetch.mockResolvedValue({ status: 'INVALID_REQUEST' });
    const result = await tool.execute({ latitude: 48.82, longitude: 7.79 });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('INVALID_REQUEST');
  });

  it('retourne une erreur si l API echoue', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const result = await tool.execute({ latitude: 48.82, longitude: 7.79 });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBeTruthy();
  });

  it('utilise date today par defaut', async () => {
    mockFetch.mockResolvedValue({
      status: 'OK',
      results: {
        sunrise: 'a',
        sunset: 'b',
        solar_noon: 'c',
        day_length: 3600,
      },
    });
    await tool.execute({ latitude: 48.82, longitude: 7.79 });
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('date=today'));
  });
});
