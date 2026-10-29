import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, PORT, PUBLIC_DIR, USER_AGENT } from './config.js';
import { ensureCatalog, getCatalog } from './scraper.js';
import {
  addSource,
  deleteSource,
  ensureSources,
  listSources,
  patchSource,
} from './store.js';
import { buildForecast } from './forecast.js';
import { reversePlace, searchPlaces } from '../public/lib/geocode.js';
import { HttpError, setUserAgent } from '../public/lib/http.js';

setUserAgent(USER_AGENT);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseCoordinate(value, name, low, high) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < low || number > high) {
    throw new HttpError(`${name} must be a number between ${low} and ${high}`, 400);
  }
  return number;
}

function parseLocation(req) {
  return {
    lat: parseCoordinate(req.query.lat, 'lat', -90, 90),
    lon: parseCoordinate(req.query.lon, 'lon', -180, 180),
  };
}

app.get('/api/health', asyncRoute(async (req, res) => {
  const sources = await listSources();
  res.json({
    ok: true,
    sources: sources.length,
    enabled: sources.filter((source) => source.enabled).length,
    userAgent: USER_AGENT,
  });
}));

app.get('/api/sources', asyncRoute(async (req, res) => {
  const sources = await listSources();
  res.json({
    sources,
    meta: {
      total: sources.length,
      enabled: sources.filter((source) => source.enabled).length,
    },
  });
}));

app.post('/api/sources', asyncRoute(async (req, res) => {
  const catalogId = typeof req.body?.catalogId === 'string' ? req.body.catalogId : '';
  if (!catalogId) throw new HttpError('catalogId is required', 400);
  const source = await addSource(catalogId);
  res.status(201).json({ source });
}));

app.patch('/api/sources/:id', asyncRoute(async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    throw new HttpError('enabled must be a boolean', 400);
  }
  const source = await patchSource(req.params.id, { enabled: req.body.enabled });
  res.json({ source });
}));

app.delete('/api/sources/:id', asyncRoute(async (req, res) => {
  const source = await deleteSource(req.params.id);
  res.json({ ok: true, source });
}));

app.get('/api/catalog', asyncRoute(async (req, res) => {
  res.json(await getCatalog());
}));

app.post('/api/catalog/refresh', asyncRoute(async (req, res) => {
  res.json(await getCatalog({ refresh: true }));
}));

app.get('/api/forecast', asyncRoute(async (req, res) => {
  const { lat, lon } = parseLocation(req);
  const requestedDays = Number(req.query.days ?? 7);
  const days = Number.isFinite(requestedDays) ? Math.max(1, Math.min(10, Math.round(requestedDays))) : 7;
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const forecast = await buildForecast({ lat, lon, days, refresh });
  res.setHeader('Cache-Control', 'no-store');
  res.json(forecast);
}));

app.get('/api/geocode', asyncRoute(async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  if (query.trim().length < 2) {
    res.json({ results: [] });
    return;
  }
  const results = await searchPlaces(query);
  res.json({ results });
}));

app.get('/api/reverse', asyncRoute(async (req, res) => {
  const { lat, lon } = parseLocation(req);
  const place = await reversePlace(lat, lon);
  res.json({ place });
}));

app.use(
  '/data',
  express.static(path.join(PUBLIC_DIR, 'data'), {
    maxAge: '7d',
    immutable: true,
    fallthrough: true,
  }),
);

app.use(
  express.static(PUBLIC_DIR, {
    maxAge: '1h',
    index: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next(new HttpError('Not found', 404));
    return;
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status >= 500) {
    console.error('[server]', error);
  }
  res.status(status).json({
    error: error instanceof Error ? error.message : 'Something went wrong',
  });
});

export async function start() {
  await ensureCatalog();
  await ensureSources();
  const catalog = await getCatalog();
  if (catalog.meta.fallback) {
    console.warn('[catalog] Scraper unavailable — using the bundled source list.');
  } else {
    console.log(
      `[catalog] ${catalog.meta.scanned} free weather APIs scanned, ${catalog.meta.matched} supported.`,
    );
  }

  const server = app.listen(PORT, () => {
    console.log(`Avercast is running at http://localhost:${PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
  });
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  start().catch((error) => {
    console.error('[startup]', error);
    process.exitCode = 1;
  });
}

export default app;
