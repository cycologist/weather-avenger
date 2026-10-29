export const DEFAULT_USER_AGENT = 'Avercast/1.0 (local weather aggregator)';

let userAgent = DEFAULT_USER_AGENT;

/** Let the Node server apply its optional CONTACT_EMAIL user agent. */
export function setUserAgent(value) {
  userAgent = value || DEFAULT_USER_AGENT;
}

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export async function fetchText(url, { headers = {}, timeout = 10_000 } = {}) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
      Accept: '*/*',
      ...headers,
    },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new HttpError(`Upstream returned HTTP ${response.status}`, response.status);
  }

  return response.text();
}

export async function fetchJson(url, { headers = {}, timeout = 10_000 } = {}) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
      Accept: 'application/json',
      ...headers,
    },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new HttpError(`Upstream returned HTTP ${response.status}`, response.status);
  }

  return response.json();
}
