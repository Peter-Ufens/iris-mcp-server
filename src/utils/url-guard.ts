import { lookup } from 'node:dns/promises';
import { loadEnv } from './env.js';

/**
 * Garde reseau pour les URL fournies par le client (anti SSRF).
 * Regles : ADR-0005 (hub Iris-MCP) + docs/securite-web.md.
 */
export class UrlGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlGuardError';
  }
}

export interface UrlGuardOptions {
  /** Allowlist d'hotes ; defaut : WEB_ALLOWED_HOSTS (vide = tout hote public). */
  allowedHosts?: string[];
  /** Verifier la resolution DNS (defaut true dans assertSafeUrl). */
  resolveDns?: boolean;
}

/** Suffixes de noms d'hotes toujours refuses. */
const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.home.arpa', '.lan'];

/** Noms d'hotes exacts toujours refuses. */
const BLOCKED_NAMES = ['localhost', 'local', 'internal', 'home.arpa'];

function parseIpv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

/** IPv4 privee, loopback, link-local (metadonnees cloud), CGNAT, multicast, reservee. */
export function isBlockedIpv4(address: string): boolean {
  const parts = parseIpv4(address);
  if (!parts) return false;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 (metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (bench)
  if (a >= 224) return true; // multicast 224/4 + reserve 240/4 + broadcast
  return false;
}

/** Developpe une IPv6 (avec `::` et forme IPv4 embarquee) en 8 hextets numeriques. */
function expandIpv6(address: string): number[] | null {
  let s = address;

  const embedded = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (embedded) {
    const v4 = parseIpv4(embedded[2]!);
    if (!v4) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    s = `${embedded[1]}${hi}:${lo}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;

  const toHextets = (part: string): number[] =>
    part.length === 0 ? [] : part.split(':').filter((x) => x.length > 0).map((x) => Number.parseInt(x, 16));

  const head = toHextets(halves[0] ?? '');
  const tail = halves.length === 2 ? toHextets(halves[1] ?? '') : [];

  let hextets: number[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    hextets = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    hextets = [...head, ...new Array<number>(missing).fill(0), ...tail];
  }

  if (hextets.some((p) => Number.isNaN(p) || p < 0 || p > 0xffff)) return null;
  return hextets;
}

/** IPv6 loopback, non specifiee, ULA (fc00::/7), link-local (fe80::/10), multicast, IPv4 mappee. */
export function isBlockedIpv6(address: string): boolean {
  let h = address.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const zone = h.indexOf('%');
  if (zone !== -1) h = h.slice(0, zone);
  if (h.length === 0) return false;

  // Forme IPv4 mappee ecrite en decimal : ::ffff:127.0.0.1
  const embedded = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (embedded && isBlockedIpv4(embedded[1]!)) return true;

  const parts = expandIpv6(h);
  if (!parts) return false;

  if (parts.every((p) => p === 0)) return true; // ::
  if (parts.slice(0, 7).every((p) => p === 0) && parts[7] === 1) return true; // ::1

  // Forme IPv4 mappee / compatible ecrite en hexa : ::ffff:7f00:1
  if (parts.slice(0, 5).every((p) => p === 0) && (parts[5] === 0xffff || parts[5] === 0)) {
    const a = (parts[6]! >> 8) & 0xff;
    const b = parts[6]! & 0xff;
    const c = (parts[7]! >> 8) & 0xff;
    const d = parts[7]! & 0xff;
    if (isBlockedIpv4(`${a}.${b}.${c}.${d}`)) return true;
  }

  const high = (parts[0]! >> 8) & 0xff;
  const low = parts[0]! & 0xff;
  if (high === 0xff) return true; // multicast ff00::/8
  if ((high & 0xfe) === 0xfc) return true; // ULA fc00::/7
  if (high === 0xfe && (low & 0xc0) === 0x80) return true; // link-local fe80::/10
  return false;
}

/** True si l'hote est une IP refusee (v4 / v6) ou un nom local. */
export function isBlockedHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (h.length === 0) return true;
  if (BLOCKED_NAMES.includes(h)) return true;
  if (BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return true;
  if (h.startsWith('[') || h.includes(':')) return isBlockedIpv6(h);
  if (parseIpv4(h)) return isBlockedIpv4(h);
  return false;
}

function normalizeAllowlist(hosts: string[]): string[] {
  return hosts
    .map((h) => h.trim().toLowerCase().replace(/^\.+/, '').replace(/\.$/, ''))
    .filter((h) => h.length > 0);
}

/** True si l'hote est couvert par l'allowlist (hote exact ou sous-domaine). */
export function isAllowlisted(host: string, allowedHosts: string[]): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  return normalizeAllowlist(allowedHosts).some((a) => h === a || h.endsWith(`.${a}`));
}

/**
 * Verifications synchrones : schema https, pas d'identifiants dans l'URL,
 * hote non local / non prive, allowlist optionnelle. Aucune resolution DNS.
 *
 * @throws UrlGuardError
 */
export function assertSafeUrlSync(raw: string | URL, options: UrlGuardOptions = {}): URL {
  let url: URL;
  try {
    url = raw instanceof URL ? new URL(raw.href) : new URL(raw);
  } catch {
    throw new UrlGuardError(`URL invalide : "${String(raw)}"`);
  }

  if (url.protocol !== 'https:') {
    throw new UrlGuardError(
      `Schema refuse : seul https est autorise (recu "${url.protocol}" pour ${url.href}).`,
    );
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new UrlGuardError(
      "URL refusee : les identifiants dans l'URL (user:pass@hote) ne sont pas autorises.",
    );
  }

  const host = url.hostname;
  if (isBlockedHost(host)) {
    throw new UrlGuardError(
      `Hote refuse : "${host}" est local, prive ou reserve (protection SSRF).`,
    );
  }

  const allowedHosts = options.allowedHosts ?? loadEnv().webAllowedHosts;
  if (allowedHosts.length > 0 && !isAllowlisted(host, allowedHosts)) {
    throw new UrlGuardError(
      `Hote refuse : "${host}" hors allowlist WEB_ALLOWED_HOSTS (${allowedHosts.join(', ')}).`,
    );
  }

  return url;
}

/**
 * Verifications synchrones + resolution DNS : chaque adresse retournee doit passer
 * les regles IP. Bloque un nom public qui pointe vers une IP privee.
 *
 * @throws UrlGuardError
 */
export async function assertSafeUrl(
  raw: string | URL,
  options: UrlGuardOptions = {},
): Promise<URL> {
  const url = assertSafeUrlSync(raw, options);
  if (options.resolveDns === false) return url;

  const host = url.hostname;
  // Litteral IP : deja valide par assertSafeUrlSync, rien a resoudre.
  if (host.startsWith('[') || host.includes(':') || parseIpv4(host)) return url;

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UrlGuardError(`Resolution DNS impossible pour "${host}" : ${msg}`);
  }

  if (addresses.length === 0) {
    throw new UrlGuardError(`Resolution DNS vide pour "${host}".`);
  }

  for (const { address, family } of addresses) {
    const blocked = family === 6 ? isBlockedIpv6(address) : isBlockedIpv4(address);
    if (blocked) {
      throw new UrlGuardError(
        `Hote refuse : "${host}" resout vers une adresse privee ou reservee (${address}).`,
      );
    }
  }

  return url;
}
