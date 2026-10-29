const dateFormatters = new Map();

function dateFormatter(timeZone) {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter;
}

export function dateKeyInZone(value, timeZone = 'UTC') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    dateFormatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function todayInZone(timeZone = 'UTC') {
  return dateKeyInZone(new Date(), timeZone);
}

export function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

export function weekday(dateKey, locale = 'en-US') {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

export function longDate(dateKey, locale = 'en-US') {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** A best-effort IANA timezone for a longitude, used only when timezone lookup fails. */
export function approximateTimezone(lon) {
  const offset = Math.max(-14, Math.min(14, Math.round(lon / 15)));
  if (offset === 0) return 'Etc/GMT';
  return `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
}
