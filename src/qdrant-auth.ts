import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * En-tête api-key pour Qdrant vault (:6334).
 * Ordre :
 *  1. env QDRANT_API_KEY, puis env QDRANT_READ_ONLY_API_KEY (config MCP, ex. Cursor) ;
 *  2. sinon (Bob 2026-11-07) la cle LECTURE SEULE du fichier .env partage du projet RAG voisin
 *     (QDRANT_ENV_FILE, sinon <dossier parent du depot>/../RAG/stack/.env, hors Git).
 *     Les outils RAG d'Iris ne font que lire : jamais la cle admin depuis ce fichier.
 * Sans ce repli, un client MCP sans la variable prend un 401.
 * La valeur n'est jamais journalisee.
 */
// src/ ou dist/ -> depot -> dossier parent -> dossier des projets -> RAG/stack/.env
const DEFAULT_QDRANT_ENV_FILE = fileURLToPath(new URL('../../../RAG/stack/.env', import.meta.url));
let cachedFileKey: string | undefined;

export function readKeyFromEnvFile(name: string, file: string): string {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return '';
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1 || line.slice(0, eq).trim() !== name) continue;
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val[val.length - 1] === val[0]) {
      val = val.slice(1, -1).trim();
    }
    return val;
  }
  return '';
}

function keyFromSharedFile(): string {
  if (cachedFileKey === undefined) {
    const file = process.env.QDRANT_ENV_FILE?.trim() || DEFAULT_QDRANT_ENV_FILE;
    cachedFileKey = readKeyFromEnvFile('QDRANT_READ_ONLY_API_KEY', file);
  }
  return cachedFileKey;
}

export function qdrantApiKeyHeader(): Record<string, string> {
  const key = (
    process.env.QDRANT_API_KEY ||
    process.env.QDRANT_READ_ONLY_API_KEY ||
    keyFromSharedFile() ||
    ''
  ).trim();
  return key ? { 'api-key': key } : {};
}
