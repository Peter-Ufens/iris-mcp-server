import * as z from 'zod/v4';
import { readFileSync } from 'node:fs';
import type { IrisTool } from './_types.js';

/**
 * rag-query-v1 — interroge le RAG vault de Peter (Qdrant :6334 + embeddings Ollama).
 *
 * Pourquoi cet outil : jusqu'ici le seul acces au RAG etait `query-rag.ps1`, lance
 * a la main. Karen / Sharon / Claude Code ne pouvaient pas interroger l'index dans
 * le fil d'une conversation (constat audit 2026-09-02).
 *
 * Gouvernance Zone A — la regle, et elle n'est pas negociable cote MCP :
 *   - par defaut          : Zone A filtree (conversations brutes + intime exclus)
 *   - includeZoneA: true  : ouvre les conversations brutes (A-1) UNIQUEMENT
 *   - Zone A-2 "intime"   : JAMAIS ouverte par cet outil, quel que soit l'input.
 *     (lana-amante, 00-Meta/profil-peter/journal, personnes.md, 03-Vie, 10-Prive...)
 *     L'ouverture de l'intime reste un geste manuel et explicite de Peter :
 *     `query-rag.ps1 -IncludeZoneA -AllowIntime`.
 *
 * Les motifs ne sont PAS dupliques ici : source unique = zone-a-patterns.json
 * (le meme fichier que lisent query-rag.ps1, l'ingest et le backup GitHub).
 */

const DEFAULT_QDRANT = 'http://127.0.0.1:6334';
const DEFAULT_OLLAMA = 'http://127.0.0.1:11434';
const DEFAULT_COLLECTION = 'vault-text';
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
const DEFAULT_PATTERNS_FILE =
  'D:\\IA-CURSOR\\Vault-Obsidian\\planning\\config\\zone-a-patterns.json';

/** Filet de securite si zone-a-patterns.json est illisible : on ferme, on n'ouvre pas. */
const FALLBACK_ALWAYS_EXCLUDE = [
  '03-Vie',
  '10-Prive',
  '_prive',
  'lana-amante',
  'profil-peter\\journal',
  'profil-peter/journal',
  'personnes.md',
  'personnes-enrichissement',
  '_ip-hors-gh',
  'lyla-heritage-ip',
];

export interface ZonePatterns {
  version: string;
  queryExclude: string[];
  alwaysExclude: string[];
  error?: string;
}

export interface RagHit {
  score: number;
  sourceFile: string;
  source_filename: string;
  excerpt: string;
}

export interface RagQueryResult {
  hits: RagHit[];
  meta: {
    filterZoneA: boolean;
    intimeAlwaysFiltered: true;
    zonePatternsVersion: string;
    excludePatterns: number;
    count: number;
    collection: string;
    error?: string;
  };
}

