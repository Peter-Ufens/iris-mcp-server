import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool } from '../src/tools/time-v1.js';

const mockFetch = vi.mocked(fetchJson);

describe('time-v1', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('retourne l heure pour un fuseau horaire', async () => {
    mockFetch.mockResolvedValue({
      timezone: 'Europe/Paris',
      datetime: '2026-05-15T10:00:00.123456+02:00',
      utc_offset: '+02:00',
      day_of_week: 4,
      week_number: 20,
    });
    const result = await tool.execute({ timezone: 'Europe/Paris' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.timezone).toBe('Europe/Paris');
    expect(payload.datetime).toBeTruthy();
    expect(payload.day_of_week).toBe(4);
  });

  it('retourne une erreur si l API echoue', async () => {
    mockFetch.mockRejectedValue(new Error('HTTP 500'));
    const result = await tool.execute({ timezone: 'Europe/Paris' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBeTruthy();
  });

  it('a l ID et la categorie corrects', () => {
    expect(tool.id).toBe('time-v1');
    expect(tool.category).toBe('cloud');
  });
});
