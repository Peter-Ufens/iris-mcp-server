import * as z from 'zod/v4';
import type { IrisTool } from './_types.js';
import { fetchText } from '../utils/http-fetch.js';
import { jsonResult, errorResult } from '../utils/git-run.js';
import {
  parseFeedXml,
  normalizeTitle,
  truncateSummary,
  isGoogleNewsUrl,
  domainOf,
  dedupeKey,
  type ParsedFeedItem,
} from '../utils/rss-parse.js';

type Zone =
  | 'france'
  | 'alsace'
  | 'ia'
  | 'monde'
  | 'guadeloupe'
  | 'usa'
  | 'asie_ia'
  | 'tout';

interface FeedDef {
  id: string;
  name: string;
  url: string;
  zones: Zone[];
  kind: 'publisher' | 'discovery';
  /** Recherche par mots-cles (Bing, Google) : nationale, deja filtree par le moteur. */
  search?: true;
  /** Filtre propre a une zone : l'article doit aussi parler de ce theme. */
  zoneFilter?: Partial<Record<Zone, RegExp>>;
}

// Zone asie_ia = intersection IA ET Asie. Les flux IA (TechCrunch, Verge) parlent
// surtout des Etats-Unis, les flux Asie (CNA, Japan Times) surtout d'autre chose :
// sans filtre, 1 article sur 30 seulement etait a la fois IA et Asie (review Bob 08/10).
const AI_RE =
  /\b(ai|artificial intelligence|generative|chatbots?|llms?|machine learning|deepseek|openai|anthropic|nvidia|chips?|semiconductors?|gpus?|data cent(?:re|er)s?|robots?|robotics)\b/i;
const ASIA_RE =
  /\b(asia|asian|asean|china|chinese|beijing|shanghai|shenzhen|hong kong|taiwan|taiwanese|japan|japanese|tokyo|osaka|korea|korean|seoul|singapore|india|indian|vietnam|indonesia|malaysia|thailand|philippines|alibaba|baidu|tencent|huawei|bytedance|xiaomi|samsung|sk hynix|softbank|tsmc|sony|deepseek)\b/i;

