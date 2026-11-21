/**
 * Review Bob 16/11 : le champ ollamaBaseUrl (lu sans controle, jamais utilise) est retire.
 * L adresse d Ollama passe UNIQUEMENT par utils/ollama-base.ts (loopback par defaut, opt-in explicite).
 */
export interface IrisEnv {
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
  const allowedRoots = splitList(process.env.ALLOWED_ROOTS ?? '');
  const webAllowedHosts = splitList(process.env.WEB_ALLOWED_HOSTS ?? '');
  return { allowedRoots, webAllowedHosts };
}
