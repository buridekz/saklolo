/** Derived place labels only; never changes report coordinates or GPS accuracy.
 * Policy: https://operations.osmfoundation.org/policies/nominatim/
 * Configure an approved/self-hosted provider before enabling real resident data.
 */
export function createLookupGate({ now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), maxQueued = 4 } = {}) {
  let tail = Promise.resolve();
  let queued = 0;
  let lastStarted = -Infinity;
  return async function run(task) {
    if (queued >= maxQueued) throw new Error('Location lookup queue is full.');
    queued++;
    const entered = now();
    const result = tail.then(async () => {
      if (now() - entered > 12000) throw new Error('Location lookup expired.');
      const delay = Math.max(0, 1100 - (now() - lastStarted));
      if (delay) await wait(delay);
      lastStarted = now();
      return task();
    });
    tail = result.catch(() => {}).finally(() => { queued--; });
    return result;
  };
}
// One process-wide queue: all users and app instances share the provider budget.
const globalLookupGate = createLookupGate();
export function validCoordinates(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}
export function createLocationLabelService({ endpoint = process.env.NOMINATIM_REVERSE_URL || '', fetchImpl = fetch, gate = globalLookupGate, now = Date.now, timeoutMs = 7000, maxCache = 500, userAgent = 'SakloloLocalDemo/0.1 (community incident map; local evaluation)' } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  let provider;
  try { provider = endpoint ? new URL(endpoint) : null; } catch { provider = null; }
  if (provider && !['https:', 'http:'].includes(provider.protocol)) provider = null;
  return async function lookup(lat, lng) {
    if (!validCoordinates(lat, lng)) throw new TypeError('Invalid coordinates.');
    if (!provider) return { label: null, source: 'OpenStreetMap', available: false };
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.value;
    if (inFlight.has(key)) return inFlight.get(key);
    const request = gate(async () => {
      const url = new URL(provider);
      url.searchParams.set('lat', lat.toFixed(5)); url.searchParams.set('lon', lng.toFixed(5));
      url.searchParams.set('format', 'jsonv2'); url.searchParams.set('addressdetails', '1');
      url.searchParams.set('zoom', '18'); url.searchParams.set('layer', 'address'); url.searchParams.set('accept-language', 'en');
      const response = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error('Location provider unavailable.');
      const body = await response.json();
      const label = typeof body.display_name === 'string' ? body.display_name.trim().slice(0, 700) : null;
      return { label: label || null, source: 'OpenStreetMap', available: Boolean(label) };
    }).catch(() => ({ label: null, source: 'OpenStreetMap', available: false })).then(value => {
      cache.delete(key); cache.set(key, { value, expires: now() + (value.label ? 86400000 : 30000) });
      while (cache.size > maxCache) cache.delete(cache.keys().next().value);
      return value;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  };
}
