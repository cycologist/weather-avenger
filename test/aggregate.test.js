import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateForecast } from '../public/lib/aggregate.js';
import { todayInZone } from '../public/lib/time.js';

function dateAfter(date, offset) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function day(date, { tMin, tMax, windMean, windDir, humidity, precip }) {
  return {
    date,
    tMin,
    tMax,
    tMean: Math.round(((tMin + tMax) / 2) * 10) / 10,
    windMean,
    windDir,
    humidity,
    precip,
  };
}

function source(id, days, extra = {}) {
  return {
    id,
    name: id,
    adapter: 'test',
    model: null,
    ok: true,
    days,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    stale: false,
    ...extra,
  };
}

test('aggregates temperature as mean of means with lowest low and highest high', () => {
  const today = todayInZone('Europe/Berlin');
  const dates = [0, 1, 2].map((offset) => dateAfter(today, offset));

  const result = aggregateForecast(
    [
      source('a', [
        day(dates[0], { tMin: 4, tMax: 12, windMean: 10, humidity: 80, precip: 1.2 }),
        day(dates[1], { tMin: 6, tMax: 14, windMean: 12, humidity: 70, precip: 0 }),
        day(dates[2], { tMin: 8, tMax: 16, windMean: 8, humidity: 60, precip: 0.4 }),
      ]),
      source('b', [
        day(dates[0], { tMin: 2, tMax: 10, windMean: 20, humidity: 90, precip: 2.0 }),
        day(dates[1], { tMin: 4, tMax: 12, windMean: 16, humidity: 80, precip: 1.5 }),
        day(dates[2], { tMin: 6, tMax: 18, windMean: 10, humidity: 70, precip: 0 }),
      ]),
    ],
    { timezone: 'Europe/Berlin', days: 7 },
  );

  assert.equal(result.today, today);
  assert.equal(result.daily.length, 3);

  const first = result.daily[0];
  assert.deepEqual(first.temp, { avg: 7, min: 2, max: 12, disagreement: 2 });
  assert.deepEqual(first.wind, {
    avg: 15,
    min: 10,
    max: 20,
    direction: null,
    directionText: null,
    directionSpread: null,
    directionCount: 0,
  });
  assert.deepEqual(first.humidity, { avg: 85, min: 80, max: 90 });
  assert.deepEqual(first.precip, { avg: 1.6, min: 1.2, max: 2 });
  assert.equal(first.sourceCount, 2);

  const second = result.daily[1];
  assert.equal(second.temp.avg, 9);
  assert.equal(second.temp.disagreement, 2);
});

test('reports model disagreement and keeps per-day source counts', () => {
  const today = todayInZone('UTC');
  const result = aggregateForecast(
    [
      source('a', [day(today, { tMin: 0, tMax: 10, windMean: 5, humidity: 50, precip: 0 })]),
      source('b', [day(today, { tMin: 4, tMax: 14, windMean: 9, humidity: 60, precip: null })]),
      source('c', [], { ok: false, error: 'upstream timeout' }),
    ],
    { timezone: 'UTC', days: 7 },
  );

  assert.equal(result.daily.length, 1);
  assert.equal(result.daily[0].temp.avg, 7);
  assert.equal(result.daily[0].temp.disagreement, 4);
  assert.equal(result.daily[0].sourceCount, 2);
  assert.equal(result.daily[0].precip.avg, 0);
  assert.equal(result.sources.length, 3);
  assert.equal(result.sources[2].ok, false);
  assert.equal(result.sources[2].error, 'upstream timeout');
});

test('filters past dates, missing dates and caps the requested range', () => {
  const today = todayInZone('America/New_York');
  const result = aggregateForecast(
    [
      source('a', [
        day(dateAfter(today, -1), { tMin: 1, tMax: 2, windMean: 1, humidity: 1, precip: 0 }),
        day(dateAfter(today, 0), { tMin: 2, tMax: 4, windMean: 2, humidity: 2, precip: 0 }),
        day(dateAfter(today, 1), { tMin: 3, tMax: 5, windMean: 3, humidity: 3, precip: 0 }),
        day(dateAfter(today, 2), { tMin: 4, tMax: 6, windMean: 4, humidity: 4, precip: 0 }),
      ]),
    ],
    { timezone: 'America/New_York', days: 2 },
  );

  assert.deepEqual(
    result.daily.map((entry) => entry.date),
    [dateAfter(today, 0), dateAfter(today, 1)],
  );
});

test('a single source has no disagreement value', () => {
  const today = todayInZone('UTC');
  const result = aggregateForecast(
    [source('a', [day(today, { tMin: 5, tMax: 15, windMean: 5, humidity: 50, precip: 0 })])],
    { timezone: 'UTC', days: 1 },
  );

  assert.equal(result.daily[0].temp.avg, 10);
  assert.equal(result.daily[0].temp.disagreement, null);
});

test('averages wind bearings around the compass and reports the spread', () => {
  const today = todayInZone('UTC');
  const days = (windDir) => [
    day(today, { tMin: 5, tMax: 15, windMean: 10, windDir, humidity: 50, precip: 0 }),
  ];
  const result = aggregateForecast(
    [source('a', days(350)), source('b', days(10))],
    { timezone: 'UTC', days: 1 },
  );

  const wind = result.daily[0].wind;
  assert.equal(wind.direction, 0);
  assert.equal(wind.directionText, 'N');
  assert.equal(wind.directionSpread, 10);
  assert.equal(wind.directionCount, 2);
});

test('reports a compass label for a single wind direction', () => {
  const today = todayInZone('UTC');
  const result = aggregateForecast(
    [
      source('a', [
        day(today, { tMin: 5, tMax: 15, windMean: 10, windDir: 292.5, humidity: 50, precip: 0 }),
      ]),
    ],
    { timezone: 'UTC', days: 1 },
  );

  const wind = result.daily[0].wind;
  assert.equal(wind.direction, 293);
  assert.equal(wind.directionText, 'WNW');
  assert.equal(wind.directionCount, 1);
  assert.equal(wind.directionSpread, null);
});

test('keeps wind direction out of the consensus when sources omit it', () => {
  const today = todayInZone('UTC');
  const result = aggregateForecast(
    [
      source('a', [
        day(today, { tMin: 5, tMax: 15, windMean: 10, windDir: 90, humidity: 50, precip: 0 }),
      ]),
      source('b', [day(today, { tMin: 5, tMax: 15, windMean: 10, humidity: 50, precip: 0 })]),
    ],
    { timezone: 'UTC', days: 1 },
  );

  const wind = result.daily[0].wind;
  assert.equal(wind.direction, 90);
  assert.equal(wind.directionText, 'E');
  assert.equal(wind.directionCount, 1);
});
