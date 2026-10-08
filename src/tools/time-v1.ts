import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { jsonResult, errorResult } from '../utils/git-run.js';

function weekNumber(d: Date): number {
  // ISO week number. Lecture en UTC : `d` est minuit UTC du jour local, un
  // getDate() local reculerait d'un jour sur un serveur a l'ouest de Greenwich.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatOffset(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const sign = totalMin >= 0 ? '+' : '-';
  const abs = Math.abs(totalMin);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

/**
 * Heure locale via Intl (aucun reseau). Remplace WorldTimeAPI (en panne 08/10).
 * Categorie `iris` : calcul local serveur (pas de valeur `local` dans ToolCategory).
 */
export const tool: IrisTool = {
  id: 'time-v1',
  description:
    "Retourne l'heure courante pour un fuseau IANA (calcul local, sans appel reseau).",
  category: 'iris',
  inputSchema: {
    timezone: z
      .string()
      .optional()
      .default('Europe/Paris')
      .describe('Fuseau horaire IANA (ex: Europe/Paris, America/New_York)'),
  },
  execute: async (input) => {
    const timezone = (input.timezone as string | undefined) ?? 'Europe/Paris';
    try {
      // Valide le fuseau : Intl throw RangeError si inconnu
      const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'longOffset',
      });
      const now = new Date();
      const parts = Object.fromEntries(
        fmt.formatToParts(now).map((p) => [p.type, p.value]),
      ) as Record<string, string>;
      const y = parts.year!;
      const mo = parts.month!;
      const da = parts.day!;
      const h = parts.hour!;
      const mi = parts.minute!;
      const s = parts.second!;
      const date = `${y}-${mo}-${da}`;
      // offset depuis timeZoneName (ex: GMT+2 ou GMT+02:00)
      let utc_offset = '+00:00';
      const tzn = parts.timeZoneName || '';
      const om = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(tzn);
      if (om) {
        const sign = om[1]!;
        const hh = String(Number(om[2])).padStart(2, '0');
        const mm = om[3] ?? '00';
        utc_offset = `${sign}${hh}:${mm}`;
      } else {
        // fallback : diff vs UTC wall for same instant
        const asUtc = new Date(
          now.toLocaleString('en-US', { timeZone: 'UTC' }),
        );
        const asTz = new Date(
          now.toLocaleString('en-US', { timeZone: timezone }),
        );
        utc_offset = formatOffset(asTz.getTime() - asUtc.getTime());
      }
      const datetime = `${date}T${h}:${mi}:${s}${utc_offset}`;
      // day_of_week : 0=dimanche … 6=samedi, comme WorldTimeAPI
      // (schema : "current day number of the week, where sunday is 0")
      const weekdayLong = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
      }).format(now);
      const map: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const day_of_week = map[weekdayLong] ?? 0;
      // week_number : ISO week of the local calendar date
      const localDate = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(da)));
      const week_number = weekNumber(localDate);

      return jsonResult({
        timezone,
        datetime,
        utc_offset,
        day_of_week,
        week_number,
        date,
        source: 'local-intl',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Invalid time zone|RangeError/i.test(msg) || e instanceof RangeError) {
        return errorResult(`Fuseau inconnu ou invalide: ${timezone}`);
      }
      return errorResult(msg);
    }
  },
};
