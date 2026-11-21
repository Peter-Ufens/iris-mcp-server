import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { embedLocal, _resetOllamaKoCachePourTests, SANTE_TENTATIVES } from '../src/utils/local-embeddings.js';
import { EMBED_REFERENCE_VECTEUR } from '../src/utils/embed-reference.js';
import {
  journaliser,
  ligneJournal,
  JOURNAL_FICHIER,
  JOURNAL_MAX_OCTETS,
  ETAPES_JOURNAL,
  CAUSES_JOURNAL,
  MOTEURS_JOURNAL,
  OUTILS_JOURNAL,
  dossierJournal,
} from '../src/utils/journal-moteurs.js';
import { ollamaChat } from '../src/tools/ollama-chat-v1.js';
import { fetchOllamaEtat } from '../src/tools/ollama-list-v1.js';

// Reste du lot O (ADR-0013 / ADR-0014, hors secours Hermes mis de cote par Peter) : journal, controle de sante,
// chat au format OpenAI, liste avec version et modeles charges. Faux serveurs loopback, donnees fictives.

const REF = [...EMBED_REFERENCE_VECTEUR];
const CHAMPS_OK = new Set(['date', 'outil', 'etape', 'cause', 'moteur', 'tentative', 'duree_ms', 'http']);

type Serveur = { srv: Server; port: number; recus: Array<{ url: string; corps: string }>; mode: string; n: number };
async function demarrer(h: (s: Serveur, req: IncomingMessage, res: ServerResponse, corps: string) => void): Promise<Serveur> {
  const s: Serveur = { srv: undefined as unknown as Server, port: 0, recus: [], mode: 'ok', n: 0 };
  s.srv = createServer((req, res) => {
    let corps = '';
    req.on('data', (c) => (corps += c));
    req.on('end', () => {
      s.recus.push({ url: req.url ?? '', corps });
      h(s, req, res, corps);
    });
  });
  s.port = await new Promise<number>((ok) => s.srv.listen(0, '127.0.0.1', () => ok((s.srv.address() as AddressInfo).port)));
  return s;
}
const json = (res: ServerResponse, o: unknown) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(o));
};
const base = (s: Serveur) => `http://127.0.0.1:${s.port}`;

let hermes: Serveur;
let ollama: Serveur;
let portFerme = 0;
let dossier = '';
let journalDir = '';

