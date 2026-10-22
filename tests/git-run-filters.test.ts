import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listGitAttributeFilters, GitAttributesScanTruncatedError, buildSafeGitEnv, runGit, GitCommandError, listGitAttributeDrivers, assertNoRepoConfigInclude } from '../src/utils/git-run.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'iris-gitattr-'));
  await writeFile(join(dir, '.gitattributes'), '*.a filter=rootf\n', 'utf-8');
  const sub = join(dir, 'sub', 'deep');
  await mkdir(sub, { recursive: true });
  await writeFile(join(dir, 'sub', '.gitattributes'), '*.b filter=subf\n', 'utf-8');
  await writeFile(join(sub, '.gitattributes'), '*.c filter=deepf\n', 'utf-8');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('listGitAttributeFilters (F2 : .gitattributes imbriques)', () => {
  it('detecte les filtres de la racine ET des sous-dossiers', () => {
    const names = listGitAttributeFilters(dir);
    expect(names).toContain('rootf');
    expect(names).toContain('subf');
    expect(names).toContain('deepf');
  });
});
describe('listGitAttributeFilters fail-closed si plafond', () => {
  it('refuse (throw) si trop de .gitattributes imbriques (> 50)', async () => {
    const flooded = await mkdtemp(join(tmpdir(), 'iris-gitattr-flood-'));
    try {
      await writeFile(join(flooded, '.gitattributes'), '*.a filter=rootf\n', 'utf-8');
      for (let i = 0; i < 55; i++) {
        const d = join(flooded, `d${i}`);
        await mkdir(d);
        await writeFile(join(d, '.gitattributes'), `*.x filter=f${i}\n`, 'utf-8');
      }
      expect(() => listGitAttributeFilters(flooded)).toThrow(GitAttributesScanTruncatedError);
    } finally {
      await rm(flooded, { recursive: true, force: true });
    }
  });
});
describe('listGitAttributeFilters fail-closed profondeur', () => {
  it('refuse si .gitattributes plus profond que max depth', async () => {
    const deep = await mkdtemp(join(tmpdir(), 'iris-gitattr-deep-'));
    try {
      await writeFile(join(deep, '.gitattributes'), '*.a filter=rootf\n', 'utf-8');
      let d = deep;
      for (let i = 0; i < 6; i++) {
        d = join(d, `L${i}`);
        await mkdir(d);
      }
      await writeFile(join(d, '.gitattributes'), '*.b filter=deep6\n', 'utf-8');
      expect(() => listGitAttributeFilters(deep)).toThrow(GitAttributesScanTruncatedError);
    } finally {
      await rm(deep, { recursive: true, force: true });
    }
  });
});

describe('buildSafeGitEnv (scrub insensible a la casse, Windows)', () => {
  it('retire les variantes de casse des variables git dangereuses', () => {
    const env = buildSafeGitEnv({
      PATH: '/usr/bin',
      HOME: '/home/x',
      Git_Ssh_Command: 'evil',
      git_askpass: 'evil',
      Git_Config_Count: '1',
      git_config_key_0: 'core.pager',
      Git_Config_Value_0: 'evil',
      git_config_parameters: "'core.pager=evil'",
      Git_Dir: '/tmp/evil',
      git_config_nosystem: '0',
      Git_Terminal_Prompt: '1',
      GIT_AUTHOR_NAME: 'garde',
    });
    const upper = Object.keys(env).map((k) => k.toUpperCase());
    for (const k of ['GIT_SSH_COMMAND', 'GIT_ASKPASS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_PARAMETERS', 'GIT_DIR']) {
      expect(upper).not.toContain(k);
    }
    expect(upper.filter((k) => k === 'GIT_CONFIG_NOSYSTEM')).toHaveLength(1);
    expect(upper.filter((k) => k === 'GIT_TERMINAL_PROMPT')).toHaveLength(1);
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.GIT_AUTHOR_NAME).toBe('garde');
  });
});

/** Depot de test : identite locale, aucun reseau. */
async function depotPiege(prefix: string): Promise<{ d: string; g: (...a: string[]) => void }> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  const g = (...a: string[]) => {
    execFileSync('git', ['-C', d, ...a], { stdio: 'ignore' });
  };
  g('init', '-q');
  g('config', 'user.name', 't');
  g('config', 'user.email', 't@t');
  return { d, g };
}

