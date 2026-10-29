import { fetchJson } from './http.js';
import { cacheGet, cacheSet } from './cache.js';

const SEARCH_TTL_MS = 60 * 60 * 1000;
const REVERSE_TTL_MS = 24 * 60 * 60 * 1000;

export async function searchPlaces(query) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const key = trimmed.toLowerCase();
  const cached = cacheGet('geocode-search', key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const params = new URLSearchParams({
    name: trimmed,
    count: '8',
    language: 'en',
    format: 'json',
  });
  const data = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`, {
    timeout: 9000,
  });

  const results = (data.results ?? []).map((result) => ({
    id: result.id,
    name: result.name,
    label: [result.name, result.admin1, result.country].filter(Boolean).join(', '),
    lat: result.latitude,
    lon: result.longitude,
    country: result.country ?? '',
    countryCode: result.country_code ?? '',
    admin1: result.admin1 ?? '',
    timezone: result.timezone ?? null,
  }));

  cacheSet('geocode-search', key, results, SEARCH_TTL_MS);
  return results;
}

async function reverseWithBigDataCloud(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    localityLanguage: 'en',
  });
  const data = await fetchJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?${params}`, {
    timeout: 9000,
  });

  const city = data.city || data.locality || '';
  const region = data.principalSubdivision || '';
  const country = data.countryName || '';
  const parts = [];
  for (const part of [city, region, country]) {
    if (part && !parts.includes(part)) parts.push(part);
  }

  if (!parts.length) return null;
  return {
    name: parts[0],
    label: parts.join(', '),
    city,
    region,
    country,
  };
}

async function reverseWithNominatim(lat, lon) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lon),
    zoom: '10',
    addressdetails: '1',
  });
  const data = await fetchJson(`https://nominatim.openstreetmap.org/reverse?${params}`, {
    timeout: 9000,
    headers: { Accept: 'application/json' },
  });

  if (!data?.display_name) return null;
  const address = data.address ?? {};
  const name =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    data.name ||
    data.display_name.split(',')[0];
  return {
    name,
    label: data.display_name,
    city: name,
    region: address.state || address.county || '',
    country: address.country || '',
  };
}

export async function reversePlace(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = cacheGet('geocode-reverse', key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let result = null;
  try {
    result = await reverseWithBigDataCloud(lat, lon);
  } catch {
    // Fall through to Nominatim.
  }
  if (!result) {
    try {
      result = await reverseWithNominatim(lat, lon);
    } catch {
      result = null;
    }
  }

  cacheSet('geocode-reverse', key, result, result ? REVERSE_TTL_MS : 10 * 60 * 1000);
  return result;
}
