import { fetchJson } from '../http.js';
import { mean, round } from '../numbers.js';

export async function fetchOpenMeteo({ lat, lon, days = 7, model = null }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max',
    hourly: 'relative_humidity_2m,wind_speed_10m',
    timezone: 'auto',
    forecast_days: String(Math.min(16, Math.max(1, days))),
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  });
  if (model) params.set('models', model);

  const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`, {
    timeout: 12_000,
  });

  const humidityByDate = new Map();
  const windByDate = new Map();
  const hourlyTimes = data.hourly?.time ?? [];

  hourlyTimes.forEach((time, index) => {
    const date = time.slice(0, 10);
    const humidity = data.hourly?.relative_humidity_2m?.[index];
    const wind = data.hourly?.wind_speed_10m?.[index];

    if (Number.isFinite(humidity)) {
      if (!humidityByDate.has(date)) humidityByDate.set(date, []);
      humidityByDate.get(date).push(humidity);
    }
    if (Number.isFinite(wind)) {
      if (!windByDate.has(date)) windByDate.set(date, []);
      windByDate.get(date).push(wind);
    }
  });

  const daily = data.daily;
  if (!daily?.time?.length) throw new Error('Open-Meteo returned no daily forecast');

  const normalized = daily.time.map((date, index) => {
    const tMax = daily.temperature_2m_max?.[index];
    const tMin = daily.temperature_2m_min?.[index];
    if (!Number.isFinite(tMax) || !Number.isFinite(tMin)) return null;

    const humidityValues = humidityByDate.get(date) ?? [];
    const windValues = windByDate.get(date) ?? [];
    const windMaxDaily = daily.wind_speed_10m_max?.[index];
    const windMax = Number.isFinite(windMaxDaily) ? windMaxDaily : windValues.length ? Math.max(...windValues) : null;

    return {
      date,
      tMin: round(tMin, 1),
      tMax: round(tMax, 1),
      tMean: round((tMin + tMax) / 2, 1),
      windMean: round(mean(windValues), 1),
      windMax: round(windMax, 1),
      humidity: round(mean(humidityValues), 0),
      precip: round(daily.precipitation_sum?.[index], 1),
    };
  });

  return {
    timezone: data.timezone || 'UTC',
    days: normalized.filter(Boolean),
  };
}