describe('F2 nom de filtre avec point (review Gaby R5)', () => {
  it('filter=a.b est neutralise en entier : git status ne lance pas le clean du depot', async () => {
    const { d, g } = await depotPiege('dotf-');
    await writeFile(join(d, '.gitattributes'), '*.txt filter=a.b\n');
    await writeFile(join(d, 'f.txt'), 'x\n');
    g('add', '.gitattributes', 'f.txt');
    g('config', 'filter.a.b.clean', `sh -c 'touch "${d}/PWNED"; cat'`);
    await utimes(join(d, 'f.txt'), new Date('2001-01-01'), new Date('2001-01-01'));
    expect(listGitAttributeFilters(d)).toContain('a.b');
    runGit(d, ['status', '--porcelain']);
    expect(existsSync(join(d, 'PWNED'))).toBe(false);
    await rm(d, { recursive: true, force: true });
  });

  it('filter=a=b refuse (fail-closed)', async () => {
    const { d } = await depotPiege('eqf-');
    await writeFile(join(d, '.gitattributes'), '*.txt filter=a=b\n');
    expect(() => runGit(d, ['status', '--porcelain'])).toThrow(GitCommandError);
    await rm(d, { recursive: true, force: true });
  });
});

describe('F2 filter.NOM.process (review Gaby R5)', () => {
  it('git status ne lance pas un filtre process du depot', async () => {
    const { d, g } = await depotPiege('procf-');
    await writeFile(join(d, '.gitattributes'), '*.txt filter=pp\n');
    await writeFile(join(d, 'f.txt'), 'x\n');
    g('add', '.gitattributes', 'f.txt');
    g('config', 'filter.pp.process', `sh -c 'touch "${d}/PWNED"; exit 1'`);
    await utimes(join(d, 'f.txt'), new Date('2001-01-01'), new Date('2001-01-01'));
    try {
      runGit(d, ['status', '--porcelain']);
    } catch {
      /* le resultat importe peu : seul compte l'absence d'execution */
    }
    expect(existsSync(join(d, 'PWNED'))).toBe(false);
    await rm(d, { recursive: true, force: true });
  });
});

describe('D3 drivers diff=NOM / merge=NOM neutralises', () => {
  it('collecte filter, diff et merge (noms avec point compris)', async () => {
    const { d } = await depotPiege('drv-');
    await writeFile(join(d, '.gitattributes'), '*.a diff=dx merge=mx\n*.b diff=d.y -merge\n[attr]m filter=fz\n');
    const r = listGitAttributeDrivers(d);
    expect(r.diff.sort()).toEqual(['d.y', 'dx']);
    expect(r.merge).toEqual(['mx']);
    expect(r.filter).toEqual(['fz']);
    await rm(d, { recursive: true, force: true });
  });

  it('git log -p ne lance ni diff.NOM.command ni diff.NOM.textconv du depot', async () => {
    const { d, g } = await depotPiege('drvlog-');
    await writeFile(join(d, '.gitattributes'), '*.txt diff=dx\n');
    await writeFile(join(d, 'f.txt'), 'a\n');
    g('add', '.');
    g('commit', '-q', '-m', 'un');
    await writeFile(join(d, 'f.txt'), 'b\n');
    g('commit', '-q', '-am', 'deux');
    g('config', 'diff.dx.textconv', `sh -c 'touch "${d}/PWNED-tc"; cat "$0"'`);
    g('config', 'diff.dx.command', `sh -c 'touch "${d}/PWNED-cmd"'`);
    runGit(d, ['log', '-p', '-2']);
    runGit(d, ['diff', 'HEAD~1', 'HEAD']);
    expect(existsSync(join(d, 'PWNED-tc'))).toBe(false);
    expect(existsSync(join(d, 'PWNED-cmd'))).toBe(false);
    await rm(d, { recursive: true, force: true });
  });

  it('merge ne lance pas merge.NOM.driver du depot', async () => {
    const { d, g } = await depotPiege('drvmerge-');
    await writeFile(join(d, '.gitattributes'), '*.txt merge=mx\n');
    await writeFile(join(d, 'f.txt'), 'base\n');
    g('add', '.');
    g('commit', '-q', '-m', 'base');
    g('checkout', '-q', '-b', 'autre');
    await writeFile(join(d, 'f.txt'), 'autre\n');
    g('commit', '-q', '-am', 'autre');
    g('checkout', '-q', '-');
    await writeFile(join(d, 'f.txt'), 'principal\n');
    g('commit', '-q', '-am', 'principal');
    g('config', 'merge.mx.driver', `sh -c 'touch "${d}/PWNED-merge"; exit 0'`);
    try {
      runGit(d, ['merge', '--no-edit', 'autre']);
    } catch {
      /* conflit attendu avec le merge texte par defaut */
    }
    expect(existsSync(join(d, 'PWNED-merge'))).toBe(false);
    await rm(d, { recursive: true, force: true });
  });

  it('diff=a=b refuse (fail-closed)', async () => {
    const { d } = await depotPiege('drveq-');
    await writeFile(join(d, '.gitattributes'), '*.txt diff=a=b\n');
    expect(() => runGit(d, ['status', '--porcelain'])).toThrow(GitCommandError);
    await rm(d, { recursive: true, force: true });
  });
});

