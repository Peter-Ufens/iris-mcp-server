import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tool } from '../src/tools/git-status-v1.js';
import { git, initTestRepo } from './git-helpers.js';

let testDir: string;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'iris-git-status-'));
  await initTestRepo(testDir);
  process.env.ALLOWED_ROOTS = testDir;
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
  delete process.env.ALLOWED_ROOTS;
});

describe('git-status-v1', () => {
  it('retourne le statut d un repo valide', async () => {
    const result = await tool.execute({ repo_path: testDir });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.parsed.branch).toBeTruthy();
    expect(payload.raw).toContain('# branch.head');
  });

  it('detecte un fichier non suivi', async () => {
    await writeFile(join(testDir, 'nouveau.txt'), 'x', 'utf-8');
    const result = await tool.execute({ repo_path: testDir });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.parsed.untracked.some((p: string) => p.includes('nouveau.txt'))).toBe(
      true,
    );
  });

  it('refuse un chemin hors ALLOWED_ROOTS', async () => {
    const result = await tool.execute({ repo_path: 'C:\\Windows' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('hors des repertoires autorises');
  });

  it('refuse un dossier sans depot Git', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'iris-not-git-'));
    process.env.ALLOWED_ROOTS = `${testDir},${empty}`;
    const result = await tool.execute({ repo_path: empty });
    await rm(empty, { recursive: true, force: true });
    process.env.ALLOWED_ROOTS = testDir;
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('pas un depot Git valide');
  });

  it('a l ID et la categorie corrects', () => {
    expect(tool.id).toBe('git-status-v1');
    expect(tool.category).toBe('git');
  });
});
