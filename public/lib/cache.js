const stores = new Map();

export function getCache(name) {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

export function cacheGet(name, key) {
  const store = getCache(name);
  const entry = store.get(key);
  if (!entry) return null;
  return entry;
}

export function cacheSet(name, key, value, ttlMs) {
  const store = getCache(name);
  store.set(key, { value, expiresAt: Date.now() + ttlMs, storedAt: Date.now() });
  if (store.size > 500) {
    const now = Date.now();
    for (const [storeKey, entry] of store) {
      if (entry.expiresAt < now) store.delete(storeKey);
    }
  }
  return value;
}

export async function cached(name, key, ttlMs, loader, { refresh = false } = {}) {
  const store = getCache(name);
  const entry = store.get(key);
  const now = Date.now();

  if (!refresh && entry && entry.expiresAt > now) {
    return { value: entry.value, cached: true, stale: false };
  }

  try {
    const value = await loader();
    store.set(key, { value, expiresAt: now + ttlMs, storedAt: now });
    return { value, cached: false, stale: false };
  } catch (error) {
    if (entry) {
      return {
        value: entry.value,
        cached: true,
        stale: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }
}
