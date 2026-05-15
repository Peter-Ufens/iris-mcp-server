import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool } from '../src/tools/exchange-rates-v1.js';

const mockFetch = vi.mocked(fetchJson);

describe('exchange-rates-v1', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('retourne les taux de change', async () => {
    mockFetch.mockResolvedValue({
      result: 'success',
      base_code: 'EUR',
      time_last_update_utc: '2026-05-15T00:00:00Z',
      rates: { USD: 1.08, GBP: 0.85, JPY: 160 },
    });
    const result = await tool.execute({ base: 'EUR', targets: ['USD', 'GBP'] });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.base).toBe('EUR');
    expect(payload.rates.USD).toBe(1.08);
    expect(payload.rates.GBP).toBe(0.85);
    expect(payload.rates.JPY).toBeUndefined();
  });

  it('retourne une erreur si result fail', async () => {
    mockFetch.mockResolvedValue({ result: 'error', base_code: 'EUR', rates: {} });
    const result = await tool.execute({ base: 'EUR' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBeTruthy();
  });

  it('a l ID et la categorie corrects', () => {
    expect(tool.id).toBe('exchange-rates-v1');
    expect(tool.category).toBe('cloud');
  });
});
