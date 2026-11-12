import { fetchJson } from '../http.js';
import { mean, round } from '../numbers.js';
import { meanDirection } from '../wind.js';

export async function fetchWttr({ lat, lon }) {
  const params = new URLSearchParams({ format: 'j1' });
  const data = await fetchJson(
    `https://wttr.in/${lat.toFixed(3)},${lon.toFixed(3)}?${params}`,
    {
      timeout: 12_000,
      headers: { Accept: 'application/json' },
    },
  );

  if (!Array.isArray(data?.weather) || !data.weather.length) {
    throw new Error('wttr.in returned no forecast');
  }

  const days = data.weather
    .map((day) => {
      const tMin = Number(day.mintempC);
      const tMax = Number(day.maxtempC);
      if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) return null;

      const hourly = Array.isArray(day.hourly) ? day.hourly : [];
      const humidity = hourly.map((hour) => Number(hour.humidity)).filter(Number.isFinite);
      const wind = hourly.map((hour) => Number(hour.windspeedKmph)).filter(Number.isFinite);
      const windDir = hourly.map((hour) => Number(hour.winddirDegree)).filter(Number.isFinite);
      const precip = hourly.map((hour) => Number(hour.precipMM)).filter(Number.isFinite);

      return {
        date: day.date,
        tMin: round(tMin, 1),
        tMax: round(tMax, 1),
        tMean: round(Number.isFinite(Number(day.avgtempC)) ? Number(day.avgtempC) : (tMin + tMax) / 2, 1),
        windMean: round(mean(wind), 1),
        windMax: round(wind.length ? Math.max(...wind) : null, 1),
        windDir: round(meanDirection(windDir), 0),
        humidity: round(mean(humidity), 0),
        precip: round(precip.reduce((total, value) => total + value, 0), 1),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    timezone: null,
    days,
    note: 'wttr.in serves a three-day forecast.',
  };
}