/** Liste fixe (ADR-0006). Aucune URL client. Pas de ville personnelle. */
const FEEDS: FeedDef[] = [
  {
    id: 'franceinfo',
    name: 'franceinfo',
    url: 'https://www.franceinfo.fr/titres.rss',
    zones: ['france', 'tout'],
    kind: 'publisher',
  },
  {
    id: 'lemonde-une',
    name: 'Le Monde',
    url: 'https://www.lemonde.fr/rss/une.xml',
    zones: ['france', 'monde', 'tout'],
    kind: 'publisher',
  },
  {
    id: 'france3-grand-est',
    name: 'France 3 Grand Est',
    url: 'https://france3-regions.franceinfo.fr/grand-est/rss',
    zones: ['alsace', 'france', 'tout'],
    kind: 'publisher',
  },
  {
    id: 'dna',
    name: 'DNA',
    url: 'https://www.dna.fr/rss',
    zones: ['alsace', 'tout'],
    kind: 'publisher',
  },
  {
    id: 'lalsace',
    name: "L'Alsace",
    url: 'https://www.lalsace.fr/rss',
    zones: ['alsace', 'tout'],
    kind: 'publisher',
  },
  {
    id: 'actuia',
    name: 'ActuIA',
    url: 'https://www.actuia.com/feed/',
    zones: ['ia', 'tout'],
    kind: 'publisher',
  },
  {
    id: 'lemonde-pixels',
    name: 'Le Monde Pixels',
    url: 'https://www.lemonde.fr/pixels/rss_full.xml',
    zones: ['ia', 'monde', 'tout'],
    kind: 'publisher',
  },
  {
    id: 'siecle-digital',
    name: 'Siècle Digital',
    url: 'https://siecledigital.fr/feed/',
    zones: ['ia', 'tout'],
    kind: 'publisher',
  },
  // Guadeloupe : le flux regional La 1ere existe a l'adresse /last-articles/rss
  // (/guadeloupe/rss redirige vers du HTML). Teste par Bob le 08/10 : 30 articles.
  // + decouverte Google en URL fixe (pas d'URL client).
  {
    id: 'la1ere-guadeloupe',
    name: 'Guadeloupe La 1ère',
    url: 'https://la1ere.franceinfo.fr/guadeloupe/last-articles/rss',
    zones: ['guadeloupe'],
    kind: 'publisher',
  },
  {
    id: 'google-guadeloupe',
    name: 'Google Actualités Guadeloupe',
    url: 'https://news.google.com/rss/search?q=Guadeloupe+when:2d&hl=fr&gl=FR&ceid=FR:fr',
    zones: ['guadeloupe'],
    kind: 'discovery',
  },
  {
    id: 'bbc-us-canada',
    name: 'BBC US & Canada',
    url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml',
    zones: ['usa', 'monde', 'tout'],
    kind: 'publisher',
  },
  {
    id: 'nyt-us',
    name: 'NYT US',
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml',
    zones: ['usa', 'monde', 'tout'],
    kind: 'publisher',
  },
  {
    id: 'techcrunch-ai',
    name: 'TechCrunch AI',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    zones: ['asie_ia', 'ia', 'tout'],
    kind: 'publisher',
    zoneFilter: { asie_ia: ASIA_RE },
  },
  {
    id: 'verge-ai',
    name: 'The Verge AI',
    url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    zones: ['asie_ia', 'ia', 'tout'],
    kind: 'publisher',
    zoneFilter: { asie_ia: ASIA_RE },
  },
  {
    id: 'cna-asia',
    name: 'Channel News Asia',
    url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511',
    zones: ['asie_ia', 'monde', 'tout'],
    kind: 'publisher',
    zoneFilter: { asie_ia: AI_RE },
  },
  {
    id: 'japan-times',
    name: 'Japan Times',
    url: 'https://www.japantimes.co.jp/feed/topstories/',
    zones: ['asie_ia', 'monde', 'tout'],
    kind: 'publisher',
    zoneFilter: { asie_ia: AI_RE },
  },
  {
    id: 'google-asie-ia',
    name: 'Google Actualités IA Asie',
    url: 'https://news.google.com/rss/search?q=artificial+intelligence+(China+OR+Japan+OR+Korea+OR+Singapore+OR+Asia)+when:7d&hl=en&gl=US&ceid=US:en',
    zones: ['asie_ia'],
    kind: 'discovery',
  },
];

const NOTE =
  'Titres et liens seulement. Usage personnel / non commercial. Lire l’article (fetch-url-v1) avant d’affirmer un fait. Voie A = flux éditeurs. Voie B = recherche `recherche=bing|google|les_deux` (Bing → items[] liens éditeur ; Google → decouverte[]) : recherche nationale, la zone ne s’y applique pas (zone « tout »). Heure Bing approximative (date_approx) : lire la date sur la page de l’éditeur avant d’affirmer une heure. Zone ia = ActuIA/Pixels/Siècle Digital. Zone guadeloupe = La 1ère + Google découverte fixe. Zone usa = BBC/NYT. Zone asie_ia = IA∩Asie + Google IA Asie.';

/**
 * Chaque mot de la requete doit commencer un mot du titre ou du resume
 * ("lycee" trouve "lycees"). Mot de 3 lettres ou moins : mot entier exige,
 * sinon "IA" trouverait "social" ou "medias".
 */
