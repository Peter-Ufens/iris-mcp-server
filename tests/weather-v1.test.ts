import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool } from '../src/tools/weather-v1.js';

const mockFetch = vi.mocked(fetchJson);

describe('weather-v1', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('retourne la meteo courante', async () => {
    mockFetch.mockResolvedValue({
      latitude: 48.82,
      longitude: 7.8,
      timezone: 'Europe/Paris',
      current: {
        time: '2026-05-15T10:00',
        temperature_2m: 18.5,
        wind_speed_10m: 12,
        weather_code: 1,
      },
    });
    const result = await tool.execute({
      latitude: 48.82,
      longitude: 7.8,
      timezone: 'Europe/Paris',
    });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.current.temperature_2m).toBe(18.5);
    expect(payload.timezone).toBe('Europe/Paris');
  });

  it('retourne une erreur si l API echoue', async () => {
    mockFetch.mockRejectedValue(new Error('Timeout'));
    const result = await tool.execute({ latitude: 48.82, longitude: 7.8 });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('Timeout');
  });

  it('a l ID et la categorie corrects', () => {
    expect(tool.id).toBe('weather-v1');
    expect(tool.category).toBe('cloud');
  });
});
