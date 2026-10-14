import { execFileSync } from 'node:child_process';
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
 * (core.fsmonitor, hooksPath, pager).
 * Note : `-c diff.external=` (vide) casse `git diff` sous Windows
 * (« cannot spawn : ») → on utilise `--no-ext-diff` (+ `--no-textconv` R2).
 *
 * R3 Bob : ne PAS mettre GIT_CONFIG_GLOBAL=NUL (casse user.name/email global
 * de Peter ; la menace depot piege est deja couverte par -c / --no-*).
 */
const SAFE_GIT_PREFIX = [
  '-c',
  'core.fsmonitor=',
  '-c',
  `core.hooksPath=${DEV_NULL}`,
  '-c',
  'core.pager=cat',
] as const;

const SAFE_GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};

/**
 * Lance git dans un repo. Les outils Git Iris = depots de confiance seulement.
 * Garde F1 : ignore hooks / helpers externes du .git/config local.
 */
export function runGit(repoPath: string, args: string[]): string {
  let finalArgs = [...args];

  // git-commit : ne jamais executer les hooks du depot (pre-commit piege).
  if (finalArgs[0] === 'commit' && !finalArgs.includes('--no-verify')) {
    finalArgs = ['commit', '--no-verify', ...finalArgs.slice(1)];
  }

  // git diff : ignorer diff.external / textconv / drivers du depot (R2).
  if (finalArgs[0] === 'diff') {
    if (!finalArgs.includes('--no-ext-diff')) {
      finalArgs = ['diff', '--no-ext-diff', ...finalArgs.slice(1)];
    }
    if (!finalArgs.includes('--no-textconv')) {
      finalArgs = [finalArgs[0]!, '--no-textconv', ...finalArgs.slice(1)];
    }
  }

  try {
    return execFileSync(
      'git',
      ['-C', repoPath, ...SAFE_GIT_PREFIX, ...finalArgs],
      {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        env: SAFE_GIT_ENV,
      },
    );
  } catch (e) {
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
