// Bob 2026-11-07 : repli de la cle Qdrant sur le fichier partage du RAG (lecture seule).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tmpEnv(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'iris-qkey-'));
  const file = join(dir, '.env');
  writeFileSync(file, text, 'utf8');
  return file;
}

async function freshHeader(): Promise<Record<string, string>> {
  vi.resetModules();
  const mod = await import('../src/qdrant-auth.js');
  return mod.qdrantApiKeyHeader();
}

describe('qdrantApiKeyHeader', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('la variable de la config MCP passe avant le fichier', async () => {
    vi.stubEnv('QDRANT_API_KEY', 'depuis-env');
    vi.stubEnv('QDRANT_ENV_FILE', tmpEnv('QDRANT_READ_ONLY_API_KEY=depuis-fichier\n'));
    expect(await freshHeader()).toEqual({ 'api-key': 'depuis-env' });
  });

  it('sans variable : cle lecture seule du fichier', async () => {
    vi.stubEnv('QDRANT_API_KEY', '');
    vi.stubEnv('QDRANT_READ_ONLY_API_KEY', '');
    vi.stubEnv('QDRANT_ENV_FILE', tmpEnv('QDRANT_API_KEY=admin\r\nQDRANT_READ_ONLY_API_KEY="lecture"\r\n'));
    expect(await freshHeader()).toEqual({ 'api-key': 'lecture' });
  });

  it('jamais la cle admin depuis le fichier', async () => {
    vi.stubEnv('QDRANT_API_KEY', '');
    vi.stubEnv('QDRANT_READ_ONLY_API_KEY', '');
    vi.stubEnv('QDRANT_ENV_FILE', tmpEnv('QDRANT_API_KEY=admin\nQDRANT__SERVICE__API_KEY=serveur\n'));
    expect(await freshHeader()).toEqual({});
  });

  it('fichier absent : pas d en-tete', async () => {
    vi.stubEnv('QDRANT_API_KEY', '');
    vi.stubEnv('QDRANT_READ_ONLY_API_KEY', '');
    vi.stubEnv('QDRANT_ENV_FILE', join(tmpdir(), 'absent-iris-qkey', '.env'));
    expect(await freshHeader()).toEqual({});
  });
});
