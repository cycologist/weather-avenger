const SVG_NS = 'http://www.w3.org/2000/svg';
const WORLD_URL = '/data/world.geojson';
const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 500;
const MIN_WIDTH = 84;
const MAX_WIDTH = WORLD_WIDTH;

let worldPromise = null;

function loadWorld() {
  if (!worldPromise) {
    worldPromise = fetch(WORLD_URL, { headers: { Accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) throw new Error(`Map request failed (${response.status})`);
        return response.json();
      })
      .catch((error) => {
        worldPromise = null;
        throw error;
      });
  }
  return worldPromise;
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const projectX = (lon) => ((lon + 180) / 360) * WORLD_WIDTH;
const projectY = (lat) => ((90 - lat) / 180) * WORLD_HEIGHT;

function unproject(x, y) {
  return {
    lon: clamp((x / WORLD_WIDTH) * 360 - 180, -180, 180),
    lat: clamp(90 - (y / WORLD_HEIGHT) * 180, -89, 89),
  };
}

function formatCoords(lat, lon) {
  const latText = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
  const lonText = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
  return `${latText} · ${lonText}`;
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
  return element;
}

function ringToPath(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return '';
  const points = ring.map(([lon, lat]) => `${projectX(lon).toFixed(2)},${projectY(lat).toFixed(2)}`);
  return `M${points.join('L')}Z`;
}

function geometryToPath(geometry) {
  if (!geometry) return '';
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map(ringToPath).join(' ');
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap((polygon) => polygon.map(ringToPath)).join(' ');
  }
  return '';
}

