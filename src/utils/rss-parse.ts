/**
 * Lecteur RSS 2.0 / Atom minimal (lab Iris · ADR-0006).
 * Pas de dependance externe tant que les cas de test passent.
 */

export interface ParsedFeedItem {
  title: string;
  url: string;
  published_at: string | null;
  summary: string;
  /** Nom du journal d'origine (balise RSS `<source>`, ex. Google Actualites). */
  source_name?: string;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripHtml(s: string): string {
  return decodeXmlEntities(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(block: string, tag: string): string {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    'i',
  );
  const m = re.exec(block);
  return m ? stripHtml(m[1]!) : '';
}

function tagAttr(block: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*\\/?>`, 'i');
  const m = re.exec(block);
  return m ? decodeXmlEntities(m[1]!) : '';
}

/** Parse RFC 822 / ISO-ish dates → ISO string or null. */
export function parseFeedDate(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Bing Actualités étiquette `GMT` alors que l'horloge est America/Los_Angeles
 * (mesure Bob+Karen 08/10 : écart pile −7 h PDT). Sans correction, since_hours
 * jette des articles frais.
 */
export function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(tz);
  if (!m) return -7 * 3_600_000;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
}

/**
 * pubDate Bing (GMT faux) → ISO UTC réel. Autres dates : parseFeedDate.
 * Garde-fou : si la correction place l'article plus d'1 h dans le futur, Bing a
 * cessé d'écrire l'heure du Pacifique pour cet article : on garde l'heure brute.
 */
export function parseBingPubDate(
  raw: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (!/GMT\s*$/i.test(trimmed)) return parseFeedDate(trimmed);
  const wrongAsUtc = Date.parse(trimmed);
  if (Number.isNaN(wrongAsUtc)) return null;
  const offset = getTimeZoneOffsetMs('America/Los_Angeles', new Date(wrongAsUtc));
  const corrected = wrongAsUtc - offset;
  if (corrected > now + 3_600_000) return new Date(wrongAsUtc).toISOString();
  return new Date(corrected).toISOString();
}

/**
 * Lien apiclick Bing → URL éditeur https (paramètre `url=`).
 * Sans ça, le filtre https refuse le lien Bing en http.
 */
export function decodeBingEditorUrl(link: string): string {
  try {
    const u = new URL(link);
    if (
      !(
        u.hostname === 'www.bing.com' ||
        u.hostname === 'bing.com' ||
        u.hostname.endsWith('.bing.com')
      )
    ) {
      return link;
    }
    if (!u.pathname.includes('/news/apiclick')) return link;
    // searchParams.get decode deja une fois. Un 2e decodeURIComponent cassait
    // les liens contenant un % (exception → lien perdu) ou un %25 / %2F.
    const decoded = u.searchParams.get('url');
    if (!decoded) return link;
    return /^https:\/\//i.test(decoded) ? decoded : link;
  } catch {
    return link;
  }
}

export function isBingNewsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === 'www.bing.com' ||
      u.hostname === 'bing.com' ||
      u.hostname.endsWith('.bing.com')
    );
  } catch {
    return false;
  }
}

export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function truncateSummary(text: string, max = 300): string {
  const t = stripHtml(text);
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Titres cassés (gabarits éditeur, ex. DNA `$content.TitleNoTags`) → placeholder.
 */
export function sanitizeTitle(title: string): string {
  const t = stripHtml(title).trim();
  if (!t) return '(sans titre)';
  if (/\$content\./i.test(t)) return '(sans titre)';
  if (/^\$\{/.test(t) || /\{\{/.test(t)) return '(sans titre)';
  return t;
}

/** Clé de dédoublonnage : URL si titre vide/placeholder, sinon titre normalisé. */
export function dedupeKey(title: string, url: string): string {
  const t = sanitizeTitle(title);
  if (t === '(sans titre)' || !normalizeTitle(t)) return `url:${url}`;
  return normalizeTitle(t);
}

function parseRssItems(xml: string): ParsedFeedItem[] {
  const items: ParsedFeedItem[] = [];
  // Bing : l'heure du Pacifique n'est ecrite que pour certains parametres de requete
  // (sans setlang, Bing donne le vrai GMT : mesure Bob 08/10). Si un seul article du
  // flux tomberait dans le futur une fois corrige, le flux est en vrai GMT : on ne
  // corrige aucun article de ce flux.
  const bingRaw: { item: ParsedFeedItem; pub: string }[] = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1]!;
    const title = tagText(block, 'title');
    let url = tagText(block, 'link');
    if (!url) url = tagAttr(block, 'link', 'href');
    if (!url) {
      const guid = tagText(block, 'guid');
      if (guid.startsWith('http')) url = guid;
    }
    const fromBing = isBingNewsUrl(url);
    url = decodeBingEditorUrl(url);
    const pub =
      tagText(block, 'pubDate') ||
      tagText(block, 'dc:date') ||
      tagText(block, 'date');
    const summary =
      tagText(block, 'description') ||
      tagText(block, 'content:encoded') ||
      '';
    if (!title && !url) continue;
    const sourceName =
      tagText(block, 'source') || tagText(block, 'News:Source');
    const item: ParsedFeedItem = {
      title: sanitizeTitle(title),
      url,
      published_at: fromBing ? parseBingPubDate(pub) : parseFeedDate(pub),
      summary: truncateSummary(summary),
      ...(sourceName ? { source_name: sourceName } : {}),
    };
    if (fromBing) bingRaw.push({ item, pub });
    items.push(item);
  }
  const now = Date.now();
  const fluxEnVraiGmt = bingRaw.some(
    ({ pub }) => (Date.parse(parseBingPubDate(pub, Infinity) ?? '') || 0) > now + 3_600_000,
  );
  if (fluxEnVraiGmt) {
    for (const { item, pub } of bingRaw) item.published_at = parseFeedDate(pub);
  }
  return items;
}

function parseAtomEntries(xml: string): ParsedFeedItem[] {
  const items: ParsedFeedItem[] = [];
  const re = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1]!;
    const title = tagText(block, 'title');
    let url = tagAttr(block, 'link', 'href');
    if (!url) url = tagText(block, 'link');
    if (!url) url = tagText(block, 'id');
    const pub =
      tagText(block, 'updated') ||
      tagText(block, 'published') ||
      tagText(block, 'dc:date');
    const summary =
      tagText(block, 'summary') || tagText(block, 'content') || '';
    if (!title && !url) continue;
    items.push({
      title: sanitizeTitle(title),
      url,
      published_at: parseFeedDate(pub),
      summary: truncateSummary(summary),
    });
  }
  return items;
}

export function parseFeedXml(xml: string): ParsedFeedItem[] {
  if (/<entry\b/i.test(xml) && /<feed\b/i.test(xml)) {
    return parseAtomEntries(xml);
  }
  if (/<item\b/i.test(xml)) {
    return parseRssItems(xml);
  }
  // Atom without explicit feed wrapper still possible
  if (/<entry\b/i.test(xml)) {
    return parseAtomEntries(xml);
  }
  return [];
}

export function isGoogleNewsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === 'news.google.com' ||
      u.hostname.endsWith('.google.com') && u.pathname.includes('/rss/')
    );
  } catch {
    return false;
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
