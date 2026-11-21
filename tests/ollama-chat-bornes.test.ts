import { createServer, type Server } from 'node:http';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ollamaChat,
  tool,
  OLLAMA_MAX_MESSAGES,
  OLLAMA_MAX_CONTENU_TOTAL,
  OLLAMA_MAX_REPONSE,
} from '../src/tools/ollama-chat-v1.js';

/** Review Bob 16/11 · RT pre-G 097 : prompt enorme, faux service sur le port d Ollama. */

let server: Server | null = null;
const baseAvant = process.env.OLLAMA_BASE_URL;

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
  if (baseAvant === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = baseAvant;
});

async function fauxOllama(handler: Parameters<typeof createServer>[0]): Promise<void> {
  server = createServer(handler);
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}

describe('ollama-chat-v1 : bornes', () => {
  it('trop de messages : refus AVANT tout appel a Ollama', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const msgs = Array.from({ length: OLLAMA_MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' }));
    const r = await ollamaChat('llama3', msgs);
    expect('error' in r && r.error).toMatch(/prompt trop gros/);
    expect(f).not.toHaveBeenCalled();
  });

  it('texte total trop long : refus AVANT tout appel a Ollama', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await ollamaChat('llama3', [
      { role: 'user', content: 'a'.repeat(OLLAMA_MAX_CONTENU_TOTAL) },
      { role: 'user', content: 'b' },
    ]);
    expect('error' in r && r.error).toMatch(/prompt trop gros/);
    expect(f).not.toHaveBeenCalled();
  });

  it('le schema refuse aussi un tableau trop long (validation MCP)', () => {
    const msgs = Array.from({ length: OLLAMA_MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' }));
    expect(tool.inputSchema.messages!.safeParse(msgs).success).toBe(false);
    expect(tool.inputSchema.model!.safeParse('m'.repeat(201)).success).toBe(false);
  });

  it('reponse geante du modele : coupee, avec un drapeau', async () => {
    await fauxOllama((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: { content: 'z'.repeat(OLLAMA_MAX_REPONSE + 50) }, model: 'm' }));
    });
    const r = await ollamaChat('m', [{ role: 'user', content: 'q' }]);
    expect('response' in r).toBe(true);
    if ('response' in r) {
      expect(r.response.length).toBe(OLLAMA_MAX_REPONSE);
      expect(r.response_tronquee).toBe(true);
    }
  });

  it('faux service : corps au goutte-a-goutte coupe par le delai (avant : attente sans fin)', async () => {
    await fauxOllama((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"message":{"content":"');
      const t = setInterval(() => res.write('a'), 50);
      res.on('close', () => clearInterval(t));
    });
    const t0 = Date.now();
    const r = await ollamaChat('m', [{ role: 'user', content: 'q' }], undefined, 400);
    expect('error' in r).toBe(true);
    expect(Date.now() - t0).toBeLessThan(3_000);
  });

  it('faux service : erreur HTTP avec un corps geant, recopie bornee', async () => {
    await fauxOllama((_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('E'.repeat(50_000));
    });
    const r = await ollamaChat('m', [{ role: 'user', content: 'q' }]);
    expect('error' in r && r.error.startsWith('HTTP 500')).toBe(true);
    if ('error' in r) expect(r.error.length).toBeLessThan(320);
  });

  it('faux service : redirection refusee (la requete ne part pas ailleurs)', async () => {
    let suivi = false;
    const autre = createServer((_q, s) => {
      suivi = true;
      s.end('{}');
    });
    await new Promise<void>((r) => autre.listen(0, '127.0.0.1', () => r()));
    const a = autre.address();
    const port = typeof a === 'object' && a ? a.port : 0;
    await fauxOllama((_req, res) => {
      res.writeHead(307, { location: `http://127.0.0.1:${port}/api/chat` });
      res.end();
    });
    const r = await ollamaChat('m', [{ role: 'user', content: 'q' }]);
    await new Promise<void>((r2) => autre.close(() => r2()));
    expect('error' in r).toBe(true);
    expect(suivi).toBe(false);
  });

  it('outil : un echec porte isError, un succes non (A18)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const e = await tool.execute({ model: 'm', messages: [{ role: 'user', content: 'q' }] });
    expect(e.isError).toBe(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'ok' }, model: 'm' }) }),
    );
    const s = await tool.execute({ model: 'm', messages: [{ role: 'user', content: 'q' }] });
    expect(s.isError).toBeUndefined();
  });
});
