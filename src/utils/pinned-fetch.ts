import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { isBlockedIpv4, isBlockedIpv6, UrlGuardError } from './url-guard.js';

/**
 * Dette D2 (DNS rebinding) : la resolution DNS est faite UNE fois, au moment de la
 * connexion, et la socket se connecte exactement aux adresses validees. Plus de fenetre
 * entre « lookup de controle » et « lookup de fetch » : un nom qui repond public puis
 * prive ne peut plus faire ouvrir une connexion vers l'IP privee.
 * Le nom d'hote reste celui de l'URL : en-tete Host et SNI/certificat TLS inchanges.
 * Chaque redirection ouvre une nouvelle connexion, donc repasse par ce controle
 * (en plus d'assertSafeUrl dans fetchText).
 */

export type Resolver = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

function isBlockedAddress(address: string, family: number): boolean {
  return family === 6 || isIP(address) === 6 ? isBlockedIpv6(address) : isBlockedIpv4(address);
}

/** Fonction `lookup` (API net/tls) qui refuse toute adresse privee ou reservee. */
export function createPinnedLookup(resolver: Resolver = dnsLookup as unknown as Resolver): LookupFunction {
  return (hostname, options, callback) => {
    const wantAll = typeof options === 'object' && options !== null && (options as { all?: boolean }).all === true;
    resolver(hostname, { all: true })
      .then((addresses) => {
        if (addresses.length === 0) {
          throw new UrlGuardError(`Resolution DNS vide pour "${hostname}".`);
        }
        for (const { address, family } of addresses) {
          if (isBlockedAddress(address, family)) {
            throw new UrlGuardError(
              `Hote refuse a la connexion : "${hostname}" resout vers une adresse privee ou reservee (${address}) (protection DNS rebinding).`,
            );
          }
        }
        if (wantAll) {
          (callback as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, addresses);
        } else {
          const first = addresses[0]!;
          callback(null, first.address, first.family);
        }
      })
      .catch((e: unknown) => {
        const err = e instanceof Error ? e : new Error(String(e));
        (callback as unknown as (e: Error) => void)(err);
      });
  };
}

let agent: Agent | undefined;

/** Agent undici dont toutes les connexions passent par createPinnedLookup. */
export function pinnedAgent(): Agent {
  agent ??= new Agent({ connect: { lookup: createPinnedLookup() } });
  return agent;
}

/** fetch avec resolution DNS epinglee et validee a la connexion (redirect: manual conseille). */
export async function pinnedFetch(url: URL | string, init: RequestInit = {}): Promise<Response> {
  const res = await undiciFetch(url, {
    ...(init as Record<string, unknown>),
    dispatcher: pinnedAgent(),
  } as Parameters<typeof undiciFetch>[1]);
  return res as unknown as Response;
}
