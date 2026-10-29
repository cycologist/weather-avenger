import { fetchOpenMeteo } from './openmeteo.js';
import { fetchMetNo } from './metno.js';
import { fetchSevenTimer } from './seventimer.js';
import { fetchWttr } from './wttr.js';

const ADAPTERS = {
  openmeteo: fetchOpenMeteo,
  metno: fetchMetNo,
  seventimer: fetchSevenTimer,
  wttr: fetchWttr,
};

export async function runAdapter(source, context) {
  const adapter = ADAPTERS[source.adapter];
  if (!adapter) throw new Error(`No adapter for ${source.adapter}`);
  const result = await adapter({
    ...context,
    model: source.model ?? null,
  });
  return {
    ...result,
    adapter: source.adapter,
  };
}

export function adapterExists(name) {
  return Boolean(ADAPTERS[name]);
}
