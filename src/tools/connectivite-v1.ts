import type { IrisTool } from './_types.js';
import { errorResult, jsonResult } from '../utils/git-run.js';
import { USER_AGENT } from '../utils/http-fetch.js';
import { assertHostCallAllowed } from '../utils/http-cache.js';
import { closeSync, lstatSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Sonde de connectivite, sur la base de la sonde de Hermes (Hermes-Agent, bridge PROJET-VOIR-LE-MONDE,
 * `scripts/test-connectivite.sh` + ADR-0006 du 12/11/2026), reprise dans Iris sur proposition de Peter (16/11).
 *
 * Principe de Hermes : un VRAI telechargement de taille fixe decide ; le ping de l Airbox peut etre parfait
 * pendant que le debit est mediocre. Memes seuils que Hermes, pour une seule regle chez toutes les agentes :
 *   OK   >= 5 Mbit/s  -> web complet
 *   SLOW 1 a 5        -> web leger (requetes courtes)
 *   DOWN < 1, ou echec -> pas de web ; le dire
 *
 * Adaptation Iris : pas de programme lance (pas de ping ICMP) ; la latence est le temps de reponse du serveur.
 * Cout Airbox : 1 Mio par mesure (comme Hermes). A la demande seulement, jamais planifie
 * (mesure Bob 16/11 : 256 Kio donnait SLOW 3,1 Mbit/s quand 1 Mio donnait OK 6,3 sur le meme reseau :
 *  un petit telechargement sous-estime le debit ; un seul mode, celui de Hermes, une seule regle)
 * (redirection du 17/10 : les anciennes mesures planifiees d Iris coutaient ~100 Mo par jour).
 * Au plus une vraie mesure par minute (15 s apres un echec) : sinon la derniere est rendue (cache).
 * Plusieurs appels simultanes partagent la meme mesure. Entre processus (Cursor, Claude, Gaby) : petit fichier
 * de cache et verrou dans le dossier temporaire (voir plus bas), pour qu un seul telechargement soit fait.
 */

export const CONNECTIVITE_HOTE = 'speed.cloudflare.com';
export const CONNECTIVITE_TAILLES = { standard: 1_048_576 } as const;
export const CONNECTIVITE_PAUSE_MS = 60_000;
/** Un echec (DOWN) est garde moins longtemps : la reprise ne doit pas rester masquee (decision Peter 07:58). */
export const CONNECTIVITE_PAUSE_DOWN_MS = 15_000;
const DELAI_MS = 30_000;
const MARGE_OCTETS = 65_536;

export type EtatReseau = 'OK' | 'SLOW' | 'DOWN';

const CONSEILS: Record<EtatReseau, string> = {
  OK: 'web complet possible',
  SLOW: 'web leger seulement : requetes courtes, pas de grosses pages',
  DOWN: 'pas de web : le dire, et repondre avec ce qui marche sans internet',
};

/** Seuils de Hermes (ADR-0006). */
export function classerDebit(mbps: number | null): EtatReseau {
  if (mbps === null || !Number.isFinite(mbps) || mbps < 1) return 'DOWN';
  return mbps >= 5 ? 'OK' : 'SLOW';
}

type Resultat = Record<string, unknown>;
type Origine = 'mesure' | 'fichier';
interface Obtenue {
  resultat: Resultat;
  quand: number;
  origine: Origine;
}
let derniere: { quand: number; resultat: Resultat } | null = null;
/** Mesure en cours : des appels simultanes la partagent (review Gaby CX2 : 1 seul telechargement). */
let enCours: Promise<Obtenue> | null = null;

export function resetConnectiviteForTests(): void {
  derniere = null;
  enCours = null;
}

function ttl(etat: unknown): number {
  return etat === 'DOWN' ? CONNECTIVITE_PAUSE_DOWN_MS : CONNECTIVITE_PAUSE_MS;
}

// ---------------------------------------------------------------------------
// Cache et verrou partages entre processus (decision Peter 07:58).
// Dossier temporaire du compte, fichiers de moins de 4 Ko, jamais fait confiance au contenu :
// seuls des champs connus, de type verifie, sont repris ; tout le reste est ignore (fichier corrompu = pas de cache).
// Desactive sous vitest, sauf si IRIS_CONNECTIVITE_DIR est pose (les tests choisissent leur dossier).
// ---------------------------------------------------------------------------
const FICHIER_CACHE = 'iris-mcp-connectivite-v1.json';
const FICHIER_VERROU = 'iris-mcp-connectivite-v1.lock';
const FICHIER_MAX_OCTETS = 4096;
const VERROU_PERIME_MS = DELAI_MS + 5_000;
const ATTENTE_VERROU_MAX_MS = DELAI_MS + 3_000;
const SONDAGE_MS = 250;
const CAUSES_CONNUES = new Set(['telechargement_incomplet', 'delai_30s', 'reseau']);

function dossierPartage(): string | null {
  const choisi = process.env.IRIS_CONNECTIVITE_DIR?.trim();
  if (choisi) return choisi;
  if (process.env.VITEST) return null;
  return tmpdir();
}

function nombre(x: unknown, min: number, max: number): number | null {
  return typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : null;
}

function lireCachePartage(dir: string, maintenant: number): { quand: number; resultat: Resultat } | null {
  try {
    const f = join(dir, FICHIER_CACHE);
    const info = lstatSync(f);
    if (!info.isFile() || info.size > FICHIER_MAX_OCTETS) return null; // pas de lien symbolique, pas de gros fichier
    const o = JSON.parse(readFileSync(f, 'utf-8')) as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') return null;
    const quand = nombre(o.quand, 1, 8.64e15);
    const etat = o.etat;
    if (quand === null || (etat !== 'OK' && etat !== 'SLOW' && etat !== 'DOWN')) return null;
    const age = maintenant - quand;
    if (age < 0 || age >= ttl(etat)) return null;
    const mode = 'standard' as const;
    const octetsDemandes = CONNECTIVITE_TAILLES[mode];
    const resultat: Resultat = {
      mode,
      octets_demandes: octetsDemandes,
      source: CONNECTIVITE_HOTE,
      methode: 'sonde Hermes (ADR-0006) : vrai telechargement',
      etat,
      debit_mbps: nombre(o.debit_mbps, 0, 1e6) ?? 0,
      latence_ms: nombre(o.latence_ms, 0, 1e7),
    };
    const recus = nombre(o.octets_recus, 0, 1e10);
    const duree = nombre(o.duree_ms, 0, 1e8);
    const http = nombre(o.http, 100, 599);
    if (recus !== null) resultat.octets_recus = recus;
    if (duree !== null) resultat.duree_ms = duree;
    if (http !== null) resultat.http = http;
    // Review Bob 16/11 : la cause d'une erreur HTTP (http_503...) se perdait d'un processus a l'autre.
    if (typeof o.cause === 'string' && (CAUSES_CONNUES.has(o.cause) || /^http_[1-5][0-9]{2}$/.test(o.cause))) resultat.cause = o.cause;
    return { quand, resultat };
  } catch {
    return null;
  }
}

function ecrireCachePartage(dir: string, quand: number, resultat: Resultat): void {
  try {
    const champs = ['etat', 'debit_mbps', 'latence_ms', 'octets_recus', 'duree_ms', 'http', 'cause'];
    const out: Record<string, unknown> = { quand };
    for (const c of champs) if (resultat[c] !== undefined) out[c] = resultat[c];
    const final = join(dir, FICHIER_CACHE);
    const tmp = `${final}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 });
    renameSync(tmp, final);
  } catch {
    // dossier inaccessible : pas de partage, la mesure reste valable pour ce processus
  }
}

type Verrou = 'pris' | 'occupe' | 'indispo';

function prendreVerrou(dir: string, maintenant: number): Verrou {
  const f = join(dir, FICHIER_VERROU);
  for (let essai = 0; essai < 2; essai++) {
    try {
      const fd = openSync(f, 'wx', 0o600); // echoue si le fichier existe (lien symbolique compris)
      closeSync(fd);
      return 'pris';
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return 'indispo';
      try {
        if (maintenant - statSync(f).mtimeMs <= VERROU_PERIME_MS) return 'occupe';
        unlinkSync(f); // verrou abandonne (processus tue) : on le reprend
      } catch {
        return 'indispo';
      }
    }
  }
  return 'occupe';
}

function lacherVerrou(dir: string): void {
  try {
    unlinkSync(join(dir, FICHIER_VERROU));
  } catch {
    // deja retire
  }
}

const pause = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

async function mesurerSousBorne(mode: keyof typeof CONNECTIVITE_TAILLES): Promise<Obtenue> {
  assertHostCallAllowed(`https://${CONNECTIVITE_HOTE}/`); // F13 : leve si l hote est au maximum
  const resultat = await mesurer(mode);
  return { resultat, quand: Date.now(), origine: 'mesure' };
}

async function obtenirMesure(mode: keyof typeof CONNECTIVITE_TAILLES): Promise<Obtenue> {
  const dir = dossierPartage();
  if (!dir) return mesurerSousBorne(mode);
  const dejaLa = () => {
    const lu = lireCachePartage(dir, Date.now());
    return lu ? ({ ...lu, origine: 'fichier' } as Obtenue) : null;
  };
  const d0 = dejaLa();
  if (d0) return d0;
  let verrou = prendreVerrou(dir, Date.now());
  if (verrou === 'occupe') {
    // Un autre processus mesure : on attend son resultat (au plus delai + 3 s), sans telecharger.
    const limite = Date.now() + ATTENTE_VERROU_MAX_MS;
    while (verrou === 'occupe' && Date.now() < limite) {
      await pause(SONDAGE_MS);
      const d = dejaLa();
      if (d) return d;
      verrou = prendreVerrou(dir, Date.now());
    }
    if (verrou === 'occupe') verrou = 'indispo';
  }
  if (verrou === 'pris') {
    try {
      const d1 = dejaLa();
      if (d1) return d1;
      const o = await mesurerSousBorne(mode);
      ecrireCachePartage(dir, o.quand, o.resultat);
      return o;
    } finally {
      lacherVerrou(dir);
    }
  }
  return mesurerSousBorne(mode);
}
function arrondi(n: number, chiffres = 2): number {
  const p = 10 ** chiffres;
  return Math.round(n * p) / p;
}

async function mesurer(mode: keyof typeof CONNECTIVITE_TAILLES): Promise<Resultat> {
  const octetsDemandes = CONNECTIVITE_TAILLES[mode];
  const url = `https://${CONNECTIVITE_HOTE}/__down?bytes=${octetsDemandes}`;
  const base = { mode, octets_demandes: octetsDemandes, source: CONNECTIVITE_HOTE, methode: 'sonde Hermes (ADR-0006) : vrai telechargement' };
  const t0 = performance.now();
  let latenceMs: number | null = null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Cache-Control': 'no-store' },
      redirect: 'error',
      signal: AbortSignal.timeout(DELAI_MS),
    });
    latenceMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ...base, etat: 'DOWN' as EtatReseau, http: res.status, latence_ms: latenceMs, debit_mbps: 0, cause: `http_${res.status}` };
    }
    let recus = 0;
    const lecteur = res.body?.getReader();
    if (lecteur) {
      try {
        for (;;) {
          const { done, value } = await lecteur.read();
          if (done) break;
          recus += value?.byteLength ?? 0;
          if (recus > octetsDemandes + MARGE_OCTETS) break; // jamais plus que prevu (Airbox)
        }
      } finally {
        await lecteur.cancel().catch(() => undefined);
      }
    }
    const dureeS = (performance.now() - t0) / 1000;
    const mbps = dureeS > 0 && recus > 0 ? arrondi((recus * 8) / dureeS / 1_000_000) : null;
    const etat = recus < octetsDemandes * 0.9 ? 'DOWN' : classerDebit(mbps);
    return {
      ...base,
      etat,
      debit_mbps: mbps ?? 0,
      latence_ms: latenceMs,
      octets_recus: recus,
      duree_ms: Math.round(dureeS * 1000),
      http: res.status,
      ...(recus < octetsDemandes * 0.9 ? { cause: 'telechargement_incomplet' } : {}),
    };
  } catch (e) {
    const nom = e instanceof Error ? e.name : '';
    const cause = nom === 'TimeoutError' || nom === 'AbortError' ? 'delai_30s' : 'reseau';
    return { ...base, etat: 'DOWN' as EtatReseau, debit_mbps: 0, latence_ms: latenceMs, cause };
  }
}

