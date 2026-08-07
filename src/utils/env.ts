export interface IrisEnv {
  ollamaBaseUrl: string;
  allowedRoots: string[];
  /** Allowlist d'hotes pour les outils web (vide = tout hote public autorise). */
  webAllowedHosts: string[];
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

export function loadEnv(): IrisEnv {
  const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const allowedRoots = splitList(process.env.ALLOWED_ROOTS ?? '');
  const webAllowedHosts = splitList(process.env.WEB_ALLOWED_HOSTS ?? '');
  return { ollamaBaseUrl, allowedRoots, webAllowedHosts };
}
