import { resolveTimezone } from './timezone.js';
import { runAdapter } from './adapters/index.js';
import { aggregateForecast } from './aggregate.js';
import { cached } from './cache.js';

const FORECAST_TTL_MS = 5 * 60 * 1000;
const SOURCE_TTL_MS = 15 * 60 * 1000;

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function runSource(source, context, { refresh = false } = {}) {
  const key = [
    source.id,
    source.adapter,
    source.model ?? '',
    context.lat.toFixed(2),
    context.lon.toFixed(2),
    context.days,
    context.timezone,
  ].join(':');

  try {
    const result = await cached(
      'source',
      key,
      SOURCE_TTL_MS,
      async () => {
        const value = await runAdapter(source, context);
        return { ...value, fetchedAt: new Date().toISOString() };
      },
      { refresh },
    );

    return {
      id: source.id,
      name: source.name,
      adapter: source.adapter,
      model: source.model ?? null,
      ok: true,
      days: result.value.days ?? [],
      note: result.value.note ?? null,
      fetchedAt: result.value.fetchedAt,
      stale: result.stale,
      staleReason: result.error ?? null,
    };
  } catch (error) {
    return {
      id: source.id,
      name: source.name,
      adapter: source.adapter,
      model: source.model ?? null,
      ok: false,
      days: [],
      error: error instanceof Error ? error.message : String(error),
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
  }
}

/**
 * Build a forecast from an explicit source list so the same aggregation can run
 * in the Node server and directly inside the Android app.
 */
export async function runForecast({ sources, lat, lon, days = 7, refresh = false }) {
  if (!sources.length) {
    throw requestError('Add at least one weather service to build a forecast', 409);
  }

  const timezoneInfo = await resolveTimezone(lat, lon);
  const timezone = timezoneInfo.timezone;
  const fingerprint = sources
    .filter((source) => source.enabled)
    .map((source) => `${source.id}:${source.adapter}:${source.model || ''}`)
    .sort()
    .join('|');
  const key = `${lat.toFixed(2)}:${lon.toFixed(2)}:${days}:${timezone}:${fingerprint}`;

  const outer = await cached(
    'forecast',
    key,
    FORECAST_TTL_MS,
    async () => {
      const results = await Promise.all(
        sources.map((source) =>
          runSource(
            source,
            {
              lat,
              lon,
              days,
              timezone,
            },
            { refresh },
          ),
        ),
      );

      const aggregated = aggregateForecast(results, { timezone, days });

      return {
        location: {
          lat,
          lon,
          timezone,
          timezoneAbbreviation: timezoneInfo.abbreviation,
          approximatedTimezone: Boolean(timezoneInfo.approximated),
        },
        generatedAt: new Date().toISOString(),
        today: aggregated.today,
        days,
        daily: aggregated.daily,
        sources: aggregated.sources,
      };
    },
    { refresh },
  );

  const response = outer.value;
  if (outer.stale) {
    return {
      ...response,
      stale: true,
      warning: 'The forecast services could not be reached. Showing the last cached forecast.',
    };
  }
  return response;
}
