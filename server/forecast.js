import { enabledSources } from './store.js';
import { runForecast } from '../public/lib/forecast.js';

export async function buildForecast({ lat, lon, days = 7, refresh = false }) {
  const sources = await enabledSources();
  return runForecast({ sources, lat, lon, days, refresh });
}
