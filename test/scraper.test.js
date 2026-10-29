import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicApisMarkdown } from '../server/scraper.js';
import { matchCatalogEntry } from '../public/lib/catalog.js';

const MARKDOWN = `# Public APIs

### Weather

| API | Description | Auth | HTTPS | CORS |
| --- | --- | --- | --- | --- |
| [Open-Meteo](https://open-meteo.com/) | Global weather forecast API | No | Yes | Yes |
| [7Timer!](http://www.7timer.info/doc.php?lang=en) | Weather, especially for Astroweather | No | No | Unknown |
| [Meteorologisk Institutt](https://api.met.no/weatherapi/documentation) | Weather &amp; climate data | User-Agent | Yes | Unknown |
| [wttr.in](https://wttr.in/:help) | Weather in your terminal | No | Yes | Yes |
| [Weatherstack](https://weatherstack.com/) | Real-time &amp; historical weather | apiKey | Yes | Unknown |
| [Open-Meteo Ensemble](https://open-meteo.com/) | Ensemble forecasts | No | Yes | Yes |
| [Some Other Service](https://weather.example.com/) | Not matched by host | No | Yes | Yes |

### Other

| API | Description | Auth | HTTPS | CORS |
| --- | --- | --- | --- | --- |
| [Not Weather](https://example.org/) | Should be ignored | No | Yes | Yes |
`;

test('parses rows from the Weather section only', () => {
  const entries = parsePublicApisMarkdown(MARKDOWN);
  assert.equal(entries.length, 7);
  assert.equal(entries[0].name, 'Open-Meteo');
  assert.equal(entries[0].url, 'https://open-meteo.com/');
  assert.equal(entries[0].auth, 'No');
  assert.equal(entries[0].https, true);
  assert.equal(entries[0].cors, 'Yes');
  assert.equal(entries[5].name, 'Open-Meteo Ensemble');
  assert.ok(entries.every((entry) => !entry.name.includes('Not Weather')));
});

test('decodes entities in names and descriptions', () => {
  const entries = parsePublicApisMarkdown(MARKDOWN);
  const met = entries.find((entry) => entry.name === 'Meteorologisk Institutt');
  assert.equal(met.description, 'Weather & climate data');
  const stack = entries.find((entry) => entry.name === 'Weatherstack');
  assert.equal(stack.description, 'Real-time & historical weather');
});

test('matches supported hosts and ignores ensemble and unrelated services', () => {
  const entries = parsePublicApisMarkdown(MARKDOWN);
  const matched = entries.filter((entry) => entry.catalogId);

  assert.deepEqual(
    matched.map((entry) => entry.catalogId),
    ['open-meteo', 'seven-timer', 'met-no', 'wttr'],
  );
  assert.equal(entries.find((entry) => entry.name === 'Open-Meteo Ensemble').catalogId, null);
  assert.equal(entries.find((entry) => entry.name === 'Weatherstack').catalogId, null);
});

test('returns an empty list when the Weather heading is missing', () => {
  assert.deepEqual(parsePublicApisMarkdown('# Something else\n\nNo table here.'), []);
});

test('matchCatalogEntry handles subdomains and case', () => {
  assert.equal(matchCatalogEntry({ name: 'Anything', url: 'https://api.met.no/weatherapi' }), 'met-no');
  assert.equal(matchCatalogEntry({ name: 'Wttr.IN', url: 'https://example.com/' }), 'wttr');
  assert.equal(matchCatalogEntry({ name: 'Weather', url: 'https://openweathermap.org/' }), null);
});
