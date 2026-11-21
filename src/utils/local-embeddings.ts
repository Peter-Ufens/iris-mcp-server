/**
 * Embeddings locaux · lot O (ADR-0013 / 0014 amendés 16/11) :
 * 1) Ollama (11434) : API native, puis format OpenAI /v1/embeddings si Ollama a repondu une erreur HTTP ;
 * 2) si Ollama KO : llama.cpp **Hermes** (18434) via /v1/embeddings, SEULEMENT si le moteur retrouve le
 *    vecteur de reference du modele d'index (ADR-0013 A3) ;
 * 3) **pas** de 3e llama-server Iris sur le chemin nominal (VRAM / review Karen). Iris ne lance aucun programme.
 *
 * Decision Peter 10:35 : le secours Hermes est mis de cote (sujet Hermes-Agent). Le code reste, inerte tant que
 * Hermes :18434 est hors ligne, et garde par le vecteur de reference.
 *
 * Review Gaby 16/11 : la doc llama.cpp dit que le champ `model` est « ignore en mode modele unique ». Un serveur
 * Hermes qui porte un modele de chat repondrait donc a `nomic-embed-text` avec SES nombres, sans erreur.
 * D'ou le controle par vecteur de reference, obligatoire pour le secours.
 *
 * Journal des echecs (ADR-0014 §4) : codes fixes seulement, voir utils/journal-moteurs.ts.
 */
import { lireJsonBorne } from './http-fetch.js';
import { resoudreBase, resoudreBaseOllama, type BaseOllama } from './ollama-base.js';
import { RAG_MAX_OCTETS_OLLAMA } from './rag-http.js';
import { retirerInvisibles } from './texte-invisible.js';
import { EMBED_REFERENCE_MODELE, EMBED_REFERENCE_PHRASE, EMBED_REFERENCE_VECTEUR } from './embed-reference.js';
import { journaliser, type CauseJournal, type EtapeJournal, type MoteurJournal, type OutilJournal } from './journal-moteurs.js';

export const HERMES_LLAMA_DEFAUT = 'http://127.0.0.1:18434';
export const HERMES_LLAMA_OPT_IN = 'IRIS_LLM_SECOURS_HORS_LOOPBACK';
export const EMBED_DIM_ATTENDUE = 768;
/** Plafond de dimension : un vecteur plus long est refuse, quel que soit le moteur. */
export const EMBED_DIM_MAX = 8192;
/** Ressemblance minimale avec le vecteur de reference (mesure : 0,999999 a 1 entre Ollama et llama.cpp). */
export const COSINUS_MIN_REFERENCE = 0.999;
/** Mémoire courte « Ollama KO » (secondes), comme le DOWN de connectivite. */
export const OLLAMA_KO_CACHE_S = 15;
const VERIF_SECOURS_OK_S = 600;
const VERIF_SECOURS_KO_S = 30;
/** ADR-0014 : 3 tentatives, seulement si le moteur dit « Loading model » (503) ; pauses entre les tentatives. */
export const SANTE_TENTATIVES = 3;
export const SANTE_PAUSES_MS = [2_000, 4_000];
export const SANTE_DELAI_MS = 5_000;
/** Apres 3 echecs de chargement : pause avant de reessayer (ADR-0014 §2.7). */
export const SECOURS_PAUSE_S = 60;

export type MoteurEmbed = MoteurJournal;

export type EmbedOk = {
  ok: true;
  vector: number[];
  moteur: MoteurEmbed;
  format: 'ollama-api' | 'openai-v1';
  /** Le moteur de secours a retrouve le vecteur de reference. Toujours vrai pour `hermes-llamacpp`. */
  verifie: boolean;
  /** Causes des moteurs essayes avant celui-ci (vide si Ollama a repondu). */
  tentatives: Array<{ moteur: MoteurEmbed; cause: string }>;
};

export type EmbedKo = {
  ok: false;
  erreur: string;
  tentatives: Array<{ moteur: MoteurEmbed; cause: string }>;
};

export interface ReferenceEmbed {
  phrase: string;
  vector: readonly number[];
}

