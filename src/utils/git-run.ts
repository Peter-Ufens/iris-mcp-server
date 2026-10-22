import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';

export class GitCommandError extends Error {
  constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = 'GitCommandError';
  }
}

/** Chemins « vides » pour couper hooks locaux (F1 red team 14/10). */
const DEV_NULL = platform() === 'win32' ? 'NUL' : '/dev/null';

/**
 * Prefixe -c pour neutraliser les reglages locaux d'un depot piege
 * (core.fsmonitor, hooksPath, pager, gpg.program, signatures).
 * Note : `-c diff.external=` (vide) casse `git diff` sous Windows
 * (« cannot spawn : ») → on utilise `--no-ext-diff` (+ `--no-textconv` R2).
 *
 * R3 Bob : ne PAS mettre GIT_CONFIG_GLOBAL=NUL (casse user.name/email global
 * de Peter ; la menace depot piege est deja couverte par -c / --no-*).
 *
 * F2 Gaby 22/10 : gpg.program + filter.* (noms lus dans .gitattributes).
 * Micro-lot review Gaby/Bob 22/10 : sshCommand / askPass / credential / include.
 * Surface Iris = status/log/diff/commit seulement ; dette restante = SECURITY.md.
 */
const SAFE_GIT_PREFIX = [
  '-c',
  'core.fsmonitor=',
  '-c',
  `core.hooksPath=${DEV_NULL}`,
  '-c',
  'core.pager=cat',
  '-c',
  'gpg.program=',
  '-c',
  'gpg.ssh.program=',
  '-c',
  'gpg.x509.program=',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'log.showSignature=false',
  '-c',
  'merge.verifySignatures=false',
  '-c',
  'core.sshCommand=',
  '-c',
  'core.askPass=',
  '-c',
  'core.editor=',
  '-c',
  'sequence.editor=',
  '-c',
  'credential.helper=',
] as const;
// Note : `-c include.path=` (vide) casse git (« relative config includes must come
// from files »). include.path / includeIf = dette documentee dans SECURITY.md.

/**
 * Variables d'environnement git qui lancent un programme : retirees de l'env passe a
 * git, au cas ou l'environnement du serveur MCP serait empoisonne (defense en profondeur,
 * micro-lot F2 Gaby 22/10). On ne touche PAS GIT_CONFIG_GLOBAL/SYSTEM (R3 : identite Peter).
 */
const GIT_ENV_TO_SCRUB = [
  'GIT_SSH_COMMAND',
  'GIT_SSH',
  'GIT_ASKPASS',
  'GIT_EXTERNAL_DIFF',
  'GIT_PAGER',
  'GIT_EDITOR',
  'GIT_SEQUENCE_EDITOR',
  'GIT_PROXY_COMMAND',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_EXEC_PATH',
  'GIT_TEMPLATE_DIR',
];

const GIT_ENV_TO_SCRUB_UPPER = new Set(GIT_ENV_TO_SCRUB.map((k) => k.toUpperCase()));

/**
 * Env git sure : reconstituee a chaque appel (pas de snapshot figé a l import).
 * Comparaison insensible a la casse : sous Windows les variables d'environnement le sont,
 * une cle `Git_Ssh_Command` survivrait sinon a un `delete env.GIT_SSH_COMMAND` sur la copie
 * (objet simple). Sans effet de bord sous Linux/macOS (git ne lit que les majuscules).
 */
export function buildSafeGitEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    const upper = key.toUpperCase();
    if (GIT_ENV_TO_SCRUB_UPPER.has(upper)) continue;
    // GIT_CONFIG_KEY_n / VALUE_n eventuels (injection config).
    if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(upper)) continue;
    // Les cles forcees ci-dessous remplacent toute variante de casse.
    if (upper === 'GIT_CONFIG_NOSYSTEM' || upper === 'GIT_TERMINAL_PROMPT') continue;
    env[key] = value;
  }
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

/** Plafonds du parcours des .gitattributes imbriques (micro-lot F2 Gaby 22/10). */
const GITATTR_MAX_DEPTH = 4;
const GITATTR_MAX_FILES = 50;

/** Recherche bornee d un .gitattributes sous dir (budget noeuds). */
function hasGitAttributesBelow(dir: string, budget: number): boolean {
  const stack = [dir];
  let left = budget;
  while (stack.length > 0 && left > 0) {
    const cur = stack.pop()!;
    left -= 1;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === '.git') continue;
      if (e.name === '.gitattributes') return true;
      if (e.isDirectory()) stack.push(join(cur, e.name));
    }
  }
  // Budget epuise avec encore des dossiers : prudent = considere tronque.
  return stack.length > 0;
}

