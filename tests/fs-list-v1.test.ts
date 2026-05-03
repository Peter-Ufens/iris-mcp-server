import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tool } from '../src/tools/fs-list-v1.js';

let testDir: string;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'iris-fs-list-'));
  await writeFile(join(testDir, 'fichier.ts'), 'export default 42;', 'utf-8');
  await writeFile(join(testDir, 'data.json'), '{}', 'utf-8');
  await mkdir(join(testDir, 'sous-dossier'));
  process.env.ALLOWED_ROOTS = testDir;
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
  delete process.env.ALLOWED_ROOTS;
});

describe('fs-list-v1', () => {
  it('liste un repertoire dans ALLOWED_ROOTS', async () => {
    const result = await tool.execute({ path: testDir });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.entries).toHaveLength(3);

    const names = payload.entries.map((e: { name: string }) => e.name).sort();
    expect(names).toEqual(['data.json', 'fichier.ts', 'sous-dossier']);

    const dir = payload.entries.find((e: { name: string }) => e.name === 'sous-dossier');
    expect(dir.type).toBe('dir');

    const file = payload.entries.find((e: { name: string }) => e.name === 'fichier.ts');
    expect(file.type).toBe('file');
    expect(file.size_bytes).toBeGreaterThan(0);
  });

  it('filtre avec un pattern glob', async () => {
    const result = await tool.execute({ path: testDir, pattern: '*.ts' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].name).toBe('fichier.ts');
  });

  it('refuse un repertoire hors ALLOWED_ROOTS', async () => {
    const result = await tool.execute({ path: 'C:\\Windows\\System32' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('hors des repertoires autorises');
  });

  it('a l\'ID et la categorie corrects', () => {
    expect(tool.id).toBe('fs-list-v1');
    expect(tool.category).toBe('filesystem');
  });
});
