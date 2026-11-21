/**
 * Chemin absolu LOCAL : refuse les chemins reseau UNC (\\\\hote\\partage, //hote/partage), qui feraient
 * charger un programme depuis une autre machine (review Gaby 16/11, A8 et reveil SearXNG).
 */
import { isAbsolute } from 'node:path';

export function estCheminLocalAbsolu(p: string): boolean {
  if (!isAbsolute(p)) return false;
  return !(p.startsWith('\\\\') || p.startsWith('//'));
}
