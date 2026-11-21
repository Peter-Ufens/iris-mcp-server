/**
 * Bases d'URL des services locaux (Ollama, Qdrant) : loopback par defaut (review Gaby 16/11, decisions Peter 07:58 et 08:11).
 * Une autre machine n'est acceptee qu'avec un opt-in explicite (IRIS_OLLAMA_HORS_LOOPBACK, IRIS_QDRANT_HORS_LOOPBACK = 1).
 * Dans tous les cas : http ou https, pas d'identifiants, pas de chemin reseau (UNC, antislash), pas de requete.
 * Aucun repli silencieux : une valeur refusee donne une erreur qui nomme la variable, sans recopier l'URL.
 */
export const OLLAMA_DEFAUT = 'http://127.0.0.1:11434';
export const OLLAMA_OPT_IN = 'IRIS_OLLAMA_HORS_LOOPBACK';

export type BaseOllama = { ok: true; url: string } | { ok: false; erreur: string };

export interface RegleBase {
  variable: string;
  optIn: string;
  defaut: string;
}

export function resoudreBase(brutEntree: string | undefined, regle: RegleBase, env: NodeJS.ProcessEnv): BaseOllama {
  const brut = (brutEntree ?? '').trim();
  if (brut.length === 0) return { ok: true, url: regle.defaut };
  const nom = regle.variable;
  if (brut.includes('\\') || brut.startsWith('//')) {
    return { ok: false, erreur: `${nom} refusee : chemin reseau ou antislash.` };
  }
  let u: URL;
  try {
    u = new URL(brut);
  } catch {
    return { ok: false, erreur: `${nom} invalide (URL attendue).` };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, erreur: `${nom} refusee : seul http ou https est autorise.` };
  }
  if (u.username || u.password) {
    return { ok: false, erreur: `${nom} refusee : pas d identifiants dans l URL.` };
  }
  if (u.search || u.hash) {
    return { ok: false, erreur: `${nom} refusee : ni requete ni fragment.` };
  }
  const hote = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = hote === '127.0.0.1' || hote === 'localhost' || hote === '::1';
  if (!loopback && env[regle.optIn] !== '1') {
    return {
      ok: false,
      erreur: `${nom} refusee : hote non loopback. Pour viser une autre machine, poser ${regle.optIn}=1 (choix explicite).`,
    };
  }
  return { ok: true, url: `${u.origin}${u.pathname}`.replace(/\/+$/, '') };
}

/** `explicite` : valeur passee par le code appelant (tests) ; meme regles que la variable d'environnement. */
export function resoudreBaseOllama(env: NodeJS.ProcessEnv = process.env, explicite?: string): BaseOllama {
  return resoudreBase(explicite ?? env.OLLAMA_BASE_URL, { variable: 'OLLAMA_BASE_URL', optIn: OLLAMA_OPT_IN, defaut: OLLAMA_DEFAUT }, env);
}