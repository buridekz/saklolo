import { useCallback, useEffect, useRef, useState } from 'react';
import type { Coordinates } from './data';

export function useDeviceLocation() {
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [state, setState] = useState<'requesting' | 'active' | 'denied' | 'unavailable'>('requesting');
  const [now, setNow] = useState(Date.now());
  const watch = useRef<number | null>(null);
  const latest = useRef<{ location: Coordinates | null; capturedAt: string | null }>({ location: null, capturedAt: null });
  const stop = useCallback(() => {
    if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
  }, []);
  const start = useCallback(() => {
    stop(); setState('requesting'); setLocation(null); setCapturedAt(null);
    latest.current = { location: null, capturedAt: null };
    if (!window.isSecureContext || !navigator.geolocation) { setState('unavailable'); return; }
    watch.current = navigator.geolocation.watchPosition(position => {
      const coordinates = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
      const timestamp = new Date(position.timestamp).toISOString();
      latest.current = { location: coordinates, capturedAt: timestamp };
      setLocation(coordinates); setCapturedAt(timestamp); setState('active');
    }, error => {
      latest.current = { location: null, capturedAt: null }; setLocation(null); setCapturedAt(null);
      setState(error.code === 1 ? 'denied' : 'unavailable');
      if (error.code === 1) stop();
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 });
  }, [stop]);
  useEffect(() => { start(); return stop; }, [start, stop]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const snapshot = useCallback(() => {
    // Keep a known fix with its original timestamp. Never silently drop a
    // location that the UI says is available; older fixes are labelled below.
    return latest.current;
  }, []);
  const stale = Boolean(capturedAt && now - Date.parse(capturedAt) > 120000);
  return { location, capturedAt, state, stale, retry: start, snapshot };
}
