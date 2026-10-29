import { max, mean, min, round } from './numbers.js';
import { todayInZone } from './time.js';

function block(values, digits) {
  return {
    avg: round(mean(values), digits),
    min: round(min(values), digits),
    max: round(max(values), digits),
  };
}

function tempBlock(days) {
  const means = days.map((day) => day.tMean).filter(Number.isFinite);
  const lows = days.map((day) => day.tMin).filter(Number.isFinite);
  const highs = days.map((day) => day.tMax).filter(Number.isFinite);
  const average = mean(means);
  const disagreement =
    means.length > 1 ? Math.max(...means) - Math.min(...means) : null;

  return {
    avg: round(average, 1),
    min: round(min(lows), 1),
    max: round(max(highs), 1),
    disagreement: round(disagreement, 1),
  };
}

export function aggregateForecast(results, { timezone = 'UTC', days = 7 } = {}) {
  const byDate = new Map();

  for (const result of results) {
    if (!result.ok) continue;
    for (const day of result.days ?? []) {
      if (!day?.date) continue;
      if (!byDate.has(day.date)) byDate.set(day.date, []);
      byDate.get(day.date).push({ sourceId: result.id, day });
    }
  }

  const today = todayInZone(timezone);
  const dates = [...byDate.keys()].filter((date) => date >= today).sort().slice(0, days);

  const daily = dates.map((date) => {
    const entries = byDate.get(date) ?? [];
    const sourceDays = entries.map((entry) => entry.day);
    const temp = tempBlock(sourceDays);
    const wind = block(
      sourceDays.map((day) => day.windMean),
      1,
    );
    const humidity = block(
      sourceDays.map((day) => day.humidity),
      0,
    );
    const precip = block(
      sourceDays.map((day) => day.precip),
      1,
    );

    return {
      date,
      sourceCount: entries.filter((entry) => Number.isFinite(entry.day.tMean)).length,
      temp,
      wind,
      humidity,
      precip,
    };
  });

  return {
    timezone,
    today,
    daily,
    sources: results.map((result) => ({
      id: result.id,
      name: result.name,
      adapter: result.adapter,
      model: result.model ?? null,
      ok: result.ok,
      error: result.error ?? null,
      stale: Boolean(result.stale),
      note: result.note ?? null,
      fetchedAt: result.fetchedAt,
      days: result.days ?? [],
      dayCount: result.days?.length ?? 0,
    })),
  };
}
