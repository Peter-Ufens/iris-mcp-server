import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tool } from '../src/tools/git-diff-v1.js';
import { git, initTestRepo } from './git-helpers.js';

let testDir: string;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'iris-git-diff-'));
  await initTestRepo(testDir);
  process.env.ALLOWED_ROOTS = testDir;
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
  delete process.env.ALLOWED_ROOTS;
});

describe('git-diff-v1', () => {
  it('retourne une diff unstaged', async () => {
    await writeFile(join(testDir, 'README.md'), '# modified\n', 'utf-8');
    const result = await tool.execute({ repo_path: testDir, mode: 'unstaged' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.mode).toBe('unstaged');
    expect(payload.diff).toContain('README.md');
  });

  it('retourne une diff staged', async () => {
    await writeFile(join(testDir, 'staged.txt'), 'staged\n', 'utf-8');
    git(testDir, ['add', 'staged.txt']);
    const result = await tool.execute({ repo_path: testDir, mode: 'staged' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.mode).toBe('staged');
    expect(payload.diff).toContain('staged.txt');
  });

  it('tronque une diff trop longue', async () => {
    await writeFile(join(testDir, 'big.txt'), 'a\n', 'utf-8');
    git(testDir, ['add', 'big.txt']);
    git(testDir, ['commit', '-m', 'add big file']);
    await writeFile(join(testDir, 'big.txt'), 'x'.repeat(9000), 'utf-8');
    const result = await tool.execute({ repo_path: testDir, mode: 'unstaged' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.truncated).toBe(true);
    expect(payload.diff).toContain('[diff tronquee apres 8000 chars]');
  });

  it('a l ID et la categorie corrects', () => {
    expect(tool.id).toBe('git-diff-v1');
    expect(tool.category).toBe('git');
  });
});