export class GitAttributesScanTruncatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitAttributesScanTruncatedError';
  }
}

/** Collecte les chemins .gitattributes : racine, .git/info/attributes, et imbriques (borne).
 * Si le plafond fichiers ou profondeur est atteint avec encore des .gitattributes non lus :
 * leve GitAttributesScanTruncatedError (fail-closed, pas de filtre silencieux hors liste).
 */
function collectGitAttributeFiles(repoPath: string): string[] {
  const files: string[] = [];
  let truncated = false;
  for (const rel of ['.gitattributes', join('.git', 'info', 'attributes')]) {
    const p = join(repoPath, rel);
    if (existsSync(p)) files.push(p);
  }
  // Parcours borne de l'arbre de travail pour les .gitattributes de sous-dossiers.
  const stack: Array<{ dir: string; depth: number }> = [{ dir: repoPath, depth: 0 }];
  while (stack.length > 0) {
    if (files.length >= GITATTR_MAX_FILES) {
      truncated = true;
      break;
    }
    const { dir, depth } = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === '.git') continue; // ne pas descendre dans .git
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < GITATTR_MAX_DEPTH) {
          stack.push({ dir: full, depth: depth + 1 });
        } else if (hasGitAttributesBelow(full, 200)) {
          // Au-dela de la profondeur max : fail-closed s il reste un .gitattributes.
          truncated = true;
        }
      } else if (e.name === '.gitattributes' && depth > 0 && !files.includes(full)) {
        if (files.length >= GITATTR_MAX_FILES) {
          truncated = true;
          break;
        }
        files.push(full);
      }
    }
  }
  if (truncated) {
    throw new GitAttributesScanTruncatedError(
      `Trop de .gitattributes (max ${GITATTR_MAX_FILES} fichiers / profondeur ${GITATTR_MAX_DEPTH}) : operation git refusee (fail-closed). Simplifiez l arbre ou le depot.`,
    );
  }
  return files;
}

export interface GitAttributeDrivers {
  filter: string[];
  diff: string[];
  merge: string[];
}

/**
 * Noms de drivers declares dans tous les .gitattributes du depot :
 * filter=NOM, diff=NOM, merge=NOM (dette D3 : drivers diff/merge nommes).
 * La valeur est lue jusqu'au prochain blanc (un nom `a.b` est garde entier).
 * Un nom contenant '=' ne peut pas etre neutralise via -c : fail-closed.
 */
export function listGitAttributeDrivers(repoPath: string): GitAttributeDrivers {
  const found = { filter: new Set<string>(), diff: new Set<string>(), merge: new Set<string>() };
  for (const p of collectGitAttributeFiles(repoPath)) {
    let raw = '';
    try {
      raw = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      for (const m of t.matchAll(/(?:^|\s)(filter|diff|merge)=(\S+)/g)) {
        const kind = m[1] as keyof typeof found;
        const name = m[2]!;
        if (name.includes('=')) {
          throw new GitAttributesScanTruncatedError(
            `Nom de driver ${kind} non neutralisable dans .gitattributes : operation git refusee (fail-closed).`,
          );
        }
        found[kind].add(name);
      }
    }
  }
  return { filter: [...found.filter], diff: [...found.diff], merge: [...found.merge] };
}

/** Noms de filtres declares dans tous les .gitattributes du depot (filter=nom). */
export function listGitAttributeFilters(repoPath: string): string[] {
  return listGitAttributeDrivers(repoPath).filter;
}

function filterNeutralizeArgs(repoPath: string): string[] {
  const out: string[] = [];
  const drivers = listGitAttributeDrivers(repoPath);
  for (const name of drivers.filter) {
    out.push(
      '-c', `filter.${name}.clean=`,
      '-c', `filter.${name}.smudge=`,
      '-c', `filter.${name}.process=`,
      '-c', `filter.${name}.required=false`,
    );
  }
  // D3 : diff=NOM (command / textconv) et merge=NOM (driver) du depot.
  // Valeur vide : git ignore le driver (diff interne, merge texte par defaut).
  for (const name of drivers.diff) {
    out.push('-c', `diff.${name}.command=`, '-c', `diff.${name}.textconv=`);
  }
  for (const name of drivers.merge) {
    out.push('-c', `merge.${name}.driver=`);
  }
  return out;
}

