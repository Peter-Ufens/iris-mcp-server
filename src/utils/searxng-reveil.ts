/**
 * Reveil a la demande de SearXNG (decision Peter 16/11 06:07 : « a la demande » ; GO 06:08).
 *
 * Quand SearXNG ne repond pas (connexion refusee : conteneur arrete apres un redemarrage du PC),
 * Iris lance UNE commande fixe, puis relance la recherche une fois :
 *     <IRIS_DOCKER_EXE> start <IRIS_SEARXNG_CONTENEUR>
 *
 * Garde-fous (meme esprit que ADR-0012 A5, A8, A10) :
 * - sans shell (execFile), chemin ABSOLU vers un .exe sous Windows ;
 * - nom de conteneur verifie (lettres, chiffres, . _ -, jamais un tiret en tete : pas d option) ;
 * - aucun argument venu d un client : seulement « start » et le nom de la config ;
 * - jamais stop, rm, run, exec ;
 * - environnement minimal (pas les cles de la config du client) ;
 * - delai 20 s, puis attente de /healthz 15 s au plus ;
 * - un seul reveil a la fois par processus, et une pause de 60 s apres un echec (pas de boucle).
 * Sans IRIS_SEARXNG_CONTENEUR : pas de reveil (comportement d avant).
 */
import { execFile } from 'node:child_process';
import { estCheminLocalAbsolu } from './chemin-local.js';

export const REVEIL_DOCKER_TIMEOUT_MS = 20_000;
export const REVEIL_PRET_MAX_MS = 15_000;
export const REVEIL_PAUSE_APRES_ECHEC_MS = 60_000;
const POLL_MS = 250;
const NOM_CONTENEUR_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;

export type ReveilConfig =
  | { actif: true; dockerExe: string; conteneur: string }
  | { actif: false; raison: string };

export function configReveil(env: NodeJS.ProcessEnv = process.env, plateforme = process.platform): ReveilConfig {
  const conteneur = (env.IRIS_SEARXNG_CONTENEUR ?? '').trim();
  if (!conteneur) return { actif: false, raison: 'reveil non configure (IRIS_SEARXNG_CONTENEUR absent)' };
  if (!NOM_CONTENEUR_RE.test(conteneur)) return { actif: false, raison: 'IRIS_SEARXNG_CONTENEUR invalide' };
  const dockerExe = (env.IRIS_DOCKER_EXE ?? '').trim();
  if (!dockerExe || !estCheminLocalAbsolu(dockerExe)) {
    return { actif: false, raison: 'IRIS_DOCKER_EXE absent, non absolu ou reseau' };
  }
  // Un .bat / .cmd demanderait un shell : refuse.
  if (plateforme === 'win32' && !/\.exe$/i.test(dockerExe)) {
    return { actif: false, raison: 'IRIS_DOCKER_EXE doit etre un .exe' };
  }
  return { actif: true, dockerExe, conteneur };
}

/** SearXNG eteint = connexion refusee (port ferme), pas une erreur HTTP ni un delai. */
export function estConnexionRefusee(e: unknown): boolean {
  const cause = e && typeof e === 'object' ? (e as { cause?: unknown }).cause : undefined;
  const code = cause && typeof cause === 'object' ? (cause as { code?: unknown }).code : undefined;
  return code === 'ECONNREFUSED' || code === 'ECONNRESET';
}

const ENV_GARDEES = [
  'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir', 'PATH', 'Path', 'USERPROFILE', 'HOME',
  'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'PROGRAMDATA', 'ProgramFiles', 'PROGRAMFILES',
  'TEMP', 'TMP', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG',
];

/** Environnement minimal pour docker (pas les cles Qdrant, n8n... de la config du client). */
export function envPourDocker(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of ENV_GARDEES) {
    const v = env[k];
    if (typeof v === 'string' && v !== '' && out[k] === undefined) out[k] = v;
  }
  return out;
}

export type ResultatCommande = { ok: true } | { ok: false; cause: 'introuvable' | 'delai' | 'refus' };
export type Executeur = (exe: string, args: string[], opts: { timeoutMs: number; env: NodeJS.ProcessEnv }) => Promise<ResultatCommande>;

const executeurReel: Executeur = (exe, args, opts) =>
  new Promise((resolve) => {
    execFile(
      exe,
      args,
      { timeout: opts.timeoutMs, env: opts.env, shell: false, windowsHide: true, maxBuffer: 64 * 1024 },
      (err) => {
        if (!err) return resolve({ ok: true });
        const e = err as NodeJS.ErrnoException & { killed?: boolean };
        if (e.code === 'ENOENT') return resolve({ ok: false, cause: 'introuvable' });
        if (e.killed) return resolve({ ok: false, cause: 'delai' });
        // Docker eteint, conteneur inconnu... : jamais le texte de stderr (chemins, noms).
        return resolve({ ok: false, cause: 'refus' });
      },
    );
  });

export type AttentePret = (base: URL, maxMs: number) => Promise<boolean>;

const attentePretReelle: AttentePret = async (base, maxMs) => {
  const t0 = Date.now();
  const sante = new URL('/healthz', base);
  while (Date.now() - t0 < maxMs) {
    try {
      const r = await fetch(sante, { signal: AbortSignal.timeout(1_000), redirect: 'error' });
      await r.body?.cancel().catch(() => undefined);
      if (r.ok) return true;
    } catch {
      /* pas encore pret */
    }
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
  return false;
};

export type ReveilResultat = { ok: true; ms: number } | { ok: false; raison: string };

let enCours: Promise<ReveilResultat> | null = null;
let dernierEchec = 0;

export function resetReveilForTests(): void {
  enCours = null;
  dernierEchec = 0;
}

/** Allume le conteneur SearXNG (commande fixe), puis attend /healthz. Un seul a la fois. */
export function reveillerSearxng(
  base: URL,
  cfg: { dockerExe: string; conteneur: string },
  deps: { exec?: Executeur; pret?: AttentePret; maintenant?: () => number } = {},
): Promise<ReveilResultat> {
  const maintenant = deps.maintenant ?? Date.now;
  if (dernierEchec && maintenant() - dernierEchec < REVEIL_PAUSE_APRES_ECHEC_MS) {
    return Promise.resolve({ ok: false, raison: 'pause apres un echec recent (60 s)' });
  }
  if (enCours) return enCours;
  const exec = deps.exec ?? executeurReel;
  const pret = deps.pret ?? attentePretReelle;
  enCours = (async (): Promise<ReveilResultat> => {
    const t0 = maintenant();
    const r = await exec(cfg.dockerExe, ['start', cfg.conteneur], {
      timeoutMs: REVEIL_DOCKER_TIMEOUT_MS,
      env: envPourDocker(),
    });
    if (!r.ok) {
      dernierEchec = maintenant();
      const raison =
        r.cause === 'introuvable'
          ? 'docker introuvable'
          : r.cause === 'delai'
            ? 'docker trop lent (20 s)'
            : 'docker a refuse (Docker eteint, ou conteneur absent)';
      return { ok: false, raison };
    }
    if (!(await pret(base, REVEIL_PRET_MAX_MS))) {
      dernierEchec = maintenant();
      return { ok: false, raison: 'SearXNG pas pret apres 15 s' };
    }
    dernierEchec = 0;
    return { ok: true, ms: maintenant() - t0 };
  })().finally(() => {
    enCours = null;
  });
  return enCours;
}
