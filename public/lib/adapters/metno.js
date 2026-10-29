import { fetchJson } from '../http.js';
import { dateKeyInZone } from '../time.js';
import { mean, round } from '../numbers.js';

export async function fetchMetNo({ lat, lon, timezone = 'UTC' }) {
  const params = new URLSearchParams({
    lat: lat.toFixed(4),
    lon: lon.toFixed(4),
  });
  const data = await fetchJson(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?${params}`,
    { timeout: 12_000 },
  );

  const series = data?.properties?.timeseries;
  if (!Array.isArray(series) || !series.length) {
    throw new Error('MET Norway returned no forecast');
  }

  const groups = new Map();
  for (const entry of series) {
    const date = dateKeyInZone(entry.time, timezone);
    if (!date) continue;
    if (!groups.has(date)) {
      groups.set(date, { temp: [], humidity: [], wind: [], precip: 0 });
    }
    const group = groups.get(date);
    const details = entry.data?.instant?.details ?? {};

    if (Number.isFinite(details.air_temperature)) group.temp.push(details.air_temperature);
    if (Number.isFinite(details.relative_humidity)) group.humidity.push(details.relative_humidity);
    if (Number.isFinite(details.wind_speed)) group.wind.push(details.wind_speed);

    let amount = entry.data?.next_1_hours?.details?.precipitation_amount;
    if (!Number.isFinite(amount)) {
      const sixHour = entry.data?.next_6_hours?.details?.precipitation_amount;
      if (Number.isFinite(sixHour)) amount = sixHour / 6;
    }
    if (Number.isFinite(amount)) group.precip += amount;
  }

  const days = [...groups.entries()]
    .filter(([, group]) => group.temp.length)
    .map(([date, group]) => ({
      date,
      tMin: round(Math.min(...group.temp), 1),
      tMax: round(Math.max(...group.temp), 1),
      tMean: round(mean(group.temp), 1),
      windMean: round(mean(group.wind) * 3.6, 1),
      windMax: round(Math.max(...group.wind) * 3.6, 1),
      humidity: round(mean(group.humidity), 0),
      precip: round(group.precip, 1),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    timezone,
    days,
    note: 'Precipitation after day three is derived from six-hour totals.',
  };
}