/** Chemin pour un fichier de config git ecrit a la main : '/' partout (valide aussi sous Windows). */
const cfgPath = (p: string) => p.replace(/\\/g, '/');

describe('D1 include.path / includeIf du depot : fail-closed', () => {
  it('depot sans include : operation autorisee', async () => {
    const { d } = await depotPiege('inc0-');
    expect(() => assertNoRepoConfigInclude(d)).not.toThrow();
    expect(() => runGit(d, ['status', '--porcelain'])).not.toThrow();
    await rm(d, { recursive: true, force: true });
  });

  it('[include] path dans .git/config : refuse et rien n est execute', async () => {
    const { d, g } = await depotPiege('inc1-');
    const piege = join(d, 'piege.cfg');
    // Fichier de config ecrit a la main : chemins en '/' (sous Windows, la barre inverse est un
    // echappement git et rend la ligne invalide : smoke PC Peter 22/10).
    const dg = cfgPath(d);
    await writeFile(piege, `[core]\n\tfsmonitor = sh -c 'touch "${dg}/PWNED"'\n[diff "x"]\n\ttextconv = sh -c 'touch "${dg}/PWNED"'\n`);
    g('config', 'include.path', piege);
    expect(() => runGit(d, ['status', '--porcelain'])).toThrow(/include/);
    expect(existsSync(join(d, 'PWNED'))).toBe(false);
    await rm(d, { recursive: true, force: true });
  });

  it('[includeIf "gitdir:..."] dans .git/config : refuse', async () => {
    const { d, g } = await depotPiege('inc2-');
    g('config', 'includeIf.gitdir:/.path', join(d, 'x.cfg'));
    expect(() => runGit(d, ['log', '-1'])).toThrow(GitCommandError);
    await rm(d, { recursive: true, force: true });
  });

  it('include dans config.worktree d un worktree lie : refuse', async () => {
    const { d, g } = await depotPiege('inc3-');
    g('commit', '-q', '--allow-empty', '-m', 'init');
    const wt = `${d}-wt`;
    g('worktree', 'add', '-q', wt);
    g('config', 'extensions.worktreeConfig', 'true');
    execFileSync('git', ['-C', wt, 'config', '--worktree', 'include.path', join(d, 'x.cfg')]);
    expect(() => runGit(wt, ['status', '--porcelain'])).toThrow(/worktree/);
    await rm(wt, { recursive: true, force: true });
    await rm(d, { recursive: true, force: true });
  });

  it('include dans la config GLOBALE (Peter, R3) : reste autorise', async () => {
    const { d } = await depotPiege('inc4-');
    const globalCfg = join(d, '..', `glob-${Date.now()}.cfg`);
    await writeFile(globalCfg, `[include]\n\tpath = ${cfgPath(join(d, 'perso.cfg'))}\n[user]\n\tname = t\n\temail = t@t\n`);
    const avant = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = globalCfg;
    try {
      expect(() => runGit(d, ['status', '--porcelain'])).not.toThrow();
    } finally {
      if (avant === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = avant;
      await rm(globalCfg, { force: true });
      await rm(d, { recursive: true, force: true });
    }
  });
});

describe('D1 smoke Windows : config globale reelle et config cassee', () => {
  it('config globale ecrite par git avec un chemin Windows (barres inverses echappees) : autorise', async () => {
    const { d } = await depotPiege('incw-');
    const globalCfg = join(d, '..', `globw-${Date.now()}.cfg`);
    await writeFile(globalCfg, '');
    // `git config --file` echappe lui-meme les barres inverses, comme `git config --global`.
    execFileSync('git', ['config', '--file', globalCfg, 'include.path', 'C:\\Users\\Exemple\\.gitconfig-perso']);
    execFileSync('git', ['config', '--file', globalCfg, 'includeIf.gitdir/i:C:/Projets/.path', 'C:\\Users\\Exemple\\.gitconfig-pro']);
    execFileSync('git', ['config', '--file', globalCfg, 'user.name', 't']);
    execFileSync('git', ['config', '--file', globalCfg, 'user.email', 't@t']);
    const avant = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = globalCfg;
    try {
      expect(() => assertNoRepoConfigInclude(d)).not.toThrow();
      expect(() => runGit(d, ['status', '--porcelain'])).not.toThrow();
    } finally {
      if (avant === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = avant;
      await rm(globalCfg, { force: true });
      await rm(d, { recursive: true, force: true });
    }
  });

  it('fichier inclus invalide : refus fail-closed avec message clair', async () => {
    const { d, g } = await depotPiege('incbad-');
    const casse = join(d, 'casse.cfg');
    await writeFile(casse, '[core]\n\tx = "a\\Ub"\n');
    g('config', 'include.path', casse);
    expect(() => runGit(d, ['status', '--porcelain'])).toThrow(/Config git illisible/);
    await rm(d, { recursive: true, force: true });
  });
});