function matchesQuery(item: ParsedFeedItem, query: string): boolean {
  const words = normalizeTitle(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const hay = ` ${normalizeTitle(`${item.title} ${item.summary}`)} `;
  return words.every((w) =>
    w.length <= 3 ? hay.includes(` ${w} `) : hay.includes(` ${w}`),
  );
}

/** Date ecrite dans l'URL (/AAAA/MM/JJ/), utile pour reperer une republication. */
function dateFromUrl(url: string): string | null {
  const m = /\/(20\d{2})\/(\d{2})\/(\d{2})\//.exec(url);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** pubDate plus recente que la date de l'URL de plus de 36 h = article ancien republie. */
const REPUBLICATION_MS = 36 * 3_600_000;

/**
 * Garde l'ordre des dates mais plafonne chaque source a sa part de `limit`,
 * pour qu'un flux tres bavard (franceinfo) ne cache pas les autres.
 * Les places restantes sont ensuite remplies dans l'ordre des dates.
 */
function balanceSources<T extends { source: string }>(list: T[], limit: number): T[] {
  const nSources = new Set(list.map((x) => x.source)).size;
  if (nSources <= 1) return list.slice(0, limit);
  const cap = Math.ceil(limit / nSources);
  const perSource = new Map<string, number>();
  const picked = new Set<T>();
  for (const x of list) {
    if (picked.size >= limit) break;
    const n = perSource.get(x.source) ?? 0;
    if (n >= cap) continue;
    perSource.set(x.source, n + 1);
    picked.add(x);
  }
  for (const x of list) {
    if (picked.size >= limit) break;
    picked.add(x);
  }
  return list.filter((x) => picked.has(x));
}

function ageHours(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 3_600_000;
}

function googleNewsUrl(query: string): string {
  const q = encodeURIComponent(`${query} when:2d`);
  return `https://news.google.com/rss/search?q=${q}&hl=fr&gl=FR&ceid=FR:fr`;
}

/** Bing : interval "7" = 24 h, "8" = 7 jours (doc / mesures Bob 08/10). */
function bingNewsUrl(query: string, sinceHours: number): string {
  const interval = sinceHours <= 24 ? '7' : '8';
  const q = encodeURIComponent(query);
  return `https://www.bing.com/news/search?q=${q}&format=rss&qft=interval%3D%22${interval}%22&setlang=fr-FR`;
}

type Recherche = 'aucune' | 'google' | 'bing' | 'les_deux';

function resolveRecherche(
  recherche: Recherche | undefined,
  googleNewsFlag: boolean,
): { wantGoogle: boolean; wantBing: boolean } {
  if (recherche && recherche !== 'aucune') {
    return {
      wantGoogle: recherche === 'google' || recherche === 'les_deux',
      wantBing: recherche === 'bing' || recherche === 'les_deux',
    };
  }
  // Compat : google_news true = Google (ADR-0006)
  return { wantGoogle: googleNewsFlag, wantBing: false };
}

export const tool: IrisTool = {
  id: 'actu-rss-v1',
  description:
    'Actualité via flux RSS fixes (France / Alsace / IA / Guadeloupe / USA / Asie-IA) + recherche Bing/Google. Titres, dates, liens éditeur https. Pas de LLM. ADR-0006/0008.',
  category: 'web',
  inputSchema: {
    query: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe('Mots-clés optionnels (filtre titres / résumés ; requis pour recherche Bing/Google)'),
    zone: z
      .enum(['france', 'alsace', 'ia', 'monde', 'guadeloupe', 'usa', 'asie_ia', 'tout'])
      .optional()
      .default('tout')
      .describe('Choix des flux'),
    since_hours: z
      .number()
      .int()
      .min(1)
      .max(168)
      .optional()
      .default(48)
      .describe('Fenêtre de fraîcheur en heures'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .default(10)
      .describe('Nombre d articles rendus'),
    google_news: z
      .boolean()
      .optional()
      .default(false)
      .describe('Compat : ajoute Google Actualités (découverte). Préférer `recherche`.'),
    recherche: z
      .enum(['aucune', 'google', 'bing', 'les_deux'])
      .optional()
      .default('aucune')
      .describe('Voie B : aucune / google (decouverte) / bing (items éditeur) / les_deux'),
  },
  execute: async (input) => {
    const zone = ((input.zone as Zone | undefined) ?? 'tout') as Zone;
    // Pas de requete implicite : un filtre "Guadeloupe" par defaut jetait les
    // articles guadeloupeens qui ne citent que la commune (Gosier, Abymes...).
    const query = (input.query as string | undefined)?.trim() || '';
    const sinceHours = (input.since_hours as number | undefined) ?? 48;
    const limit = (input.limit as number | undefined) ?? 10;
    const googleNewsFlag = (input.google_news as boolean | undefined) ?? false;
    const recherche = (input.recherche as Recherche | undefined) ?? 'aucune';
    const { wantGoogle, wantBing } = resolveRecherche(recherche, googleNewsFlag);

    const now = new Date();
    const todayFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const today = todayFmt.format(now);
    const nowParis = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .format(now)
      .replace(' ', 'T');

    const selected = FEEDS.filter((f) => f.zones.includes(zone));
    const jobs: { def: FeedDef; url: string }[] = selected.map((def) => ({
      def,
      url: def.url,
    }));
    if (wantGoogle && query) {
      jobs.push({
        def: {
          id: 'google-news',
          name: 'Google Actualités',
          url: googleNewsUrl(query),
          zones: ['tout'],
          kind: 'discovery',
          search: true,
        },
        url: googleNewsUrl(query),
      });
    }
    if (wantBing && query) {
      const bingUrl = bingNewsUrl(query, sinceHours);
      jobs.push({
        def: {
          id: 'bing-news',
          name: 'Bing Actualités',
          url: bingUrl,
          zones: ['tout'],
          // Lien éditeur décodé → items[] citables (ADR-0008)
          kind: 'publisher',
          search: true,
        },
        url: bingUrl,
      });
    }

    if (jobs.length === 0) {
      return errorResult(`Aucun flux pour zone=${zone}`);
    }

    type FeedState = {
      id: string;
      name: string;
      url: string;
      status: 'ok' | 'vide' | 'erreur';
      message?: string;
      count?: number;
    };

    const feeds: FeedState[] = [];
    if (wantGoogle && !query) {
      feeds.push({
        id: 'google-news',
        name: 'Google Actualités',
        url: '',
        status: 'erreur',
        message: 'non appelé : recherche Google demande une query',
      });
    }
    if (wantBing && !query) {
      feeds.push({
        id: 'bing-news',
        name: 'Bing Actualités',
        url: '',
        status: 'erreur',
        message: 'non appelé : recherche Bing demande une query',
      });
    }
    const collected: {
      title: string;
      source: string;
      url: string;
      published_at: string | null;
      age_hours: number | null;
      summary: string;
      zone: Zone;
      discovery: boolean;
      date_inconnue: boolean;
      date_douteuse?: true;
      date_approx?: true;
      date_url?: string;
      domain: string;
      normTitle: string;
    }[] = [];

    const results = await Promise.allSettled(
      jobs.map(async ({ def, url }) => {
        const res = await fetchText(url, { maxChars: 200_000 });
        return { def, url, text: res.text, status: res.status };
      }),
    );

    let anyOk = false;
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      const job = jobs[i]!;
      if (r.status === 'rejected') {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        feeds.push({
          id: job.def.id,
          name: job.def.name,
          url: job.url,
          status: 'erreur',
          message: msg,
        });
        continue;
      }
      const { def, url, text } = r.value;
      try {
        const items = parseFeedXml(text);
        if (items.length === 0) {
          feeds.push({
            id: def.id,
            name: def.name,
            url,
            status: 'vide',
            count: 0,
          });
          continue;
        }
        anyOk = true;
        feeds.push({
          id: def.id,
          name: def.name,
          url,
          status: 'ok',
          count: items.length,
        });
        // Zone demandee si precise ; sinon la 1re zone du flux (TechCrunch en zone ia
        // etait etiquete asie_ia, BBC en zone monde etiquete usa).
        // Recherche Bing / Google = nationale : jamais etiquetee avec la zone demandee
        // (Sud Ouest ou La Voix du Nord sortaient en zone « alsace », review Bob 08/10).
        const primaryZone = def.search
          ? 'tout'
          : zone !== 'tout'
            ? zone
            : ((def.zones.find((z) => z !== 'tout') as Zone | undefined) ?? zone);
        const zoneFilter = def.zoneFilter?.[zone];
        for (const it of items) {
          if (!it.url || !/^https:\/\//i.test(it.url)) continue;
          if (zoneFilter && !zoneFilter.test(`${it.title} ${it.summary}`)) continue;
          const discovery =
            def.kind === 'discovery' || isGoogleNewsUrl(it.url);
          const age = ageHours(it.published_at, now);
          const date_inconnue = !it.published_at;
          if (!date_inconnue && age !== null && age > sinceHours) continue;
          // Les resultats Bing / Google sont AUSSI filtres sur les mots : sans ce filtre,
          // le piege « virus quarantaine population mondiale » remontait 7 articles reels
          // (Ebola au Kenya) et Google 6 hors-sujet sur 10 pour « Gosier » (mesure Bob 08/10).
          if (query && !matchesQuery(it, query)) continue;
          const dateUrl = dateFromUrl(it.url);
          const republie =
            dateUrl !== null &&
            it.published_at !== null &&
            Date.parse(it.published_at) - Date.parse(dateUrl) > REPUBLICATION_MS;
          collected.push({
            title: it.title,
            // Bing / Google : préférer le nom du journal (News:Source / <source>)
            source: it.source_name || def.name,
            url: it.url,
            published_at: it.published_at,
            age_hours: age === null ? null : Math.round(age * 10) / 10,
            summary: truncateSummary(it.summary),
            zone: primaryZone,
            discovery,
            date_inconnue,
            ...(republie ? { date_douteuse: true as const, date_url: dateUrl! } : {}),
            // Heure Bing juste en moyenne, fausse de plusieurs heures sur certains
            // articles (La Provence datee avant l'evenement, mesure Bob 08/10)
            ...(def.id === 'bing-news' ? { date_approx: true as const } : {}),
            domain: domainOf(it.url),
            normTitle: dedupeKey(it.title, it.url),
          });
        }
      } catch (e) {
        feeds.push({
          id: def.id,
          name: def.name,
          url,
          status: 'erreur',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (!anyOk) {
      return jsonResult({
        error: 'Tous les flux ont échoué ou sont vides. Voir feeds[] pour le détail.',
        feeds,
      });
    }

    // Dédoublonnage : titre normalisé, ou URL si titre placeholder (B10)
    const seen = new Set<string>();
    const deduped: typeof collected = [];
    for (const it of collected) {
      const key = it.normTitle;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(it);
    }

    // Tri : datés d'abord (plus récents), puis date_inconnue
    deduped.sort((a, b) => {
      if (a.published_at && b.published_at) {
        return Date.parse(b.published_at) - Date.parse(a.published_at);
      }
      if (a.published_at) return -1;
      if (b.published_at) return 1;
      return 0;
    });

    // Google Actualites a part : sinon ses 100 resultats chassent les liens editeurs citables
    const toOutput = ({
      normTitle: _n,
      domain: _d,
      discovery: _g,
      ...rest
    }: (typeof collected)[number]) => rest;
    const items = balanceSources(
      deduped.filter((x) => !x.discovery),
      limit,
    ).map(toOutput);
    const decouverte = balanceSources(
      deduped.filter((x) => x.discovery),
      limit,
    ).map(toOutput);

    let recoupement: number | null = null;
    if (query) {
      const domains = new Set(
        deduped.filter((x) => !x.discovery && x.domain).map((x) => x.domain),
      );
      recoupement = domains.size;
    }

    return jsonResult({
      now: nowParis,
      today,
      query: query || null,
      zone,
      since_hours: sinceHours,
      recherche:
        wantBing && query && wantGoogle
          ? 'les_deux'
          : wantBing && query
            ? 'bing'
            : wantGoogle && query
              ? 'google'
              : 'aucune',
      items,
      decouverte,
      recoupement,
      feeds,
      note: NOTE,
    });
  },
};
