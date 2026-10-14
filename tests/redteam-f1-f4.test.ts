/**
 * Correctifs red team Bob 14/10 (F1-F4).
 * Preuves : depot piege / HTML dense / glob ReDoS / gros fichier.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  rmSync,
  mkdirSync,
  chmodSync,
} from 'node:fs';
import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { htmlToText } from '../src/utils/html-text.js';
import { tool as fsList } from '../src/tools/fs-list-v1.js';
import { tool as fsRead } from '../src/tools/fs-read-v1.js';
import { tool as gitStatus } from '../src/tools/git-status-v1.js';
import { tool as gitDiff } from '../src/tools/git-diff-v1.js';
import { tool as gitCommit } from '../src/tools/git-commit-v1.js';
import { loadZonePatterns } from '../src/tools/rag-query-v1.js';

describe('F2 htmlToText plafond / borne', () => {
  it('reste rapide sur beaucoup de < (≤ 500 ms)', () => {
    const bomb = '<'.repeat(200_000);
    const t0 = Date.now();
    const text = htmlToText(bomb);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(500);
    expect(typeof text).toBe('string');
  });
});

describe('F3 fs-list ReDoS pattern', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'iris-f3-'));
    await writeFile(join(testDir, 'ok.ts'), 'x', 'utf-8');
    process.env.ALLOWED_ROOTS = testDir;
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    delete process.env.ALLOWED_ROOTS;
  });

  it('refuse un pattern avec trop de *', async () => {
    const evil = `${'*a'.repeat(12)}*b`;
    const t0 = Date.now();
    const result = await fsList.execute({ path: testDir, pattern: evil });
    const ms = Date.now() - t0;
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toMatch(/trop complexe/i);
    expect(ms).toBeLessThan(500);
  });
});

describe('F4 fs-read plafond', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'iris-f4-'));
    await writeFile(join(testDir, 'gros.txt'), 'A'.repeat(250_000), 'utf-8');
    process.env.ALLOWED_ROOTS = testDir;
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    delete process.env.ALLOWED_ROOTS;
  });

  it('tronque au-dela de max_chars (defaut 200k)', async () => {
    const result = await fsRead.execute({ path: join(testDir, 'gros.txt') });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.truncated).toBe(true);
    expect(payload.content.length).toBe(200_000);
    expect(payload.max_chars).toBe(200_000);
  });

  it('respecte max_chars explicite', async () => {
    const result = await fsRead.execute({
      path: join(testDir, 'gros.txt'),
      max_chars: 1000,
    });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.truncated).toBe(true);
    expect(payload.content.length).toBe(1000);
  });
});

describe('F1 git depot piege (pas d execution externe)', () => {
  let base: string;
  let root: string;
  let depot: string;
  let mDiff: string;
  let mHook: string;
  let mFsm: string;
  const prevRoots = process.env.ALLOWED_ROOTS;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'iris-f1-'));
    root = join(base, 'racine');
    depot = join(root, 'depot');
    mkdirSync(depot, { recursive: true });
    const g = (...a: string[]) =>
      execFileSync('git', ['-C', depot, ...a], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    g('init', '-q');
    g('config', 'user.name', 'rt');
    g('config', 'user.email', 'rt@x');
    g('config', 'commit.gpgsign', 'false');
    writeFileSync(join(depot, 'a.txt'), 'v1\n');
    g('add', 'a.txt');
    g('commit', '-q', '-m', 'init');

    mDiff = join(root, 'PREUVE-diff.txt');
    mHook = join(root, 'PREUVE-hook.txt');
    mFsm = join(root, 'PREUVE-fsmonitor.txt');

    const batDiff = join(root, 'd.bat');
    writeFileSync(batDiff, `@echo x> "${mDiff}"\r\n`);
    const fsm = join(root, 'f.bat');
    writeFileSync(fsm, `@echo x> "${mFsm}"\r\n`);

    g('config', 'diff.external', batDiff);
    writeFileSync(join(depot, 'a.txt'), 'v2\n');
    const hookPath = join(depot, '.git', 'hooks', 'pre-commit');
    writeFileSync(hookPath, `#!/bin/sh\ntouch "${mHook.replace(/\\/g, '/')}"\n`);
    try {
      chmodSync(hookPath, 0o755);
    } catch {
      /* Windows : chmod optionnel */
    }
    writeFileSync(join(depot, 'b.txt'), 'b\n');
    g('add', 'b.txt');
    g('config', 'core.fsmonitor', fsm);

    process.env.ALLOWED_ROOTS = root;
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
    if (prevRoots === undefined) delete process.env.ALLOWED_ROOTS;
    else process.env.ALLOWED_ROOTS = prevRoots;
  });

  it('git-status ne declenche pas core.fsmonitor', async () => {
    await gitStatus.execute({ repo_path: depot });
    expect(existsSync(mFsm)).toBe(false);
  });

  it('git-diff ne declenche pas diff.external', async () => {
    await gitDiff.execute({ repo_path: depot, mode: 'unstaged' });
    expect(existsSync(mDiff)).toBe(false);
  });

  it('git-commit ignore le hook pre-commit', async () => {
    await gitCommit.execute({ repo_path: depot, message: 'commit test rt f1' });
    expect(existsSync(mHook)).toBe(false);
  });
});

describe('F5 RAG fallback fail-closed elargi', () => {
  it('sans ZONE_A_PATTERNS_FILE : couvre 10-prive / journal / personnes / atoms', () => {
    const prev = process.env.ZONE_A_PATTERNS_FILE;
    delete process.env.ZONE_A_PATTERNS_FILE;
    try {
      const p = loadZonePatterns();
      expect(p.alwaysExclude).toEqual(
        expect.arrayContaining([
          'conversations/',
          '_prive',
          '10-prive',
          '03-vie',
          '/journal/',
          'personnes.md',
          '/atoms/',
        ]),
      );
    } finally {
      if (prev === undefined) delete process.env.ZONE_A_PATTERNS_FILE;
      else process.env.ZONE_A_PATTERNS_FILE = prev;
    }
  });
});
