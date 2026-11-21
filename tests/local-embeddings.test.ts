import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetOllamaKoCachePourTests,
  embedLocal,
  EMBED_DIM_ATTENDUE,
  HERMES_LLAMA_DEFAUT,
} from '../src/utils/local-embeddings.js';

function vecteur(seed: number): number[] {
  return Array.from({ length: EMBED_DIM_ATTENDUE }, (_, i) => ((i + seed) % 17) / 17);
}

afterEach(() => {
  _resetOllamaKoCachePourTests();
});

describe('embedLocal · lot O (Ollama puis Hermes, pas de 3e instance)', () => {
  it('Ollama /api/embeddings OK → moteur ollama', async () => {
    const v = vecteur(1);
    const srv = createServer((req, res) => {
      if (req.url === '/api/embeddings') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ embedding: v }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    const out = await embedLocal('bonjour', {
      env: { OLLAMA_BASE_URL: `http://127.0.0.1:${port}` },
      timeoutMs: 2000,
    });
    srv.close();
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.moteur).toBe('ollama');
      expect(out.vector).toHaveLength(EMBED_DIM_ATTENDUE);
    }
  });

  it('Ollama KO → Hermes /v1/embeddings OK → moteur hermes-llamacpp', async () => {
    const v = vecteur(2);
    const hermes = createServer((req, res) => {
      if (req.url === '/v1/embeddings') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ embedding: v }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => hermes.listen(0, '127.0.0.1', r));
    const hPort = (hermes.address() as { port: number }).port;
    const out = await embedLocal('secours', {
      // Review Gaby 16/11 : le secours doit retrouver un vecteur de reference (ADR-0013 A3).
      reference: { phrase: 'phrase de controle', vector: v },
      env: {
        OLLAMA_BASE_URL: 'http://127.0.0.1:9', // port ferme
        IRIS_LLM_SECOURS_URL: `http://127.0.0.1:${hPort}`,
      },
      timeoutMs: 800,
    });
    hermes.close();
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.moteur).toBe('hermes-llamacpp');
      expect(out.format).toBe('openai-v1');
    }
  });

  it('Ollama et Hermes KO → erreur claire, mention pas de 3e serveur', async () => {
    const out = await embedLocal('rien', {
      env: {
        OLLAMA_BASE_URL: 'http://127.0.0.1:9',
        IRIS_LLM_SECOURS_URL: 'http://127.0.0.1:9',
      },
      timeoutMs: 400,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.erreur).toMatch(/3e llama-server|Hermes/);
      expect(out.tentatives.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('defaut secours = Hermes 18434', () => {
    expect(HERMES_LLAMA_DEFAUT).toBe('http://127.0.0.1:18434');
  });

  it('dimension fausse refusee si IRIS_EMBED_DIM_STRICT=1', async () => {
    const srv = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ embedding: [0.1, 0.2] }));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    const out = await embedLocal('dim', {
      env: {
        OLLAMA_BASE_URL: `http://127.0.0.1:${port}`,
        IRIS_LLM_SECOURS_URL: 'http://127.0.0.1:9',
        IRIS_EMBED_DIM_STRICT: '1',
      },
      timeoutMs: 800,
    });
    srv.close();
    expect(out.ok).toBe(false);
  });
});
