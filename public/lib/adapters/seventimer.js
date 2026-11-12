import { fetchJson } from '../http.js';
import { dateKeyInZone } from '../time.js';
import { mean, round } from '../numbers.js';
import { compassToDegrees, meanDirection } from '../wind.js';

// 7Timer publishes wind force bands (1–8) and rain-rate bands (0–9).
// These are the band midpoints converted to km/h and mm/hour.
const WIND_BAND_KMH = [0, 0.5, 6.7, 20.5, 33.8, 50.4, 75.1, 102.8, 129.6];
const RAIN_BAND_MM_PER_HOUR = [0, 0.125, 0.625, 2.5, 7, 13, 23, 40, 62.5, 80];

function parseInit(value) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]));
}

export async function fetchSevenTimer({ lat, lon, timezone = 'UTC' }) {
  const params = new URLSearchParams({
    lon: lon.toFixed(3),
    lat: lat.toFixed(3),
    product: 'civil',
    output: 'json',
  });
  const data = await fetchJson(`https://www.7timer.info/bin/api.pl?${params}`, {
    timeout: 12_000,
  });

  const init = parseInit(data.init);
  if (!init || !Array.isArray(data.dataseries)) {
    throw new Error('7Timer! returned no forecast');
  }

  const groups = new Map();
  for (const entry of data.dataseries) {
    const timestamp = init + Number(entry.timepoint ?? 0) * 60 * 60 * 1000;
    const date = dateKeyInZone(timestamp, timezone);
    if (!date) continue;
    if (!groups.has(date)) {
      groups.set(date, { temp: [], humidity: [], wind: [], windDir: [], precip: 0 });
    }
    const group = groups.get(date);
    if (Number.isFinite(entry.temp2m)) group.temp.push(entry.temp2m);

    const humidity = Number.parseFloat(String(entry.rh2m ?? '').replace('%', ''));
    if (Number.isFinite(humidity)) group.humidity.push(humidity);

    const windBand = Number(entry.wind10m?.speed);
    if (Number.isFinite(windBand)) group.wind.push(WIND_BAND_KMH[Math.max(0, Math.min(8, windBand))]);

    const windDir = compassToDegrees(entry.wind10m?.direction);
    if (Number.isFinite(windDir)) group.windDir.push(windDir);

    const rainBand = Number(entry.prec_amount);
    if (Number.isFinite(rainBand)) {
      group.precip += RAIN_BAND_MM_PER_HOUR[Math.max(0, Math.min(9, rainBand))] * 3;
    }
  }

  const days = [...groups.entries()]
    .filter(([, group]) => group.temp.length)
    .map(([date, group]) => ({
      date,
      tMin: round(Math.min(...group.temp), 1),
      tMax: round(Math.max(...group.temp), 1),
      tMean: round(mean(group.temp), 1),
      windMean: round(mean(group.wind), 1),
      windMax: round(group.wind.length ? Math.max(...group.wind) : null, 1),
      windDir: round(meanDirection(group.windDir), 0),
      humidity: round(mean(group.humidity), 0),
      precip: round(group.precip, 1),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    timezone,
    days,
    note: 'Wind and precipitation are converted from coarse 7Timer bands.',
  };
}
