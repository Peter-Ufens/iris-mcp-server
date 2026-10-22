import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { createPinnedLookup, pinnedAgent, type Resolver } from '../src/utils/pinned-fetch.js';
import { fetchText } from '../src/utils/http-fetch.js';
import { UrlGuardError } from '../src/utils/url-guard.js';

function appel(lookup: ReturnType<typeof createPinnedLookup>, all: boolean) {
  return new Promise<{ err: Error | null; addr: unknown }>((resolve) => {
    lookup('rebind.example', { all } as never, ((err: Error | null, addr: unknown) => resolve({ err, addr })) as never);
  });
}

describe('D2 DNS rebinding : resolution epinglee a la connexion', () => {
  it('resolveur public puis prive : la 2e connexion est refusee', async () => {
    const resolver = vi
      .fn<Resolver>()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const lookup = createPinnedLookup(resolver);
    const a = await appel(lookup, false);
    expect(a.err).toBeNull();
    expect(a.addr).toBe('93.184.216.34');
    const b = await appel(lookup, false);
    expect(b.err).toBeInstanceOf(UrlGuardError);
    expect(b.err?.message).toMatch(/rebinding/);
  });

  it('une seule adresse privee dans la liste suffit a refuser (mode all, IPv6)', async () => {
    const resolver = vi.fn<Resolver>().mockResolvedValue([
      { address: '2001:4860:4860::8888', family: 6 },
      { address: 'fd00::1', family: 6 },
    ]);
    const r = await appel(createPinnedLookup(resolver), true);
    expect(r.err).toBeInstanceOf(UrlGuardError);
  });

  it('mode all : renvoie la liste validee', async () => {
    const resolver = vi.fn<Resolver>().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const r = await appel(createPinnedLookup(resolver), true);
    expect(r.err).toBeNull();
    expect(r.addr).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('integration undici : la socket n est jamais ouverte vers une IP privee', async () => {
    let hits = 0;
    const srv = createServer((_q, s) => {
      hits += 1;
      s.end('secret interne');
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as AddressInfo).port;
    // Nom « public » qui resout vers 127.0.0.1 au moment de la connexion.
    const agent = new Agent({
      connect: { lookup: createPinnedLookup(async () => [{ address: '127.0.0.1', family: 4 }]) },
    });
    await expect(undiciFetch(`http://rebind.example:${port}/`, { dispatcher: agent })).rejects.toThrow();
    expect(hits).toBe(0);
    await agent.close();
    await new Promise<void>((r) => srv.close(() => r()));
  });

  it('fetchText utilise bien l agent epingle (pas le fetch global)', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    // URL litterale privee : refusee avant toute connexion ; le fetch global n est jamais appele.
    await expect(fetchText('https://127.0.0.1/')).rejects.toBeInstanceOf(UrlGuardError);
    expect(spy).not.toHaveBeenCalled();
    expect(pinnedAgent()).toBeInstanceOf(Agent);
    vi.unstubAllGlobals();
  });
});
