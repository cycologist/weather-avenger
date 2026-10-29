import { createWorldMap } from '/map.js';
import { installLocalApi } from './local-api.js';

// The Android shell has no Node server; ??local=1 enables the same in-app data
// layer in a desktop browser for testing.
if (globalThis.Capacitor?.isNativePlatform?.() || new URLSearchParams(location.search).has('local')) {
  installLocalApi();
}

const DEFAULT_LOCATION = {
  lat: 52.52,
  lon: 13.405,
  name: 'Berlin',
  label: 'Berlin, Germany',
};

const STORAGE_LOCATION = 'avercast-location';
const STORAGE_THEME = 'avercast-theme';
const DAYS = 7;

const state = {
  location: loadLocation(),
  sources: [],
  sourcesLoaded: false,
  catalog: null,
  catalogBusy: false,
  catalogError: null,
  catalogTab: 'addable',
  forecast: null,
  forecastSeq: 0,
  loading: false,
  pending: null,
  map: null,
  reverseSeq: 0,
  searchSeq: 0,
  searchItems: [],
  searchTimer: null,
  confirmResolve: null,
};

const $ = (id) => document.getElementById(id);

const dom = {
  html: document.documentElement,
  sidebar: $('sidebar'),
  scrim: $('scrim'),
  menuBtn: $('menu-btn'),
  sidebarClose: $('sidebar-close'),
  sourceList: $('source-list'),
  sourcesSummary: $('sources-summary'),
  addSourceBtn: $('add-source-btn'),
  addSourceRow: $('add-source-row'),
  catalogNote: $('catalog-note'),
  locationChip: $('location-chip'),
  placeName: $('place-name'),
  placeSub: $('place-sub'),
  locateBtn: $('locate-btn'),
  refreshBtn: $('refresh-btn'),
  themeBtn: $('theme-btn'),
  content: $('content'),
  statusLine: $('status-line'),
  updatedLine: $('updated-line'),
  hero: $('hero'),
  heroDate: $('hero-date'),
  heroTemp: $('hero-temp'),
  heroRange: $('hero-range'),
  confidenceChip: $('confidence-chip'),
  confidenceText: $('confidence-text'),
  heroSources: $('hero-sources'),
  statWind: $('stat-wind'),
  statWindRange: $('stat-wind-range'),
  statWindBar: $('stat-wind-bar'),
  statHumidity: $('stat-humidity'),
  statHumidityRange: $('stat-humidity-range'),
  statHumidityBar: $('stat-humidity-bar'),
  statPrecip: $('stat-precip'),
  statPrecipRange: $('stat-precip-range'),
  statPrecipBar: $('stat-precip-bar'),
  tempChart: $('temp-chart'),
  chartWrap: $('chart-wrap'),
  chartTooltip: $('chart-tooltip'),
  chartNote: $('chart-note'),
  dailyTable: $('daily-table'),
  dailyBody: $('daily-body'),
  forecastEmpty: $('forecast-empty'),
  forecastEmptyText: $('forecast-empty-text'),
  emptyRetry: $('empty-retry'),
  sourceBreakdown: $('source-breakdown'),
  breakdownSub: $('breakdown-sub'),
  breakdownBody: $('breakdown-body'),
  locationDialog: $('location-dialog'),
  placeSearch: $('place-search'),
  searchResults: $('search-results'),
  useMyLocation: $('use-my-location'),
  mapContainer: $('world-map'),
  mapReadout: $('map-readout'),
  selectedName: $('selected-name'),
  selectedCoords: $('selected-coords'),
  applyLocation: $('apply-location'),
  locationStatus: $('location-status'),
  sourceDialog: $('source-dialog'),
  catalogMeta: $('catalog-meta'),
  catalogTabs: $('catalog-tabs'),
  rescanBtn: $('rescan-btn'),
  catalogList: $('catalog-list'),
  confirmDialog: $('confirm-dialog'),
  confirmTitle: $('confirm-title'),
  confirmText: $('confirm-text'),
  confirmOk: $('confirm-ok'),
  confirmCancel: $('confirm-cancel'),
  toasts: $('toasts'),
};

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function loadLocation() {
  try {
    const raw = localStorage.getItem(STORAGE_LOCATION);
    if (!raw) return { ...DEFAULT_LOCATION };
    const parsed = JSON.parse(raw);
    if (isFiniteNumber(parsed?.lat) && isFiniteNumber(parsed?.lon)) {
      return {
        lat: parsed.lat,
        lon: parsed.lon,
        name: typeof parsed.name === 'string' && parsed.name ? parsed.name : null,
        label: typeof parsed.label === 'string' && parsed.label ? parsed.label : null,
      };
    }
  } catch {
    // Ignore unreadable storage and fall back to Berlin.
  }
  return { ...DEFAULT_LOCATION };
}

function saveLocation(location) {
  try {
    localStorage.setItem(
      STORAGE_LOCATION,
      JSON.stringify({
        lat: location.lat,
        lon: location.lon,
        name: location.name ?? null,
        label: location.label ?? null,
      }),
    );
  } catch {
    // Storage may be disabled; the app still works for this session.
  }
}

