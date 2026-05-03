import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import type { IrisTool } from './_types.js';

const startTime = Date.now();
let registeredTools: IrisTool[] = [];

/** Liste des outils enregistres (disponible apres discoverTools). */
export function getRegisteredTools(): readonly IrisTool[] {
  return registeredTools;
}

/** Secondes depuis le demarrage du serveur. */
export function getUptimeSeconds(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

/**
 * Scanne src/tools/ (ou dist/tools/), importe dynamiquement chaque fichier
 * qui n'est pas prefixe par `_`, et collecte les exports `tool: IrisTool`.
 */
export async function discoverTools(): Promise<IrisTool[]> {
  const dir = dirname(fileURLToPath(import.meta.url));
  const files = await readdir(dir);

  const toolFiles = files
    .filter((f) => {
      if (f.startsWith('_')) return false;
      if (f.endsWith('.d.ts') || f.endsWith('.map')) return false;
      return f.endsWith('.js') || f.endsWith('.ts');
    })
    .sort();

  const discovered: IrisTool[] = [];
  for (const file of toolFiles) {
    const filePath = join(dir, file);
    const mod: Record<string, unknown> = await import(
      pathToFileURL(filePath).href
    );
    if (
      mod.tool &&
      typeof (mod.tool as IrisTool).id === 'string' &&
      typeof (mod.tool as IrisTool).execute === 'function'
    ) {
      discovered.push(mod.tool as IrisTool);
    }
  }

  registeredTools = discovered;
  return discovered;
}