let ollamaKoJusqua = 0;
let secoursPauseJusqua = 0;
const verifSecours = new Map<string, { ok: boolean; jusqua: number; raison?: string }>();

export function _resetOllamaKoCachePourTests(): void {
  ollamaKoJusqua = 0;
  secoursPauseJusqua = 0;
  verifSecours.clear();
}

/** Ollama est-il repute KO (memoire courte) ? Sert a ne pas retenter un appel groupe vers un Ollama mort. */
export function ollamaEstKo(maintenant: number = Date.now()): boolean {
  return !process.env.VITEST && maintenant < ollamaKoJusqua;
}

export function resoudreBaseHermesLlama(env: NodeJS.ProcessEnv = process.env, explicite?: string): BaseOllama {
  return resoudreBase(
    explicite ?? env.IRIS_LLM_SECOURS_URL,
    { variable: 'IRIS_LLM_SECOURS_URL', optIn: HERMES_LLAMA_OPT_IN, defaut: HERMES_LLAMA_DEFAUT },
    env,
  );
}

function cosinus(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Echec d'un moteur, avec son code de journal (jamais le message brut du serveur). */
export class ErreurMoteur extends Error {
  constructor(
    message: string,
    readonly code: CauseJournal,
    readonly http?: number,
    /** Panne reseau ou delai : le moteur n'a pas repondu. Pas la peine d'essayer un autre format chez lui. */
    readonly reseau = false,
  ) {
    super(message);
  }
  /** Deja inscrite au journal : ne pas la re-inscrire plus haut. */
  deja = false;
}

function nettoyerCause(e: unknown): string {
  const brut = e instanceof Error ? e.message : String(e);
  return retirerInvisibles(brut).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 160);
}

async function postEmbed(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw new ErreurMoteur('delai depasse', 'delai', undefined, true);
      throw new ErreurMoteur('injoignable', 'refuse', undefined, true);
    }
    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      throw new ErreurMoteur(`HTTP ${res.status}`, 'http', res.status);
    }
    try {
      return await lireJsonBorne<unknown>(res, RAG_MAX_OCTETS_OLLAMA, new URL(url).origin);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw new ErreurMoteur('delai depasse', 'delai', undefined, true);
      throw new ErreurMoteur(nettoyerCause(e), 'reponse_invalide');
    }
  } finally {
    clearTimeout(t);
  }
}

/** Vecteur sain : 1 a EMBED_DIM_MAX nombres, tous finis. */
function vecteurSain(emb: unknown): number[] | null {
  if (!Array.isArray(emb) || emb.length === 0 || emb.length > EMBED_DIM_MAX) return null;
  for (const x of emb) if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  return emb as number[];
}

function lireVecteurOpenAI(data: unknown): number[] | null {
  if (!data || typeof data !== 'object') return null;
  return vecteurSain((data as { data?: Array<{ embedding?: unknown }> }).data?.[0]?.embedding);
}

function lireVecteurOllama(data: unknown): number[] | null {
  if (!data || typeof data !== 'object') return null;
  return vecteurSain((data as { embedding?: unknown }).embedding);
}

function verifierDimensionOllama(v: number[], ref: readonly number[] | undefined, strictDim: boolean): ErreurMoteur | null {
  if (ref && ref.length > 0) {
    if (v.length !== ref.length) return new ErreurMoteur(`dimension ${v.length} (reference ${ref.length})`, 'dimension');
    return null;
  }
  if (strictDim && v.length !== EMBED_DIM_ATTENDUE) return new ErreurMoteur(`dimension ${v.length} (attendu ${EMBED_DIM_ATTENDUE})`, 'dimension');
  return null;
}

