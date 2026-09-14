import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { avecJournal } from '../utils/rag-journal.js';
import {
  dedupKey,
  isPathExcluded,
  loadZonePatterns,
  ragQuery,
  resolveExcludes,
  resolvePatternsFile,
  sourceWeight,
} from './rag-query-v1.js';

/**
 * rag-hybrid-v1 : recherche vectorielle + lexicale, pour les termes EXACTS.
 *
 * A utiliser pour : identifiants (nom de machine, code de certification), noms de fichier
 * ou de variable, chemins partiels, noms propres rares, et fautes de frappe sur ces termes
 * (lettres voisines inversees). Ce n'est PAS l'outil des questions dictees en langage
 * naturel : c'est le role de rag-search-v2 (glossaire).
 *
 * Canal vectoriel : rag-query-v1 tel quel (zones, poids doux, dedoublonnage).
 * Canal lexical   : recherche texte dans l'index Qdrant lui-meme (payload `text` et
 *   `sourceFile`), avec les MEMES exclusions de zone que le vectoriel. On cherche donc
 *   exactement le meme perimetre, sans lire le disque. Le filtre texte de Qdrant est une
 *   sous-chaine sensible a la casse : plusieurs casses sont essayees ; si un terme n'est
 *   trouve nulle part, ses inversions de lettres voisines sont essayees (faute de frappe).
 * Fusion : RRF (k = 60) des deux classements, puis poids doux de zone.
 *
 * Gouvernance Zone A : celle de v1 (includeZoneA n'ouvre jamais la zone sensible), et le
 * filtre est re-applique cote client sur chaque point recu.
 */

const DEFAULT_QDRANT = 'http://127.0.0.1:6334';
const DEFAULT_COLLECTION = 'vault-text';
const RRF_K = 60;
const MAX_TOKENS = 6;
const SCROLL_LIMIT = 256;
/** au-dela, un terme est considere comme courant (le scroll est tronque) */
const COMMON_DF = 60;
const TYPO_MIN_LEN = 4;
const TYPO_MAX_LEN = 16;
const VECTOR_POOL = 25;
const LEX_WEIGHT_WEAK = 0.5;

const STOPWORDS = new Set(
  (
    'a ai au aux avec ce ces cet cette c ca cela chez comme dans de des du elle en est et etre eu fait faire ' +
    'ici il ils je la le les leur lui ma mais me mes moi mon ne nos notre nous on ont ou par pas peu plus pour ' +
    'quand que qui quoi sa sans se ses son sont sur ta te tes toi ton tous tout tres tu un une vos votre vous y ' +
    'the and for with you are was has can how what where est-ce qu est note fichier dossier projet question ' +
    'trouve retrouve cherche ou quel quelle quels quelles comment pourquoi peux peut veux faut dire vois sais ' +
    'avait avais etait etais deja encore aussi alors donc bien juste merci'
  ).split(/\s+/),
);

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

export interface LexicalToken {
  token: string;
  /** 2 identifiant (chiffre, _, -, ., majuscule interne), 1,5 nom propre, 1 mot long, 0,5 autre */
  priority: number;
}

/** Termes distinctifs de la question, du plus « identifiant » au plus courant. */
export function extractTokens(query: string): LexicalToken[] {
  const raw = query.match(/[\p{L}\p{N}][\p{L}\p{N}_.\-/\\:]*[\p{L}\p{N}]|[\p{L}\p{N}]{3,}/gu) ?? [];
  const seen = new Set<string>();
  const out: LexicalToken[] = [];
  raw.forEach((t) => {
    const tok = t.replace(/[.:]+$/, '');
    const low = stripAccents(tok.toLowerCase());
    if (seen.has(low)) return;
    const hasDigit = /\p{N}/u.test(tok);
    if (tok.length < 3 && !hasDigit) return;
    if (STOPWORDS.has(low)) return;
    // elisions francaises (« l'installation » est deja coupe par la regex ; « est-ce » ou « ai-je »)
    const parts = low.split(/[-_.]/).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => p.length < 3 || STOPWORDS.has(p))) return;
    seen.add(low);
    const identifier = hasDigit || /[_.\-/\\]/.test(tok) || /\p{Ll}\p{Lu}/u.test(tok) || (tok.length >= 2 && tok === tok.toUpperCase() && /\p{L}/u.test(tok));
    const proper = !identifier && /^\p{Lu}/u.test(tok);
    const priority = identifier ? 2 : proper ? 1.5 : tok.length >= 7 ? 1 : 0.5;
    out.push({ token: tok, priority });
  });
  return out
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.priority - a.t.priority || a.i - b.i)
    .slice(0, MAX_TOKENS)
    .map((x) => x.t);
}

