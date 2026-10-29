import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { CATALOG_BY_ID } from '../public/lib/catalog.js';
import { getDefaultCatalogIds } from './scraper.js';

const SOURCES_FILE = path.join(DATA_DIR, 'sources.json');

let sources = null;
let queue = Promise.resolve();

function makeSource(catalogEntry, origin = 'catalog') {
  return {
    id: catalogEntry.id,
    catalogId: catalogEntry.id,
    name: catalogEntry.name,
    adapter: catalogEntry.adapter,
    model: catalogEntry.model ?? null,
    enabled: true,
    addedAt: new Date().toISOString(),
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

async function persist() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${SOURCES_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(sources, null, 2)}\n`, 'utf8');
  await fs.rename(tempFile, SOURCES_FILE);
}

function validateSources(value) {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (source) =>
      source &&
      typeof source.id === 'string' &&
      typeof source.adapter === 'string' &&
      typeof source.name === 'string',
  );
}

async function seedSources() {
  const ids = getDefaultCatalogIds();
  const seeded = [];
  for (const id of ids) {
    const entry = CATALOG_BY_ID.get(id);
    if (!entry) continue;
    seeded.push({ ...makeSource(entry, 'scraped'), enabled: true });
  }
  sources = seeded;
  await persist();
  return sources;
}

export async function ensureSources() {
  if (sources) return sources;

  try {
    const raw = await fs.readFile(SOURCES_FILE, 'utf8');
    const parsed = validateSources(JSON.parse(raw));
    if (parsed) {
      sources = parsed;
      return sources;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[sources] Could not read ${SOURCES_FILE}:`, error.message);
    }
  }

  return seedSources();
}

export async function listSources() {
  return ensureSources();
}

export async function enabledSources() {
  const list = await ensureSources();
  return list.filter((source) => source.enabled);
}

export function sourcesFingerprint(list) {
  return list
    .filter((source) => source.enabled)
    .map((source) => `${source.id}:${source.adapter}:${source.model || ''}`)
    .sort()
    .join('|');
}

function mutate(change) {
  const run = queue.then(async () => {
    const list = await ensureSources();
    const result = await change(list);
    await persist();
    return result;
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function addSource(catalogId) {
  const catalogEntry = CATALOG_BY_ID.get(catalogId);
  if (!catalogEntry) {
    const error = new Error('That weather service is not in the catalog');
    error.status = 404;
    throw error;
  }

  return mutate((list) => {
    if (list.some((source) => source.catalogId === catalogId)) {
      const error = new Error('That weather service is already in your menu');
      error.status = 409;
      throw error;
    }
    const source = makeSource(catalogEntry, catalogEntry.variant ? 'bundled' : 'user');
    list.push(source);
    return source;
  });
}

export async function patchSource(id, changes) {
  return mutate((list) => {
    const source = list.find((item) => item.id === id);
    if (!source) {
      const error = new Error('Weather service not found');
      error.status = 404;
      throw error;
    }
    if (typeof changes.enabled === 'boolean') source.enabled = changes.enabled;
    return source;
  });
}

export async function deleteSource(id) {
  return mutate((list) => {
    const index = list.findIndex((item) => item.id === id);
    if (index === -1) {
      const error = new Error('Weather service not found');
      error.status = 404;
      throw error;
    }
    const [removed] = list.splice(index, 1);
    return removed;
  });
}
