import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/utils/http-fetch.js', () => ({ fetchJson: vi.fn() }));

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool, dimanchePaques, joursAlsaceMoselle, NOTE_ALSACE_MOSELLE } from '../src/tools/holidays-v1.js';

/** Review Bob 16/11 : redirection 1046 (12/11), feries d Alsace-Moselle absents de la reponse. */

const mockFetch = vi.mocked(fetchJson);
const NATIONAUX_2026 = [
  { date: '2026-01-01', name: "New Year's Day", localName: "Jour de l'an" },
  { date: '2026-04-06', name: 'Easter Monday', localName: 'Lundi de Paques' },
  { date: '2026-12-25', name: 'Christmas Day', localName: 'Noel' },
];
const P = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text) as Record<string, unknown>;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(NATIONAUX_2026);
});

describe('holidays-v1 : Alsace-Moselle', () => {
  it('Paques juste sur des annees connues', () => {
    expect(dimanchePaques(2026)).toBe('2026-04-05');
    expect(dimanchePaques(2025)).toBe('2025-04-20');
    expect(dimanchePaques(2024)).toBe('2024-03-31');
    expect(dimanchePaques(2027)).toBe('2027-03-28');
  });

  it('les 2 jours locaux de 2026 : Vendredi saint 03/04 (avec sa condition) et 26/12', () => {
    const j = joursAlsaceMoselle(2026);
    expect(j.map((x) => x.date)).toEqual(['2026-04-03', '2026-12-26']);
    expect(j[0]!.condition).toMatch(/temple protestant/);
  });

  it('FR sans region : la REPONSE porte la note (avant : seule la description prevenait)', async () => {
    const p = P(await tool.execute({ country_code: 'FR', year: 2026 }));
    expect(p.note).toBe(NOTE_ALSACE_MOSELLE);
    expect(p.count).toBe(3);
  });

  it('FR + region alsace-moselle : 2 jours ajoutes, marques local, tries par date', async () => {
    const p = P(await tool.execute({ country_code: 'FR', year: 2026, region: 'alsace-moselle' }));
    const h = p.holidays as Array<Record<string, unknown>>;
    expect(p.count).toBe(5);
    expect(h.map((x) => x.date)).toEqual(['2026-01-01', '2026-04-03', '2026-04-06', '2026-12-25', '2026-12-26']);
    expect(h.filter((x) => x.local === 'Alsace-Moselle')).toHaveLength(2);
    expect(p.note).toBeUndefined();
  });

  it('autre pays : pas de note, et region refusee', async () => {
    expect(P(await tool.execute({ country_code: 'DE', year: 2026 })).note).toBeUndefined();
    const r = await tool.execute({ country_code: 'DE', year: 2026, region: 'alsace-moselle' });
    expect(r.isError).toBe(true);
  });
});