/** Casses essayees (le filtre texte de Qdrant est sensible a la casse). */
export function caseVariants(token: string): string[] {
  const lower = token.toLowerCase();
  const upper = token.toUpperCase();
  const title = token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
  return [...new Set([token, lower, upper, title])];
}

/** Inversions de deux lettres voisines (faute de frappe la plus courante), en plusieurs casses. */
export function transpositionVariants(token: string): string[] {
  const out = new Set<string>();
  if (token.length < TYPO_MIN_LEN || token.length > TYPO_MAX_LEN) return [];
  for (let i = 0; i < token.length - 1; i += 1) {
    if (token[i] === token[i + 1]) continue;
    const swapped = token.slice(0, i) + token[i + 1] + token[i] + token.slice(i + 2);
    for (const v of caseVariants(swapped)) out.add(v);
  }
  for (const v of caseVariants(token)) out.delete(v);
  return [...out];
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

interface LexPoint {
  sourceFile: string;
  source_filename: string;
  text: string;
}

async function scrollVariants(
  qdrant: string,
  collection: string,
  variants: string[],
  excludes: string[],
): Promise<LexPoint[]> {
  const should = variants.flatMap((v) => [
    { key: 'text', match: { text: v } },
    { key: 'sourceFile', match: { text: v } },
  ]);
  const res = (await postJson(
    `${qdrant}/collections/${encodeURIComponent(collection)}/points/scroll`,
    {
      filter: {
        must: [{ should }],
        ...(excludes.length ? { must_not: excludes.map((p) => ({ key: 'sourceFile', match: { text: p } })) } : {}),
      },
      limit: SCROLL_LIMIT,
      with_payload: ['sourceFile', 'source_filename', 'text'],
      with_vector: false,
    },
    30_000,
  )) as { result?: { points?: Array<{ payload?: Record<string, unknown> }> } };
  return (res.result?.points ?? []).map((p) => ({
    sourceFile: String(p.payload?.sourceFile ?? ''),
    source_filename: String(p.payload?.source_filename ?? ''),
    text: String(p.payload?.text ?? ''),
  }));
}

function excerptAround(text: string, needles: string[]): string {
  const low = text.toLowerCase();
  let at = -1;
  for (const n of needles) {
    const i = low.indexOf(n.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return text.length > 240 ? `${text.slice(0, 240)}...` : text;
  const start = Math.max(0, at - 80);
  const end = Math.min(text.length, start + 240);
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
}

export interface TokenReport {
  token: string;
  documents: number;
  typo: boolean;
  variantesTrouvees: string[];
  courant: boolean;
}

interface LexDoc {
  key: string;
  sourceFile: string;
  source_filename: string;
  score: number;
  tokens: Set<string>;
  typo: boolean;
  chemin: boolean;
  excerpt: string;
}

export interface HybridHit {
  score: number;
  sourceFile: string;
  source_filename: string;
  excerpt: string;
  trouvePar: Array<'vectoriel' | 'lexical'>;
  rangVectoriel?: number;
  rangLexical?: number;
  termes?: string[];
  fauteDeFrappe?: boolean;
  dansLeChemin?: boolean;
}

export interface RagHybridInput {
  query: string;
  limit?: number;
  project?: string;
  sourceContains?: string;
  includeZoneA?: boolean;
  includeContentieux?: boolean;
  patternsFile?: string;
  qdrantUrl?: string;
  ollamaUrl?: string;
}

export interface RagHybridResult {
  hits: HybridHit[];
  meta: Record<string, unknown> & {
    tool: 'rag-hybrid-v1';
    filterZoneA: boolean;
    filterContentieux: boolean;
    intimeAlwaysFiltered: true;
    zonePatternsVersion: string;
    count: number;
    error?: string;
  };
}

export async function ragHybrid(input: RagHybridInput): Promise<RagHybridResult> {
  const t0 = Date.now();
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 25);
  const includeZoneA = input.includeZoneA === true;
  const includeContentieux = input.includeContentieux === true;
  const collection = process.env.QDRANT_COLLECTION ?? DEFAULT_COLLECTION;
  const qdrant = (input.qdrantUrl ?? process.env.QDRANT_URL ?? DEFAULT_QDRANT).replace(/\/+$/, '');
  const patterns = loadZonePatterns(input.patternsFile ?? resolvePatternsFile());
  const excludes = resolveExcludes(patterns, includeZoneA, includeContentieux);

  const result: RagHybridResult = {
    hits: [],
    meta: {
      tool: 'rag-hybrid-v1',
      filterZoneA: !includeZoneA,
      filterContentieux: !includeContentieux,
      intimeAlwaysFiltered: true,
      zonePatternsVersion: patterns.version,
      excludePatterns: excludes.length,
      sourcePriorityApplied: Object.keys(patterns.sourcePriority).length > 0,
      collection,
      count: 0,
      canalLexical: "index Qdrant (texte exact, meme perimetre de zones que le vectoriel ; fichiers pas encore indexes invisibles)",
    },
  };
  const meta = result.meta;
  if (patterns.error) meta.error = patterns.error;
  if (!input.query?.trim()) {
    meta.error = 'query vide';
    return result;
  }

  const tokens = extractTokens(input.query);
  meta.termes = tokens.map((t) => t.token);

  // --- canal vectoriel (v1 inchange) et canal lexical, en parallele
  const tVec = Date.now();
  const vectorP = ragQuery({
    query: input.query,
    limit: VECTOR_POOL,
    project: input.project,
    sourceContains: input.sourceContains,
    includeZoneA,
    includeContentieux,
    patternsFile: input.patternsFile,
    qdrantUrl: input.qdrantUrl,
    ollamaUrl: input.ollamaUrl,
  }).then((r) => ({ r, ms: Date.now() - tVec }));

  const tLex = Date.now();
  const keep = (p: LexPoint) => {
    if (isPathExcluded(p.sourceFile, excludes)) return false; // jamais confiance au seul filtre serveur
    if (input.project && !p.sourceFile.toLowerCase().includes(input.project.toLowerCase())) return false;
    if (input.sourceContains && !p.sourceFile.toLowerCase().includes(input.sourceContains.toLowerCase())) return false;
    return true;
  };
  const reports: TokenReport[] = [];
  const docs = new Map<string, LexDoc>();
  let lexError: string | undefined;
  try {
    const exact = await Promise.all(
      tokens.map((t) => scrollVariants(qdrant, collection, caseVariants(t.token), excludes).then((pts) => pts.filter(keep))),
    );
    // faute de frappe : seulement pour un terme introuvable tel quel
    const typoRuns = await Promise.all(
      tokens.map((t, i) => {
        if (exact[i]!.length > 0 || t.priority < 1) return Promise.resolve([] as LexPoint[]);
        const vs = transpositionVariants(t.token);
        return vs.length ? scrollVariants(qdrant, collection, vs, excludes).then((pts) => pts.filter(keep)) : Promise.resolve([]);
      }),
    );
    tokens.forEach((t, i) => {
      const typo = exact[i]!.length === 0 && typoRuns[i]!.length > 0;
      const pts = typo ? typoRuns[i]! : exact[i]!;
      const variants = typo ? transpositionVariants(t.token) : caseVariants(t.token);
      const perDoc = new Map<string, LexPoint[]>();
      for (const p of pts) {
        const k = dedupKey(p.sourceFile, p.source_filename);
        perDoc.set(k, [...(perDoc.get(k) ?? []), p]);
      }
      const truncated = pts.length >= SCROLL_LIMIT;
      // Terme courant (plus de SCROLL_LIMIT passages) : l'echantillon renvoye par Qdrant est
      // arbitraire, il ne dit rien de pertinent. On l'ignore : le vectoriel s'en charge deja.
      // Sans cette regle, deux noms tres frequents du vault noyaient la bonne note d'une question naturelle.
      if (truncated || perDoc.size > COMMON_DF) {
        reports.push({ token: t.token, documents: perDoc.size, typo, variantesTrouvees: [], courant: true });
        return;
      }
      const df = perDoc.size;
      const found = new Set<string>();
      for (const [k, list] of perDoc) {
        const hitVariants = variants.filter((v) => list.some((p) => p.text.includes(v) || p.sourceFile.includes(v)));
        hitVariants.forEach((v) => found.add(v));
        const inPath = list.some((p) => variants.some((v) => p.sourceFile.includes(v)));
        const idf = Math.log(1 + 1000 / Math.max(df, 1));
        const gain = idf * (typo ? 0.7 : 1) * (inPath ? 1.5 : 1);
        const best = list.find((p) => variants.some((v) => p.text.includes(v))) ?? list[0]!;
        const cur = docs.get(k);
        if (!cur) {
          docs.set(k, {
            key: k, sourceFile: best.sourceFile, source_filename: best.source_filename, score: gain,
            tokens: new Set([t.token]), typo, chemin: inPath, excerpt: excerptAround(best.text, hitVariants.length ? hitVariants : variants),
          });
        } else {
          cur.score += gain;
          cur.tokens.add(t.token);
          cur.typo = cur.typo || typo;
          cur.chemin = cur.chemin || inPath;
        }
      }
      reports.push({ token: t.token, documents: perDoc.size, typo, variantesTrouvees: [...found].slice(0, 6), courant: false });
    });
  } catch (e) {
    lexError = `canal lexical indisponible (${e instanceof Error ? e.message : String(e)})`;
  }
  const msLex = Date.now() - tLex;
  const { r: vec, ms: msVec } = await vectorP;

  // --- fusion RRF
  // Le canal lexical ne compte plein pot que si la question porte un vrai identifiant (chiffre,
  // tiret, soulignement, point, majuscules) ou une faute de frappe rattrapee. Avec seulement des
  // noms propres (« Process Complet Claude Code »), il pese moitie : ces mots sont frequents et
  // le classement vectoriel de v1 reste la meilleure base.
  // Une requete tres courte (1 ou 2 termes, ex. un nom de service) est une recherche de mot-cle : plein pot.
  // Sinon, en mode faible, un document ne compte cote lexical que s'il porte au moins deux termes
  // distinctifs : un seul mot rare (souvent un mot ecrit sans accent) ne suffit pas a le propulser.
  const strong = tokens.length <= 2 || reports.some((r) => !r.courant && r.documents > 0 && (r.typo || tokens.find((t) => t.token === r.token)!.priority >= 2));
  const lexWeight = strong ? 1 : LEX_WEIGHT_WEAK;
  const minTokens = strong ? 1 : 2;
  const lexRanked = [...docs.values()]
    .filter((d) => d.tokens.size >= minTokens)
    .sort((a, b) => b.score - a.score || b.tokens.size - a.tokens.size);
  const fused = new Map<string, HybridHit & { rrf: number }>();
  vec.hits.forEach((h, i) => {
    const key = dedupKey(h.sourceFile, h.source_filename);
    fused.set(key, {
      rrf: 1 / (RRF_K + i + 1), score: 0, sourceFile: h.sourceFile, source_filename: h.source_filename,
      excerpt: h.excerpt, trouvePar: ['vectoriel'], rangVectoriel: i + 1,
    });
  });
  lexRanked.forEach((d, i) => {
    const cur = fused.get(d.key);
    const extra = { rangLexical: i + 1, termes: [...d.tokens], fauteDeFrappe: d.typo, dansLeChemin: d.chemin };
    // Le rang vectoriel vient deja de v1 (poids doux inclus) : le poids de zone ne s'applique qu'a
    // la contribution lexicale, sinon il serait compte deux fois et intervertirait l'ordre de v1.
    const lexContribution = (lexWeight * sourceWeight(d.sourceFile, patterns.sourcePriority)) / (RRF_K + i + 1);
    if (cur) {
      cur.rrf += lexContribution;
      cur.trouvePar.push('lexical');
      Object.assign(cur, extra);
      cur.excerpt = d.excerpt; // l'extrait lexical montre le terme cherche
    } else {
      fused.set(d.key, {
        rrf: lexContribution, score: 0, sourceFile: d.sourceFile, source_filename: d.source_filename,
        excerpt: d.excerpt, trouvePar: ['lexical'], ...extra,
      });
    }
  });
  const ordered = [...fused.values()]
    // a score egal : trouve par les deux canaux d'abord (le signal le plus sur)
    .sort((a, b) => b.rrf - a.rrf || b.trouvePar.length - a.trouvePar.length)
    .slice(0, limit);
  result.hits = ordered.map(({ rrf, ...h }) => ({ ...h, score: Math.round(rrf * 1e6) / 1e6 }));

  meta.count = result.hits.length;
  meta.termesLexicaux = reports;
  meta.documentsLexicaux = docs.size;
  meta.documentsVectoriels = vec.hits.length;
  meta.poidsLexical = lexWeight;
  meta.fusion = `RRF k=${RRF_K} : rang vectoriel de v1 (poids doux deja inclus) + rang lexical x${lexWeight} x poids doux de zone ; lexical x1 si identifiant, faute de frappe ou requete de 1-2 termes, sinon x${LEX_WEIGHT_WEAK} et au moins 2 termes distinctifs par document ; a egalite, trouve par les deux canaux d'abord`;
  if (tokens.length === 0 || (reports.length > 0 && reports.every((r) => r.courant))) {
    meta.conseil = "Aucun terme assez distinctif pour le canal lexical : resultats du vectoriel seul. Pour une question en langage naturel ou dictee, utiliser rag-search-v2.";
  } else if (docs.size === 0 && !lexError) {
    meta.conseil = "Aucun terme trouve tel quel ni avec une inversion de lettres : resultats vectoriels seulement. Verifier l'orthographe, ou le fichier n'est peut-etre pas encore indexe.";
  }
  const errors = [vec.meta.error, lexError].filter(Boolean);
  if (errors.length) meta.error = errors.join(' | ');
  meta.timingsMs = { vectoriel: msVec, lexical: msLex, total: Date.now() - t0 };
  return result;
}

export const tool: IrisTool = {
  id: 'rag-hybrid-v1',
  description:
    'Recherche dans le vault de Peter pour les termes EXACTS : identifiants (nom de machine, code de certification), ' +
    'noms de fichier ou de variable, chemins partiels, noms propres rares, avec tolerance aux lettres voisines inversees. ' +
    "Combine le vectoriel de rag-query-v1 et une recherche texte dans l'index, memes regles de Zone A (zone intime jamais ouverte). " +
    "Pour une question dictee ou en langage naturel, utiliser rag-search-v2.",
  category: 'memory',
  inputSchema: {
    query: z.string().min(1).describe("Terme exact, identifiant, nom de fichier, ou question courte qui en contient"),
    limit: z.number().int().min(1).max(25).optional().describe('Nombre de passages (defaut 5, max 25)'),
    project: z.string().optional().describe("Ne garder que les chemins contenant ce texte, ex. 'Virtualisation-HyperV'"),
    sourceContains: z.string().optional().describe("Ne garder que les chemins contenant ce texte, ex. 'from-microsoft-copilot'"),
    includeZoneA: z.boolean().optional().describe('Ouvre les conversations brutes Zone A-1 (defaut false). N ouvre jamais la zone intime A-2 ni la zone contentieux.'),
    includeContentieux: z.boolean().optional().describe("Ouvre la zone contentieux (dossier de litige), seulement si l'utilisateur demande explicitement ce dossier (defaut false). N ouvre jamais la zone intime A-2."),
  },
  // journal des recherches : opt-in par IRIS_RAG_JOURNAL_DIR, sans effet sinon
  execute: avecJournal('rag-hybrid-v1', async (input) => {
    try {
      const result = await ragHybrid({
        query: String(input.query ?? ''),
        limit: input.limit as number | undefined,
        project: input.project as string | undefined,
        sourceContains: input.sourceContains as string | undefined,
        includeZoneA: input.includeZoneA as boolean | undefined,
        includeContentieux: input.includeContentieux as boolean | undefined,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ hits: [], meta: { tool: 'rag-hybrid-v1', filterZoneA: true, filterContentieux: true, intimeAlwaysFiltered: true, count: 0, error: msg } }, null, 2),
        }],
      };
    }
  }),
};
