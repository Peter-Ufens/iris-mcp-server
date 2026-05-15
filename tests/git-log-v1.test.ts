import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tool } from '../src/tools/git-log-v1.js';
import { git, initTestRepo } from './git-helpers.js';

let testDir: string;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'iris-git-log-'));
  await initTestRepo(testDir);
  git(testDir, ['commit', '--allow-empty', '-m', 'second commit']);
  process.env.ALLOWED_ROOTS = testDir;
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
  delete process.env.ALLOWED_ROOTS;
});

describe('git-log-v1', () => {
  it('retourne les commits recents', async () => {
    const result = await tool.execute({ repo_path: testDir, limit: 5 });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.commits.length).toBeGreaterThanOrEqual(2);
    expect(payload.commits[0].hash).toBeTruthy();
    expect(payload.commits[0].message).toBeTruthy();
  });

  it('plafonne limit a 50', async () => {
    const result = await tool.execute({ repo_path: testDir, limit: 999 });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.limit).toBe(50);
  });

  it('a l ID et la categorie corrects', () => {
    expect(tool.id).toBe('git-log-v1');
    expect(tool.category).toBe('git');
  });
});
