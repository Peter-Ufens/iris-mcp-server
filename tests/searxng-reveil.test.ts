import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

/** Review Bob 16/11 : reveil a la demande de SearXNG (decision Peter « a la demande », GO 06:08). */

vi.mock('../src/utils/http-fetch.js', () => ({
  fetchJson: vi.fn(),
}));
vi.mock('../src/utils/searxng-reveil.js', async (orig) => {
  const vrai = await orig<typeof import('../src/utils/searxng-reveil.js')>();
  return { ...vrai, reveillerSearxng: vi.fn(vrai.reveillerSearxng) };
});

import { fetchJson } from '../src/utils/http-fetch.js';
import { tool } from '../src/tools/web-search-v2.js';
import {
  configReveil,
  envPourDocker,
  estConnexionRefusee,
  reveillerSearxng,
  resetReveilForTests,
  REVEIL_PAUSE_APRES_ECHEC_MS,
  type Executeur,
} from '../src/utils/searxng-reveil.js';

const mockFetchJson = vi.mocked(fetchJson);
const mockReveil = vi.mocked(reveillerSearxng);
const EXE = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
const BASE = new URL('http://127.0.0.1:8080');
const ENV_KEYS = ['IRIS_SEARXNG_URL', 'IRIS_SEARXNG_CONTENEUR', 'IRIS_DOCKER_EXE', 'BRAVE_API_KEY'] as const;
const sauve: Record<string, string | undefined> = {};

function refus(): Error {
  return Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
}
function payloadOf(r: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    sauve[k] = process.env[k];
    delete process.env[k];
  }
  mockFetchJson.mockReset();
  mockReveil.mockClear();
  resetReveilForTests();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (sauve[k] === undefined) delete process.env[k];
    else process.env[k] = sauve[k];
  }
});

describe('searxng-reveil : configuration', () => {
  it('sans IRIS_SEARXNG_CONTENEUR : pas de reveil', () => {
    expect(configReveil({}).actif).toBe(false);
  });

  it('nom de conteneur : jamais une option ni un caractere de shell', () => {
    for (const nom of ['-h', '--rm', 'a b', 'a;b', 'a&b', 'a|b', '$(x)', 'a/b', 'x'.repeat(70)]) {
      expect(configReveil({ IRIS_SEARXNG_CONTENEUR: nom, IRIS_DOCKER_EXE: EXE }, 'win32').actif).toBe(false);
    }
    expect(configReveil({ IRIS_SEARXNG_CONTENEUR: 'iris-lab-searxng', IRIS_DOCKER_EXE: EXE }, 'win32')).toEqual({
      actif: true,
      dockerExe: EXE,
      conteneur: 'iris-lab-searxng',
    });
  });

  it('docker : chemin absolu obligatoire, .exe seulement sous Windows (pas de .bat qui demande un shell)', () => {
    const c = { IRIS_SEARXNG_CONTENEUR: 'iris-lab-searxng' };
    expect(configReveil({ ...c, IRIS_DOCKER_EXE: 'docker' }, 'win32').actif).toBe(false);
    expect(configReveil({ ...c, IRIS_DOCKER_EXE: 'C:\\outils\\docker.bat' }, 'win32').actif).toBe(false);
    expect(configReveil({ ...c, IRIS_DOCKER_EXE: 'C:\\outils\\docker.cmd' }, 'win32').actif).toBe(false);
  });

  it('connexion refusee reconnue ; erreur HTTP ou delai non', () => {
    expect(estConnexionRefusee(refus())).toBe(true);
    expect(estConnexionRefusee(new Error('HTTP 500 depuis http://127.0.0.1:8080'))).toBe(false);
    expect(estConnexionRefusee(Object.assign(new Error('x'), { cause: { code: 'ETIMEDOUT' } }))).toBe(false);
    expect(estConnexionRefusee(null)).toBe(false);
  });

  it('environnement de docker minimal : aucune cle de la config du client', () => {
    const e = envPourDocker({
      PATH: 'C:\\x',
      USERPROFILE: 'C:\\Users\\u',
      QDRANT_API_KEY: 'secret',
      N8N_API_KEY: 'secret',
      BRAVE_API_KEY: 'secret',
    });
    expect(e.PATH).toBe('C:\\x');
    expect(e.USERPROFILE).toBe('C:\\Users\\u');
    expect(JSON.stringify(e)).not.toContain('secret');
  });
});