export interface EmbedOptions {
  model?: string;
  timeoutMs?: number;
  /** Phrase de controle + vecteur de reference (ADR-0013 A3). Par defaut : celle de nomic-embed-text. */
  reference?: ReferenceEmbed;
  env?: NodeJS.ProcessEnv;
  /** Base Ollama explicite (parametre d'outil) ; memes regles que OLLAMA_BASE_URL. */
  ollamaBase?: string;
  /** Sauter Ollama (tests). */
  forcerSecours?: boolean;
  maintenant?: number;
  /** Memoire « Ollama KO ». Par defaut active hors vitest. */
  cacheKo?: boolean;
  /** Outil appelant, pour le journal des echecs. */
  outil?: OutilJournal;
  /** Pauses entre les tentatives de sante du secours (tests). */
  pausesSanteMs?: number[];
  timeoutSanteMs?: number;
}

const dormir = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/**
 * Produit un embedding. Ollama d'abord, puis Hermes :18434 (verifie). Jamais de 3e process.
 */
export async function embedLocal(texte: string, opts: EmbedOptions = {}): Promise<EmbedOk | EmbedKo> {
  const model = opts.model ?? 'nomic-embed-text';
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const env = opts.env ?? process.env;
  const maintenant = opts.maintenant ?? Date.now();
  const outil: OutilJournal = opts.outil ?? 'embeddings';
  const tentatives: EmbedKo['tentatives'] = [];
  const strictDim = env.IRIS_EMBED_DIM_STRICT === '1' || Boolean(opts.reference);
  const cacheKo = opts.cacheKo ?? !process.env.VITEST;
  const reference: ReferenceEmbed | undefined =
    opts.reference ??
    (model === EMBED_REFERENCE_MODELE ? { phrase: EMBED_REFERENCE_PHRASE, vector: EMBED_REFERENCE_VECTEUR } : undefined);

  const baseO = resoudreBaseOllama(env, opts.ollamaBase);
  const baseH = resoudreBaseHermesLlama(env);

  /** Une ligne de journal : codes fixes seulement, jamais le message du serveur. */
  const noter = (etape: EtapeJournal, moteur: MoteurJournal, e: unknown, debut: number, tentative?: number): void => {
    const code = e instanceof ErreurMoteur ? e.code : 'inconnu';
    if (e instanceof ErreurMoteur) e.deja = true;
    journaliser(
      { outil, etape, moteur, cause: code, duree_ms: Date.now() - debut, ...(tentative ? { tentative } : {}), ...(e instanceof ErreurMoteur && e.http ? { http: e.http } : {}) },
      env,
    );
  };

  const essayeOllama = async (): Promise<EmbedOk | null> => {
    if (!baseO.ok) {
      tentatives.push({ moteur: 'ollama', cause: baseO.erreur });
      journaliser({ outil, etape: 'ollama', moteur: 'ollama', cause: 'base_refusee' }, env);
      return null;
    }
    const debut = Date.now();
    const validee = (v: number[]) => verifierDimensionOllama(v, opts.reference?.vector, strictDim);
    let c1: string;
    // 1a) API native Ollama
    try {
      const raw = await postEmbed(`${baseO.url}/api/embeddings`, { model, prompt: texte }, timeoutMs);
      const v = lireVecteurOllama(raw);
      if (!v) throw new ErreurMoteur('reponse sans embedding valide', 'reponse_invalide');
      const dimErr = validee(v);
      if (dimErr) throw dimErr;
      ollamaKoJusqua = 0;
      return { ok: true, vector: v, moteur: 'ollama', format: 'ollama-api', verifie: false, tentatives };
    } catch (e1) {
      c1 = nettoyerCause(e1);
      noter('ollama', 'ollama', e1, debut);
      // Panne reseau ou delai : pas de 2e essai chez le meme moteur (au plus 10 s perdues, pas 20).
      if (e1 instanceof ErreurMoteur && e1.reseau) {
        tentatives.push({ moteur: 'ollama', cause: c1 });
        ollamaKoJusqua = maintenant + OLLAMA_KO_CACHE_S * 1000;
        return null;
      }
    }
    // 1b) format OpenAI (Ollama le parle aussi), seulement apres une reponse HTTP d'erreur
    const debut2 = Date.now();
    try {
      const raw = await postEmbed(`${baseO.url}/v1/embeddings`, { model, input: texte }, timeoutMs);
      const v = lireVecteurOpenAI(raw);
      if (!v) throw new ErreurMoteur('reponse OpenAI sans embedding valide', 'reponse_invalide');
      const dimErr = validee(v);
      if (dimErr) throw dimErr;
      ollamaKoJusqua = 0;
      return { ok: true, vector: v, moteur: 'ollama', format: 'openai-v1', verifie: false, tentatives };
    } catch (e2) {
      noter('ollama', 'ollama', e2, debut2);
      tentatives.push({ moteur: 'ollama', cause: `${c1} | ${nettoyerCause(e2)}` });
      ollamaKoJusqua = maintenant + OLLAMA_KO_CACHE_S * 1000;
      return null;
    }
  };

  const cleVerif = (base: string) => (reference ? `${base}|${model}|${reference.phrase}` : '');

  /**
   * Sante du secours (ADR-0014 §2) : GET /health. Connexion refusee ou delai = echec tout de suite, SANS nouvelle
   * tentative (personne ne demarre ce serveur : attendre ne sert a rien). Seule une reponse 503 « Loading model »
   * justifie d'attendre : 3 tentatives, avec des pauses ; apres 3 echecs, pause de 60 s. 404 = pas de /health, on continue.
   */
  const santeSecours = async (base: string): Promise<void> => {
    if (maintenant < secoursPauseJusqua) {
      const pause = new ErreurMoteur(`pause ${SECOURS_PAUSE_S}s apres ${SANTE_TENTATIVES} echecs de chargement`, 'pause');
      noter('secours-sante', 'hermes-llamacpp', pause, Date.now());
      throw pause;
    }
    const pauses = opts.pausesSanteMs ?? SANTE_PAUSES_MS;
    const delai = opts.timeoutSanteMs ?? SANTE_DELAI_MS;
    for (let n = 1; n <= SANTE_TENTATIVES; n++) {
      const debut = Date.now();
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), delai);
      let statut: number;
      try {
        const res = await fetch(`${base}/health`, { signal: controller.signal, redirect: 'error' });
        statut = res.status;
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
      } catch (e) {
        const err =
          e instanceof Error && e.name === 'AbortError'
            ? new ErreurMoteur('delai depasse', 'delai', undefined, true)
            : new ErreurMoteur('injoignable', 'refuse', undefined, true);
        noter('secours-sante', 'hermes-llamacpp', err, debut, n);
        throw err;
      } finally {
        clearTimeout(t);
      }
      if (statut === 200 || statut === 404) return;
      if (statut === 503) {
        const err = new ErreurMoteur('modele en cours de chargement', 'charge_en_cours', 503);
        noter('secours-sante', 'hermes-llamacpp', err, debut, n);
        if (n < SANTE_TENTATIVES) {
          await dormir(pauses[n - 1] ?? 2_000);
          continue;
        }
        secoursPauseJusqua = Date.now() + SECOURS_PAUSE_S * 1000;
        const final = new ErreurMoteur(`modele toujours en chargement apres ${SANTE_TENTATIVES} tentatives`, 'charge_en_cours', 503);
        final.deja = true;
        throw final;
      }
      const err = new ErreurMoteur(`HTTP ${statut}`, 'http', statut);
      noter('secours-sante', 'hermes-llamacpp', err, debut, n);
      throw err;
    }
  };

  /** Le moteur de secours doit retrouver le vecteur de reference, sinon il est refuse (resultat memorise). */
  const verifierSecours = async (base: string): Promise<ErreurMoteur | null> => {
    if (!reference) {
      const sans = new ErreurMoteur(`pas de vecteur de reference pour le modele ${nettoyerCause(model)} : secours refuse (ADR-0013 A3)`, 'pas_de_reference');
      noter('reference', 'hermes-llamacpp', sans, Date.now());
      return sans;
    }
    const cle = cleVerif(base);
    const connu = verifSecours.get(cle);
    if (connu && maintenant < connu.jusqua) {
      if (connu.ok) return null;
      const memo = new ErreurMoteur(connu.raison ?? 'verification echouee', 'reference_fausse');
      memo.deja = true; // deja inscrit lors du 1er refus
      return memo;
    }
    const debut = Date.now();
    let echec: ErreurMoteur | null = null;
    try {
      const raw = await postEmbed(`${base}/v1/embeddings`, { model, input: reference.phrase }, timeoutMs);
      const v = lireVecteurOpenAI(raw);
      if (!v) echec = new ErreurMoteur('verification : reponse sans embedding valide', 'reponse_invalide');
      else if (v.length !== reference.vector.length) echec = new ErreurMoteur(`verification : dimension ${v.length} (reference ${reference.vector.length})`, 'dimension');
      else {
        const c = cosinus(v, reference.vector);
        if (c < COSINUS_MIN_REFERENCE) echec = new ErreurMoteur(`verification : vecteur de reference trop eloigne (ressemblance ${c.toFixed(3)}), moteur refuse`, 'reference_fausse');
      }
    } catch (e) {
      echec = e instanceof ErreurMoteur ? new ErreurMoteur(`verification impossible (${nettoyerCause(e)})`, e.code, e.http, e.reseau) : new ErreurMoteur('verification impossible', 'inconnu');
    }
    if (echec) noter('reference', 'hermes-llamacpp', echec, debut);
    verifSecours.set(cle, {
      ok: echec === null,
      jusqua: maintenant + (echec === null ? VERIF_SECOURS_OK_S : VERIF_SECOURS_KO_S) * 1000,
      ...(echec ? { raison: echec.message } : {}),
    });
    return echec;
  };

  const essayeHermes = async (): Promise<EmbedOk | null> => {
    if (!baseH.ok) {
      tentatives.push({ moteur: 'hermes-llamacpp', cause: baseH.erreur });
      journaliser({ outil, etape: 'secours-appel', moteur: 'hermes-llamacpp', cause: 'base_refusee' }, env);
      return null;
    }
    const debut = Date.now();
    try {
      const dejaVerifie = verifSecours.get(cleVerif(baseH.url));
      // Sante puis controle seulement quand le resultat n'est pas deja memorise (une fois par 10 min).
      if (!reference) throw (await verifierSecours(baseH.url)); // sans reference : refus avant tout appel
      if (!(dejaVerifie && dejaVerifie.ok && maintenant < dejaVerifie.jusqua)) {
        await santeSecours(baseH.url);
        const refus = await verifierSecours(baseH.url);
        if (refus) throw refus;
      }
      const raw = await postEmbed(`${baseH.url}/v1/embeddings`, { model, input: texte }, timeoutMs);
      const v = lireVecteurOpenAI(raw);
      if (!v) throw new ErreurMoteur('reponse Hermes sans embedding valide', 'reponse_invalide');
      if (reference && v.length !== reference.vector.length) {
        throw new ErreurMoteur(`dimension ${v.length} (reference ${reference.vector.length})`, 'dimension');
      }
      return { ok: true, vector: v, moteur: 'hermes-llamacpp', format: 'openai-v1', verifie: true, tentatives };
    } catch (e) {
      // Les etapes sante et reference se sont deja inscrites au journal ; le reste est inscrit ici.
      if (!(e instanceof ErreurMoteur && e.deja)) noter('secours-appel', 'hermes-llamacpp', e, debut);
      tentatives.push({ moteur: 'hermes-llamacpp', cause: nettoyerCause(e) });
      return null;
    }
  };

  if (opts.forcerSecours) {
    tentatives.push({ moteur: 'ollama', cause: 'force secours (test)' });
  } else if (cacheKo && maintenant < ollamaKoJusqua) {
    tentatives.push({ moteur: 'ollama', cause: `cache KO ${OLLAMA_KO_CACHE_S}s` });
    journaliser({ outil, etape: 'ollama', moteur: 'ollama', cause: 'cache_ko' }, env);
  } else {
    const o = await essayeOllama();
    if (o) return o;
  }

  const h = await essayeHermes();
  if (h) return h;

  return {
    ok: false,
    erreur:
      'Aucun moteur embeddings (Ollama puis Hermes :18434). Pas de 3e llama-server Iris. ' +
      tentatives.map((t) => `${t.moteur}:${t.cause}`).join(' · '),
    tentatives,
  };
}