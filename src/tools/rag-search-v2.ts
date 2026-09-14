import * as z from 'zod/v4';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IrisTool } from './_types.js';
import { avecJournal } from '../utils/rag-journal.js';
import {
  dedupKey,
  isPathExcluded,
  loadZonePatterns,
  resolveExcludes,
  resolvePatternsFile,
  sourceWeight,
} from './rag-query-v1.js';

/**
 * rag-search-v2 : recherche du vault qui comprend le vocabulaire de l'utilisateur.
 *
 * Differences avec rag-query-v1 (qui reste inchange, rapide, pour les cas simples) :
 *   1. un glossaire PRIVE traduit les mots de l'utilisateur (dictee comprise) vers les
 *      termes du vault. Il n'est jamais dans ce depot : chemin par RAG_GLOSSARY_FILE,
 *      sinon fichier `glossaire-recherche.md` voisin de ZONE_A_PATTERNS_FILE ;
 *   2. plusieurs variantes de la question sont cherchees : question nettoyee,
 *      reecriture deterministe par le glossaire, reformulations d'un modele local
 *      (temperature 0, think false), recherche ciblee dans les notes que le glossaire
 *      designe ;
 *   3. fusion RRF + poids doux + dedoublonnage identiques a v1 ;
 *   4. si aucun extrait ne porte les termes de la question, l'outil le dit et demande
 *      un contexte au lieu de laisser croire qu'il a trouve.
 *
 * Gouvernance Zone A : exactement celle de v1 (memes motifs, meme fichier source,
 * A-2 jamais ouverte). Le score cosinus n'est jamais compare a un seuil absolu :
 * il n'est pas comparable d'une question a l'autre.
 */

const DEFAULT_QDRANT = 'http://127.0.0.1:6334';
const DEFAULT_OLLAMA = 'http://127.0.0.1:11434';
const DEFAULT_COLLECTION = 'vault-text';
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
const DEFAULT_REFORMULATE_MODEL = 'qwen3.5:9b';
const DEFAULT_REFORMULATE_TIMEOUT_MS = 6_000;
const GLOSSARY_SIBLING_NAME = 'glossaire-recherche.md';
const BOM = new RegExp('^' + String.fromCharCode(0xfeff));
const RRF_K = 60;
const MAX_REFORMULATIONS = 3;
const MAX_PINNED_PATHS = 4;
/** une note designee par le glossaire compte comme trouvee a ce rang par chaque variante */
const PINNED_RANK = Number(process.env.RAG_PINNED_RANK) || 8;
/** ... si sa similarite n'est pas trop loin du meilleur extrait de la meme question */
const PINNED_MARGIN = 0.15;

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

