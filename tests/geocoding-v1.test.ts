import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool } from '../src/tools/geocoding-v1.js';

const mockFetch = vi.mocked(fetchJson);

describe('geocoding-v1', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('retourne les coordonnees d une ville', async () => {
    mockFetch.mockResolvedValue({
      results: [
        {
          name: 'Lyon',
          latitude: 45.75,
          longitude: 4.85,
          country: 'France',
          timezone: 'Europe/Paris',
          country_code: 'FR',
        },
      ],
    });
    const result = await tool.execute({ city: 'Lyon', language: 'fr' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.city).toBe('Lyon');
    expect(payload.latitude).toBe(45.75);
    expect(payload.timezone).toBe('Europe/Paris');
  });

  it('retourne une erreur si ville introuvable', async () => {
    mockFetch.mockResolvedValue({ results: [] });
    const result = await tool.execute({ city: 'XyzNotAPlace999' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('introuvable');
  });

  it('retourne une erreur si l API echoue', async () => {
    mockFetch.mockRejectedValue(new Error('Timeout'));
    const result = await tool.execute({ city: 'Paris' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('Timeout');
  });

  it('utilise language fr par defaut', async () => {
    mockFetch.mockResolvedValue({
      results: [
        {
          name: 'Paris',
          latitude: 48.85,
          longitude: 2.35,
          country: 'France',
          timezone: 'Europe/Paris',
          country_code: 'FR',
        },
      ],
    });
    await tool.execute({ city: 'Paris' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('language=fr'),
    );
  });
});
