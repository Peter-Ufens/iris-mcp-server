import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validatePath, PathGuardError } from '../src/utils/path-guard.js';

let testDir: string;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'iris-guard-'));
  await writeFile(join(testDir, 'ok.txt'), 'safe', 'utf-8');
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('path-guard', () => {
  it('accepte un chemin sous allowed root', async () => {
    const result = await validatePath(join(testDir, 'ok.txt'), [testDir]);
    expect(result).toContain('ok.txt');
  });

  it('refuse un chemin hors allowed root', async () => {
    await expect(
      validatePath('C:\\Windows\\System32\\notepad.exe', [testDir]),
    ).rejects.toThrow(PathGuardError);
  });

  it('refuse si ALLOWED_ROOTS est vide', async () => {
    await expect(validatePath(join(testDir, 'ok.txt'), [])).rejects.toThrow(
      'ALLOWED_ROOTS non configure',
    );
  });

  it('refuse le path traversal (..) apres resolution', async () => {
    // Chemin qui tente de sortir via ..
    await expect(
      validatePath(join(testDir, '..', '..', 'Windows', 'System32'), [testDir]),
    ).rejects.toThrow(PathGuardError);
  });

  it('accepte le root lui-meme', async () => {
    const result = await validatePath(testDir, [testDir]);
    expect(result).toBeTruthy();
  });

  it('refuse un chemin qui est un prefixe du root (false positive)', async () => {
    // testDir = /tmp/iris-guard-XXXX
    // attacker tries /tmp/iris-guard-XXXXmalicious
    await expect(
      validatePath(testDir + 'malicious', [testDir]),
    ).rejects.toThrow(PathGuardError);
  });
});
