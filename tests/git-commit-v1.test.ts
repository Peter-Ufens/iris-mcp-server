import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tool } from '../src/tools/git-commit-v1.js';
import { git, initTestRepo } from './git-helpers.js';

let testDir: string;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'iris-git-commit-'));
  await initTestRepo(testDir);
  process.env.ALLOWED_ROOTS = testDir;
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
  delete process.env.ALLOWED_ROOTS;
});

describe('git-commit-v1', () => {
  it('cree un commit sur fichiers deja stages', async () => {
    await writeFile(join(testDir, 'commit-me.txt'), 'data\n', 'utf-8');
    git(testDir, ['add', 'commit-me.txt']);
    const result = await tool.execute({
      repo_path: testDir,
      message: 'feat: test commit via tool',
    });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.commit_hash).toBeTruthy();
    expect(payload.output).toContain('feat: test commit via tool');
  });

  it('refuse un commit sans fichiers stages', async () => {
    const result = await tool.execute({
      repo_path: testDir,
      message: 'feat: rien a committer',
    });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('Rien a committer');
  });

  it('ne fait pas de git add implicite', async () => {
    await writeFile(join(testDir, 'unstaged-only.txt'), 'x\n', 'utf-8');
    const result = await tool.execute({
      repo_path: testDir,
      message: 'feat: should fail without stage',
    });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toContain('Rien a committer');
  });

  it('a l ID et la categorie corrects', () => {
    expect(tool.id).toBe('git-commit-v1');
    expect(tool.category).toBe('git');
  });
});
