import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { MapPin } from 'lucide-react';
import type { Coordinates } from './data';

export default function LocationPreview({ location }: { location: Coordinates }) {
  const element = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!element.current) return;
    setUnavailable(false);
    const map = L.map(element.current, { zoomControl: false, scrollWheelZoom: false }).setView([location.lat, location.lng], 16);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19
    }).on('tileerror', () => setUnavailable(true)).addTo(map);
    L.circleMarker([location.lat, location.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#243e36', fillOpacity: 1 }).addTo(map);
    if (location.accuracy) L.circle([location.lat, location.lng], { radius: location.accuracy, color: '#355f45', weight: 1, fillOpacity: .08 }).addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(element.current);
    return () => { observer.disconnect(); map.remove(); };
  }, [location.lat, location.lng, location.accuracy]);
  return <div className="resident-map-wrap"><div ref={element} className="resident-location-map" role="img" aria-label="Preview of your GPS location" />{unavailable && <p className="resident-map-error"><MapPin size={14} />Street map unavailable. Your coordinates are still available.</p>}</div>;
}
