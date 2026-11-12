import { useEffect, useState } from 'react';
import type { Coordinates } from './data';

type Result = { label: string | null; state: 'idle' | 'loading' | 'ready' | 'unavailable' };
type Entry = { key: string; label: string; at: number };
const storageKey = 'saklolo-location-labels-v1';
const maxAge = 7 * 86400000;
function readCache(key: string): string | null {
  try {
    const entries = JSON.parse(localStorage.getItem(storageKey) || '[]') as Entry[];
    return Array.isArray(entries) ? entries.find(entry => entry.key === key && typeof entry.label === 'string' && Date.now() - entry.at < maxAge)?.label || null : null;
  } catch { return null; }
}
function cacheLabel(key: string, label: string) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const entries = Array.isArray(stored) ? stored.filter((entry: Entry) => entry.key !== key && Date.now() - entry.at < maxAge) : [];
    localStorage.setItem(storageKey, JSON.stringify([...entries, { key, label, at: Date.now() }].slice(-100)));
  } catch { /* Storage may be unavailable; the current lookup still works. */ }
}
/** Enable for a user-requested location review, not a background GPS watch. */
export function useLocationLabel(location: Coordinates | null | undefined, enabled = true): Result {
  const valid = location && Number.isFinite(location.lat) && Number.isFinite(location.lng) && Math.abs(location.lat) <= 90 && Math.abs(location.lng) <= 180;
  const key = valid ? `${location.lat.toFixed(5)},${location.lng.toFixed(5)}` : '';
  const [result, setResult] = useState<Result & { key: string }>({ key: '', label: null, state: 'idle' });
  useEffect(() => {
    if (!key || !enabled) { setResult({ key, label: null, state: 'idle' }); return; }
    const cached = readCache(key);
    if (cached) { setResult({ key, label: cached, state: 'ready' }); return; }
    const controller = new AbortController();
    setResult({ key, label: null, state: 'loading' });
    const timer = window.setTimeout(() => controller.abort(), 15000);
    const [lat, lng] = key.split(',');
    void fetch(`/api/location-label?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Lookup unavailable');
      const body = await response.json();
      if (controller.signal.aborted) return;
      const label = typeof body.label === 'string' && body.label.trim() ? body.label.slice(0, 700) : null;
      if (label) cacheLabel(key, label);
      setResult({ key, label, state: label ? 'ready' : 'unavailable' });
    }).catch(() => { if (!disposed) setResult({ key, label: null, state: 'unavailable' }); }).finally(() => window.clearTimeout(timer));
    let disposed = false;
    return () => { disposed = true; controller.abort(); window.clearTimeout(timer); };
  }, [key, enabled]);
  if (!key || !enabled) return { label: null, state: 'idle' };
  return result.key === key ? result : { label: null, state: 'loading' };
}
