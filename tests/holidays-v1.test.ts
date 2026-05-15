import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool } from '../src/tools/holidays-v1.js';

const mockFetch = vi.mocked(fetchJson);

describe('holidays-v1', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('retourne les jours feries', async () => {
    mockFetch.mockResolvedValue([
      { date: '2026-01-01', name: "New Year's Day", localName: 'Jour de l an' },
    ]);
    const result = await tool.execute({ country_code: 'FR', year: 2026 });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.country_code).toBe('FR');
    expect(payload.year).toBe(2026);
    expect(payload.count).toBe(1);
    expect(payload.holidays[0].date).toBe('2026-01-01');
  });

  it('retourne une erreur si l API echoue', async () => {
    mockFetch.mockRejectedValue(new Error('Timeout'));
    const result = await tool.execute({ country_code: 'FR' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBeTruthy();
  });

  it('a l ID et la categorie corrects', () => {
    expect(tool.id).toBe('holidays-v1');
    expect(tool.category).toBe('cloud');
  });
});
