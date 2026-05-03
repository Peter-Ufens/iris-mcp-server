export interface IrisEnv {
  ollamaBaseUrl: string;
  allowedRoots: string[];
}

export function loadEnv(): IrisEnv {
  const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const rootsRaw = process.env.ALLOWED_ROOTS ?? '';
  const allowedRoots = rootsRaw
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  return { ollamaBaseUrl, allowedRoots };
}