export const tool: IrisTool = {
  id: 'connectivite-v1',
  description:
    'Sonde reseau avant une recherche web lourde (base : sonde de Hermes, ADR-0006). Un vrai telechargement de taille fixe ' +
    '(1 Mio, comme Hermes) depuis speed.cloudflare.com decide : OK >= 5 Mbit/s (web complet), SLOW 1 a 5 (web leger), ' +
    'DOWN < 1 ou echec (pas de web). Le ping de l Airbox peut mentir. Au plus une mesure par minute (15 s apres un echec), ' +
    'partagee entre les appels simultanes et entre les processus (sinon la derniere est rendue). ' +
    'A la demande seulement : chaque mesure coute 1 Mio de donnees.',
  category: 'web',
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  inputSchema: {},
  execute: async (input) => {
    void input;
    const mode = 'standard' as const;
    const maintenant = Date.now();
    // Une mesure recente suffit : on la rend sans retelecharger.
    const age = derniere ? maintenant - derniere.quand : -1;
    // age < 0 : l horloge a recule, on ne garde pas un cache sans fin (review Gaby CX2).
    if (derniere && age >= 0 && age < ttl(derniere.resultat.etat)) {
      return jsonResult({
        ...derniere.resultat,
        cache: true,
        age_s: Math.round(age / 1000),
        conseil: CONSEILS[derniere.resultat.etat as EtatReseau],
      });
    }
    let promesse = enCours;
    const createur = promesse === null;
    if (promesse === null) {
      promesse = obtenirMesure(mode);
      enCours = promesse;
    }
    let o: Obtenue;
    try {
      o = await promesse;
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : String(e));
    } finally {
      if (createur) enCours = null;
    }
    const conseil = CONSEILS[o.resultat.etat as EtatReseau];
    if (!createur) {
      return jsonResult({ ...o.resultat, cache: true, partage_avec_mesure_en_cours: true, conseil });
    }
    derniere = { quand: o.quand, resultat: o.resultat };
    if (o.origine === 'fichier') {
      return jsonResult({
        ...o.resultat,
        cache: true,
        partage_entre_processus: true,
        age_s: Math.round((Date.now() - o.quand) / 1000),
        conseil,
      });
    }
    return jsonResult({ ...o.resultat, cache: false, conseil });
  },
};