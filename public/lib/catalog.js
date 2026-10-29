export const DEFAULT_SOURCE_ORDER = ['open-meteo', 'met-no', 'seven-timer', 'wttr'];

export const CATALOG = [
  {
    id: 'open-meteo',
    name: 'Open-Meteo',
    adapter: 'openmeteo',
    model: null,
    variantLabel: 'Best match',
    description:
      'Global hourly forecasts blended from national weather models. No key, generous free tier.',
    homepage: 'https://open-meteo.com/',
    docs: 'https://open-meteo.com/en/docs',
    auth: 'None',
    license: 'CC BY 4.0',
    licenseUrl: 'https://open-meteo.com/en/license',
    coverage: 'Global · 16 days',
    color: '#2f7df6',
    default: true,
    scraped: true,
  },
  {
    id: 'open-meteo-ecmwf',
    name: 'Open-Meteo · ECMWF',
    adapter: 'openmeteo',
    model: 'ecmwf_ifs025',
    variantLabel: 'ECMWF IFS 0.25°',
    description: 'The ECMWF IFS global model, served through the same keyless Open-Meteo API.',
    homepage: 'https://open-meteo.com/',
    docs: 'https://open-meteo.com/en/docs/ecmwf-api',
    auth: 'None',
    license: 'CC BY 4.0',
    licenseUrl: 'https://open-meteo.com/en/license',
    coverage: 'Global · 15 days',
    color: '#635bff',
    variant: true,
    scraped: false,
  },
  {
    id: 'open-meteo-icon',
    name: 'Open-Meteo · ICON',
    adapter: 'openmeteo',
    model: 'icon_seamless',
    variantLabel: 'DWD ICON',
    description: 'Germany’s DWD ICON model via Open-Meteo, with high-resolution coverage over Europe.',
    homepage: 'https://open-meteo.com/',
    docs: 'https://open-meteo.com/en/docs/icon-api',
    auth: 'None',
    license: 'CC BY 4.0',
    licenseUrl: 'https://open-meteo.com/en/license',
    coverage: 'Global · 7 days',
    color: '#0e9f8a',
    variant: true,
    scraped: false,
  },
  {
    id: 'met-no',
    name: 'MET Norway',
    adapter: 'metno',
    variantLabel: 'Locationforecast',
    description:
      'The Norwegian Meteorological Institute’s global forecast, with hourly detail for the first days.',
    homepage: 'https://www.met.no/en',
    docs: 'https://api.met.no/weatherapi/locationforecast/2.0/documentation',
    auth: 'User-Agent',
    license: 'CC BY 4.0',
    licenseUrl: 'https://www.met.no/en/free-meteorological-data/Licensing-and-crediting',
    coverage: 'Global · 10 days',
    color: '#f97316',
    default: true,
    scraped: true,
  },
  {
    id: 'seven-timer',
    name: '7Timer!',
    adapter: 'seventimer',
    variantLabel: 'Civil',
    description:
      'A lightweight keyless forecast with 3-hour steps. Wind and rain are published in coarse bands.',
    homepage: 'https://www.7timer.info/',
    docs: 'https://www.7timer.info/doc.php?lang=en',
    auth: 'None',
    license: 'Free, no key',
    coverage: 'Global · 8 days',
    color: '#eab308',
    default: true,
    scraped: true,
  },
  {
    id: 'wttr',
    name: 'wttr.in',
    adapter: 'wttr',
    variantLabel: 'WorldWeatherOnline',
    description:
      'A terminal-friendly weather service with a compact 3-day JSON forecast. Global and keyless.',
    homepage: 'https://wttr.in/:help',
    docs: 'https://wttr.in/:help',
    auth: 'None',
    license: 'Free, no key',
    coverage: 'Global · 3 days',
    color: '#0ea5e9',
    default: true,
    scraped: true,
  },
];

export const CATALOG_BY_ID = new Map(CATALOG.map((entry) => [entry.id, entry]));

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function matchCatalogEntry(discovered) {
  const host = safeHost(discovered.url);
  const name = (discovered.name || '').toLowerCase();

  if (host === 'open-meteo.com' && name.startsWith('open-meteo') && !name.includes('ensemble')) {
    return 'open-meteo';
  }
  if (host === '7timer.info' || name.includes('7timer')) return 'seven-timer';
  if (host === 'met.no' || host.endsWith('.met.no') || name.includes('meteorologisk institutt')) {
    return 'met-no';
  }
  if (host === 'wttr.in' || name.includes('wttr.in')) return 'wttr';
  return null;
}

export function toPublicCatalogEntry(entry, { discovered, scrapedEntry } = {}) {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    homepage: entry.homepage,
    docs: entry.docs,
    auth: entry.auth,
    license: entry.license,
    licenseUrl: entry.licenseUrl,
    coverage: entry.coverage,
    color: entry.color,
    variantLabel: entry.variantLabel,
    variant: Boolean(entry.variant),
    discovered: Boolean(discovered),
    scrapedName: scrapedEntry?.name ?? null,
    scrapedDescription: scrapedEntry?.description ?? null,
  };
}
