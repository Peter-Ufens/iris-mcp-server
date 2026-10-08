import { describe, it, expect, afterEach, vi } from 'vitest';
import { tool } from '../src/tools/time-v1.js';

async function at(iso: string, timezone: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
  const result = await tool.execute({ timezone });
  return JSON.parse(result.content[0]!.text);
}

describe('time-v1 (horloge figee)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('jeudi d ete a Paris : +02:00, day_of_week 4 (dimanche = 0), semaine 41', async () => {
    const p = await at('2026-10-08T06:34:00Z', 'Europe/Paris');
    expect(p.datetime).toBe('2026-10-08T08:34:00+02:00');
    expect(p.date).toBe('2026-10-08');
    expect(p.day_of_week).toBe(4);
    expect(p.week_number).toBe(41);
  });

  it('hiver a Paris : +01:00', async () => {
    const p = await at('2026-01-15T12:00:00Z', 'Europe/Paris');
    expect(p.utc_offset).toBe('+01:00');
    expect(p.week_number).toBe(3);
  });

  it('dimanche = 0', async () => {
    const p = await at('2026-10-11T10:00:00Z', 'Europe/Paris');
    expect(p.day_of_week).toBe(0);
  });

  it('New York : la date locale peut etre la veille de la date UTC', async () => {
    const p = await at('2026-10-08T03:00:00Z', 'America/New_York');
    expect(p.datetime).toBe('2026-10-07T23:00:00-04:00');
    expect(p.day_of_week).toBe(3);
  });

  it('UTC : decalage +00:00', async () => {
    const p = await at('2026-10-08T06:34:00Z', 'UTC');
    expect(p.datetime).toBe('2026-10-08T06:34:00+00:00');
  });

  it('1er janvier 2027 = semaine ISO 53 de 2026', async () => {
    const p = await at('2027-01-01T12:00:00Z', 'Europe/Paris');
    expect(p.week_number).toBe(53);
  });
});

describe('time-v1', () => {
  it('retourne l heure locale Europe/Paris sans reseau', async () => {
    const result = await tool.execute({ timezone: 'Europe/Paris' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBeUndefined();
    expect(payload.timezone).toBe('Europe/Paris');
    expect(payload.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.datetime).toContain(payload.date);
    expect(payload.utc_offset).toMatch(/^[+-]\d{2}:\d{2}$/);
    expect(typeof payload.day_of_week).toBe('number');
    expect(payload.day_of_week).toBeGreaterThanOrEqual(0);
    expect(payload.day_of_week).toBeLessThanOrEqual(6);
    expect(payload.source).toBe('local-intl');
  });

  it('refuse un fuseau inconnu', async () => {
    const result = await tool.execute({ timezone: 'Mars/Olympus' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBeTruthy();
    expect(String(payload.error)).toMatch(/Fuseau|invalide|unknown|RangeError/i);
  });

  it('a l ID et la categorie iris (calcul local)', () => {
    expect(tool.id).toBe('time-v1');
    expect(tool.category).toBe('iris');
  });
});
