import {
  CATALOG,
  CATALOG_BY_ID,
  DEFAULT_SOURCE_ORDER,
  matchCatalogEntry,
  toPublicCatalogEntry,
} from './catalog.js';

export const PUBLIC_APIS_URL =
  'https://raw.githubusercontent.com/public-apis/public-apis/master/README.md';
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

export const FALLBACK_ENTRIES = [
  {
    name: 'Open-Meteo',
    url: 'https://open-meteo.com/',
    description: 'Global weather forecast API for non-commercial use',
    auth: 'No',
    https: true,
    cors: 'Yes',
  },
  {
    name: '7Timer!',
    url: 'http://www.7timer.info/doc.php?lang=en',
    description: 'Weather, especially for Astroweather',
    auth: 'No',
    https: false,
    cors: 'Unknown',
  },
  {
    name: 'Meteorologisk Institutt',
    url: 'https://api.met.no/weatherapi/documentation',
    description: 'Weather and climate data',
    auth: 'User-Agent',
    https: true,
    cors: 'Unknown',
  },
  {
    name: 'wttr.in',
    url: 'https://wttr.in/:help',
    description: 'Weather in your terminal, supports JSON output',
    auth: 'No',
    https: true,
    cors: 'Yes',
  },
];

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

export function parsePublicApisMarkdown(markdown) {
  const heading = markdown.search(/^### Weather\s*$/m);
  if (heading === -1) return [];

  const afterHeading = markdown.slice(heading).replace(/^### Weather\s*/, '');
  const nextHeading = afterHeading.search(/^#{2,3} /m);
  const section = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
  const entries = [];

  for (const line of section.split('\n')) {
    const match = line.match(
      /^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*(Yes|No)\s*\|\s*([^|]*?)\s*\|/,
    );
    if (!match) continue;

    const [, rawName, url, rawDescription, rawAuth, https, rawCors] = match;
    const discovered = {
      name: decodeEntities(rawName.trim()),
      url: url.trim(),
      description: decodeEntities(rawDescription.trim()),
      auth: rawAuth.replace(/`/g, '').trim() || 'Unknown',
      https: https === 'Yes',
      cors: rawCors.trim() || 'Unknown',
    };
    discovered.catalogId = matchCatalogEntry(discovered);
    entries.push(discovered);
  }

  return entries;
}

export function buildDoc(entries, { ok, sourceUrl = PUBLIC_APIS_URL, error = null } = {}) {
  const supportedIds = [];
  for (const entry of entries) {
    if (entry.catalogId && !supportedIds.includes(entry.catalogId)) {
      supportedIds.push(entry.catalogId);
    }
  }

  return {
    ok,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    scanned: entries.length,
    entries,
    supportedIds,
    error,
  };
}

export function fallbackDoc(error) {
  const entries = FALLBACK_ENTRIES.map((entry) => ({
    ...entry,
    catalogId: matchCatalogEntry(entry),
  }));
  const doc = buildDoc(entries, { ok: false, error });
  doc.fallback = true;
  return doc;
}

export function isFresh(doc) {
  if (!doc?.ok || !doc.fetchedAt) return false;
  return Date.now() - new Date(doc.fetchedAt).getTime() < CATALOG_TTL_MS;
}

/** The shape returned by GET /api/catalog. */
export function catalogPayload(doc) {
  const scrapedById = new Map(
    doc.entries.filter((entry) => entry.catalogId).map((entry) => [entry.catalogId, entry]),
  );
  const supported = new Set(doc.supportedIds);

  const entries = CATALOG.filter((entry) => supported.has(entry.id) || entry.variant).map((entry) =>
    toPublicCatalogEntry(entry, {
      discovered: supported.has(entry.id),
      scrapedEntry: scrapedById.get(entry.id),
    }),
  );

  return {
    meta: {
      ok: Boolean(doc.ok),
      fallback: Boolean(doc.fallback && !doc.ok),
      stale: Boolean(doc.stale),
      sourceUrl: doc.sourceUrl || PUBLIC_APIS_URL,
      fetchedAt: doc.fetchedAt,
      scanned: doc.scanned || 0,
      matched: supported.size,
      error: doc.error || null,
    },
    entries,
    scanned: doc.entries.map((entry) => ({
      name: entry.name,
      url: entry.url,
      description: entry.description,
      auth: entry.auth,
      https: entry.https,
      cors: entry.cors,
      catalogId: entry.catalogId || null,
    })),
  };
}

export function defaultCatalogIds(doc) {
  const ids = doc?.supportedIds ?? FALLBACK_ENTRIES.map((entry) => matchCatalogEntry(entry));
  const supported = new Set(ids);
  const defaults = DEFAULT_SOURCE_ORDER.filter((id) => supported.has(id));
  return defaults.length ? defaults : DEFAULT_SOURCE_ORDER;
}

export { CATALOG, CATALOG_BY_ID };