function preferredTheme() {
  const saved = (() => {
    try {
      return localStorage.getItem(STORAGE_THEME);
    } catch {
      return null;
    }
  })();
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function setTheme(theme, { persist = false } = {}) {
  dom.html.dataset.theme = theme;
  dom.themeBtn.setAttribute('title', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  dom.themeBtn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#07111d' : '#eef4fb');
  const statusBar = globalThis.Capacitor?.Plugins?.StatusBar;
  if (statusBar) {
    statusBar.setStyle({ style: theme === 'dark' ? 'DARK' : 'LIGHT' }).catch(() => {});
  }
  if (persist) {
    try {
      localStorage.setItem(STORAGE_THEME, theme);
    } catch {
      // Ignore.
    }
  }
}

async function api(path, options = {}) {
  const init = {
    headers: { Accept: 'application/json' },
    ...options,
  };
  if (options.body && !init.headers['Content-Type']) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
  }

  const response = await fetch(path, init);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload ?? {};
}

function elem(tag, { className, text, attrs, props } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  Object.assign(node, props ?? {});
  for (const child of children) {
    if (child) node.append(child);
  }
  return node;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function initials(name) {
  const words = String(name || '?')
    .replace(/[·!.]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function avatar(name, color, className = 'source-avatar') {
  const node = elem('span', { className, text: initials(name), attrs: { 'aria-hidden': 'true' } });
  node.style.setProperty('--source-color', color || '#1d6fe0');
  return node;
}

function rounded(value, digits = 0) {
  if (!isFiniteNumber(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatNumber(value, digits = 0) {
  const number = rounded(value, digits);
  return number === null ? '–' : String(number);
}

function formatValue(value, digits = 0, unit = '') {
  const text = formatNumber(value, digits);
  return text === '–' ? text : `${text}${unit}`;
}

function rangeText(block, { digits = 0, unit = '', suffix = '' } = {}) {
  if (!block || !isFiniteNumber(block.min) || !isFiniteNumber(block.max)) return 'No data';
  const low = formatNumber(block.min, digits);
  const high = formatNumber(block.max, digits);
  const span = low === high ? low : `${low}–${high}`;
  return `${span}${unit}${suffix ? ` ${suffix}` : ''}`;
}

function setMeter(node, value, scale) {
  if (!node) return;
  if (!isFiniteNumber(value) || !isFiniteNumber(scale) || scale <= 0) {
    node.style.width = '0%';
    return;
  }
  const percent = clamp((value / scale) * 100, value > 0 ? 2 : 0, 100);
  node.style.width = `${percent.toFixed(2)}%`;
}

function formatCoords(lat, lon) {
  const latText = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
  const lonText = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
  return `${latText} · ${lonText}`;
}

const WEEKDAY_SHORT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  timeZone: 'UTC',
});
const WEEKDAY_LONG = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  timeZone: 'UTC',
});
const MONTH_DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const FULL_DATE = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function dateObject(date) {
  return new Date(`${date}T12:00:00Z`);
}

function addDays(date, amount) {
  const value = dateObject(date);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function timeInZone(iso, timeZone, withDate = false) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      ...(withDate ? { day: 'numeric', month: 'short' } : {}),
      timeZone: timeZone || undefined,
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

function dateLabel(date) {
  return MONTH_DAY.format(dateObject(date));
}

function longDateLabel(date) {
  return FULL_DATE.format(dateObject(date));
}

function toast(message, tone = 'info', timeout = 4600) {
  if (!message) return;
  const node = elem('div', { className: `toast ${tone}`, text: message, attrs: { role: 'status' } });
  node.addEventListener('click', () => node.remove());
  dom.toasts.append(node);
  while (dom.toasts.children.length > 4) dom.toasts.firstElementChild?.remove();
  window.setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = 'opacity .2s ease, transform .2s ease';
    window.setTimeout(() => node.remove(), 220);
  }, timeout);
}

/* ------------------------------------------------------------------ */
/* Location header                                                     */
/* ------------------------------------------------------------------ */

function renderLocationHeader() {
  const { lat, lon, name, label } = state.location;
  dom.placeName.textContent = name || label || 'Pinned location';
  dom.placeSub.textContent = formatCoords(lat, lon);
  dom.locationChip.setAttribute('title', `${label || name || 'Selected location'} · ${formatCoords(lat, lon)}`);
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

function openSidebar() {
  dom.sidebar.classList.add('open');
  dom.scrim.classList.add('open');
  dom.menuBtn.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  dom.sidebar.classList.remove('open');
  dom.scrim.classList.remove('open');
  dom.menuBtn.setAttribute('aria-expanded', 'false');
}

function toggleSidebar() {
  if (dom.sidebar.classList.contains('open')) closeSidebar();
  else openSidebar();
}

function forecastSource(id) {
  return state.forecast?.sources?.find((source) => source.id === id) ?? null;
}

function renderSources() {
  const total = state.sources.length;
  const enabled = state.sources.filter((source) => source.enabled).length;
  dom.sourcesSummary.textContent =
    total === 0
      ? 'No services in the menu yet.'
      : `${enabled} of ${total} enabled · one vote each`;

  dom.sourceList.replaceChildren();

  if (!total) {
    dom.sourceList.append(
      elem('li', { className: 'source-item is-off' }, [
        elem('div', {
          className: 'source-main',
          text: 'Add a service to start comparing forecasts.',
        }),
      ]),
    );
    return;
  }

  for (const source of state.sources) {
    const result = forecastSource(source.id);
    const dotClass = result ? (result.ok ? (result.stale ? 'stale' : 'ok') : 'error') : '';
    const dot = elem('span', {
      className: `status-dot ${dotClass}`.trim(),
      attrs: { 'aria-hidden': 'true' },
    });
    if (result) {
      dot.title = !result.ok
        ? `Failed: ${result.error || 'unknown error'}`
        : result.stale
          ? 'Showing cached data'
          : 'Reporting fresh data';
    }

    const nameRow = elem('div', { className: 'source-name' }, [dot, elem('span', { text: source.name })]);
    const subtitle = source.variantLabel || source.adapter;
    const main = elem('div', { className: 'source-main' }, [
      nameRow,
      elem('div', { className: 'source-sub', text: subtitle }),
    ]);

    const toggle = elem('input', {
      attrs: {
        type: 'checkbox',
        'aria-label': `${source.enabled ? 'Disable' : 'Enable'} ${source.name}`,
      },
    });
    toggle.checked = Boolean(source.enabled);
    toggle.addEventListener('change', () => toggleSource(source, toggle));
    const switchLabel = elem('label', { className: 'switch', attrs: { title: 'Include in forecast' } }, [
      toggle,
      elem('span', { className: 'switch-track', attrs: { 'aria-hidden': 'true' } }),
    ]);

    const remove = elem(
      'button',
      {
        className: 'source-delete',
        attrs: { type: 'button', 'aria-label': `Remove ${source.name}`, title: `Remove ${source.name}` },
      },
      [icon('trash')],
    );
    remove.addEventListener('click', () => removeSource(source));

    const item = elem('li', { className: `source-item${source.enabled ? '' : ' is-off'}` }, [
      avatar(source.name, source.color),
      main,
      elem('div', { className: 'source-actions' }, [switchLabel, remove]),
    ]);
    dom.sourceList.append(item);
  }
}

function updateCatalogNote() {
  const meta = state.catalog?.meta;
  if (!meta) {
    dom.catalogNote.textContent = state.catalogError
      ? 'Source catalog unavailable — the menu still works with added services.'
      : 'Loading the source catalog…';
    return;
  }
  if (meta.fallback) {
    dom.catalogNote.textContent = `Scraper offline — using the bundled list of ${meta.scanned} weather services.`;
    return;
  }
  dom.catalogNote.textContent = `${meta.scanned} weather APIs scanned from public-apis · ${meta.matched} supported here.`;
}

async function loadSources({ quiet = false } = {}) {
  try {
    const data = await api('/api/sources');
    state.sources = Array.isArray(data.sources) ? data.sources : [];
    state.sourcesLoaded = true;
    renderSources();
    if (dom.sourceDialog.open) renderCatalog();
  } catch (error) {
    dom.sourcesSummary.textContent = 'Could not load the services menu.';
    if (!quiet) toast(error.message, 'error');
  }
}

async function toggleSource(source, input) {
  const next = input.checked;
  input.disabled = true;
  try {
    const data = await api(`/api/sources/${encodeURIComponent(source.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: next }),
    });
    Object.assign(source, data.source ?? {}, { enabled: next });
    renderSources();
    if (dom.sourceDialog.open) renderCatalog();
    toast(
      `${source.name} ${next ? 'included in' : 'excluded from'} the consensus.`,
      next ? 'success' : 'warning',
    );
    loadForecast();
  } catch (error) {
    input.checked = !next;
    input.disabled = false;
    toast(error.message, 'error');
  }
}

async function removeSource(source) {
  const confirmed = await askConfirm({
    title: 'Remove this weather service?',
    text: `${source.name} will be removed from your menu. The forecast will be rebuilt without it.`,
    confirmLabel: 'Remove',
  });
  if (!confirmed) return;

  try {
    await api(`/api/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' });
    state.sources = state.sources.filter((item) => item.id !== source.id);
    renderSources();
    if (dom.sourceDialog.open) renderCatalog();
    toast(`${source.name} removed.`, 'success');
    loadForecast();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Catalog dialog                                                      */
/* ------------------------------------------------------------------ */

function catalogMetaText() {
  const meta = state.catalog?.meta;
  dom.catalogMeta.replaceChildren();
  if (!meta) {
    dom.catalogMeta.textContent = state.catalogError
      ? `The catalog could not be loaded: ${state.catalogError}`
      : 'Loading catalog…';
    return;
  }

  const sentence = meta.fallback
    ? 'public-apis could not be reached, so the bundled source list is shown.'
    : `Scraped ${meta.scanned} entries from the public-apis Weather list · ${meta.matched} matched to supported services.`;
  dom.catalogMeta.append(document.createTextNode(`${sentence} `));

  if (meta.stale) {
    dom.catalogMeta.append(elem('span', { className: 'tag', text: 'Cached scan' }), document.createTextNode(' '));
  }

  if (meta.fetchedAt) {
    const when = timeInZone(meta.fetchedAt, undefined, true);
    if (when) dom.catalogMeta.append(document.createTextNode(`Scanned ${when}. `));
  }

  dom.catalogMeta.append(
    elem(
      'a',
      {
        text: 'View the source list',
        attrs: { href: meta.sourceUrl, target: '_blank', rel: 'noreferrer' },
      },
    ),
  );

  if (meta.error) {
    dom.catalogMeta.append(document.createTextNode(` Last error: ${meta.error}`));
  }
}

function catalogAddButton(entry, { added }) {
  if (added) {
    return elem('span', { className: 'tag good catalog-action', text: 'Added' });
  }
  const button = elem(
    'button',
    {
      className: 'btn primary small catalog-action',
      attrs: { type: 'button', 'aria-label': `Add ${entry.name}` },
    },
    [icon('plus'), elem('span', { text: 'Add' })],
  );
  button.addEventListener('click', () => addSource(entry, button));
  return button;
}

function renderAddableCatalog() {
  const entries = state.catalog?.entries ?? [];
  const added = new Set(state.sources.map((source) => source.catalogId).filter(Boolean));
  dom.catalogList.replaceChildren();

  if (!state.catalog) {
    dom.catalogList.append(
      elem('div', {
        className: 'catalog-empty',
        text: state.catalogError
          ? 'The catalog could not be loaded. Try rescanning in a moment.'
          : 'Loading the scanned catalog…',
      }),
    );
    return;
  }

  if (!entries.length) {
    dom.catalogList.append(elem('div', { className: 'catalog-empty', text: 'No supported services found.' }));
    return;
  }

  for (const entry of entries) {
    const name = elem('a', {
      text: entry.name,
      attrs: { href: entry.homepage || '#', target: '_blank', rel: 'noreferrer' },
    });
    const tags = elem('div', { className: 'catalog-tags' }, [
      entry.variant ? elem('span', { className: 'tag brand', text: 'Extra model' }) : null,
      entry.discovered ? elem('span', { className: 'tag good', text: 'Scraped' }) : null,
      elem('span', { className: 'tag', text: entry.coverage }),
      elem('span', { className: 'tag', text: entry.auth === 'None' ? 'No key' : entry.auth }),
    ]);

    const copy = elem('div', { className: 'catalog-copy' }, [
      elem('div', { className: 'catalog-name' }, [name]),
      elem('p', { className: 'catalog-desc', text: entry.description }),
      tags,
    ]);

    const item = elem(
      'div',
      { className: `catalog-item${added.has(entry.id) ? ' added' : ''}` },
      [avatar(entry.name, entry.color, 'catalog-avatar'), copy, catalogAddButton(entry, { added: added.has(entry.id) })],
    );
    dom.catalogList.append(item);
  }
}

function renderScannedCatalog() {
  const scanned = state.catalog?.scanned ?? [];
  const entriesById = new Map((state.catalog?.entries ?? []).map((entry) => [entry.id, entry]));
  const added = new Set(state.sources.map((source) => source.catalogId).filter(Boolean));
  dom.catalogList.replaceChildren();

  if (!scanned.length) {
    dom.catalogList.append(
      elem('div', { className: 'catalog-empty', text: 'Nothing was scanned. Try rescanning the source list.' }),
    );
    return;
  }

  for (const item of scanned) {
    const supported = item.catalogId ? entriesById.get(item.catalogId) : null;
    const name = elem('a', {
      text: item.name,
      attrs: { href: item.url, target: '_blank', rel: 'noreferrer' },
    });
    const tags = elem('div', { className: 'catalog-tags' }, [
      supported
        ? elem('span', { className: 'tag good', text: supported.variant ? 'Extra model' : 'Supported' })
        : elem('span', { className: 'tag', text: 'No adapter yet' }),
      elem('span', { className: 'tag', text: item.auth === 'Yes' ? 'Needs key' : item.auth === 'No' ? 'No key' : item.auth }),
      elem('span', { className: 'tag', text: item.https ? 'HTTPS' : 'HTTP' }),
    ]);

    const copy = elem('div', { className: 'catalog-copy' }, [
      elem('div', { className: 'catalog-name' }, [name]),
      elem('p', { className: 'catalog-desc', text: item.description || 'No description in the list.' }),
      tags,
    ]);

    let action = null;
    if (supported) {
      action = catalogAddButton(supported, { added: added.has(supported.id) });
    }

    dom.catalogList.append(
      elem('div', { className: `catalog-item${supported && added.has(supported.id) ? ' added' : ''}` }, [
        avatar(item.name, supported?.color || '#8fa5bb', 'catalog-avatar'),
        copy,
        action,
      ]),
    );
  }
}

function renderCatalog() {
  catalogMetaText();
  for (const button of dom.catalogTabs.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', button.dataset.tab === state.catalogTab ? 'true' : 'false');
  }
  if (state.catalogTab === 'scanned') renderScannedCatalog();
  else renderAddableCatalog();
}

async function loadCatalog({ refresh = false, quiet = false } = {}) {
  if (state.catalogBusy) return false;
  state.catalogBusy = true;
  try {
    const data = refresh
      ? await api('/api/catalog/refresh', { method: 'POST', body: '{}' })
      : await api('/api/catalog');
    state.catalog = data;
    state.catalogError = null;
    updateCatalogNote();
    if (dom.sourceDialog.open) renderCatalog();
    return true;
  } catch (error) {
    state.catalogError = error.message;
    updateCatalogNote();
    if (dom.sourceDialog.open) renderCatalog();
    if (!quiet) toast(`Catalog unavailable: ${error.message}`, 'error');
    return false;
  } finally {
    state.catalogBusy = false;
  }
}

async function addSource(entry, button) {
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.classList.add('spinning');
  }
  try {
    const data = await api('/api/sources', {
      method: 'POST',
      body: JSON.stringify({ catalogId: entry.id }),
    });
    if (data.source && !state.sources.some((source) => source.id === data.source.id)) {
      state.sources.push(data.source);
    }
    renderSources();
    renderCatalog();
    toast(`${entry.name} added to the menu.`, 'success');
    loadForecast();
  } catch (error) {
    toast(error.message, 'error');
    if (error.status === 409) {
      await loadSources({ quiet: true });
      renderCatalog();
    }
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.classList.remove('spinning');
    }
  }
}

async function rescanCatalog() {
  if (state.catalogBusy) return;
  dom.rescanBtn.disabled = true;
  dom.rescanBtn.classList.add('spinning');
  const label = dom.rescanBtn.querySelector('span');
  if (label) label.textContent = 'Rescanning…';
  try {
    const ok = await loadCatalog({ refresh: true, quiet: true });
    toast(
      ok ? 'Source list rescanned from public-apis.' : 'Rescan failed; the existing source list is still shown.',
      ok ? 'success' : 'error',
    );
  } finally {
    dom.rescanBtn.disabled = false;
    dom.rescanBtn.classList.remove('spinning');
    if (label) label.textContent = 'Rescan';
  }
}

function openSourceDialog() {
  if (!dom.sourceDialog.open) dom.sourceDialog.showModal();
  if (!state.catalog) loadCatalog();
  else renderCatalog();
}

/* ------------------------------------------------------------------ */
/* Location dialog                                                     */
/* ------------------------------------------------------------------ */

function ensureMap() {
  if (state.map) return state.map;
  state.map = createWorldMap(dom.mapContainer, {
    onPick: ({ lat, lon }) => {
      hideSearchResults();
      selectPending(lat, lon, null, { focus: false, reverse: true });
    },
  });
  return state.map;
}

function updateSelectedPlace() {
  const pending = state.pending;
  if (!pending) return;
  const label = pending.label || pending.name || 'Pinned location';
  dom.selectedName.textContent = label;
  const pieces = [formatCoords(pending.lat, pending.lon)];
  if (pending.timezone) pieces.push(pending.timezone);
  dom.selectedCoords.textContent = pieces.join(' · ');
}

function setLocationStatus(message) {
  dom.locationStatus.textContent = message || '';
}

function selectPending(lat, lon, place, { focus = false, reverse = false } = {}) {
  state.pending = {
    lat: Number(lat.toFixed(3)),
    lon: Number(lon.toFixed(3)),
    name: place?.name ?? null,
    label: place?.label ?? null,
    timezone: place?.timezone ?? null,
  };
  ensureMap().setMarker(state.pending.lat, state.pending.lon);
  if (focus) state.map.focus(state.pending.lat, state.pending.lon, 4);
  updateSelectedPlace();
  if (reverse) reversePending(state.pending.lat, state.pending.lon);
  else if (place) setLocationStatus('Ready — use this location to rebuild the forecast.');
}

async function reversePending(lat, lon) {
  const seq = ++state.reverseSeq;
  setLocationStatus('Looking up this place…');
  try {
    const data = await api(`/api/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
    if (seq !== state.reverseSeq) return;
    const pending = state.pending;
    if (!pending || Math.abs(pending.lat - lat) > 0.002 || Math.abs(pending.lon - lon) > 0.002) return;
    if (data.place?.label) {
      pending.label = data.place.label;
      pending.name = data.place.name || data.place.label.split(',')[0];
      updateSelectedPlace();
      setLocationStatus('Ready — use this location to rebuild the forecast.');
    } else {
      setLocationStatus('No nearby place name; coordinates work just as well.');
    }
  } catch {
    if (seq !== state.reverseSeq) return;
    setLocationStatus('Could not look up the place name; the coordinates still work.');
  }
}

function openLocationDialog() {
  closeSidebar();
  state.pending = { ...state.location };
  dom.searchResults.hidden = true;
  dom.searchResults.replaceChildren();
  dom.placeSearch.value = '';
  setLocationStatus('');
  if (!dom.locationDialog.open) dom.locationDialog.showModal();
  const map = ensureMap();
  map.setMarker(state.pending.lat, state.pending.lon);
  map.focus(state.pending.lat, state.pending.lon, 2.4);
  updateSelectedPlace();
}

function applyPendingLocation() {
  const pending = state.pending;
  if (!pending) return;
  const label = pending.label || pending.name || 'Pinned location';
  state.location = {
    lat: pending.lat,
    lon: pending.lon,
    name: pending.name || label.split(',')[0],
    label,
  };
  saveLocation(state.location);
  renderLocationHeader();
  if (dom.locationDialog.open) dom.locationDialog.close();
  prepareSkeletons();
  loadForecast();
  toast(`Forecast location set to ${state.location.name}.`, 'success');
}

function geolocationError(error) {
  if (error?.code === 1) return 'Location access was blocked. Allow it in your browser or pick a place on the map.';
  if (error?.code === 2) return 'Your position is unavailable right now. Pick a place on the map instead.';
  if (error?.code === 3) return 'Finding your position took too long. Try again or pick a place on the map.';
  return error?.message || 'Could not determine your location.';
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser does not expose a location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      (error) => reject(error),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

async function locateInDialog() {
  dom.useMyLocation.disabled = true;
  setLocationStatus('Asking your browser for the current position…');
  try {
    const position = await getCurrentPosition();
    const { latitude, longitude, accuracy } = position.coords;
    selectPending(latitude, longitude, null, { focus: true, reverse: true });
    setLocationStatus(
      `Found your position${Number.isFinite(accuracy) ? ` (±${Math.round(accuracy)} m)` : ''}. Looking up the place…`,
    );
  } catch (error) {
    setLocationStatus(geolocationError(error));
  } finally {
    dom.useMyLocation.disabled = false;
  }
}

async function locateAndApply() {
  dom.locateBtn.disabled = true;
  toast('Finding your current location…', 'info', 2600);
  try {
    const position = await getCurrentPosition();
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    let place = null;
    try {
      const data = await api(`/api/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
      place = data.place ?? null;
    } catch {
      place = null;
    }
    state.location = {
      lat,
      lon,
      name: place?.name || 'My location',
      label: place?.label || 'My location',
    };
    saveLocation(state.location);
    renderLocationHeader();
    prepareSkeletons();
    loadForecast();
    toast(place?.label ? `Using ${place.label}.` : 'Using your current location.', 'success');
  } catch (error) {
    toast(geolocationError(error), 'error', 6000);
  } finally {
    dom.locateBtn.disabled = false;
  }
}

/* Geocoding search */

function hideSearchResults() {
  state.searchSeq += 1;
  dom.searchResults.hidden = true;
  dom.searchResults.replaceChildren();
  state.searchItems = [];
}

async function searchPlaces(query) {
  const seq = ++state.searchSeq;
  dom.searchResults.hidden = false;
  dom.searchResults.replaceChildren(elem('div', { className: 'search-empty', text: 'Searching…' }));

  try {
    const data = await api(`/api/geocode?q=${encodeURIComponent(query)}`);
    if (seq !== state.searchSeq) return;
    state.searchItems = Array.isArray(data.results) ? data.results : [];
    renderSearchResults();
  } catch (error) {
    if (seq !== state.searchSeq) return;
    state.searchItems = [];
    dom.searchResults.replaceChildren(
      elem('div', { className: 'search-empty', text: `Search failed: ${error.message}` }),
    );
  }
}

function renderSearchResults() {
  dom.searchResults.replaceChildren();
  if (!state.searchItems.length) {
    dom.searchResults.append(
      elem('div', { className: 'search-empty', text: 'No place found. Try a nearby city or country name.' }),
    );
    dom.searchResults.hidden = false;
    return;
  }

  for (const place of state.searchItems) {
    const button = elem('button', {
      className: 'search-result',
      attrs: { type: 'button', role: 'option' },
    });
    button.append(
      elem('div', {}, [
        elem('strong', { text: place.name }),
        elem('span', { text: place.label || [place.admin1, place.country].filter(Boolean).join(', ') }),
      ]),
      icon('arrow-right'),
    );
    button.addEventListener('click', () => {
      selectPending(place.lat, place.lon, place, { focus: true });
      dom.placeSearch.value = place.name || place.label || '';
      hideSearchResults();
    });
    dom.searchResults.append(button);
  }
  dom.searchResults.hidden = false;
}

function onSearchInput() {
  window.clearTimeout(state.searchTimer);
  const query = dom.placeSearch.value.trim();
  if (query.length < 2) {
    hideSearchResults();
    return;
  }
  state.searchTimer = window.setTimeout(() => searchPlaces(query), 320);
}

/* ------------------------------------------------------------------ */
/* Confirm dialog                                                      */
/* ------------------------------------------------------------------ */

function askConfirm({ title, text, confirmLabel = 'Confirm' }) {
  if (state.confirmResolve) {
    const previous = state.confirmResolve;
    state.confirmResolve = null;
    previous(false);
  }
  dom.confirmTitle.textContent = title;
  dom.confirmText.textContent = text;
  dom.confirmOk.textContent = confirmLabel;
  if (!dom.confirmDialog.open) dom.confirmDialog.showModal();

  return new Promise((resolve) => {
    state.confirmResolve = resolve;
  });
}

function settleConfirm(value) {
  const resolve = state.confirmResolve;
  state.confirmResolve = null;
  if (dom.confirmDialog.open) dom.confirmDialog.close();
  resolve?.(value);
}

/* ------------------------------------------------------------------ */
/* Forecast rendering                                                  */
/* ------------------------------------------------------------------ */

function prepareSkeletons() {
  state.forecast = null;
  dom.dailyTable.hidden = false;
  dom.forecastEmpty.hidden = true;
  dom.dailyBody.replaceChildren(
    ...Array.from({ length: 4 }, () => {
      const row = elem('tr', { className: 'skeleton-row' });
      row.append(elem('td', { attrs: { colspan: '6' } }, [elem('span')]));
      return row;
    }),
  );
  dom.tempChart.replaceChildren(elem('div', { className: 'chart-empty', text: 'Loading temperature chart…' }));
  dom.chartTooltip.hidden = true;
  dom.breakdownBody.replaceChildren();
  dom.breakdownSub.textContent = 'How each service shaped this forecast';
  resetHero('Waiting for weather services');
  resetStats();
  dom.statusLine.textContent = 'Collecting forecasts…';
  dom.updatedLine.textContent = '';
}

function resetStats() {
  dom.statWind.textContent = '–';
  dom.statHumidity.textContent = '–';
  dom.statPrecip.textContent = '–';
  dom.statWind.classList.add('is-empty');
  dom.statHumidity.classList.add('is-empty');
  dom.statPrecip.classList.add('is-empty');
  dom.statWindRange.textContent = 'daily mean';
  dom.statHumidityRange.textContent = 'daily mean';
  dom.statPrecipRange.textContent = 'daily total';
  setMeter(dom.statWindBar, 0, 1);
  setMeter(dom.statHumidityBar, 0, 1);
  setMeter(dom.statPrecipBar, 0, 1);
}

function resetHero(message) {
  dom.heroDate.textContent = 'Consensus forecast';
  dom.heroTemp.textContent = '–';
  dom.heroTemp.classList.add('is-empty');
  dom.heroRange.textContent = message;
  dom.confidenceChip.className = 'confidence-chip';
  dom.confidenceText.textContent = 'No data';
  dom.heroSources.textContent = '–';
}

function setBusy(busy) {
  state.loading = busy;
  dom.content.classList.toggle('is-refreshing', busy && Boolean(state.forecast));
  dom.hero.setAttribute('aria-busy', busy ? 'true' : 'false');
  dom.refreshBtn.classList.toggle('spinning', busy);
  dom.refreshBtn.disabled = busy;
}

function showEmptyForecast(message) {
  resetHero(message);
  resetStats();
  dom.dailyTable.hidden = true;
  dom.dailyBody.replaceChildren();
  dom.forecastEmpty.hidden = false;
  dom.forecastEmptyText.textContent = message;
  dom.tempChart.replaceChildren(elem('div', { className: 'chart-empty', text: 'No temperature data to chart.' }));
  dom.chartTooltip.hidden = true;
  dom.statusLine.textContent = 'No forecast available';
  dom.updatedLine.textContent = '';
}

function heroDay(daily, today) {
  return daily.find((day) => day.date === today) ?? daily[0] ?? null;
}

function renderHero(day, forecast) {
  if (!day) {
    resetHero('No forecast data for this location.');
    return;
  }

  const isToday = day.date === forecast.today;
  dom.heroDate.textContent = `${isToday ? 'Today' : WEEKDAY_LONG.format(dateObject(day.date))} · ${longDateLabel(day.date)}`;
  dom.heroTemp.textContent = formatNumber(day.temp.avg, 0);
  dom.heroTemp.classList.remove('is-empty');
  dom.heroRange.textContent = `Low ${formatValue(day.temp.min, 0, '°')} · High ${formatValue(day.temp.max, 0, '°')} across ${day.sourceCount} ${day.sourceCount === 1 ? 'service' : 'services'}`;

  const disagreement = day.temp.disagreement;
  dom.confidenceChip.className = 'confidence-chip';
  if (!isFiniteNumber(disagreement)) {
    dom.confidenceText.textContent = 'Single source';
    dom.confidenceChip.title = 'Only one service reported a daily mean.';
  } else if (disagreement <= 1) {
    dom.confidenceChip.classList.add('good');
    dom.confidenceText.textContent = `Strong agreement · ±${formatNumber(disagreement, 1)}°`;
    dom.confidenceChip.title = 'Daily means differ by one degree or less.';
  } else if (disagreement <= 3) {
    dom.confidenceText.textContent = `Fair agreement · ±${formatNumber(disagreement, 1)}°`;
    dom.confidenceChip.title = 'Daily means are broadly in line.';
  } else {
    dom.confidenceChip.classList.add('wide');
    dom.confidenceText.textContent = `Wide spread · ±${formatNumber(disagreement, 1)}°`;
    dom.confidenceChip.title = 'Daily means differ noticeably; treat the average with care.';
  }

  const ok = forecast.sources.filter((source) => source.ok).length;
  const total = forecast.sources.length;
  dom.heroSources.textContent =
    ok === total ? `${total} services reporting` : `${ok} of ${total} services reporting`;

  const wind = day.wind;
  dom.statWind.textContent = formatNumber(wind.avg, 0);
  dom.statWind.classList.toggle('is-empty', !isFiniteNumber(wind.avg));
  dom.statWindRange.textContent = rangeText(wind, { suffix: 'km/h' });
  setMeter(dom.statWindBar, wind.avg, 70);

  const humidity = day.humidity;
  dom.statHumidity.textContent = formatNumber(humidity.avg, 0);
  dom.statHumidity.classList.toggle('is-empty', !isFiniteNumber(humidity.avg));
  dom.statHumidityRange.textContent = rangeText(humidity, { unit: '%' });
  setMeter(dom.statHumidityBar, humidity.avg, 100);

  const precip = day.precip;
  dom.statPrecip.textContent = formatNumber(precip.avg, 1);
  dom.statPrecip.classList.toggle('is-empty', !isFiniteNumber(precip.avg));
  dom.statPrecipRange.textContent = rangeText(precip, { digits: 1, suffix: 'mm' });
  setMeter(dom.statPrecipBar, precip.avg, 15);
}

let chartMetrics = { width: 820, height: 268 };

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  return node;
}

function chartDomain(daily) {
  const lows = daily.map((day) => day.temp.min).filter(isFiniteNumber);
  const highs = daily.map((day) => day.temp.max).filter(isFiniteNumber);
  let low = lows.length ? Math.min(...lows) : -5;
  let high = highs.length ? Math.max(...highs) : 30;
  if (high - low < 4) {
    const middle = (high + low) / 2;
    low = middle - 2;
    high = middle + 2;
  }
  const span = high - low;
  const step = span <= 7 ? 1 : span <= 16 ? 2 : 5;
  low = Math.floor((low - 1) / step) * step;
  high = Math.ceil((high + 1) / step) * step;
  return { low, high, step };
}

function showChartTooltip(node, day, x, y) {
  const weekday = WEEKDAY_LONG.format(dateObject(day.date));
  dom.chartTooltip.replaceChildren(
    elem('strong', { text: `${weekday}, ${dateLabel(day.date)}` }),
    elem('div', {
      className: 'tt-temp',
      text: `Average ${formatValue(day.temp.avg, 0, '°')} · Range ${formatValue(day.temp.min, 0, '°')}–${formatValue(day.temp.max, 0, '°')}`,
    }),
    elem('div', {
      text: `${day.sourceCount} ${day.sourceCount === 1 ? 'service' : 'services'} reporting`,
    }),
  );
  dom.chartTooltip.hidden = false;

  const svgRect = node.ownerSVGElement.getBoundingClientRect();
  const wrapRect = dom.chartWrap.getBoundingClientRect();
  const px = svgRect.left - wrapRect.left + (x / chartMetrics.width) * svgRect.width;
  const py = svgRect.top - wrapRect.top + (y / chartMetrics.height) * svgRect.height;
  const edge = Math.min(88, wrapRect.width / 2);
  dom.chartTooltip.style.left = `${clamp(px, edge, wrapRect.width - edge)}px`;
  dom.chartTooltip.style.top = `${Math.max(py, 72)}px`;
}

function renderChart(daily, today) {
  dom.tempChart.replaceChildren();
  dom.chartTooltip.hidden = true;

  if (!daily.length) {
    dom.tempChart.append(elem('div', { className: 'chart-empty', text: 'No temperature data to chart.' }));
    return;
  }

  const width = Math.max(
    300,
    Math.round(dom.tempChart.getBoundingClientRect().width || dom.chartWrap.getBoundingClientRect().width || 820),
  );
  const compact = width < 560;
  const dims = {
    width,
    height: compact ? 250 : 268,
    top: 30,
    right: compact ? 12 : 20,
    bottom: 48,
    left: compact ? 36 : 44,
  };
  chartMetrics = { width: dims.width, height: dims.height };

  const { low, high, step } = chartDomain(daily);
  const innerWidth = dims.width - dims.left - dims.right;
  const innerHeight = dims.height - dims.top - dims.bottom;
  const count = daily.length;
  const xFor = (index) =>
    count === 1 ? dims.left + innerWidth / 2 : dims.left + (index / (count - 1)) * innerWidth;
  const yFor = (value) => dims.top + ((high - value) / (high - low || 1)) * innerHeight;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${dims.width} ${dims.height}`,
    role: 'img',
    'aria-label': `Seven day temperature consensus: ${daily
      .map((day) => `${WEEKDAY_SHORT.format(dateObject(day.date))} ${formatValue(day.temp.avg, 0, ' degrees')}`)
      .join(', ')}`,
    preserveAspectRatio: 'xMidYMid meet',
  });

  const defs = svgEl('defs');
  const gradient = svgEl('linearGradient', {
    id: 'tempBandGradient',
    x1: '0',
    y1: '0',
    x2: '0',
    y2: '1',
  });
  gradient.append(
    svgEl('stop', { offset: '0%', 'stop-color': 'var(--chart-line)', 'stop-opacity': '0.24' }),
    svgEl('stop', { offset: '100%', 'stop-color': 'var(--chart-line)', 'stop-opacity': '0.03' }),
  );
  defs.append(gradient);
  svg.append(defs);

  for (let value = low; value <= high + 0.001; value += step) {
    const y = yFor(value);
    svg.append(
      svgEl('line', {
        class: 'chart-grid-line',
        x1: dims.left,
        y1: y,
        x2: dims.width - dims.right,
        y2: y,
      }),
    );
    const label = svgEl('text', {
      class: 'chart-axis-label',
      x: dims.left - 9,
      y: y + 3.5,
      'text-anchor': 'end',
    });
    label.textContent = `${value}°`;
    svg.append(label);
  }

  const todayIndex = daily.findIndex((day) => day.date === today);
  if (todayIndex >= 0) {
    const x = xFor(todayIndex);
    svg.append(
      svgEl('line', {
        class: 'chart-today-line',
        x1: x,
        y1: dims.top,
        x2: x,
        y2: dims.top + innerHeight,
      }),
    );
  }

  if (daily.every((day) => isFiniteNumber(day.temp.min) && isFiniteNumber(day.temp.max))) {
    const topPoints = daily.map((day, index) => `${xFor(index).toFixed(2)} ${yFor(day.temp.max).toFixed(2)}`);
    const bottomPoints = daily
      .map((day, index) => ({ day, index }))
      .reverse()
      .map(({ day, index }) => `${xFor(index).toFixed(2)} ${yFor(day.temp.min).toFixed(2)}`);
    const bandPath = `M${topPoints.join('L')}L${bottomPoints.join('L')}Z`;
    svg.append(svgEl('path', { class: 'chart-band', d: bandPath }));
  }

  const averagePoints = daily
    .map((day, index) => ({ day, index, x: xFor(index), y: yFor(day.temp.avg) }))
    .filter((point) => isFiniteNumber(point.day.temp.avg));

  if (averagePoints.length) {
    const path = averagePoints.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join('L');
    svg.append(svgEl('path', { class: 'chart-line', d: `M${path}` }));
    for (const point of averagePoints) {
      svg.append(svgEl('circle', { class: 'chart-dot', cx: point.x, cy: point.y, r: 4.2 }));
    }
  }

  const slotWidth = innerWidth / Math.max(count, 1);
  daily.forEach((day, index) => {
    const x = xFor(index);
    const area = svgEl('rect', {
      class: 'chart-hover-area',
      x: x - slotWidth / 2,
      y: dims.top,
      width: slotWidth,
      height: innerHeight,
      'aria-label': `${longDateLabel(day.date)}, average ${formatValue(day.temp.avg, 0, ' degrees')}`,
    });
    const show = () => showChartTooltip(area, day, x, yFor(day.temp.avg) - 10);
    area.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') show();
    });
    area.addEventListener('pointerdown', show);
    area.addEventListener('pointerleave', (event) => {
      // Touch has no hover; keep the tooltip until the next tap.
      if (event.pointerType === 'mouse') dom.chartTooltip.hidden = true;
    });
    svg.append(area);

    const dayLabel = svgEl('text', {
      class: index === todayIndex ? 'chart-day-label' : 'chart-date-label',
      x,
      y: dims.height - dims.bottom + 20,
      'text-anchor': 'middle',
    });
    dayLabel.textContent = day.date === today ? 'Today' : WEEKDAY_SHORT.format(dateObject(day.date));
    svg.append(dayLabel);

    const dateLabelNode = svgEl('text', {
      class: 'chart-date-label',
      x,
      y: dims.height - dims.bottom + 35,
      'text-anchor': 'middle',
    });
    dateLabelNode.textContent = dateLabel(day.date);
    svg.append(dateLabelNode);
  });

  dom.tempChart.append(svg);
}

function renderDailyTable(daily, today) {
  dom.dailyBody.replaceChildren();
  dom.dailyTable.hidden = false;
  dom.forecastEmpty.hidden = true;

  const lows = daily.map((day) => day.temp.min).filter(isFiniteNumber);
  const highs = daily.map((day) => day.temp.max).filter(isFiniteNumber);
  const scaleLow = lows.length ? Math.min(...lows) : 0;
  const scaleHigh = highs.length ? Math.max(...highs) : 1;
  const scaleSpan = scaleHigh - scaleLow || 1;
  const tomorrow = today ? addDays(today, 1) : null;

  for (const day of daily) {
    const tr = elem('tr');

    const dayName =
      day.date === tomorrow ? 'Tomorrow' : WEEKDAY_LONG.format(dateObject(day.date));
    const dayCell = elem('td', { className: 'day-cell' }, [
      elem('div', { className: 'day-name' }, [
        elem('span', { text: dayName }),
        day.date === today ? elem('span', { className: 'today-pill', text: 'Today' }) : null,
      ]),
      elem('div', { className: 'day-date', text: dateLabel(day.date) }),
    ]);

    const tempMain = elem('div', { className: 'temp-main' }, [
      elem('span', { className: 'temp-avg', text: formatValue(day.temp.avg, 0, '°') }),
      elem('span', {
        className: 'temp-range',
        text: `${formatValue(day.temp.min, 0, '°')} – ${formatValue(day.temp.max, 0, '°')}`,
      }),
    ]);
    const tempBar = elem('div', { className: 'temp-bar', attrs: { 'aria-hidden': 'true' } });
    if (isFiniteNumber(day.temp.min) && isFiniteNumber(day.temp.max)) {
      const left = clamp(((day.temp.min - scaleLow) / scaleSpan) * 100, 0, 96);
      const room = 100 - left;
      const width = clamp(((day.temp.max - day.temp.min) / scaleSpan) * 100, Math.min(4, room), room);
      tempBar.append(
        elem('span', {
          props: {
            style: `left:${left.toFixed(2)}%; width:${width.toFixed(2)}%`,
          },
        }),
      );
    }
    const tempCell = elem('td', { className: 'temp-cell' }, [tempMain, tempBar]);

    const windCell = elem('td', { className: 'metric-cell' }, [
      elem('div', { className: 'metric-main' }, [
        document.createTextNode(formatNumber(day.wind.avg, 0)),
        elem('small', { text: 'km/h' }),
      ]),
      elem('div', {
        className: 'metric-range',
        text: `${formatNumber(day.wind.min, 0)}–${formatNumber(day.wind.max, 0)}`,
      }),
    ]);

    const humidityCell = elem('td', { className: 'metric-cell' }, [
      elem('div', { className: 'metric-main' }, [
        document.createTextNode(formatNumber(day.humidity.avg, 0)),
        elem('small', { text: '%' }),
      ]),
      elem('div', {
        className: 'metric-range',
        text: `${formatNumber(day.humidity.min, 0)}–${formatNumber(day.humidity.max, 0)}`,
      }),
    ]);

    const precipCell = elem('td', { className: 'metric-cell' }, [
      elem('div', { className: 'metric-main' }, [
        document.createTextNode(formatNumber(day.precip.avg, 1)),
        elem('small', { text: 'mm' }),
      ]),
      elem('div', {
        className: 'metric-range',
        text: `${formatNumber(day.precip.min, 1)}–${formatNumber(day.precip.max, 1)}`,
      }),
    ]);

    const sourceCell = elem('td', { className: 'sources-col' }, [
      elem('span', {
        className: 'source-count',
        text: String(day.sourceCount),
        attrs: {
          title: `${day.sourceCount} ${day.sourceCount === 1 ? 'service' : 'services'} contributed temperature data`,
        },
      }),
    ]);

    tr.append(dayCell, tempCell, windCell, humidityCell, precipCell, sourceCell);
    dom.dailyBody.append(tr);
  }
}

function renderBreakdown(forecast) {
  const sources = forecast.sources ?? [];
  const ok = sources.filter((source) => source.ok).length;
  dom.breakdownSub.textContent = `${ok} of ${sources.length} services reporting · ${forecast.daily.length} days aggregated`;
  dom.breakdownBody.replaceChildren();

  if (!sources.length) {
    dom.breakdownBody.append(
      elem('p', {
        className: 'breakdown-note',
        text: 'No weather services are enabled. Add one from the menu to build a consensus.',
      }),
    );
    return;
  }

  const table = elem('table', { className: 'breakdown-table' });
  const head = elem('thead');
  const headRow = elem('tr');
  for (const label of ['Service', 'Status', 'Days', 'Today', 'Note']) {
    headRow.append(elem('th', { text: label, attrs: { scope: 'col' } }));
  }
  head.append(headRow);

  const body = elem('tbody');
  for (const source of sources) {
    const statusClass = !source.ok ? 'error' : source.stale ? 'stale' : 'ok';
    const statusText = !source.ok ? 'Failed' : source.stale ? 'Cached' : 'Live';
    const todayDay = source.days?.find((day) => day.date === forecast.today);
    const note = source.error || source.note || '—';

    const row = elem('tr');
    row.append(
      elem('td', {}, [
        elem('div', { className: 'breakdown-source' }, [
          avatar(source.name, state.sources.find((item) => item.id === source.id)?.color, 'mini-avatar'),
          elem('span', { text: source.name }),
        ]),
      ]),
      elem('td', {}, [elem('span', { className: `status-pill ${statusClass}`, text: statusText })]),
      elem('td', { text: `${source.dayCount ?? 0} d` }),
      elem('td', {
        text: todayDay && isFiniteNumber(todayDay.tMean) ? formatValue(todayDay.tMean, 0, '°') : '–',
      }),
      elem('td', { className: 'breakdown-note-cell', text: note }),
    );
    body.append(row);
  }

  table.append(head, body);
  dom.breakdownBody.append(
    elem('div', { className: 'breakdown-scroll' }, [table]),
    elem('p', {
      className: 'breakdown-note',
      text: 'Every service counts once per day. Missing values are skipped for that metric, and cached rows reuse the last successful response.',
    }),
  );
}

function renderForecast(forecast) {
  const daily = forecast.daily ?? [];
  const day = heroDay(daily, forecast.today);

  if (!daily.length) {
    showEmptyForecast('No service returned a usable forecast for these dates. Check source contributions below.');
  } else {
    renderHero(day, forecast);
    renderChart(daily, forecast.today);
    renderDailyTable(daily, forecast.today);
  }

  renderBreakdown(forecast);

  if (!daily.length) return;

  const ok = forecast.sources.filter((source) => source.ok).length;
  const total = forecast.sources.length;
  dom.statusLine.textContent = forecast.stale
    ? `Cached consensus · ${ok} of ${total} services`
    : `Consensus of ${ok} ${ok === 1 ? 'service' : 'services'} · ${daily.length} ${daily.length === 1 ? 'day' : 'days'}`;
  const time = timeInZone(forecast.generatedAt, forecast.location?.timezone);
  dom.updatedLine.textContent = time
    ? `Updated ${time} · ${forecast.location?.timezone || 'UTC'}`
    : '';
}

async function loadForecast({ refresh = false } = {}) {
  const seq = ++state.forecastSeq;

  if (state.sourcesLoaded && !state.sources.some((source) => source.enabled)) {
    state.forecast = null;
    setBusy(false);
    renderSources();
    const message = 'No weather services are enabled. Add one from the menu to build a forecast.';
    showEmptyForecast(message);
    dom.breakdownSub.textContent = 'No contributions to show';
    dom.breakdownBody.replaceChildren(elem('p', { className: 'breakdown-note', text: message }));
    return;
  }

  setBusy(true);
  dom.statusLine.textContent = refresh ? 'Refreshing forecasts…' : 'Collecting forecasts…';

  try {
    const params = new URLSearchParams({
      lat: String(state.location.lat),
      lon: String(state.location.lon),
      days: String(DAYS),
    });
    if (refresh) params.set('refresh', '1');
    const forecast = await api(`/api/forecast?${params}`);
    if (seq !== state.forecastSeq) return;

    state.forecast = forecast;
    renderForecast(forecast);
    if (state.sourcesLoaded) renderSources();
    if (forecast.warning) toast(forecast.warning, 'warning', 6500);
  } catch (error) {
    if (seq !== state.forecastSeq) return;

    state.forecast = null;
    if (state.sourcesLoaded) renderSources();
    const message =
      error.status === 409
        ? 'No weather services are enabled. Add one from the menu to build a forecast.'
        : error.message || 'The forecast could not be loaded.';
    showEmptyForecast(message);
    dom.breakdownSub.textContent = 'No contributions to show';
    dom.breakdownBody.replaceChildren(elem('p', { className: 'breakdown-note', text: message }));
    if (error.status !== 409) toast(message, 'error', 6000);
  } finally {
    if (seq === state.forecastSeq) {
      setBusy(false);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function wireEvents() {
  let chartResizeTimer = null;
  window.addEventListener('resize', () => {
    window.clearTimeout(chartResizeTimer);
    chartResizeTimer = window.setTimeout(() => {
      if (state.forecast?.daily?.length) {
        renderChart(state.forecast.daily, state.forecast.today);
      }
    }, 160);
  });

  dom.themeBtn.addEventListener('click', () => {
    setTheme(dom.html.dataset.theme === 'dark' ? 'light' : 'dark', { persist: true });
  });

  document.addEventListener('pointerdown', (event) => {
    if (!dom.chartTooltip.hidden && !event.target.closest?.('.chart-hover-area')) {
      dom.chartTooltip.hidden = true;
    }
  });

  dom.menuBtn.addEventListener('click', toggleSidebar);
  dom.sidebarClose.addEventListener('click', closeSidebar);
  dom.scrim.addEventListener('click', closeSidebar);

  dom.locationChip.addEventListener('click', openLocationDialog);
  dom.addSourceBtn.addEventListener('click', openSourceDialog);
  dom.addSourceRow.addEventListener('click', openSourceDialog);
  dom.refreshBtn.addEventListener('click', () => loadForecast({ refresh: true }));
  dom.locateBtn.addEventListener('click', locateAndApply);
  dom.emptyRetry.addEventListener('click', () => loadForecast({ refresh: true }));

  for (const button of document.querySelectorAll('[data-close-dialog]')) {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  }

  for (const dialog of [dom.locationDialog, dom.sourceDialog, dom.confirmDialog]) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  dom.confirmOk.addEventListener('click', () => settleConfirm(true));
  dom.confirmCancel.addEventListener('click', () => settleConfirm(false));
  dom.confirmDialog.addEventListener('close', () => {
    if (state.confirmResolve) {
      const resolve = state.confirmResolve;
      state.confirmResolve = null;
      resolve(false);
    }
  });

  dom.placeSearch.addEventListener('input', onSearchInput);
  dom.placeSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const first = dom.searchResults.querySelector('.search-result');
      if (first) {
        event.preventDefault();
        first.click();
      }
    } else if (event.key === 'Escape') {
      hideSearchResults();
    }
  });

  dom.useMyLocation.addEventListener('click', locateInDialog);
  dom.applyLocation.addEventListener('click', applyPendingLocation);

  for (const button of dom.catalogTabs.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      state.catalogTab = button.dataset.tab === 'scanned' ? 'scanned' : 'addable';
      renderCatalog();
    });
  }
  dom.rescanBtn.addEventListener('click', rescanCatalog);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dom.sidebar.classList.contains('open')) closeSidebar();
    if (
      event.key === '/' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.target.closest?.('input, textarea, select, [contenteditable="true"]') &&
      !document.querySelector('dialog[open]')
    ) {
      event.preventDefault();
      openLocationDialog();
      window.setTimeout(() => dom.placeSearch.focus(), 60);
    }
  });

  dom.locationDialog.addEventListener('close', () => {
    hideSearchResults();
    dom.placeSearch.value = '';
    setLocationStatus('');
  });
}

async function boot() {
  setTheme(dom.html.dataset.theme || preferredTheme());
  renderLocationHeader();
  wireEvents();
  updateCatalogNote();
  dom.tempChart.append(elem('div', { className: 'chart-empty', text: 'Loading temperature chart…' }));
  await loadSources({ quiet: true });
  loadCatalog({ quiet: true });
  loadForecast();
}

boot();