/** Minuscules, sans accents, apostrophes unifiees, espaces reduits. */
export function normalizeText(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(
  (
    "a au aux avec ce ces cet cette c d de des du elle en et est etait eu il ils j je l la le les leur lui " +
    "m ma mais me mes mon n ne ni nous on ou par pas pour qu que qui s sa se ses si son sur t ta te tes toi ton " +
    'tu un une vos votre vous y ca cela ceci ete etre avoir fait faire dit dire peux peut pouvoir veux vais va ' +
    'suis sont ont avait avais aurait alors donc aussi tres plus moins bien tout tous toute toutes quand comment ' +
    "pourquoi quoi quel quelle quels quelles ou combien est-ce c'est c'etait qu'est-ce dans chez entre vers apres " +
    'avant deja encore toujours jamais rien chose choses truc trucs question fichier fichiers note notes fiche ' +
    'projet projets dossier raison parle parler parlait retrouve retrouver souviens souvenir rappelle deja ' +
    'explicitement merci svp stp oui non ok okay hein genre voila voili voilou bref euh enfin ' +
    // adverbes, adjectifs et verbes generiques : ils ne disent pas de quoi parle la question
    'trop peu beaucoup petit petite petits petites grand grande gros grosse juste vraiment besoin faut ' +
    'gere gerer sert servir marche marcher fonctionne fonctionner utilise utiliser mettre mis met'
  ).split(/\s+/),
);

/** Racine grossiere pour le francais : suffixe de pluriel retire, prefixe de 5 lettres au-dela de 6. */
export function stem(token: string): string {
  let t = normalizeText(token).replace(/[^a-z0-9-]/g, '');
  if (t.length > 4) t = t.replace(/(s|x)$/, '');
  return t.length >= 6 ? t.slice(0, 5) : t;
}

export function significantStems(text: string, withParts = false): Set<string> {
  const out = new Set<string>();
  const add = (tok: string) => {
    if (!tok || STOPWORDS.has(tok)) return;
    if (tok.length < 4 && !/\d/.test(tok)) return;
    out.add(stem(tok));
  };
  for (const raw of normalizeText(text).split(/[^a-z0-9-]+/)) {
    const tok = raw.replace(/^-+|-+$/g, '');
    add(tok);
    // dans un extrait ou un chemin, « Avis-Agentes-sur-Peter » porte aussi « agentes » et « peter »
    if (withParts && tok.includes('-')) tok.split('-').forEach(add);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Glossaire (format tableau Markdown « Tu dis | Terme | Ou chercher | Preuve | Statut »)
// ---------------------------------------------------------------------------

export interface GlossaryEntry {
  forms: string[];
  term: string;
  where: string[];
  status: string;
  /** true si la ligne designe au moins une note du vault (colonne « Ou chercher »). */
  pointsToNotes: boolean;
  /** true pour la section « formulations de demande » */
  intent: boolean;
}

export interface Glossary {
  version: string;
  source: 'env' | 'voisin-zone-patterns' | 'absent';
  entries: GlossaryEntry[];
  traps: string[];
  tics: string[];
  error?: string;
}

function cleanCell(cell: string): string {
  return cell.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

function splitForms(cell: string): string[] {
  return cleanCell(cell)
    .split('·')
    .map((f) => f.replace(/\([^)]*\)/g, '').trim())
    .filter((f) => f.length >= 2);
}

function splitRow(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

export function parseGlossary(md: string): Omit<Glossary, 'source'> {
  const version = /^version:\s*(\S+)/m.exec(md)?.[1] ?? 'unknown';
  const entries: GlossaryEntry[] = [];
  const traps: string[] = [];
  const tics: string[] = [];
  let mode: 'none' | 'entries' | 'intents' | 'traps' | 'tics' = 'none';
  let section = '';
  for (const line of md.split(/\r?\n/)) {
    if (/^#{1,3}\s/.test(line)) {
      section = normalizeText(line);
      mode = /tics/.test(section) ? 'tics' : 'none';
      continue;
    }
    if (mode === 'tics') {
      for (const m of line.matchAll(/`([^`]+)`/g)) {
        const t = m[1]!.trim();
        // « ;o » ou « :) » sont des smileys, traites a part : un tic a au moins deux lettres
        if ((t.match(/\p{L}/gu) ?? []).length >= 2) tics.push(t);
      }
      continue;
    }
    if (!line.trim().startsWith('|')) {
      if (mode !== 'none' && line.trim() === '') mode = 'none';
      continue;
    }
    const cells = splitRow(line);
    const head = normalizeText(cells[0] ?? '');
    if (/^-+$/.test(head.replace(/[:\s]/g, ''))) continue;
    if (head === 'tu dis') {
      mode = /formulations de demande|intentions/.test(section) ? 'intents' : 'entries';
      continue;
    }
    if (head === 'forme') {
      mode = 'traps';
      continue;
    }
    if (head === 'mot' || head === 'colonne' || head === 'version') {
      mode = 'none';
      continue;
    }
    if (mode === 'traps') {
      traps.push(...splitForms(cells[0] ?? '').map((f) => f.split('/').map((x) => x.trim())).flat());
      continue;
    }
    if ((mode === 'entries' || mode === 'intents') && cells.length >= 3) {
      const forms = splitForms(cells[0] ?? '');
      const term = cleanCell(cells[1] ?? '').replace(/[()]/g, '');
      const where = [...(cells[2] ?? '').matchAll(/`([^`]+\.md)`/g)].map((m) => m[1]!.trim());
      if (forms.length && term) {
        entries.push({
          forms,
          term,
          where,
          status: cleanCell(cells[4] ?? ''),
          pointsToNotes: where.length > 0,
          intent: mode === 'intents',
        });
      }
    }
  }
  return { version, entries, traps: [...new Set(traps)], tics: [...new Set(tics)] };
}

export function resolveGlossaryFile(): { path: string | null; source: Glossary['source'] } {
  const fromEnv = process.env.RAG_GLOSSARY_FILE?.trim();
  if (fromEnv) return { path: fromEnv, source: 'env' };
  const patterns = resolvePatternsFile();
  if (patterns) {
    const sibling = join(dirname(patterns), GLOSSARY_SIBLING_NAME);
    if (existsSync(sibling)) return { path: sibling, source: 'voisin-zone-patterns' };
  }
  return { path: null, source: 'absent' };
}

export function loadGlossary(file?: string | null): Glossary {
  const resolved = file ? { path: file, source: 'env' as const } : resolveGlossaryFile();
  if (!resolved.path) {
    return {
      version: 'absent', source: 'absent', entries: [], traps: [], tics: [],
      error: 'glossaire absent (RAG_GLOSSARY_FILE non defini, pas de glossaire voisin de ZONE_A_PATTERNS_FILE)',
    };
  }
  try {
    const md = readFileSync(resolved.path, 'utf8').replace(BOM, '');
    return { ...parseGlossary(md), source: resolved.source };
  } catch (e) {
    return {
      version: 'illisible', source: resolved.source, entries: [], traps: [], tics: [],
      error: `glossaire illisible (${e instanceof Error ? e.message : String(e)})`,
    };
  }
}

export interface GlossaryMatch {
  form: string;
  entry: GlossaryEntry;
  /** true si la forme peut reecrire la question sans avis du modele */
  deterministic: boolean;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Formes du glossaire presentes dans la question (sans accents, sur frontieres de mots).
 * Une forme courte (moins de 4 lettres) ne compte que si elle est ecrite en MAJUSCULES
 * dans la question (FT, GF, MSI) : « vol » ou « coin » seuls sont trop ambigus.
 * Les formes listees en piege, ou dont la ligne est « a valider », sont transmises au
 * modele comme indice mais ne reecrivent jamais la question.
 */
export function matchGlossary(query: string, glossary: Glossary): GlossaryMatch[] {
  // apostrophe = espace : « d'installation » et « d installation » (dictee) se valent
  const nq = ` ${normalizeText(query).replace(/[^a-z0-9-]+/g, ' ')} `;
  const trapSet = new Set(glossary.traps.map((t) => normalizeText(t)));
  const out: GlossaryMatch[] = [];
  const seenEntries = new Set<GlossaryEntry>();
  const allForms = glossary.entries
    .flatMap((entry) => entry.forms.map((form) => ({ form, entry })))
    .sort((a, b) => b.form.length - a.form.length);
  for (const { form, entry } of allForms) {
    if (seenEntries.has(entry)) continue;
    const nf = normalizeText(form).replace(/[^a-z0-9-]+/g, ' ').trim();
    if (!nf) continue;
    if (!new RegExp(`[ ]${escapeRe(nf)}[ ]`).test(nq)) continue;
    const compactLen = nf.replace(/[^a-z0-9]/g, '').length;
    if (compactLen < 4) {
      const upper = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(form.trim())}([^A-Za-z0-9]|$)`);
      if (!(form.trim() === form.trim().toUpperCase() && upper.test(query))) continue;
    }
    const ambiguous = /a valider/.test(normalizeText(entry.status)) || trapSet.has(nf);
    seenEntries.add(entry);
    out.push({ form, entry, deterministic: !ambiguous });
  }
  return out;
}

/** Retire les tics de langage et les smileys (inutiles pour la recherche). */
export function cleanQuery(query: string, tics: string[]): string {
  let q = ` ${query} `;
  for (const tic of [...tics].sort((a, b) => b.length - a.length)) {
    if (!/[a-z]/i.test(tic)) continue;
    q = q.replace(new RegExp(`(^|[^\\p{L}])${escapeRe(tic)}(?=[^\\p{L}]|$)`, 'giu'), '$1 ');
  }
  q = q.replace(/(?:^|\s)(?:[;:]-?[)(oODpPlL]|\^\^|xD|XD|♥|<3|\*bises?\*)(?=\s|$)/g, ' ');
  const cleaned = q.replace(/\s+/g, ' ').trim();
  return cleaned.length >= 3 ? cleaned : query.trim();
}

// ---------------------------------------------------------------------------
// Appels HTTP
// ---------------------------------------------------------------------------

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

async function embedAll(ollama: string, model: string, texts: string[]): Promise<number[][]> {
  try {
    const res = (await postJson(`${ollama}/api/embed`, { model, input: texts }, 30_000)) as {
      embeddings?: number[][];
    };
    if (Array.isArray(res.embeddings) && res.embeddings.length === texts.length) return res.embeddings;
    throw new Error('reponse /api/embed incomplete');
  } catch {
    // Ollama ancien : un appel par texte sur l'API historique.
    const out: number[][] = [];
    for (const prompt of texts) {
      const r = (await postJson(`${ollama}/api/embeddings`, { model, prompt }, 30_000)) as { embedding?: number[] };
      if (!r.embedding?.length) throw new Error('reponse sans embedding');
      out.push(r.embedding);
    }
    return out;
  }
}

export function buildReformulationPrompt(query: string, matches: GlossaryMatch[], glossary: Glossary): string {
  const lines = matches.map((m) => {
    const where = m.entry.where.length ? ` (notes : ${m.entry.where.slice(0, 2).join(', ')})` : '';
    const caution = m.deterministic ? '' : ' [ambigu : decider au contexte]';
    return `- « ${m.form} » = ${m.entry.term}${where}${caution}`;
  });
  if (lines.length === 0) {
    const terms = [...new Set(glossary.entries.filter((e) => e.pointsToNotes).map((e) => e.term))].slice(0, 60);
    lines.push(`- aucun mot de la question n'est dans le glossaire ; termes connus du vault : ${terms.join(' ; ')}`);
  }
  const traps = glossary.traps.filter((t) => normalizeText(query).includes(normalizeText(t)));
  if (traps.length) lines.push(`- pieges a ne pas traduire : ${traps.join(', ')}`);
  return (
    "Tu prepares des requetes pour le moteur de recherche d'un vault de notes personnel. " +
    "L'utilisateur dicte a la voix : fautes et mots mal reconnus sont normaux.\n\n" +
    `Correspondances connues :\n${lines.join('\n')}\n\n` +
    `Ecris ${MAX_REFORMULATIONS} requetes de recherche courtes (5 a 15 mots), en francais, qui gardent ` +
    "l'intention de la question et utilisent les termes du vault quand ils s'appliquent. " +
    "N'invente aucun fait, aucun nom absent des correspondances ou de la question.\n" +
    'Reponds UNIQUEMENT en JSON : {"requetes":["...","...","..."]}\n\n' +
    `Question : ${query}\n`
  );
}

export function parseReformulations(raw: string, query: string): string[] {
  let list: unknown = [];
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    list = j.requetes ?? j.queries ?? j.reformulations ?? [];
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const nq = normalizeText(query);
  const seen = new Set<string>([nq]);
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const s = item.replace(/\s+/g, ' ').trim();
    const n = normalizeText(s);
    if (s.length < 3 || s.length > 200 || seen.has(n)) continue;
    seen.add(n);
    out.push(s);
    if (out.length >= MAX_REFORMULATIONS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recherche, fusion, confiance
// ---------------------------------------------------------------------------

interface Candidate {
  key: string;
  score: number;
  sourceFile: string;
  source_filename: string;
  text: string;
  /** recherche ciblee : variante dont le vecteur a servi (pour la marge) */
  refLabel?: string;
}

interface Variant {
  label: string;
  text: string;
  weight: number;
  /** filtre Qdrant supplementaire (recherche ciblee dans une note pointee) */
  pinnedPath?: string;
}

async function searchVariant(
  qdrant: string,
  collection: string,
  vector: number[],
  variant: Variant,
  excludes: string[],
  limit: number,
  project?: string,
  sourceContains?: string,
): Promise<Candidate[]> {
  const filter: Record<string, unknown> = {
    must_not: excludes.map((pat) => ({ key: 'sourceFile', match: { text: pat } })),
  };
  if (variant.pinnedPath) {
    // les chemins du glossaire s'ecrivent avec « / », l'index stocke des chemins Windows
    filter.must = [{ key: 'sourceFile', match: { text: variant.pinnedPath.replace(/\//g, '\\') } }];
  }
  const res = (await postJson(
    `${qdrant}/collections/${encodeURIComponent(collection)}/points/search`,
    { vector, limit: variant.pinnedPath ? 6 : Math.max(limit * 8, 40), with_payload: true, filter },
    60_000,
  )) as { result?: Array<{ score?: number; payload?: Record<string, unknown> }> };
  const byKey = new Map<string, Candidate>();
  for (const h of Array.isArray(res.result) ? res.result : []) {
    const sourceFile = String(h.payload?.sourceFile ?? '');
    if (isPathExcluded(sourceFile, excludes)) continue;
    if (project && !sourceFile.toLowerCase().includes(project.toLowerCase())) continue;
    if (sourceContains && !sourceFile.toLowerCase().includes(sourceContains.toLowerCase())) continue;
    const source_filename = String(h.payload?.source_filename ?? '');
    const key = dedupKey(sourceFile, source_filename);
    const score = Number(h.score ?? 0);
    const prev = byKey.get(key);
    if (!prev || score > prev.score) {
      byKey.set(key, { key, score, sourceFile, source_filename, text: String(h.payload?.text ?? '') });
    }
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score);
}

export interface SearchHit {
  score: number;
  score_raw: number;
  sourceFile: string;
  source_filename: string;
  excerpt: string;
  trouvePar: string[];
}

interface Fused extends SearchHit {
  key: string;
  evidence: string;
}

export function fuseRuns(
  runs: Array<{ variant: Variant; hits: Candidate[] }>,
  priority: Record<string, number>,
  limit: number,
): Fused[] {
  const acc = new Map<string, Fused>();
  const searchRuns = runs.filter((r) => !r.variant.pinnedPath);
  const pinnedFactor = searchRuns.reduce((sum, r) => sum + r.variant.weight / (RRF_K + PINNED_RANK), 0);
  const bestRawOf = (label?: string) => searchRuns.find((r) => r.variant.label === (label ?? 'question'))?.hits[0]?.score ?? 0;
  for (const { variant, hits } of runs) {
    hits.forEach((h, idx) => {
      if (variant.pinnedPath && h.score < bestRawOf(h.refLabel) - PINNED_MARGIN) return;
      const contribution = variant.pinnedPath
        ? variant.weight * pinnedFactor
        : variant.weight / (RRF_K + idx + 1);
      const cur = acc.get(h.key);
      if (!cur) {
        acc.set(h.key, {
          key: h.key, score: contribution, score_raw: h.score, sourceFile: h.sourceFile,
          source_filename: h.source_filename,
          excerpt: h.text.length > 240 ? `${h.text.slice(0, 240)}...` : h.text,
          trouvePar: [variant.label], evidence: `${h.sourceFile}\n${h.text}`,
        });
      } else {
        cur.score += contribution;
        if (!cur.trouvePar.includes(variant.label)) cur.trouvePar.push(variant.label);
        cur.evidence += `\n${h.text}`;
        if (h.score > cur.score_raw) {
          cur.score_raw = h.score;
          cur.excerpt = h.text.length > 240 ? `${h.text.slice(0, 240)}...` : h.text;
        }
      }
    });
  }
  const ranked = [...acc.values()].map((f) => ({ ...f, score: f.score * sourceWeight(f.sourceFile, priority) }));
  ranked.sort((a, b) => b.score - a.score);
  const seenText = new Set<string>();
  const out: Fused[] = [];
  for (const f of ranked) {
    const textKey = f.excerpt.trim();
    if (textKey.length >= 40 && seenText.has(textKey)) continue;
    if (textKey.length >= 40) seenText.add(textKey);
    out.push({ ...f, score: Math.round(f.score * 1e6) / 1e6, score_raw: Math.round(f.score_raw * 1e4) / 1e4 });
    if (out.length >= limit) break;
  }
  return out;
}

export interface Confidence {
  level: 'bonne' | 'faible';
  reason: string;
  termesQuestion: number;
  termesTrouves: number;
}

/**
 * Un extrait « repond » s'il porte les termes de la question : un terme canonique du
 * glossaire, ou au moins la moitie des termes significatifs. Mesure relative a la
 * question, jamais un seuil de score.
 */
export function assessConfidence(
  query: string,
  matches: GlossaryMatch[],
  top: Array<{ evidence: string; trouvePar: string[] }>,
  pool: string[] = [],
): Confidence {
  const q = significantStems(query);
  const sure = matches.filter((x) => x.deterministic);
  const canon = new Set<string>();
  for (const m of sure) for (const st of significantStems(m.entry.term, true)) canon.add(st);
  const formStems = new Set<string>();
  for (const m of sure) for (const st of significantStems(m.form, true)) formStems.add(st);
  // termes de la question qui ne viennent pas d'un mot du glossaire
  const rest = new Set([...q].filter((st) => !formStems.has(st)));
  if (q.size === 0 && canon.size === 0) {
    return { level: 'faible', reason: 'question sans terme exploitable', termesQuestion: 0, termesTrouves: 0 };
  }

  // Rarete de chaque terme dans tous les extraits recuperes : le plus rare est celui qui
  // distingue la question (« Tokyo », « Patagonie ») ; s'il n'est nulle part, aucun extrait
  // ne parle vraiment du sujet.
  const poolStems = pool.map((t) => significantStems(t, true));
  const dfOf = (st: string) => poolStems.filter((ps) => ps.has(st)).length;
  const rarestOf = (set: Set<string>) => {
    if (set.size === 0) return new Set<string>();
    const df = new Map([...set].map((st) => [st, dfOf(st)] as const));
    const min = Math.min(...df.values());
    return new Set([...set].filter((st) => df.get(st) === min));
  };
  const rarestQ = rarestOf(q);
  const rarestRest = rarestOf(rest);

  let best = 0;
  let bestCoversRarest = false;
  for (const hit of top.slice(0, 3)) {
    const ev = significantStems(hit.evidence, true);
    const searchLabels = hit.trouvePar.filter((l) => !l.startsWith('note pointee'));
    const foundBySearch = hit.trouvePar.includes('question') || searchLabels.length >= 2;

    // Preuve par le glossaire : l'extrait porte le terme canonique ET
    //  - soit la question n'a pas d'autre terme (« jeda parcours data ») et la recherche l'a trouve,
    //  - soit l'extrait porte aussi le plus rare, ou la moitie, des autres termes de la question
    //    (ex. une forme courte du glossaire ne valide pas une note sans les autres termes).
    if ([...canon].some((c) => ev.has(c))) {
      const restFound = [...rest].filter((st) => ev.has(st)).length;
      const restOk = rest.size > 0 && ([...rarestRest].some((st) => ev.has(st)) || restFound / rest.size >= 0.5);
      if ((rest.size <= 1 && foundBySearch) || restOk) {
        return { level: 'bonne', reason: 'un terme du glossaire et les autres termes de la question sont dans un extrait', termesQuestion: q.size, termesTrouves: q.size - rest.size + restFound };
      }
    }

    let found = 0;
    for (const st of q) if (ev.has(st)) found += 1;
    // si un mot du glossaire a joue, le terme distinctif se cherche parmi les AUTRES mots
    const coversRarest = [...(sure.length && rest.size ? rarestRest : rarestQ)].some((st) => ev.has(st));
    if (found > best || (found === best && coversRarest)) {
      best = found;
      bestCoversRarest = coversRarest;
    }
  }
  if (q.size > 0 && best / q.size >= 0.5 && (bestCoversRarest || pool.length === 0)) {
    return { level: 'bonne', reason: 'la moitie des termes de la question, dont le plus rare, sont dans un extrait', termesQuestion: q.size, termesTrouves: best };
  }
  if (q.size > 0 && best / q.size >= 0.5) {
    return { level: 'faible', reason: 'des termes courants sont trouves, mais pas le terme le plus distinctif de la question', termesQuestion: q.size, termesTrouves: best };
  }
  return { level: 'faible', reason: 'aucun extrait ne porte les termes de la question', termesQuestion: q.size, termesTrouves: best };
}

// ---------------------------------------------------------------------------
// Point d'entree
// ---------------------------------------------------------------------------

export interface RagSearchInput {
  query: string;
  limit?: number;
  project?: string;
  sourceContains?: string;
  includeZoneA?: boolean;
  includeContentieux?: boolean;
  reformulate?: boolean;
  patternsFile?: string;
  glossaryFile?: string;
  qdrantUrl?: string;
  ollamaUrl?: string;
}

export interface RagSearchResult {
  hits: SearchHit[];
  meta: Record<string, unknown> & {
    tool: 'rag-search-v2';
    filterZoneA: boolean;
    filterContentieux: boolean;
    intimeAlwaysFiltered: true;
    zonePatternsVersion: string;
    count: number;
    reformulations: string[];
    reformulationCount: number;
    reformulationNote: string;
    fallback: { used: boolean; reason?: string };
    needsClarification: boolean;
    error?: string;
  };
}

export async function ragSearch(input: RagSearchInput): Promise<RagSearchResult> {
  const t0 = Date.now();
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 25);
  const includeZoneA = input.includeZoneA === true;
  const includeContentieux = input.includeContentieux === true;
  const collection = process.env.QDRANT_COLLECTION ?? DEFAULT_COLLECTION;
  const qdrant = (input.qdrantUrl ?? process.env.QDRANT_URL ?? DEFAULT_QDRANT).replace(/\/+$/, '');
  const ollama = (input.ollamaUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA).replace(/\/+$/, '');
  const embedModel = process.env.RAG_EMBED_MODEL ?? DEFAULT_EMBED_MODEL;
  const genModel = process.env.RAG_REFORMULATE_MODEL ?? DEFAULT_REFORMULATE_MODEL;
  const genTimeout = Number(process.env.RAG_REFORMULATE_TIMEOUT_MS) || DEFAULT_REFORMULATE_TIMEOUT_MS;

  const patterns = loadZonePatterns(input.patternsFile ?? resolvePatternsFile());
  const excludes = resolveExcludes(patterns, includeZoneA, includeContentieux);
  const glossary = loadGlossary(input.glossaryFile ?? null);

  const result: RagSearchResult = {
    hits: [],
    meta: {
      tool: 'rag-search-v2',
      filterZoneA: !includeZoneA,
      filterContentieux: !includeContentieux,
      intimeAlwaysFiltered: true,
      zonePatternsVersion: patterns.version,
      excludePatterns: excludes.length,
      sourcePriorityApplied: Object.keys(patterns.sourcePriority).length > 0,
      dedup: 'conversations par UUID, notes par chemin, texte identique fusionne',
      collection,
      count: 0,
      glossary: {
        loaded: glossary.entries.length > 0,
        version: glossary.version,
        source: glossary.source,
        entries: glossary.entries.length,
        ...(glossary.error ? { error: glossary.error } : {}),
      },
      reformulations: [],
      reformulationCount: 0,
      reformulationNote: '',
      fallback: { used: false },
      needsClarification: false,
    },
  };
  const meta = result.meta;
  if (patterns.error) meta.error = patterns.error;
  if (!input.query?.trim()) {
    meta.error = 'query vide';
    meta.reformulationNote = '0 reformulation : question vide.';
    return result;
  }

  // 1) variantes deterministes
  const cleaned = cleanQuery(input.query, glossary.tics);
  const allMatches = matchGlossary(cleaned, glossary);
  // Les formulations de demande sans note (« on avait parle », « lecture seule ») disent
  // ce que veut l'utilisateur, pas quoi chercher : elles restent en meta, hors requete.
  const matches = allMatches.filter((m) => m.entry.pointsToNotes);
  meta.questionNettoyee = cleaned;
  meta.glossaire = matches.map((m) => ({
    forme: m.form, terme: m.entry.term, ouChercher: m.entry.where, sur: m.deterministic,
  }));
  meta.intentions = allMatches.filter((m) => !m.entry.pointsToNotes).map((m) => ({ forme: m.form, sens: m.entry.term }));
  const variants: Variant[] = [{ label: 'question', text: cleaned, weight: 1 }];
  const sure = matches.filter((m) => m.deterministic);
  if (sure.length) {
    const terms = [...new Set(sure.map((m) => m.entry.term))].join(' ; ');
    variants.push({ label: 'glossaire', text: `${cleaned} (${terms})`, weight: 1 });
  }
  const pinned = [...new Set(sure.flatMap((m) => m.entry.where))]
    .filter((p) => !/^Vault-Obsidian\//i.test(p)) // hors vault : pas dans l'index
    .slice(0, MAX_PINNED_PATHS);

  // 2) reformulations du modele local (en parallele de rien d'autre : elles conditionnent les variantes)
  const tGen = Date.now();
  if (input.reformulate === false) {
    meta.reformulationNote = '0 reformulation : desactivees par la requete (reformulate=false).';
  } else if (!glossary.entries.length) {
    meta.reformulationNote = `0 reformulation : ${glossary.error ?? 'glossaire vide'}. Recherche sans traduction du vocabulaire.`;
  } else {
    try {
      const gen = (await postJson(
        `${ollama}/api/generate`,
        {
          model: genModel,
          prompt: buildReformulationPrompt(cleaned, matches, glossary),
          stream: false,
          think: false,
          format: 'json',
          keep_alive: '30m',
          options: { temperature: 0, num_predict: 300 },
        },
        genTimeout,
      )) as { response?: string };
      const refs = parseReformulations(String(gen.response ?? ''), cleaned);
      meta.reformulations = refs;
      meta.reformulationCount = refs.length;
      refs.forEach((r, i) => variants.push({ label: `reformulation ${i + 1}`, text: r, weight: 0.8 }));
      meta.reformulationNote = refs.length
        ? `${refs.length} reformulation(s) par ${genModel}.`
        : `0 reformulation : ${genModel} a repondu sans requete exploitable (reponse vide ou JSON invalide). Recherche faite sans reformulation.`;
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      const reason = aborted
        ? `reformulation au-dela de ${genTimeout} ms (modele ${genModel} froid ou GPU occupe)`
        : `reformulation impossible (${e instanceof Error ? e.message : String(e)})`;
      meta.fallback = { used: true, reason };
      meta.reformulationNote = `0 reformulation : ${reason}. Repli sur la question et le glossaire.`;
    }
  }
  const msGen = Date.now() - tGen;

  // 3) embeddings (un seul appel) puis recherches en parallele
  const tSearch = Date.now();
  let vectors: number[][];
  try {
    vectors = await embedAll(ollama, embedModel, variants.map((v) => v.text));
  } catch (e) {
    meta.error = `Ollama injoignable ou modele absent (${e instanceof Error ? e.message : String(e)})`;
    return result;
  }
  const jobs: Array<Promise<{ variant: Variant; hits: Candidate[] }>> = variants.map((variant, i) =>
    searchVariant(qdrant, collection, vectors[i]!, variant, excludes, limit, input.project, input.sourceContains)
      .then((hits) => ({ variant, hits })),
  );
  // La note designee est cherchee avec la question ET la variante glossaire (une dictee est
  // loin des mots de la note) ; on garde son meilleur extrait et l'ecart a la meilleure
  // reponse du meme vecteur.
  const glossIdx = variants.findIndex((v) => v.label === 'glossaire');
  const pinVectors = glossIdx > 0 ? [0, glossIdx] : [0];
  for (const path of pinned) {
    const variant: Variant = { label: 'note pointee par le glossaire', text: cleaned, weight: 1, pinnedPath: path };
    jobs.push(
      Promise.all(pinVectors.map((vi) =>
        searchVariant(qdrant, collection, vectors[vi]!, variant, excludes, limit, input.project, input.sourceContains)
          .then((hits) => hits.slice(0, 1).map((h) => ({ ...h, refLabel: variants[vi]!.label }))),
      )).then((lists) => {
        const best = lists.flat().sort((a, b) => b.score - a.score)[0];
        return { variant, hits: best ? [best] : [] };
      }),
    );
  }
  let runs: Array<{ variant: Variant; hits: Candidate[] }>;
  try {
    runs = await Promise.all(jobs);
  } catch (e) {
    meta.error = `Qdrant injoignable (${e instanceof Error ? e.message : String(e)})`;
    return result;
  }
  const msSearch = Date.now() - tSearch;

  // 4) fusion
  const fused = fuseRuns(runs, patterns.sourcePriority, limit);
  result.hits = fused.map(({ key: _k, evidence: _e, ...hit }) => hit);
  meta.count = result.hits.length;
  meta.variantes = variants.map((v) => ({ label: v.label, texte: v.text }));
  meta.notesPointees = pinned;
  meta.fusion = `RRF k=${RRF_K} (question et glossaire x1, reformulations x0,8 ; note pointee par le glossaire = rang ${PINNED_RANK} dans chaque variante si sa similarite est a moins de ${PINNED_MARGIN} du meilleur extrait) puis poids doux de zone`;

  // 5) confiance et clarification
  const pool = runs.flatMap((r) => r.hits.map((h) => `${h.sourceFile}
${h.text}`));
  const conf = assessConfidence(cleaned, matches, fused, pool);
  meta.confiance = conf.level;
  meta.confianceRaison = conf.reason;
  if (conf.level === 'faible') {
    meta.needsClarification = true;
    const pistes = fused.slice(0, 3).map((h) => h.sourceFile);
    meta.clarification = {
      message:
        "Je n'ai pas trouve d'extrait qui reponde vraiment a la question. Je prefere ne rien inventer. " +
        'Tu peux me donner un contexte : le projet concerne, a peu pres quand, ou une autre formulation ?' +
        (includeZoneA ? '' : " On en a peut-etre deja parle dans une conversation : je peux relancer en ouvrant les conversations brutes (includeZoneA)."),
      questions: [
        'Quel projet ou quel sujet ?',
        'Vers quelle periode ?',
        includeZoneA ? 'Une autre formulation ou un mot-cle exact ?' : 'On en a deja parle dans une conversation ? (relancer avec includeZoneA=true)',
      ],
      pistesAVerifier: pistes,
    };
  }
  meta.timingsMs = { reformulation: msGen, recherche: msSearch, total: Date.now() - t0 };
  return result;
}

export const tool: IrisTool = {
  id: 'rag-search-v2',
  description:
    'Recherche dans le vault de Peter en comprenant son vocabulaire (glossaire prive, dictee comprise) : ' +
    'plusieurs formulations de la question sont cherchees puis fusionnees. Si aucun extrait ne porte les termes ' +
    "de la question, needsClarification=true et un message propose de preciser le contexte : ne pas inventer de reponse. " +
    'Memes regles de Zone A que rag-query-v1 (zone intime jamais ouverte). Pour un mot-cle exact et rapide, preferer rag-query-v1.',
  category: 'memory',
  inputSchema: {
    query: z.string().min(1).describe('Question en langage naturel, telle que dictee'),
    limit: z.number().int().min(1).max(25).optional().describe('Nombre de passages (defaut 5, max 25)'),
    project: z.string().optional().describe("Ne garder que les chemins contenant ce texte, ex. 'Virtualisation-HyperV'"),
    sourceContains: z.string().optional().describe("Ne garder que les chemins contenant ce texte, ex. 'from-microsoft-copilot'"),
    includeZoneA: z.boolean().optional().describe('Ouvre les conversations brutes Zone A-1 (defaut false). N ouvre jamais la zone intime A-2 ni la zone contentieux.'),
    includeContentieux: z.boolean().optional().describe("Ouvre la zone contentieux (dossier de litige), seulement si l'utilisateur demande explicitement ce dossier (defaut false). N ouvre jamais la zone intime A-2."),
    reformulate: z.boolean().optional().describe('Reformulations par le modele local (defaut true). false = plus rapide.'),
  },
  // journal des recherches : opt-in par IRIS_RAG_JOURNAL_DIR, sans effet sinon
  execute: avecJournal('rag-search-v2', async (input) => {
    try {
      const result = await ragSearch({
        query: String(input.query ?? ''),
        limit: input.limit as number | undefined,
        project: input.project as string | undefined,
        sourceContains: input.sourceContains as string | undefined,
        includeZoneA: input.includeZoneA as boolean | undefined,
        includeContentieux: input.includeContentieux as boolean | undefined,
        reformulate: input.reformulate as boolean | undefined,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ hits: [], meta: { tool: 'rag-search-v2', filterZoneA: true, filterContentieux: true, intimeAlwaysFiltered: true, count: 0, error: msg } }, null, 2),
        }],
      };
    }
  }),
};
