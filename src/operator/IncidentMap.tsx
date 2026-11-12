import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Crosshair, MapPin, Scan } from 'lucide-react';
import type { Report } from '../data';
import { clockTime, prefersReducedMotion } from './format';

const SYMBOLS: Record<string, string> = {
  Medical: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  Fire: '<path d="M12 3c2 5 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-6 0 3 2 4 3 4 1-3 1-6 0-9z"/>',
  Safety: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="M12 8v4M12 16h.01"/>',
  Flood: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  Other: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
};

type Props = {
  reports: Report[];
  selected: string | null;
  fresh: ReadonlySet<string>;
  onSelect: (id: string) => void;
};

export default function IncidentMap({ reports, selected, fresh, onSelect }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const lastFocus = useRef<string | null>(null);
  const [tileState, setTileState] = useState<'loading' | 'ready' | 'error'>('loading');
  const located = reports.filter(report => report.location);
  const current = reports.find(report => report.id === selected);
  const mapRevision = JSON.stringify(reports.map(({ id, location, category, status, landmark, createdAt }) => ({ id, location, category, status, landmark, createdAt })));
  const freshKey = [...fresh].sort().join(',');

  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { zoomControl: false, zoomSnap: 0.5 }).setView([14.5547, 121.0244], 13);
    map.current = instance;
    L.control.zoom({ position: 'bottomright' }).addTo(instance);
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(instance);
    let failed = false;
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 });
    tiles.on('loading', () => { failed = false; setTileState('loading'); });
    tiles.on('tileerror', () => { failed = true; setTileState('error'); });
    tiles.on('load', () => setTileState(failed ? 'error' : 'ready'));
    tiles.addTo(instance);
    markers.current = L.layerGroup().addTo(instance);
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(element.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const layer = markers.current;
    if (!layer) return;
    layer.clearLayers();
    const groups = new Map<string, Report[]>();
    for (const report of reports) {
      if (!report.location) continue;
      const key = `${report.location.lat.toFixed(4)}:${report.location.lng.toFixed(4)}`;
      groups.set(key, [...(groups.get(key) || []), report]);
    }
    for (const group of groups.values()) {
      const report = group.find(item => item.id === selected) || group[0];
      const point = report.location!;
      const active = group.some(item => item.id === selected);
      const reviewed = group.every(item => item.status === 'acknowledged');
      const isNew = group.some(item => fresh.has(item.id));
      const content = group.length > 1
        ? `<span>${group.length}</span>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${SYMBOLS[report.category] || SYMBOLS.Other}</svg>`;
      const icon = L.divIcon({
        className: ['ops-map-pin', reviewed && 'is-reviewed', active && 'is-active', isNew && 'is-new'].filter(Boolean).join(' '),
        html: `<div class="ops-pin-body">${content}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      const marker = L.marker([point.lat, point.lng], {
        icon,
        title: group.length > 1 ? `${group.length} reports at this location` : `${report.category} assistance`,
        keyboard: true,
        zIndexOffset: active ? 1000 : isNew ? 500 : 0,
      }).addTo(layer);
      if (group.length > 1) {
        const popup = document.createElement('div');
        popup.className = 'ops-map-popup';
        const title = document.createElement('strong');
        title.textContent = `${group.length} reports near this location`;
        const note = document.createElement('p');
        note.textContent = 'Locations within approximately 15 m. Select a report to review.';
        popup.append(title, note);
        for (const item of group) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = `${item.category} · ${item.landmark || 'Shared GPS location'} (${clockTime(item.createdAt)})`;
          button.addEventListener('click', () => { onSelect(item.id); map.current?.closePopup(); });
          popup.append(button);
        }
        marker.bindPopup(popup, { maxWidth: 280 });
      } else marker.on('click', () => onSelect(report.id));
      if (active && point.accuracy) {
        L.circle([point.lat, point.lng], { radius: point.accuracy, color: '#294c35', weight: 1, fillOpacity: 0.07, interactive: false, className: 'ops-accuracy' }).addTo(layer);
      }
    }
    const report = reports.find(item => item.id === selected);
    const instance = map.current;
    if (report?.location && instance) {
      const { lat, lng } = report.location;
      const focusKey = `${report.id}:${lat}:${lng}`;
      if (lastFocus.current !== focusKey) {
        const zoom = Math.max(instance.getZoom(), 14);
        // Only animate after the first focus, so the desk does not "fly" on page load.
        if (lastFocus.current && !prefersReducedMotion()) instance.flyTo([lat, lng], zoom, { duration: 0.55, easeLinearity: 0.3 });
        else instance.setView([lat, lng], zoom);
        lastFocus.current = focusKey;
      }
    }
    // mapRevision and freshKey summarise reports/fresh, so routine polling does not rebuild markers.
  },[mapRevision, selected, freshKey, onSelect]);

  function fitReports() {
    const instance = map.current;
    if (!instance || !located.length) return;
    const bounds = L.latLngBounds(located.map(report => [report.location!.lat, report.location!.lng] as [number, number]));
    const options = { padding: [56, 56] as [number, number], maxZoom: 16 };
    if (prefersReducedMotion()) instance.fitBounds(bounds, options);
    else instance.flyToBounds(bounds, { ...options, duration: 0.6 });
  }

  function focusSelected() {
    const instance = map.current;
    if (!instance || !current?.location) return;
    const target: [number, number] = [current.location.lat, current.location.lng];
    if (prefersReducedMotion()) instance.setView(target, 16);
    else instance.flyTo(target, 16, { duration: 0.55 });
  }

  return (
    <div className="ops-map-section">
      <div className="ops-map-canvas">
        <div ref={element} className="ops-map" aria-label="Map of received incident locations" />
        <div className="ops-map-controls">
          <button type="button" className="ops-chip-button" onClick={fitReports} disabled={!located.length}><Scan size={14} />Fit reports</button>
          <button type="button" className="ops-chip-button" onClick={focusSelected} disabled={!current?.location}><Crosshair size={14} />Focus selected</button>
        </div>
        {tileState !== 'ready' && (
          <div className={`ops-tile-status ${tileState === 'error' ? 'is-error' : ''}`} role="status">
            {tileState === 'error' ? 'Basemap unavailable. Report locations remain visible.' : 'Loading map tiles…'}
          </div>
        )}
        {current && !current.location && (
          <div className="ops-location-missing" role="status"><MapPin size={15} /> Selected report has no shared location</div>
        )}
      </div>
      <div className="ops-map-caption">
        <span><MapPin size={13} />{located.length} mapped of {reports.length} shown</span>
        <span className="ops-legend">
          <span><i className="ops-dot is-open" />Needs review</span>
          <span><i className="ops-dot is-ack" />Acknowledged</span>
          <span><i className="ops-ring" />GPS accuracy</span>
        </span>
      </div>
    </div>
  );
}
