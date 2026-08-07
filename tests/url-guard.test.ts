import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import {
  assertSafeUrl,
  assertSafeUrlSync,
  isAllowlisted,
  isBlockedHost,
  isBlockedIpv4,
  isBlockedIpv6,
  UrlGuardError,
} from '../src/utils/url-guard.js';

const mockLookup = vi.mocked(lookup);
const publicAddress = [{ address: '93.184.216.34', family: 4 }];

describe('url-guard : schema et forme', () => {
  it('accepte une URL https publique', () => {
    const url = assertSafeUrlSync('https://example.com/page?q=1');
    expect(url.hostname).toBe('example.com');
  });

  it('refuse http', () => {
    expect(() => assertSafeUrlSync('http://example.com')).toThrow(UrlGuardError);
    expect(() => assertSafeUrlSync('http://example.com')).toThrow(/https/);
  });

  it('refuse file, ftp et data', () => {
    for (const raw of ['file:///C:/Windows/win.ini', 'ftp://example.com/x', 'data:text/html,<b>x</b>']) {
      expect(() => assertSafeUrlSync(raw)).toThrow(UrlGuardError);
    }
  });

  it('refuse une URL invalide', () => {
    expect(() => assertSafeUrlSync('pas une url')).toThrow(/URL invalide/);
  });

  it('refuse les identifiants dans l URL', () => {
    expect(() => assertSafeUrlSync('https://user:pass@example.com/')).toThrow(/identifiants/);
  });
});

describe('url-guard : hotes locaux et prives', () => {
  const refuses = [
    'https://localhost/',
    'https://LOCALHOST:8443/',
    'https://nas.local/',
    'https://api.internal/',
    'https://box.home.arpa/',
    'https://127.0.0.1/',
    'https://127.1.2.3/',
    'https://10.0.0.5/',
    'https://172.16.0.1/',
    'https://172.31.255.254/',
    'https://192.168.0.1/',
    'https://169.254.169.254/latest/meta-data/',
    'https://0.0.0.0/',
    'https://100.64.0.1/',
    'https://198.18.0.1/',
    'https://255.255.255.255/',
    'https://[::1]/',
    'https://[::]/',
    'https://[fe80::1]/',
    'https://[fc00::1]/',
    'https://[fd12:3456::1]/',
    'https://[::ffff:127.0.0.1]/',
  ];

  for (const raw of refuses) {
    it(`refuse ${raw}`, () => {
      expect(() => assertSafeUrlSync(raw)).toThrow(UrlGuardError);
    });
  }

  it('accepte une IP publique litterale', () => {
    expect(assertSafeUrlSync('https://8.8.8.8/').hostname).toBe('8.8.8.8');
  });

  it('refuse une IPv4 ecrite en decimal (normalisee par le parseur URL)', () => {
    // https://2130706433/ est normalise en 127.0.0.1 par la spec URL
    expect(() => assertSafeUrlSync('https://2130706433/')).toThrow(UrlGuardError);
    expect(() => assertSafeUrlSync('https://0x7f000001/')).toThrow(UrlGuardError);
  });

  it('isBlockedIpv4 : plages privees vs publiques', () => {
    expect(isBlockedIpv4('127.0.0.1')).toBe(true);
    expect(isBlockedIpv4('172.15.0.1')).toBe(false);
    expect(isBlockedIpv4('172.32.0.1')).toBe(false);
    expect(isBlockedIpv4('8.8.8.8')).toBe(false);
    expect(isBlockedIpv4('93.184.216.34')).toBe(false);
  });

  it('isBlockedIpv6 : locales vs publiques', () => {
    expect(isBlockedIpv6('::1')).toBe(true);
    expect(isBlockedIpv6('0:0:0:0:0:0:0:1')).toBe(true);
    expect(isBlockedIpv6('fe80::abcd')).toBe(true);
    expect(isBlockedIpv6('ff02::1')).toBe(true);
    expect(isBlockedIpv6('::ffff:7f00:1')).toBe(true);
    expect(isBlockedIpv6('2001:4860:4860::8888')).toBe(false);
  });

  it('isBlockedHost : nom public non bloque', () => {
    expect(isBlockedHost('example.com')).toBe(false);
    expect(isBlockedHost('example.com.')).toBe(false);
    expect(isBlockedHost('')).toBe(true);
  });
});

describe('url-guard : allowlist optionnelle', () => {
  it('isAllowlisted couvre les sous-domaines', () => {
    expect(isAllowlisted('fr.wikipedia.org', ['wikipedia.org'])).toBe(true);
    expect(isAllowlisted('wikipedia.org', ['wikipedia.org'])).toBe(true);
    expect(isAllowlisted('notwikipedia.org', ['wikipedia.org'])).toBe(false);
  });

  it('refuse un hote hors allowlist', () => {
    expect(() => assertSafeUrlSync('https://example.com/', { allowedHosts: ['wikipedia.org'] })).toThrow(
      /allowlist/,
    );
  });

  it('accepte un hote de l allowlist', () => {
    const url = assertSafeUrlSync('https://fr.wikipedia.org/w/api.php', {
      allowedHosts: ['wikipedia.org'],
    });
    expect(url.hostname).toBe('fr.wikipedia.org');
  });

  it('allowlist vide = tout hote public autorise', () => {
    expect(assertSafeUrlSync('https://example.com/', { allowedHosts: [] }).hostname).toBe('example.com');
  });
});

describe('url-guard : resolution DNS', () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  it('accepte un nom qui resout vers une IP publique', async () => {
    mockLookup.mockResolvedValue(publicAddress as never);
    const url = await assertSafeUrl('https://example.com/page');
    expect(url.href).toBe('https://example.com/page');
    expect(mockLookup).toHaveBeenCalledWith('example.com', { all: true });
  });

  it('refuse un nom public qui resout vers une IP privee (DNS rebinding)', async () => {
    mockLookup.mockResolvedValue([{ address: '192.168.1.10', family: 4 }] as never);
    await expect(assertSafeUrl('https://interne.example.com/')).rejects.toThrow(/privee ou reservee/);
  });

  it('refuse si une seule des adresses est privee', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '::1', family: 6 },
    ] as never);
    await expect(assertSafeUrl('https://mixte.example.com/')).rejects.toThrow(UrlGuardError);
  });

  it('refuse si la resolution DNS echoue', async () => {
    mockLookup.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    await expect(assertSafeUrl('https://inconnu.example.com/')).rejects.toThrow(/Resolution DNS impossible/);
  });

  it('refuse si la resolution DNS est vide', async () => {
    mockLookup.mockResolvedValue([] as never);
    await expect(assertSafeUrl('https://vide.example.com/')).rejects.toThrow(/Resolution DNS vide/);
  });

  it('ne resout pas une IP litterale', async () => {
    const url = await assertSafeUrl('https://8.8.8.8/');
    expect(url.hostname).toBe('8.8.8.8');
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('resolveDns false saute la resolution', async () => {
    const url = await assertSafeUrl('https://example.com/', { resolveDns: false });
    expect(url.hostname).toBe('example.com');
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('refuse avant tout DNS si le schema est mauvais', async () => {
    await expect(assertSafeUrl('http://example.com/')).rejects.toThrow(UrlGuardError);
    expect(mockLookup).not.toHaveBeenCalled();
  });
});
