/**
 * Conversion HTML -> texte lisible, sans dependance externe.
 * Volontairement simple : on retire le bruit (script, style, balises, entites)
 * pour donner au LLM un extrait lisible, pas un rendu fidele.
 */

import { retirerInvisibles } from './texte-invisible.js';

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  hellip: '...',
  ndash: '-',
  mdash: '-',
  laquo: '"',
  raquo: '"',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  ugrave: 'ù',
  ccedil: 'ç',
  lt: '<',
  gt: '>',
};

/** Decode les entites HTML courantes + numeriques. `&amp;` est traite en dernier. */
export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeFromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeFromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/&amp;/gi, '&');
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** True si le Content-Type designe du HTML / XHTML. */
export function isHtmlContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.includes('text/html') || ct.includes('application/xhtml');
}

/**
 * Transforme un document HTML en texte : retire script/style/commentaires,
 * remplace les balises de bloc par des sauts de ligne, decode les entites,
 * normalise les espaces.
 */
/** Plafond entree HTML (F2 red team 14/10 : O(n2) sur beaucoup de `<`). */
const HTML_TO_TEXT_MAX_INPUT = 100_000;

const NON_CONTENT_TAGS = ['script', 'style', 'noscript', 'template', 'svg', 'iframe'];

/**
 * Minuscules A-Z seulement, MEME LONGUEUR que l'entree (review Bob 15/11). `toLowerCase()`
 * peut allonger la chaine (« İ » turc → 2 caracteres) : les positions trouvees dans la copie
 * en minuscules ne correspondaient plus a l'original, le decoupage tombait a cote et du
 * texte apres un <script> disparaissait (mesure : « İstanbul » avant un script).
 */
