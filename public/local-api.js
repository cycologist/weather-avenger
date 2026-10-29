import { CATALOG_BY_ID, DEFAULT_SOURCE_ORDER } from './lib/catalog.js';
import {
  PUBLIC_APIS_URL,
  buildDoc,
  catalogPayload,
  defaultCatalogIds,
  fallbackDoc,
  isFresh,
  parsePublicApisMarkdown,
} from './lib/scraper-core.js';
import { fetchText } from './lib/http.js';
import { runForecast } from './lib/forecast.js';
import { reversePlace, searchPlaces } from './lib/geocode.js';

const SOURCES_KEY = 'avercast-sources-v1';
const CATALOG_KEY = 'avercast-catalog-v1';

const nowIso = () => new Date().toISOString();

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function makeSource(catalogEntry, origin = 'catalog') {
  return {
    id: catalogEntry.id,
    catalogId: catalogEntry.id,
    name: catalogEntry.name,
    adapter: catalogEntry.adapter,
    model: catalogEntry.model ?? null,
    enabled: true,
    addedAt: nowIso(),
    origin,
    description: catalogEntry.description,
    homepage: catalogEntry.homepage,
    color: catalogEntry.color,
    variantLabel: catalogEntry.variantLabel,
    coverage: catalogEntry.coverage,
    license: catalogEntry.license,
    licenseUrl: catalogEntry.licenseUrl,
  };
}

function seedSources() {
  const ids = defaultCatalogIds(readCatalogDoc());
  const seeded = [];
  for (const id of ids) {
    const entry = CATALOG_BY_ID.get(id);
    if (entry) seeded.push(makeSource(entry, 'scraped'));
  }
  return seeded;
}

function validSources(value) {
  if (!Array.isArray(value)) return null;
  const list = value.filter(
    (source) =>
      source &&
      typeof source.id === 'string' &&
      typeof source.adapter === 'string' &&
      typeof source.name === 'string',
  );
  return list.length ? list : null;
}

let sources = null;

function loadSources() {
  if (sources) return sources;
  try {
    sources = validSources(JSON.parse(localStorage.getItem(SOURCES_KEY) ?? 'null'));
  } catch {
    sources = null;
  }
  if (!sources) {
    sources = seedSources();
    saveSources();
  }
  return sources;
}

function saveSources() {
  localStorage.setItem(SOURCES_KEY, JSON.stringify(sources));
}

function readCatalogDoc() {
  try {
    const doc = JSON.parse(localStorage.getItem(CATALOG_KEY) ?? 'null');
    if (!doc || !Array.isArray(doc.entries) || !Array.isArray(doc.supportedIds)) return null;
    return doc;
  } catch {
    return null;
  }
}

function writeCatalogDoc(doc) {
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify(doc));
  } catch {
    // Storage can be unavailable or full; the in-memory copy still works.
  }
}

let catalogDoc = null;
let catalogPending = null;

async function ensureCatalog({ force = false } = {}) {
  if (!force && catalogDoc && isFresh(catalogDoc)) return catalogDoc;
  if (catalogPending) return catalogPending;

  catalogPending = (async () => {
    const cached = catalogDoc ?? readCatalogDoc();
    if (!force && isFresh(cached)) {
      catalogDoc = cached;
      return catalogDoc;
    }

    try {
      const markdown = await fetchText(PUBLIC_APIS_URL, {
        timeout: 12_000,
        headers: { Accept: 'text/plain' },
      });
      const entries = parsePublicApisMarkdown(markdown);
      if (entries.length < 3) throw new Error('The scraped weather list looked empty');

      const doc = buildDoc(entries, { ok: true });
      doc.fallback = false;
      catalogDoc = doc;
      writeCatalogDoc(doc);
      return doc;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cached) {
        catalogDoc = { ...cached, stale: true, error: message };
        return catalogDoc;
      }
      catalogDoc = fallbackDoc(message);
      writeCatalogDoc(catalogDoc);
      return catalogDoc;
    }
  })();

  try {
    return await catalogPending;
  } finally {
    catalogPending = null;
  }
}

function listSources() {
  return loadSources().map((source) => ({ ...source }));
}

function enabledSources() {
  return listSources().filter((source) => source.enabled);
}

