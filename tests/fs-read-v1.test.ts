import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tool } from '../src/tools/fs-read-v1.js';

let testDir: string;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'iris-fs-read-'));
  await writeFile(join(testDir, 'hello.txt'), 'Bonjour Iris', 'utf-8');
  process.env.ALLOWED_ROOTS = testDir;
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
  delete process.env.ALLOWED_ROOTS;
});

describe('fs-read-v1', () => {
  it('lit un fichier dans ALLOWED_ROOTS', async () => {
    const result = await tool.execute({ path: join(testDir, 'hello.txt') });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.content).toBe('Bonjour Iris');
    expect(payload.size_bytes).toBeGreaterThan(0);
    expect(payload.encoding).toBe('utf-8');
  });

  it('refuse un fichier hors ALLOWED_ROOTS', async () => {
    const result = await tool.execute({ path: 'C:\\Windows\\System32\\config\\sam' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('hors des repertoires autorises');
  });

  it('retourne une erreur si le fichier n\'existe pas', async () => {
    const result = await tool.execute({ path: join(testDir, 'inexistant.txt') });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBeTruthy();
  });

  it('a l\'ID et la categorie corrects', () => {
    expect(tool.id).toBe('fs-read-v1');
    expect(tool.category).toBe('filesystem');
  });
});
