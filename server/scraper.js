import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { fetchText } from '../public/lib/http.js';
import { CATALOG_BY_ID } from '../public/lib/catalog.js';
import {
  PUBLIC_APIS_URL,
  buildDoc,
  catalogPayload,
  defaultCatalogIds,
  fallbackDoc,
  isFresh,
  parsePublicApisMarkdown,
} from '../public/lib/scraper-core.js';

export { PUBLIC_APIS_URL, parsePublicApisMarkdown };

const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');

let catalogDoc = null;
let pending = null;

async function readCachedDoc() {
  try {
    const doc = JSON.parse(await fs.readFile(CATALOG_FILE, 'utf8'));
    if (!doc || !Array.isArray(doc.entries) || !Array.isArray(doc.supportedIds)) return null;
    return doc;
  } catch {
    return null;
  }
}

async function writeCatalogDoc(doc) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CATALOG_FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

export async function ensureCatalog({ force = false } = {}) {
  if (!force && catalogDoc && isFresh(catalogDoc)) return catalogDoc;
  if (pending) return pending;

  pending = (async () => {
    const cached = await readCachedDoc();
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
      await writeCatalogDoc(doc);
      return doc;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cached) {
        catalogDoc = { ...cached, stale: true, error: message };
        return catalogDoc;
      }
      catalogDoc = fallbackDoc(message);
      await writeCatalogDoc(catalogDoc);
      return catalogDoc;
    }
  })();

  try {
    return await pending;
  } finally {
    pending = null;
  }
}

export async function getCatalog({ refresh = false } = {}) {
  return catalogPayload(await ensureCatalog({ force: refresh }));
}

export function getDefaultCatalogIds() {
  return defaultCatalogIds(catalogDoc);
}

export function getCatalogEntry(catalogId) {
  return CATALOG_BY_ID.get(catalogId) ?? null;
}
