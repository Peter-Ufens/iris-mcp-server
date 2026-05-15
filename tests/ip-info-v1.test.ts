import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool } from '../src/tools/ip-info-v1.js';

const mockFetch = vi.mocked(fetchJson);

describe('ip-info-v1', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('retourne les infos IP', async () => {
    mockFetch.mockResolvedValue({
      status: 'success',
      query: '8.8.8.8',
      country: 'United States',
      regionName: 'Virginia',
      city: 'Ashburn',
      lat: 39.03,
      lon: -77.5,
      isp: 'Google',
    });
    const result = await tool.execute({ ip: '8.8.8.8' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.ip).toBe('8.8.8.8');
    expect(payload.country).toBe('United States');
  });

  it('retourne une erreur si status fail', async () => {
    mockFetch.mockResolvedValue({ status: 'fail', message: 'invalid query' });
    const result = await tool.execute({ ip: 'bad' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBeTruthy();
  });

  it('a l ID et la categorie corrects', () => {
    expect(tool.id).toBe('ip-info-v1');
    expect(tool.category).toBe('cloud');
  });
});