function addSource(catalogId) {
  const entry = CATALOG_BY_ID.get(catalogId);
  if (!entry) throw httpError('That weather service is not in the catalog', 404);
  const list = loadSources();
  if (list.some((source) => source.catalogId === catalogId)) {
    throw httpError('That weather service is already in your menu', 409);
  }
  const source = makeSource(entry, entry.variant ? 'bundled' : 'user');
  list.push(source);
  saveSources();
  return { ...source };
}

function patchSource(id, changes) {
  if (typeof changes?.enabled !== 'boolean') {
    throw httpError('enabled must be a boolean', 400);
  }
  const source = loadSources().find((item) => item.id === id);
  if (!source) throw httpError('Weather service not found', 404);
  source.enabled = changes.enabled;
  saveSources();
  return { ...source };
}

function deleteSource(id) {
  const list = loadSources();
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) throw httpError('Weather service not found', 404);
  const [removed] = list.splice(index, 1);
  saveSources();
  return { ...removed };
}

function coordinate(value, name, low, high) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < low || number > high) {
    throw httpError(`${name} must be a number between ${low} and ${high}`, 400);
  }
  return number;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handle(url, init) {
  const request = new URL(url, location.origin);
  const method = (init?.method || 'GET').toUpperCase();
  const path = request.pathname;
  let body = null;
  if (typeof init?.body === 'string' && init.body) {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = null;
    }
  }

  if (path === '/api/health') {
    const list = listSources();
    return {
      ok: true,
      sources: list.length,
      enabled: list.filter((source) => source.enabled).length,
      userAgent: 'in-app',
    };
  }

  if (path === '/api/sources' && method === 'GET') {
    const list = listSources();
    return {
      sources: list,
      meta: {
        total: list.length,
        enabled: list.filter((source) => source.enabled).length,
      },
    };
  }

  if (path === '/api/sources' && method === 'POST') {
    const catalogId = typeof body?.catalogId === 'string' ? body.catalogId : '';
    if (!catalogId) throw httpError('catalogId is required', 400);
    return { source: addSource(catalogId) };
  }

  const sourceMatch = /^\/api\/sources\/([^/]+)$/.exec(path);
  if (sourceMatch) {
    const id = decodeURIComponent(sourceMatch[1]);
    if (method === 'PATCH') return { source: patchSource(id, body ?? {}) };
    if (method === 'DELETE') return { ok: true, source: deleteSource(id) };
  }

  if (path === '/api/catalog') {
    return catalogPayload(await ensureCatalog());
  }

  if (path === '/api/catalog/refresh') {
    return catalogPayload(await ensureCatalog({ force: true }));
  }

  if (path === '/api/forecast') {
    const lat = coordinate(request.searchParams.get('lat'), 'lat', -90, 90);
    const lon = coordinate(request.searchParams.get('lon'), 'lon', -180, 180);
    const requestedDays = Number(request.searchParams.get('days') ?? 7);
    const days = Number.isFinite(requestedDays)
      ? Math.max(1, Math.min(10, Math.round(requestedDays)))
      : 7;
    const refresh =
      request.searchParams.get('refresh') === '1' || request.searchParams.get('refresh') === 'true';
    return runForecast({ sources: enabledSources(), lat, lon, days, refresh });
  }

  if (path === '/api/geocode') {
    const query = request.searchParams.get('q') ?? '';
    if (query.trim().length < 2) return { results: [] };
    return { results: await searchPlaces(query) };
  }

  if (path === '/api/reverse') {
    const lat = coordinate(request.searchParams.get('lat'), 'lat', -90, 90);
    const lon = coordinate(request.searchParams.get('lon'), 'lon', -180, 180);
    return { place: await reversePlace(lat, lon) };
  }

  throw httpError('Not found', 404);
}

/**
 * Route the frontend's /api/* fetches to in-app implementations. Used by the
 * Android build (and by `?local=1` in a desktop browser) where no Node server
 * is available.
 */
export function installLocalApi() {
  if (globalThis.__avercastLocalApi) return;
  globalThis.__avercastLocalApi = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (!url.startsWith('/api/')) return nativeFetch(input, init);
    try {
      return jsonResponse(await handle(url, init ?? {}));
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, status);
    }
  };
}