export function loadZonePatterns(file = resolvePatternsFile()): ZonePatterns {
  try {
    // utf-8-sig : le fichier peut porter un BOM (ecrit par PowerShell).
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const j = JSON.parse(raw) as {
      version?: string;
      ragQueryExcludeContains?: string[];
      ragAlwaysExcludeContains?: string[];
    };
    const always =
      Array.isArray(j.ragAlwaysExcludeContains) && j.ragAlwaysExcludeContains.length > 0
        ? j.ragAlwaysExcludeContains
        : FALLBACK_ALWAYS_EXCLUDE;
    return {
      version: j.version ?? 'unknown',
      queryExclude: Array.isArray(j.ragQueryExcludeContains) ? j.ragQueryExcludeContains : [],
      alwaysExclude: always,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Config illisible => on reste ferme sur l'intime ET sur les conversations brutes.
    return {
      version: 'unreadable',
      queryExclude: FALLBACK_ALWAYS_EXCLUDE,
      alwaysExclude: FALLBACK_ALWAYS_EXCLUDE,
      error: `zone-a-patterns illisible (${msg}) - repli sur la liste de secours`,
    };
  }
}

export function resolvePatternsFile(): string {
  const fromEnv = process.env.ZONE_A_PATTERNS_FILE?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_PATTERNS_FILE;
}

/** Meme semantique que Test-RagSourcePathExcluded (PowerShell) : contains, insensible a la casse, / == \. */
export function isPathExcluded(sourcePath: string, excludeContains: string[]): boolean {
  if (!sourcePath) return true;
  const norm = sourcePath.replace(/\//g, '\\').toLowerCase();
  return excludeContains.some((pat) => {
    if (!pat) return false;
    return norm.includes(pat.replace(/\//g, '\\').toLowerCase());
  });
}

/** Motifs a exclure pour cette requete. includeZoneA n'ouvre jamais A-2. */
export function resolveExcludes(patterns: ZonePatterns, includeZoneA: boolean): string[] {
  return includeZoneA ? patterns.alwaysExclude : patterns.queryExclude;
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

export interface RagQueryInput {
  query: string;
  limit?: number;
  project?: string;
  sourceContains?: string;
  includeZoneA?: boolean;
  qdrantUrl?: string;
  ollamaUrl?: string;
  collection?: string;
  embedModel?: string;
  patternsFile?: string;
}

export async function ragQuery(input: RagQueryInput): Promise<RagQueryResult> {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 25);
  const includeZoneA = input.includeZoneA === true;
  const collection = input.collection ?? process.env.QDRANT_COLLECTION ?? DEFAULT_COLLECTION;
  const qdrant = (input.qdrantUrl ?? process.env.QDRANT_URL ?? DEFAULT_QDRANT).replace(/\/+$/, '');
  const ollama = (input.ollamaUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA).replace(/\/+$/, '');
  const embedModel = input.embedModel ?? process.env.RAG_EMBED_MODEL ?? DEFAULT_EMBED_MODEL;

  const patterns = loadZonePatterns(input.patternsFile ?? resolvePatternsFile());
  const excludes = resolveExcludes(patterns, includeZoneA);

  const base: RagQueryResult = {
    hits: [],
    meta: {
      filterZoneA: !includeZoneA,
      intimeAlwaysFiltered: true,
      zonePatternsVersion: patterns.version,
      excludePatterns: excludes.length,
      count: 0,
      collection,
    },
  };
  if (patterns.error) base.meta.error = patterns.error;

  if (!input.query || !input.query.trim()) {
    base.meta.error = 'query vide';
    return base;
  }

  // 1) embedding
  let vector: number[];
  try {
    const emb = (await postJson(
      `${ollama}/api/embeddings`,
      { model: embedModel, prompt: input.query },
      30_000,
    )) as { embedding?: number[] };
    if (!emb.embedding || emb.embedding.length === 0) throw new Error('reponse sans embedding');
    vector = emb.embedding;
  } catch (e) {
    base.meta.error = `Ollama injoignable ou modele absent (${e instanceof Error ? e.message : String(e)})`;
    return base;
  }

  // 2) recherche Qdrant, filtre zone cote serveur
  // Sur-echantillonnage : les filtres appliques apres (zone, projet, source) mangent des hits.
  const needsOverfetch = excludes.length > 0 || Boolean(input.project) || Boolean(input.sourceContains);
  const searchBody: Record<string, unknown> = {
    vector,
    limit: needsOverfetch ? Math.max(limit * 4, 20) : limit,
    with_payload: true,
  };
  if (excludes.length > 0) {
    searchBody.filter = {
      must_not: excludes.map((pat) => ({ key: 'sourceFile', match: { text: pat } })),
    };
  }

  let raw: Array<{ score?: number; payload?: Record<string, unknown> }>;
  try {
    const res = (await postJson(
      `${qdrant}/collections/${encodeURIComponent(collection)}/points/search`,
      searchBody,
      60_000,
    )) as { result?: Array<{ score?: number; payload?: Record<string, unknown> }> };
    raw = Array.isArray(res.result) ? res.result : [];
  } catch (e) {
    base.meta.error = `Qdrant injoignable (${e instanceof Error ? e.message : String(e)})`;
    return base;
  }

  // 3) filet post-requete : on ne fait jamais confiance au seul filtre serveur
  const hits: RagHit[] = [];
  for (const h of raw) {
    const sourceFile = String(h.payload?.sourceFile ?? '');
    if (isPathExcluded(sourceFile, excludes)) continue;
    if (input.project && !sourceFile.toLowerCase().includes(input.project.toLowerCase())) continue;
    if (
      input.sourceContains &&
      !sourceFile.toLowerCase().includes(input.sourceContains.toLowerCase())
    ) {
      continue;
    }
    const text = String(h.payload?.text ?? '');
    hits.push({
      score: Math.round(Number(h.score ?? 0) * 10_000) / 10_000,
      sourceFile,
      source_filename: String(h.payload?.source_filename ?? ''),
      excerpt: text.length > 240 ? `${text.slice(0, 240)}...` : text,
    });
    if (hits.length >= limit) break;
  }

  base.hits = hits;
  base.meta.count = hits.length;
  return base;
}

export const tool: IrisTool = {
  id: 'rag-query-v1',
  description:
    "Interroge le RAG vault de Peter (Qdrant + embeddings Ollama) et retourne les passages les plus proches. " +
    "Par defaut la Zone A est filtree (conversations brutes exclues) ; includeZoneA=true ouvre les conversations " +
    "brutes (Copilot, Ollama, Claude) mais JAMAIS la zone intime, qui reste filtree en toutes circonstances. " +
    'Utiliser project ou sourceContains pour cibler un projet ou une source.',
  category: 'memory',
  inputSchema: {
    query: z.string().min(1).describe('Question en langage naturel, ou terme exact a retrouver'),
    limit: z.number().int().min(1).max(25).optional().describe('Nombre de passages (defaut 5, max 25)'),
    project: z
      .string()
      .optional()
      .describe("Ne garder que les chemins contenant ce texte, ex. 'Virtualisation-HyperV'"),
    sourceContains: z
      .string()
      .optional()
      .describe("Ne garder que les chemins contenant ce texte, ex. 'from-microsoft-copilot'"),
    includeZoneA: z
      .boolean()
      .optional()
      .describe(
        'Ouvre les conversations brutes Zone A-1 (defaut false). N ouvre jamais la zone intime A-2.',
      ),
  },
  execute: async (input) => {
    try {
      const result = await ragQuery({
        query: String(input.query ?? ''),
        limit: input.limit as number | undefined,
        project: input.project as string | undefined,
        sourceContains: input.sourceContains as string | undefined,
        includeZoneA: input.includeZoneA as boolean | undefined,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      // Contrat Iris : ne JAMAIS planter, retourner une erreur propre dans le JSON.
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { hits: [], meta: { filterZoneA: true, intimeAlwaysFiltered: true, count: 0, error: msg } },
              null,
              2,
            ),
          },
        ],
      };
    }
  },
};