export class GitConfigIncludeRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitConfigIncludeRefusedError';
  }
}

/** Portees de config controlees par le depot (et non par Peter). */
const REPO_CONFIG_SCOPES = new Set(['local', 'worktree', 'command']);

/**
 * Dette D1 : `-c include.path=` vide est refuse par git, on ne peut donc pas
 * neutraliser un [include] / [includeIf] du depot. Fail-closed : si la config
 * du depot (.git/config, config.worktree, commondir des worktrees : git les resout
 * lui-meme) declare un include, l'operation est refusee.
 * La config globale de Peter (portee global) reste autorisee (R3 : identite globale).
 * `--no-includes` : on lit la config sans suivre les includes (rien n'est execute).
 */
export function assertNoRepoConfigInclude(repoPath: string): void {
  let out = '';
  try {
    out = execFileSync(
      'git',
      [
        '-C', repoPath, ...SAFE_GIT_PREFIX,
        'config', '--no-includes', '--show-scope', '--name-only',
        '--get-regexp', '^include(if\\..*)?\\.path$',
      ],
      { encoding: 'utf-8', env: buildSafeGitEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    if (err.status === 1) return; // aucune cle trouvee
    throw new GitConfigIncludeRefusedError(
      `Config git illisible (depot, fichier inclus ou config globale) : operation refusee (fail-closed). Corrigez le fichier cite ; dans un fichier de config ecrit a la main, utilisez '/' dans les chemins Windows. ${String(err.stderr ?? '').trim()}`.trim(),
    );
  }
  for (const line of out.split(/\r?\n/)) {
    const [scope, key] = line.split('\t');
    if (!scope || !key) continue;
    if (REPO_CONFIG_SCOPES.has(scope)) {
      throw new GitConfigIncludeRefusedError(
        `Le depot declare un include de config (${key}, portee ${scope}) : operation git refusee (fail-closed, git ne permet pas de le neutraliser). Retirez la section [include]/[includeIf] de la config du depot.`,
      );
    }
  }
}

/**
 * Lance git dans un repo. Les outils Git Iris = depots de confiance seulement.
 * Garde : ignore hooks / helpers externes / gpg.program / filtres attributes du depot.
 */
export function runGit(repoPath: string, args: string[]): string {
  let finalArgs = [...args];

  // git-commit : ne jamais executer les hooks du depot (pre-commit piege).
  if (finalArgs[0] === 'commit' && !finalArgs.includes('--no-verify')) {
    finalArgs = ['commit', '--no-verify', ...finalArgs.slice(1)];
  }

  // git diff / log / show : ignorer diff.external / textconv / drivers du depot (R2, D3).
  // (Les -c diff.NOM.command= / textconv= vides font echouer git au lieu d'executer :
  // ces options evitent l'echec sur un usage legitime.)
  if (finalArgs[0] === 'diff' || finalArgs[0] === 'log' || finalArgs[0] === 'show') {
    if (!finalArgs.includes('--no-ext-diff')) {
      finalArgs = [finalArgs[0], '--no-ext-diff', ...finalArgs.slice(1)];
    }
    if (!finalArgs.includes('--no-textconv')) {
      finalArgs = [finalArgs[0]!, '--no-textconv', ...finalArgs.slice(1)];
    }
  }

  try {
    assertNoRepoConfigInclude(repoPath);
    const filterArgs = filterNeutralizeArgs(repoPath);
    return execFileSync(
      'git',
      ['-C', repoPath, ...SAFE_GIT_PREFIX, ...filterArgs, ...finalArgs],
      {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        env: buildSafeGitEnv(),
      },
    );
  } catch (e) {
    if (e instanceof GitAttributesScanTruncatedError || e instanceof GitConfigIncludeRefusedError) {
      throw new GitCommandError(e.message, '', e.message, 1);
    }
    const err = e as {
      status?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const stdout = err.stdout ?? '';
    const stderr = err.stderr ?? '';
    const exitCode = err.status ?? 1;
    throw new GitCommandError(
      err.message ?? `git ${args.join(' ')} a echoue (code ${exitCode})`,
      stdout,
      stderr,
      exitCode,
    );
  }
}

export function jsonResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function errorResult(message: string) {
  return jsonResult({ error: message });
}