describe('searxng-reveil : la commande et ses gardes', () => {
  const cfg = { dockerExe: EXE, conteneur: 'iris-lab-searxng' };

  it('commande fixe : exactement « start <nom> », rien d autre', async () => {
    const exec = vi.fn<Executeur>(async () => ({ ok: true }));
    const r = await reveillerSearxng(BASE, cfg, { exec, pret: async () => true });
    expect(r.ok).toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0]![0]).toBe(EXE);
    expect(exec.mock.calls[0]![1]).toEqual(['start', 'iris-lab-searxng']);
  });

  it('deux recherches en meme temps : un seul reveil', async () => {
    let fini!: () => void;
    const exec = vi.fn<Executeur>(() => new Promise((res) => (fini = () => res({ ok: true }))));
    const a = reveillerSearxng(BASE, cfg, { exec, pret: async () => true });
    const b = reveillerSearxng(BASE, cfg, { exec, pret: async () => true });
    fini();
    expect((await a).ok && (await b).ok).toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('echec : raison courte, puis pause de 60 s sans relancer docker (pas de boucle)', async () => {
    let t = 1_000_000;
    const maintenant = () => t;
    const exec = vi.fn<Executeur>(async () => ({ ok: false, cause: 'refus' }));
    const r1 = await reveillerSearxng(BASE, cfg, { exec, pret: async () => true, maintenant });
    expect(r1).toEqual({ ok: false, raison: 'docker a refuse (Docker eteint, ou conteneur absent)' });
    t += 10_000;
    const r2 = await reveillerSearxng(BASE, cfg, { exec, pret: async () => true, maintenant });
    expect(r2.ok).toBe(false);
    expect(exec).toHaveBeenCalledTimes(1);
    t += REVEIL_PAUSE_APRES_ECHEC_MS;
    await reveillerSearxng(BASE, cfg, { exec, pret: async () => true, maintenant });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('docker introuvable, trop lent, ou SearXNG jamais pret : raisons distinctes', async () => {
    const essai = async (exec: Executeur, pret = async () => true) => {
      resetReveilForTests();
      return reveillerSearxng(BASE, cfg, { exec, pret });
    };
    expect(await essai(async () => ({ ok: false, cause: 'introuvable' }))).toEqual({ ok: false, raison: 'docker introuvable' });
    expect(await essai(async () => ({ ok: false, cause: 'delai' }))).toEqual({ ok: false, raison: 'docker trop lent (20 s)' });
    expect(await essai(async () => ({ ok: true }), async () => false)).toEqual({ ok: false, raison: 'SearXNG pas pret apres 15 s' });
  });
});

describe('web-search-v2 : SearXNG eteint', () => {
  const RESULTATS = { results: [{ title: 'A', url: 'https://example.com/1', content: 'un' }] };

  beforeEach(() => {
    process.env.IRIS_SEARXNG_URL = 'http://127.0.0.1:8080';
  });

  it('reveil configure : SearXNG rallume, recherche relancee une fois', async () => {
    process.env.IRIS_SEARXNG_CONTENEUR = 'iris-lab-searxng';
    process.env.IRIS_DOCKER_EXE = EXE;
    mockReveil.mockResolvedValueOnce({ ok: true, ms: 2100 });
    mockFetchJson.mockRejectedValueOnce(refus()).mockResolvedValueOnce(RESULTATS);
    const r = await tool.execute({ query: 'test', limit: 3 });
    const p = payloadOf(r);
    expect(r.isError).toBeUndefined();
    expect(p.engine).toBe('searxng');
    expect(p.searxng_reveille).toBe(true);
    expect(p.reveil_ms).toBe(2100);
    expect(p.count).toBe(1);
    expect(mockFetchJson).toHaveBeenCalledTimes(2);
  });

  it('reveil impossible : echec MCP clair, avec la commande a taper', async () => {
    process.env.IRIS_SEARXNG_CONTENEUR = 'iris-lab-searxng';
    process.env.IRIS_DOCKER_EXE = EXE;
    mockReveil.mockResolvedValueOnce({ ok: false, raison: 'docker introuvable' });
    mockFetchJson.mockRejectedValueOnce(refus());
    const r = await tool.execute({ query: 'test', limit: 3 });
    expect(r.isError).toBe(true);
    expect(String(payloadOf(r).error)).toContain('docker start iris-lab-searxng');
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
  });

  it('sans reveil configure : echec clair, aucun appel a docker', async () => {
    mockFetchJson.mockRejectedValueOnce(refus());
    const r = await tool.execute({ query: 'test', limit: 3 });
    expect(r.isError).toBe(true);
    expect(String(payloadOf(r).error)).toContain('ne repond pas');
    expect(mockReveil).not.toHaveBeenCalled();
  });

  it('erreur HTTP (SearXNG allume mais en erreur) : pas de reveil', async () => {
    process.env.IRIS_SEARXNG_CONTENEUR = 'iris-lab-searxng';
    process.env.IRIS_DOCKER_EXE = EXE;
    mockFetchJson.mockRejectedValueOnce(new Error('HTTP 500 depuis http://127.0.0.1:8080/search'));
    const r = await tool.execute({ query: 'test', limit: 3 });
    expect(r.isError).toBe(true);
    expect(mockReveil).not.toHaveBeenCalled();
  });
});