export function asciiLower(s: string): string {
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

/**
 * Retire commentaires et blocs script/style/noscript/template/svg/iframe, en UN passage
 * (indexOf, pas de regex qui revient en arriere). A faire AVANT le plafond d'entree :
 * sur la presse (franceinfo : 113 000 car. de CSS en tete) le plafond tombait au milieu
 * d'un <style>, le CSS fuyait dans le texte et le corps de l'article etait perdu.
 * Un bloc non ferme (page tronquee) : seule la balise ouvrante est retiree.
 */
export function stripNonContentBlocks(html: string): string {
  const lower = asciiLower(html);
  const parts: string[] = [];
  const unclosed = new Set<string>();
  let keepFrom = 0;
  let i = lower.indexOf('<');
  while (i !== -1) {
    let skipTo = -1;
    if (lower.startsWith('<!--', i)) {
      const end = lower.indexOf('-->', i + 4);
      skipTo = end === -1 ? html.length : end + 3;
    } else {
      for (const tag of NON_CONTENT_TAGS) {
        if (!lower.startsWith(`<${tag}`, i)) continue;
        const next = lower.charAt(i + 1 + tag.length);
        if (next !== '>' && next !== '/' && next !== ' ' && next !== '\n' && next !== '\t' && next !== '\r') continue;
        const close = unclosed.has(tag) ? -1 : lower.indexOf(`</${tag}`, i + 1 + tag.length);
        if (close === -1) {
          // Pas de fermeture plus loin : on ne retire que la balise ouvrante (comportement
          // historique) et on ne re-cherche plus ce tag (reste lineaire).
          unclosed.add(tag);
          const gt0 = lower.indexOf('>', i);
          skipTo = gt0 === -1 ? html.length : gt0 + 1;
        } else {
          const gt = lower.indexOf('>', close);
          skipTo = gt === -1 ? html.length : gt + 1;
        }
        break;
      }
    }
    if (skipTo === -1) {
      i = lower.indexOf('<', i + 1);
      continue;
    }
    parts.push(html.slice(keepFrom, i), ' ');
    keepFrom = skipTo;
    i = lower.indexOf('<', skipTo);
  }
  parts.push(html.slice(keepFrom));
  return parts.join('');
}

const MAX_TAG_CHARS = 100_000;

/**
 * Retire toutes les balises en UN passage. Remplace l'ancienne regex `<[^>]{0,2000}>` :
 * une balise a attribut de plus de 2000 car. (CNA : <meta data-js-options="{...}"> de
 * plusieurs Ko) n'etait pas retiree et sortait en texte. Le prochain `>` est memorise
 * (pas de re-balayage : lineaire meme avec 200 000 `<`). Une balise ouverte non fermee en
 * fin de page tronquee est supprimee jusqu'a la fin.
 */
export function stripTagsLinear(s: string): string {
  const parts: string[] = [];
  let keepFrom = 0;
  let nextGt = -2; // -2 = pas encore cherche, -1 = plus de `>`
  let i = s.indexOf('<');
  while (i !== -1) {
    const c = s.charCodeAt(i + 1);
    const tagLike = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 47 || c === 33 || c === 63;
    if (!tagLike) {
      i = s.indexOf('<', i + 1);
      continue;
    }
    if (nextGt !== -1 && nextGt < i) nextGt = s.indexOf('>', i);
    if (nextGt === -2) nextGt = s.indexOf('>', i);
    if (nextGt === -1) {
      parts.push(s.slice(keepFrom, i), ' ');
      return parts.join('');
    }
    if (nextGt - i > MAX_TAG_CHARS) {
      i = s.indexOf('<', i + 1);
      continue;
    }
    parts.push(s.slice(keepFrom, i), ' ');
    keepFrom = nextGt + 1;
    i = s.indexOf('<', keepFrom);
  }
  parts.push(s.slice(keepFrom));
  return parts.join('');
}

export function htmlToText(html: string): string {
  const stripped = stripNonContentBlocks(html);
  const clipped =
    stripped.length > HTML_TO_TEXT_MAX_INPUT
      ? stripped.slice(0, HTML_TO_TEXT_MAX_INPUT)
      : stripped;
  // Lot Q / Bob 15/11 : balises Unicode et autres invisibles retires (phrase cachee).
  return retirerInvisibles(
    decodeEntities(
      stripTagsLinear(
        clipped
          .replace(/<!--[\s\S]*?-->/g, ' ')
          .replace(/<(script|style|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
          .replace(/<(script|style|noscript|template|svg|iframe)\b[^>]*>/gi, ' ')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|nav|blockquote|pre|table)\s*>/gi, '\n'),
      ),
    )
      .replace(/\r\n?/g, '\n')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

// ---------------------------------------------------------------------------
// Presse : corps dans le JSON-LD, mur de connexion / abonnement, page anti-robot
// ---------------------------------------------------------------------------

export interface ArticleMeta {
  headline?: string;
  description?: string;
  body?: string;
}

const ARTICLE_BODY_MAX = 20_000;
const LD_BLOCK_MAX = 200_000;

function plain(s: string): string {
  return retirerInvisibles(
    decodeEntities(s.replace(/<[^>]{0,2000}>/g, ' ')).replace(/\s+/g, ' ').trim(),
  );
}

/**
 * Cherche un NewsArticle / Article dans les blocs `application/ld+json` et renvoie
 * titre, resume et corps. Beaucoup de pages rendues cote navigateur (franceinfo)
 * n'ont le corps que la. Donnee externe : jamais une consigne.
 */
export function extractArticleMeta(html: string): ArticleMeta | null {
  const lower = asciiLower(html);
  let i = lower.indexOf('<script');
  while (i !== -1) {
    const gt = lower.indexOf('>', i);
    if (gt === -1) break;
    const head = lower.slice(i, Math.min(gt, i + 600));
    const close = lower.indexOf('</script', gt);
    const end = close === -1 ? html.length : close;
    if (/type\s*=\s*["']?application\/ld\+json/.test(head) && end - gt < LD_BLOCK_MAX) {
      try {
        const found = pickArticle(JSON.parse(html.slice(gt + 1, end)), 0);
        if (found) return found;
      } catch {
        /* JSON-LD invalide : on ignore */
      }
    }
    i = lower.indexOf('<script', end);
  }
  return null;
}

function pickArticle(node: unknown, depth: number): ArticleMeta | null {
  if (depth > 3 || node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = pickArticle(n, depth + 1);
      if (f) return f;
    }
    return null;
  }
  const o = node as Record<string, unknown>;
  const type = JSON.stringify(o['@type'] ?? '');
  if (/Article|BlogPosting/.test(type)) {
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? plain(v) : undefined);
    const body = str(o.articleBody);
    const meta: ArticleMeta = {
      headline: str(o.headline),
      description: str(o.description),
      body: body ? body.slice(0, ARTICLE_BODY_MAX) : undefined,
    };
    if (meta.headline || meta.description || meta.body) return meta;
  }
  return o['@graph'] !== undefined ? pickArticle(o['@graph'], depth + 1) : null;
}

export type AccesLimite = 'challenge_anti_bot' | 'connexion_ou_abonnement';

const CHALLENGE_RE =
  /client challenge|required part of this site couldn.t load|checking your browser|just a moment|verify you are (a )?human|enable javascript and cookies|attention required|pardon our interruption|verification de securite|vérification de sécurité/i;

const WALL_MARKERS = [
  'connectez-vous ou créez un compte',
  'se connecter ou créer un compte',
  'réservé aux abonnés',
  'reserve aux abonnes',
  'article réservé',
  'abonnez-vous pour',
  'pour lire la suite',
  'déjà abonné',
  "s'abonner",
];

/**
 * HTTP 200 n'est pas « article lisible ». Signale (sans certitude) une page anti-robot
 * ou un mur de connexion / abonnement dont le corps n'est pas dans le HTML.
 */
export function detectAccesLimite(rawHtml: string, text: string, meta: ArticleMeta | null): AccesLimite | undefined {
  if (rawHtml.length < 15_000 && text.length < 1_500 && CHALLENGE_RE.test(text)) {
    return 'challenge_anti_bot';
  }
  if ((meta?.body?.length ?? 0) >= 500 || text.length >= 8_000) return undefined;
  const t = text.toLowerCase().replace(/’/g, "'");
  const hits = WALL_MARKERS.filter((m) => t.includes(m)).length;
  return hits >= 2 ? 'connexion_ou_abonnement' : undefined;
}

/**
 * Total de caracteres des lignes d'au moins `min` caracteres. Un vrai article en a des milliers
 * (mesure 15/11 : BBC 3 981, TechCrunch 7 005, Siecle Digital 12 857), un menu de site 0
 * (CNA 0, France 3 0, NYT 0). Sert a reperer « corps non atteint » meme quand le menu est long.
 */
export function paragraphChars(text: string, min = 120): number {
  let n = 0;
  for (const line of text.split('\n')) if (line.length >= min) n += line.length;
  return n;
}