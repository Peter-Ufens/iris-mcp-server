import { execFileSync } from 'node:child_process';

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

export function runGit(repoPath: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', repoPath, ...args], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string; message?: string };
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
