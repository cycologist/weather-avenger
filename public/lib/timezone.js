import { approximateTimezone } from './time.js';
import { fetchJson } from './http.js';
import { cacheGet, cacheSet } from './cache.js';

const TTL_MS = 24 * 60 * 60 * 1000;

export async function resolveTimezone(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = cacheGet('timezone', key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const fallback = {
    timezone: approximateTimezone(lon),
    abbreviation: 'local',
    offsetSeconds: Math.round(lon / 15) * 3600,
    approximated: true,
  };

  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: 'temperature_2m',
      timezone: 'auto',
      forecast_days: '1',
    });
    const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`, {
      timeout: 7000,
    });
    const value = {
      timezone: data.timezone || fallback.timezone,
      abbreviation: data.timezone_abbreviation || 'local',
      offsetSeconds: Number.isFinite(data.utc_offset_seconds)
        ? data.utc_offset_seconds
        : fallback.offsetSeconds,
      approximated: false,
    };
    cacheSet('timezone', key, value, TTL_MS);
    return value;
  } catch {
    cacheSet('timezone', key, fallback, 60 * 60 * 1000);
    return fallback;
  }
}