export function createWorldMap(container, { onPick } = {}) {
  const readout =
    container.parentElement?.querySelector('.map-readout') ??
    document.getElementById('map-readout');

  const svg = svgElement('svg', {
    viewBox: `0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`,
    role: 'img',
    'aria-label': 'World map. Click or tap to choose a location.',
    preserveAspectRatio: 'xMidYMid meet',
  });

  const defs = svgElement('defs');
  const oceanGradient = svgElement('linearGradient', {
    id: 'mapOceanGradient',
    x1: '0',
    y1: '0',
    x2: '0',
    y2: '1',
  });
  oceanGradient.append(
    svgElement('stop', { offset: '0', 'stop-color': 'var(--map-ocean)' }),
    svgElement('stop', { offset: '1', 'stop-color': 'var(--map-ocean)' }),
  );
  defs.append(oceanGradient);
  svg.append(defs);

  const ocean = svgElement('rect', {
    x: 0,
    y: 0,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    class: 'map-ocean-rect',
  });
  svg.append(ocean);

  const graticule = svgElement('g', {
    class: 'graticule',
    'aria-hidden': 'true',
    'pointer-events': 'none',
  });
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = projectX(lon);
    graticule.append(
      svgElement('line', { x1: x, y1: 0, x2: x, y2: WORLD_HEIGHT }),
    );
  }
  for (let lat = -80; lat <= 80; lat += 20) {
    const y = projectY(lat);
    graticule.append(
      svgElement('line', { x1: 0, y1: y, x2: WORLD_WIDTH, y2: y }),
    );
  }
  svg.append(graticule);

  const countriesGroup = svgElement('g', { 'aria-hidden': 'true' });
  svg.append(countriesGroup);

  const marker = svgElement('g', { class: 'map-marker', 'aria-hidden': 'true' });
  const pulse = svgElement('circle', { class: 'map-marker-pulse', r: 18, cx: 0, cy: 0 });
  const ring = svgElement('circle', { class: 'map-marker-ring', r: 12, cx: 0, cy: 0 });
  const crossX = svgElement('line', {
    class: 'map-marker-cross',
    x1: -14,
    y1: 0,
    x2: 14,
    y2: 0,
  });
  const crossY = svgElement('line', {
    class: 'map-marker-cross',
    x1: 0,
    y1: -14,
    x2: 0,
    y2: 14,
  });
  const dot = svgElement('circle', { class: 'map-marker-dot', r: 4.6, cx: 0, cy: 0 });
  marker.append(pulse, ring, crossX, crossY, dot);
  marker.style.display = 'none';
  svg.append(marker);

  const loading = document.createElement('div');
  loading.className = 'map-loading';
  loading.innerHTML = '<span class="spinner"></span> Loading world map…';

  container.replaceChildren(loading, svg);

  const controls = document.createElement('div');
  controls.className = 'map-controls';
  const zoomIn = document.createElement('button');
  zoomIn.type = 'button';
  zoomIn.setAttribute('aria-label', 'Zoom in');
  zoomIn.textContent = '+';
  const zoomOut = document.createElement('button');
  zoomOut.type = 'button';
  zoomOut.setAttribute('aria-label', 'Zoom out');
  zoomOut.textContent = '−';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'map-reset';
  reset.setAttribute('aria-label', 'Reset to world view');
  reset.textContent = 'World';
  controls.append(zoomIn, zoomOut, reset);
  container.append(controls);

  let view = { x: 0, y: 0, w: WORLD_WIDTH, h: WORLD_HEIGHT };
  let markerLocation = null;
  let loadingFailed = false;

  function setView(next) {
    const w = clamp(next.w, MIN_WIDTH, MAX_WIDTH);
    const h = w / 2;
    view = {
      w,
      h,
      x: clamp(next.x, 0, WORLD_WIDTH - w),
      y: clamp(next.y, 0, WORLD_HEIGHT - h),
    };
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    positionMarker();
    zoomOut.disabled = view.w >= MAX_WIDTH - 0.1;
    reset.disabled = view.w >= MAX_WIDTH - 0.1;
  }

  function positionMarker() {
    if (!markerLocation) return;
    const x = projectX(markerLocation.lon);
    const y = projectY(markerLocation.lat);
    // Keep the marker the same size on screen while the view zooms.
    const pixels = svg.getBoundingClientRect().width || 600;
    const scale = (view.w / pixels) * 1.08;
    marker.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
  }

  function setMarker(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    markerLocation = { lat, lon };
    marker.style.display = '';
    positionMarker();
  }

  function focus(lat, lon, zoom = 4) {
    const w = MAX_WIDTH / clamp(zoom, 1, 14);
    const x = projectX(lon) - w / 2;
    const y = projectY(lat) - w / 4;
    setView({ x, y, w });
  }

  function resetView() {
    setView({ x: 0, y: 0, w: WORLD_WIDTH });
  }

  function zoomBy(factor, anchor) {
    const centerX = anchor ? anchor.x : view.x + view.w / 2;
    const centerY = anchor ? anchor.y : view.y + view.h / 2;
    const ratioX = (centerX - view.x) / view.w;
    const ratioY = (centerY - view.y) / view.h;
    const nextW = view.w * factor;
    setView({
      w: nextW,
      x: centerX - ratioX * nextW,
      y: centerY - ratioY * (nextW / 2),
    });
  }

  function eventToWorld(event) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = view.x + ((event.clientX - rect.left) / rect.width) * view.w;
    const y = view.y + ((event.clientY - rect.top) / rect.height) * view.h;
    return { x, y };
  }

  function updateReadout(event) {
    if (!readout) return;
    const world = eventToWorld(event);
    if (!world || world.x < 0 || world.x > WORLD_WIDTH || world.y < 0 || world.y > WORLD_HEIGHT) {
      return;
    }
    const { lat, lon } = unproject(world.x, world.y);
    readout.textContent = formatCoords(lat, lon);
  }

  let pointer = null;

  svg.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const world = eventToWorld(event);
    if (!world) return;
    pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      view,
      world,
      moved: false,
    };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('dragging');
  });

  svg.addEventListener('pointermove', (event) => {
    updateReadout(event);
    if (!pointer || pointer.id !== event.pointerId) return;

    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    if (!pointer.moved && Math.hypot(dx, dy) > 3) pointer.moved = true;
    if (!pointer.moved) return;

    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const worldDx = (dx / rect.width) * pointer.view.w;
    const worldDy = (dy / rect.height) * pointer.view.h;
    setView({
      x: pointer.view.x - worldDx,
      y: pointer.view.y - worldDy,
      w: pointer.view.w,
    });
  });

  function endPointer(event, cancelled = false) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const current = pointer;
    pointer = null;
    svg.classList.remove('dragging');
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);

    if (!cancelled && !current.moved) {
      const world = eventToWorld(event) ?? current.world;
      if (!world) return;
      const { lat, lon } = unproject(world.x, world.y);
      setMarker(lat, lon);
      if (readout) readout.textContent = formatCoords(lat, lon);
      onPick?.({ lat: Number(lat.toFixed(3)), lon: Number(lon.toFixed(3)) });
    }
  }

  svg.addEventListener('pointerup', (event) => endPointer(event));
  svg.addEventListener('pointercancel', (event) => endPointer(event, true));
  svg.addEventListener('pointerleave', () => {
    if (!pointer && readout) readout.textContent = 'Tap or click the map to choose a place';
  });

  svg.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const world = eventToWorld(event);
      zoomBy(event.deltaY > 0 ? 1.16 : 1 / 1.16, world ?? undefined);
    },
    { passive: false },
  );

  zoomIn.addEventListener('click', () => zoomBy(1 / 1.45));
  zoomOut.addEventListener('click', () => zoomBy(1.45));
  reset.addEventListener('click', resetView);
  window.addEventListener('resize', positionMarker);

  setView(view);

  loadWorld()
    .then((world) => {
      const features = Array.isArray(world?.features) ? world.features : [];
      const fragment = document.createDocumentFragment();
      for (const feature of features) {
        const pathData = geometryToPath(feature.geometry);
        if (!pathData) continue;
        const path = svgElement('path', { d: pathData, class: 'country' });
        const name = feature.properties?.ADMIN || feature.properties?.NAME || 'Country';
        const title = document.createElementNS(SVG_NS, 'title');
        title.textContent = name;
        path.append(title);
        fragment.append(path);
      }
      countriesGroup.append(fragment);
      loading.remove();
    })
    .catch(() => {
      loadingFailed = true;
      loading.textContent = 'World map could not load. Search for a place instead.';
    });

  return {
    setMarker,
    focus,
    reset: resetView,
    setLoadingMessage(message) {
      if (!loadingFailed) loading.textContent = message;
    },
    getLocation: () => (markerLocation ? { ...markerLocation } : null),
  };
}