beforeAll(async () => {
  hermes = await demarrer((s, req, res) => {
    if (req.url === '/health') {
      if (s.mode === 'charge') return void res.writeHead(503).end('{"error":{"message":"Loading model"}}');
      if (s.mode === 'charge-puis-ok') {
        s.n += 1;
        return s.n < 3 ? void res.writeHead(503).end('{"error":{"message":"Loading model"}}') : json(res, { status: 'ok' });
      }
      if (s.mode === 'sante-500') return void res.writeHead(500).end('boum');
      return json(res, { status: 'ok' });
    }
    if (req.url === '/v1/embeddings') return json(res, { data: [{ embedding: REF }] });
    res.writeHead(404).end();
  });
  ollama = await demarrer((s, req, res, corps) => {
    const u = req.url ?? '';
    if (u === '/api/chat') {
      if (s.mode === 'natif-404') return void res.writeHead(404).end('{"error":"not found"}');
      if (s.mode === 'modele-absent') return void res.writeHead(404).end('{"error":"model \\"zzz\\" not found"}');
      if (s.mode === 'natif-500') return void res.writeHead(500).end('boum');
      return json(res, { model: 'm', message: { role: 'assistant', content: 'reponse native' }, total_duration: 5_000_000 });
    }
    if (u === '/v1/chat/completions') {
      if (s.mode === 'modele-absent') return void res.writeHead(404).end('{"error":{"message":"model not found"}}');
      return json(res, { model: 'm', choices: [{ message: { role: 'assistant', content: 'reponse openai\u{E0041}' } }] });
    }
    if (u === '/api/version') {
      if (s.mode === 'redirect') return void res.writeHead(302, { location: 'http://127.0.0.1:1/x' }).end();
      return json(res, { version: s.mode === 'version-folle' ? '0.1\n<script>' : '0.12.3' });
    }
    if (u === '/api/ps') {
      if (s.mode === 'ps-500') return void res.writeHead(500).end();
      if (s.mode === 'ps-beaucoup') {
        return json(res, { models: Array.from({ length: 80 }, (_, i) => ({ name: `m${i}`, size: 1, size_vram: 1, expires_at: 'x' })) });
      }
      return json(res, { models: [{ name: 'nomic-embed-text:latest\u{E0041}', size: 600_000_000, size_vram: 600_000_000, expires_at: '2026-11-16T12:00:00Z' }, 7, null] });
    }
    void corps;
    res.writeHead(404).end();
  });
  const tmp = createServer();
  portFerme = await new Promise<number>((ok) => tmp.listen(0, '127.0.0.1', () => ok((tmp.address() as AddressInfo).port)));
  await new Promise((ok) => tmp.close(ok));
  dossier = mkdtempSync(join(tmpdir(), 'iris-lot-o-reste-'));
});
afterAll(async () => {
  for (const s of [hermes, ollama]) {
    s.srv.closeAllConnections();
    await new Promise((ok) => s.srv.close(ok));
  }
  rmSync(dossier, { recursive: true, force: true });
});
beforeEach(() => {
  for (const s of [hermes, ollama]) {
    s.mode = 'ok';
    s.recus = [];
    s.n = 0;
  }
  _resetOllamaKoCachePourTests();
  journalDir = mkdtempSync(join(dossier, 'j-'));
  for (const v of ['OLLAMA_BASE_URL', 'IRIS_OLLAMA_HORS_LOOPBACK', 'IRIS_LLM_SECOURS_URL', 'IRIS_LLM_SECOURS_HORS_LOOPBACK', 'IRIS_JOURNAL_MOTEURS'])
    vi.stubEnv(v, '');
  vi.stubEnv('OLLAMA_BASE_URL', `http://127.0.0.1:${portFerme}`);
  vi.stubEnv('IRIS_LLM_SECOURS_URL', base(hermes));
  vi.stubEnv('IRIS_JOURNAL_MOTEURS_DIR', journalDir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetOllamaKoCachePourTests();
});

const lignes = (): Array<Record<string, unknown>> => {
  const f = join(journalDir, JOURNAL_FICHIER);
  return existsSync(f)
    ? readFileSync(f, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];
};
const embH = () => hermes.recus.filter((x) => x.url === '/v1/embeddings').length;
const santeH = () => hermes.recus.filter((x) => x.url === '/health').length;

describe('journal des echecs des moteurs (ADR-0014 §4)', () => {
  it('ne garde que des champs fixes : jamais le texte, l URL, la cle ou le message brut', async () => {
    vi.stubEnv('IRIS_LLM_SECOURS_URL', `http://127.0.0.1:${portFerme}`);
    await embedLocal('PHRASE-SECRETE-DE-PETER', { timeoutMs: 500, outil: 'rag-query-v1' });
    await ollamaChat('modele-fictif', [{ role: 'user', content: 'PROMPT-SECRET-NOTE-PRIVEE' }], undefined, 500);
    const l = lignes();
    expect(l.length).toBeGreaterThanOrEqual(3);
    for (const x of l) {
      for (const k of Object.keys(x)) expect(CHAMPS_OK.has(k)).toBe(true);
      expect(OUTILS_JOURNAL).toContain(x.outil);
      expect(ETAPES_JOURNAL).toContain(x.etape);
      expect(CAUSES_JOURNAL).toContain(x.cause);
      if (x.moteur !== undefined) expect(MOTEURS_JOURNAL).toContain(x.moteur);
    }
    const brut = readFileSync(join(journalDir, JOURNAL_FICHIER), 'utf8');
    expect(brut).not.toMatch(/SECRET|127\.0\.0\.1|http|localhost|modele-fictif|PETER/i);
  });

  it('ligneJournal remplace toute valeur hors liste et borne les nombres', () => {
    const x = JSON.parse(
      ligneJournal({ outil: 'x' as never, etape: 'y' as never, cause: 'http://secret' as never, moteur: 'z' as never, tentative: 99, duree_ms: -5, http: 12 }),
    ) as Record<string, unknown>;
    expect(x.cause).toBe('inconnu');
    expect(OUTILS_JOURNAL).toContain(x.outil);
    expect(ETAPES_JOURNAL).toContain(x.etape);
    expect(MOTEURS_JOURNAL).toContain(x.moteur);
    expect(x.tentative).toBeUndefined();
    expect(x.duree_ms).toBeUndefined();
    expect(x.http).toBeUndefined();
  });

  it('rotation vers .1 a 1 Mio, fichier en mode prive', () => {
    writeFileSync(join(journalDir, JOURNAL_FICHIER), 'x'.repeat(JOURNAL_MAX_OCTETS));
    journaliser({ outil: 'embeddings', etape: 'ollama', cause: 'refuse' });
    expect(existsSync(join(journalDir, `${JOURNAL_FICHIER}.1`))).toBe(true);
    expect(statSync(join(journalDir, JOURNAL_FICHIER)).size).toBeLessThan(500);
  });

  it('IRIS_JOURNAL_MOTEURS=0 coupe le journal ; un dossier UNC est refuse ; aucune exception', () => {
    vi.stubEnv('IRIS_JOURNAL_MOTEURS', '0');
    journaliser({ outil: 'embeddings', etape: 'ollama', cause: 'refuse' });
    expect(lignes()).toHaveLength(0);
    vi.stubEnv('IRIS_JOURNAL_MOTEURS', '');
    vi.stubEnv('IRIS_JOURNAL_MOTEURS_DIR', '\\\\serveur\\partage\\j');
    expect(() => journaliser({ outil: 'embeddings', etape: 'ollama', cause: 'refuse' })).not.toThrow();
    vi.stubEnv('IRIS_JOURNAL_MOTEURS_DIR', join(journalDir, 'fichier.txt', 'dedans'));
    writeFileSync(join(journalDir, 'fichier.txt'), 'x');
    expect(() => journaliser({ outil: 'embeddings', etape: 'ollama', cause: 'refuse' })).not.toThrow();
  });

  it('sous vitest, sans dossier pose, rien n est ecrit', () => {
    vi.stubEnv('IRIS_JOURNAL_MOTEURS_DIR', '');
    expect(() => journaliser({ outil: 'embeddings', etape: 'ollama', cause: 'refuse' })).not.toThrow();
    expect(lignes()).toHaveLength(0);
  });

  // Review Bob 16/11 : deux fichiers de tests ecrivaient dans le VRAI journal de l'utilisateur
  // (un env passe a la main sans VITEST, et un test qui vide VITEST). Le dossier par defaut est interdit sous test.
  it('sous vitest, le dossier par defaut est refuse meme avec un env a part ou VITEST vide', () => {
    expect(dossierJournal({})).toBeNull();
    expect(dossierJournal({ OLLAMA_BASE_URL: 'http://127.0.0.1:9', LOCALAPPDATA: journalDir })).toBeNull();
    vi.stubEnv('VITEST', '');
    vi.stubEnv('IRIS_JOURNAL_MOTEURS_DIR', '');
    expect(dossierJournal()).toBeNull();
    expect(dossierJournal({})).toBeNull();
    // Un dossier choisi explicitement reste permis (c'est ainsi que les tests lisent le journal).
    expect(dossierJournal({ IRIS_JOURNAL_MOTEURS_DIR: journalDir })).toBe(journalDir);
  });
});

describe('controle de sante du secours (ADR-0014 §2) : 3 essais seulement pour « Loading model »', () => {
  it('connexion refusee : 1 seul essai, pas 3, rapide', async () => {
    vi.stubEnv('IRIS_LLM_SECOURS_URL', `http://127.0.0.1:${portFerme}`);
    const debut = Date.now();
    const r = await embedLocal('q', { timeoutMs: 500, pausesSanteMs: [500, 500] });
    expect(r.ok).toBe(false);
    expect(Date.now() - debut).toBeLessThan(1500);
    const sante = lignes().filter((x) => x.etape === 'secours-sante');
    expect(sante).toHaveLength(1);
    expect(sante[0]!.cause).toBe('refuse');
  });

  it('503 « Loading model » : 3 essais avec pauses, puis abandon et pause de 60 s sans nouvel appel', async () => {
    hermes.mode = 'charge';
    const r = await embedLocal('q', { timeoutMs: 500, pausesSanteMs: [5, 5] });
    expect(r.ok).toBe(false);
    expect(santeH()).toBe(SANTE_TENTATIVES);
    expect(embH()).toBe(0);
    const avant = santeH();
    const r2 = await embedLocal('q', { timeoutMs: 500, pausesSanteMs: [5, 5] });
    expect(r2.ok).toBe(false);
    expect(santeH()).toBe(avant); // pause : le moteur n est pas re-interroge
    expect(lignes().some((x) => x.cause === 'pause')).toBe(true);
  });

  it('503 puis 200 au 3e essai : le secours est utilise et verifie', async () => {
    hermes.mode = 'charge-puis-ok';
    const r = await embedLocal('q', { timeoutMs: 500, pausesSanteMs: [5, 5] });
    expect(r.ok).toBe(true);
    expect(santeH()).toBe(3);
    expect(embH()).toBeGreaterThanOrEqual(2); // controle + question
  });

  it('sante en erreur 500 : pas de nouvel essai, secours refuse', async () => {
    hermes.mode = 'sante-500';
    const r = await embedLocal('q', { timeoutMs: 500, pausesSanteMs: [5, 5] });
    expect(r.ok).toBe(false);
    expect(santeH()).toBe(1);
    expect(embH()).toBe(0);
  });
});

describe('ollama-chat-v1 : format OpenAI sur la meme base Ollama', () => {
  const chat = (t?: number) => ollamaChat('m', [{ role: 'user', content: 'bonjour' }], t, 2000);

  it('API native presente : le format OpenAI n est pas utilise', async () => {
    vi.stubEnv('OLLAMA_BASE_URL', base(ollama));
    const r = await chat();
    expect('response' in r && r.response).toBe('reponse native');
    expect('format' in r).toBe(false);
    expect(ollama.recus.map((x) => x.url)).toEqual(['/api/chat']);
  });

  it('natif 404 : repli sur /v1/chat/completions, temperature au bon endroit, invisibles retires', async () => {
    vi.stubEnv('OLLAMA_BASE_URL', base(ollama));
    ollama.mode = 'natif-404';
    const r = await chat(0.2);
    expect('response' in r && r.response).toBe('reponse openai');
    expect('format' in r && r.format).toBe('openai');
    const envoye = JSON.parse(ollama.recus[1]!.corps) as Record<string, unknown>;
    expect(ollama.recus[1]!.url).toBe('/v1/chat/completions');
    expect(envoye.temperature).toBe(0.2);
    expect(envoye.options).toBeUndefined();
    expect(envoye.stream).toBe(false);
  });

  it('modele absent (404 des deux cotes) : on garde l erreur native, deux appels au plus', async () => {
    vi.stubEnv('OLLAMA_BASE_URL', base(ollama));
    ollama.mode = 'modele-absent';
    const r = await chat();
    expect('error' in r && r.error).toMatch(/HTTP 404.*not found/);
    expect(ollama.recus).toHaveLength(2);
  });

  it('natif 500 : aucun repli (seulement 404, 405, 501)', async () => {
    vi.stubEnv('OLLAMA_BASE_URL', base(ollama));
    ollama.mode = 'natif-500';
    const r = await chat();
    expect('error' in r).toBe(true);
    expect(ollama.recus).toHaveLength(1);
  });

  it('aucun repli vers Hermes : Ollama mort, le secours n est jamais appele pour le chat', async () => {
    const r = await chat();
    expect('error' in r).toBe(true);
    expect(hermes.recus).toHaveLength(0);
    expect(lignes().some((x) => x.etape === 'chat' && x.cause === 'refuse')).toBe(true);
  });
});

describe('ollama-list-v1 : version et modeles charges', () => {
  it('lit la version et les modeles charges, noms nettoyes, entrees folles ignorees', async () => {
    const e = await fetchOllamaEtat(base(ollama), 2000);
    expect(e.version).toBe('0.12.3');
    expect(e.charges).toHaveLength(1);
    expect(e.charges![0]!.name).toBe('nomic-embed-text:latest');
    expect(e.etat_erreur).toBeUndefined();
  });
  it('plus de 50 modeles charges : coupe a 50', async () => {
    ollama.mode = 'ps-beaucoup';
    expect((await fetchOllamaEtat(base(ollama), 2000)).charges).toHaveLength(50);
  });
  it('version avec retour a la ligne ou balise : ignoree', async () => {
    ollama.mode = 'version-folle';
    expect((await fetchOllamaEtat(base(ollama), 2000)).version).toBeUndefined();
  });
  it('/api/ps en erreur : la version reste lue, la panne est dite sans casser', async () => {
    ollama.mode = 'ps-500';
    const e = await fetchOllamaEtat(base(ollama), 2000);
    expect(e.version).toBe('0.12.3');
    expect(e.charges).toBeUndefined();
    expect(e.etat_erreur).toMatch(/modeles charges/);
  });
  it('redirection refusee, Ollama eteint : pas d exception', async () => {
    ollama.mode = 'redirect';
    expect((await fetchOllamaEtat(base(ollama), 2000)).etat_erreur).toMatch(/version/);
    const mort = await fetchOllamaEtat(`http://127.0.0.1:${portFerme}`, 500);
    expect(mort.etat_erreur).toMatch(/version/);
  });
});