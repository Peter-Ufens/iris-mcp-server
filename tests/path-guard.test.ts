import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { execFileSync } from 'node:child_process';
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

  it('refuse un dossier intermediaire symlink/jonction hors root (F1)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iris-f1-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'iris-f1-out-'));
    await writeFile(join(outside, 'secret.txt'), 'LEAK', 'utf-8');
    const link = join(root, 'via-link');
    try {
      if (platform() === 'win32') {
        execFileSync('cmd', ['/c', 'mklink', '/J', link, outside], { stdio: 'ignore' });
      } else {
        await symlink(outside, link, 'dir');
      }
      await expect(validatePath(join(link, 'secret.txt'), [root])).rejects.toThrow(PathGuardError);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('refuse un chemin INEXISTANT sous un parent symlink/jonction hors root (F1b)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iris-f1b-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'iris-f1b-out-'));
    const link = join(root, 'via-link');
    try {
      if (platform() === 'win32') {
        execFileSync('cmd', ['/c', 'mklink', '/J', link, outside], { stdio: 'ignore' });
      } else {
        await symlink(outside, link, 'dir');
      }
      // absent.txt n'existe pas : le chemin logique passerait, mais le parent sort du root.
      await expect(validatePath(join(link, 'absent.txt'), [root])).rejects.toThrow(PathGuardError);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('accepte un chemin sous une racine qui est elle-meme une jonction (F1 roots)', async () => {
    const realRoot = await mkdtemp(join(tmpdir(), 'iris-f1r-real-'));
    await writeFile(join(realRoot, 'f.txt'), 'ok', 'utf-8');
    const parent = await mkdtemp(join(tmpdir(), 'iris-f1r-parent-'));
    const aliasRoot = join(parent, 'alias');
    try {
      if (platform() === 'win32') {
        execFileSync('cmd', ['/c', 'mklink', '/J', aliasRoot, realRoot], { stdio: 'ignore' });
      } else {
        await symlink(realRoot, aliasRoot, 'dir');
      }
      // La racine autorisee est la jonction : un fichier dessous ne doit PAS etre refuse a tort.
      const result = await validatePath(join(aliasRoot, 'f.txt'), [aliasRoot]);
      expect(result).toContain('f.txt');
    } finally {
      await rm(parent, { recursive: true, force: true });
      await rm(realRoot, { recursive: true, force: true });
    }
  });
});
