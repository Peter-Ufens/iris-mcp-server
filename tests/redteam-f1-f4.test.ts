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
  it('reste rapide sur beaucoup de < (≤ 2 s, plafond 100k deja applique)', () => {
    // Seuil 2 s : flocon selon la machine (~200 a ~900 ms mesures) ; pas le claim F6 RSS.
    const bomb = '<'.repeat(200_000);
    const t0 = Date.now();
    const text = htmlToText(bomb);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(2000);
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

  it('refuse un pattern avec plus de 4 * (R1)', async () => {
    const evil = `${'*a'.repeat(5)}*b`; // 6 etoiles
    const t0 = Date.now();
    const result = await fsList.execute({ path: testDir, pattern: evil });
    const ms = Date.now() - t0;
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toMatch(/trop complexe/i);
    expect(payload.error).toMatch(/max 4 \*/i);
    expect(ms).toBeLessThan(50);
  });

  it('reste rapide meme si 4 * autorises (pas de gel)', async () => {
    await writeFile(join(testDir, `${'a'.repeat(60)}.txt`), 'x', 'utf-8');
    const motif = `${'*a'.repeat(3)}*b`; // 4 etoiles
    const t0 = Date.now();
    const result = await fsList.execute({ path: testDir, pattern: motif });
    const ms = Date.now() - t0;
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBeUndefined();
    expect(payload.entries).toEqual([]);
    expect(ms).toBeLessThan(50);
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

describe('R2 F1 textconv via .gitattributes', () => {
  let base: string;
  let root: string;
  let depot: string;
  let mTc: string;
  const prevRoots = process.env.ALLOWED_ROOTS;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'iris-r2-tc-'));
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
    writeFileSync(join(depot, 'secret.txt'), 'v1\n');
    writeFileSync(join(depot, '.gitattributes'), 'secret.txt diff=pwn\n');
    g('add', '.');
    g('commit', '-q', '-m', 'init');
    mTc = join(root, 'PREUVE-textconv.txt');
    const posix = `/${mTc.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, d: string) => d.toLowerCase())}`;
    g('config', 'diff.pwn.textconv', `touch '${posix}' #`);
    writeFileSync(join(depot, 'secret.txt'), 'v2-modifie\n');
    process.env.ALLOWED_ROOTS = root;
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
    if (prevRoots === undefined) delete process.env.ALLOWED_ROOTS;
    else process.env.ALLOWED_ROOTS = prevRoots;
  });

  it('git-diff ne declenche pas textconv', async () => {
    await gitDiff.execute({ repo_path: depot, mode: 'unstaged' });
    await gitDiff.execute({ repo_path: depot, mode: 'head' });
    expect(existsSync(mTc)).toBe(false);
  });
});

describe('R3 F1 commit avec identite globale seulement', () => {
  it('reussit sans user.name local (identite globale)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'iris-r3-id-'));
    const root = join(base, 'racine');
    const depot = join(root, 'depot');
    mkdirSync(depot, { recursive: true });
    const globalCfg = join(base, 'fakeglobal.gitconfig');
    writeFileSync(globalCfg, '[user]\n  name = Peter Global\n  email = peter@global\n');
    const gSetup = (...a: string[]) =>
      execFileSync('git', ['-C', depot, ...a], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: globalCfg,
          GIT_CONFIG_SYSTEM: 'NUL',
        },
      });
    gSetup('init', '-q');
    writeFileSync(join(depot, 'a.txt'), 'x\n');
    gSetup('add', 'a.txt');

    const prev = {
      ALLOWED_ROOTS: process.env.ALLOWED_ROOTS,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    };
    process.env.ALLOWED_ROOTS = root;
    process.env.HOME = base;
    process.env.USERPROFILE = base;
    process.env.GIT_CONFIG_GLOBAL = globalCfg;
    try {
      const r = await gitCommit.execute({
        repo_path: depot,
        message: 'commit identite globale r3',
      });
      const payload = JSON.parse(r.content[0]!.text);
      expect(payload.error).toBeUndefined();
      expect(payload.commit_hash).toBeTruthy();
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('F5 RAG fallback fail-closed elargi', () => {
  it('sans ZONE_A_PATTERNS_FILE : couvre <dossier-reserve-1> / journal / personnes / atoms', () => {
    const prev = process.env.ZONE_A_PATTERNS_FILE;
    delete process.env.ZONE_A_PATTERNS_FILE;
    try {
      const p = loadZonePatterns();
      expect(p.alwaysExclude).toEqual(
        expect.arrayContaining([
          'conversations/',
          '_prive',
          '<dossier-reserve-1>',
          '<dossier-reserve-2>',
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
