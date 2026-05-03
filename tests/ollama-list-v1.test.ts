import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchOllamaModels } from '../src/tools/ollama-list-v1.js';

describe('ollama-list-v1', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parse les modeles en succes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            { name: 'llama3:latest', size: 4_000_000, modified_at: '2026-01-01', digest: 'abc123' },
            { name: 'mistral:7b', size: 3_500_000, modified_at: '2026-02-01', digest: 'def456' },
          ],
        }),
      }),
    );

    const r = await fetchOllamaModels('http://127.0.0.1:11434');
    expect(r.error).toBeUndefined();
    expect(r.models).toHaveLength(2);
    expect(r.models[0]!.name).toBe('llama3:latest');
    expect(r.models[0]!.digest).toBe('abc123');
    expect(r.models[1]!.name).toBe('mistral:7b');
  });

  it('retourne erreur si HTTP non OK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      }),
    );

    const r = await fetchOllamaModels('http://127.0.0.1:11434');
    expect(r.models).toEqual([]);
    expect(r.error).toContain('503');
  });

  it('retourne erreur si Ollama injoignable (graceful)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const r = await fetchOllamaModels('http://127.0.0.1:11434');
    expect(r.models).toEqual([]);
    expect(r.error).toContain('ECONNREFUSED');
  });

  it('gere un tableau models vide', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      }),
    );

    const r = await fetchOllamaModels('http://127.0.0.1:11434');
    expect(r.models).toEqual([]);
    expect(r.error).toBeUndefined();
  });
});
