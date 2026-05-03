import { describe, it, expect, vi, afterEach } from 'vitest';
import { ollamaChat } from '../src/tools/ollama-chat-v1.js';

describe('ollama-chat-v1', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retourne la reponse du modele en succes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: 'Bonjour, je suis un LLM.' },
          model: 'llama3',
          total_duration: 500_000_000, // 500ms en nanosecondes
        }),
      }),
    );

    const r = await ollamaChat('llama3', [{ role: 'user', content: 'Salut' }]);
    expect('response' in r).toBe(true);
    if ('response' in r) {
      expect(r.response).toBe('Bonjour, je suis un LLM.');
      expect(r.model).toBe('llama3');
      expect(r.duration_ms).toBe(500);
    }
  });

  it('retourne erreur si HTTP non OK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'model not found',
      }),
    );

    const r = await ollamaChat('modele-inexistant', [{ role: 'user', content: 'test' }]);
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error).toContain('404');
    }
  });

  it('retourne erreur si Ollama injoignable (graceful)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const r = await ollamaChat('llama3', [{ role: 'user', content: 'test' }]);
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error).toContain('ECONNREFUSED');
    }
  });

  it('passe la temperature dans options', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: 'ok' },
        model: 'llama3',
        total_duration: 100_000_000,
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await ollamaChat('llama3', [{ role: 'user', content: 'test' }], 0.3);

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body.stream).toBe(false);
    expect(body.options.temperature).toBe(0.3);
  });
});
