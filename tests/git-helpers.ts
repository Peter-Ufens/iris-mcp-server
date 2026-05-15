import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function git(repoPath: string, args: string[]): string {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf-8' }).trim();
}

export async function initTestRepo(dir: string): Promise<void> {
  git(dir, ['init']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test User']);
  await writeFile(join(dir, 'README.md'), '# test repo\n', 'utf-8');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'initial commit']);
}
