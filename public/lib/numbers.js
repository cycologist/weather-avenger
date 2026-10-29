export function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function round(value, digits = 1) {
  if (!finite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function mean(values) {
  const usable = values.filter(finite);
  if (!usable.length) return null;
  return usable.reduce((total, value) => total + value, 0) / usable.length;
}

export function min(values) {
  const usable = values.filter(finite);
  return usable.length ? Math.min(...usable) : null;
}

export function max(values) {
  const usable = values.filter(finite);
  return usable.length ? Math.max(...usable) : null;
}

export function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}
