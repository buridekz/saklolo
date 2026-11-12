import { useEffect, useRef, useState, type CSSProperties } from 'react';
import L from 'leaflet';
import { Crosshair, MapPin, Minus, Plus, Scan } from 'lucide-react';
import type { Report } from '../data';
import { age, clockTime, isOpen, locationLine, prefersReducedMotion } from './format';

const SYMBOLS: Record<string, string> = {
  Medical: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  Fire: '<path d="M12 3c2 5 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-6 0 3 2 4 3 4 1-3 1-6 0-9z"/>',
  Safety: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="M12 8v4M12 16h.01"/>',
  Flood: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  Other: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
};

/** Reports waiting longer than this get an amber "waiting" ring on the map. */
const LONG_WAIT_MS = 5 * 60 * 1000;
const BASEMAP_KEY = 'saklolo.ops.basemap';

type Basemap = 'muted' | 'streets';
type Entry = { marker: L.Marker; group: Report[] };

type Props = {
  reports: Report[];
  /** Report shown in the detail drawer, or null when the drawer is closed. */
  selected: string | null;
  hovered: string | null;
  fresh: ReadonlySet<string>;
  /** Pixels of the map covered by the detail drawer on the right. */
  insetRight: number;
  now: number;
  onSelect: (id: string) => void;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Built from DOM nodes with textContent, so resident-entered text can never inject markup. */
function tooltipFor(group: Report[], now: number) {
  const root = el('div', 'ops-tip');
  if (group.length > 1) {
    const open = group.filter(isOpen).length;
    root.append(el('strong', undefined, `${group.length} reports here`));
    root.append(el('span', 'ops-tip-line', open ? `${open} awaiting review` : 'All acknowledged'));
    root.append(el('span', 'ops-tip-hint', 'Click to choose a report'));
    return root;
  }
  const [report] = group;
  const head = el('div', 'ops-tip-head');
  head.append(el('strong', undefined, `${report.category} assistance`), el('span', 'ops-tip-age', age(report.createdAt, now)));
  const status = el('span', `ops-tip-status ${isOpen(report) ? 'is-open' : 'is-ack'}`, isOpen(report) ? 'Needs review' : 'Acknowledged');
  root.append(head, el('span', 'ops-tip-line', locationLine(report)), status);
  return root;
}

function decorate({ marker, group }: Entry, now: number) {
  const node = marker.getElement();
  if (!node) return;
  const oldestOpen = group.filter(isOpen).reduce<Report | null>((oldest, report) => !oldest || report.createdAt < oldest.createdAt ? report : oldest, null);
  node.classList.toggle('is-waiting', Boolean(oldestOpen && now - Date.parse(oldestOpen.createdAt) >= LONG_WAIT_MS));
  node.classList.toggle('has-age', Boolean(oldestOpen));
  const badge = node.querySelector('.ops-pin-age');
  if (badge) badge.textContent = oldestOpen ? age(oldestOpen.createdAt, now) : '';
  marker.setTooltipContent(tooltipFor(group, now));
}

export default function IncidentMap({ reports, selected, hovered, fresh, insetRight, now, onSelect }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const entries = useRef(new Map<string, Entry>());
  const lastFocus = useRef<string | null>(null);
  const didFit = useRef(false);
  const [tileState, setTileState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [basemap, setBasemap] = useState<Basemap>(() => {
    try { return localStorage.getItem(BASEMAP_KEY) === 'streets' ? 'streets' : 'muted'; } catch { return 'muted'; }
  });
  const located = reports.filter(report => report.location);
  const current = reports.find(report => report.id === selected);
  const mapRevision = JSON.stringify(reports.map(({ id, location, category, status, landmark, createdAt }) => ({ id, location, category, status, landmark, createdAt })));
  const freshKey = [...fresh].sort().join(',');
  const minute = Math.floor(now / 60000);

  useEffect(() => {
    try { localStorage.setItem(BASEMAP_KEY, basemap); } catch { /* Preference is optional. */ }
  }, [basemap]);

  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { zoomControl: false, attributionControl: false, zoomSnap: 0.5 }).setView([14.5547, 121.0244], 13);
    map.current = instance;
    // Left side stays clear of the detail drawer, so licensing attribution is always visible.
    L.control.attribution({ position: 'bottomleft' }).addTo(instance);
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

  // Rebuild markers only when report content, selection or the fresh set changes (not on every poll).
  useEffect(() => {
    const layer = markers.current;
    if (!layer) return;
    layer.clearLayers();
    entries.current.clear();
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
        html: `<div class="ops-pin-body">${content}</div><span class="ops-pin-age"></span>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      const marker = L.marker([point.lat, point.lng], {
        icon,
        title: group.length > 1 ? `${group.length} reports at this location` : `${report.category} assistance`,
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: active ? 1000 : isNew ? 500 : 0,
      }).addTo(layer);
      marker.bindTooltip(tooltipFor(group, Date.now()), { direction: 'top', offset: [0, -22], className: 'ops-pin-tooltip', opacity: 1 });
      if (group.length > 1) {
        const popup = el('div', 'ops-map-popup');
        popup.append(el('strong', undefined, `${group.length} reports near this location`), el('p', undefined, 'Locations within approximately 15 m. Select a report to review.'));
        for (const item of group) {
          const button = el('button', isOpen(item) ? 'is-open' : 'is-ack', `${item.category} · ${item.landmark || 'Shared GPS location'} (${clockTime(item.createdAt)})`);
          button.type = 'button';
          button.addEventListener('click', () => { onSelect(item.id); map.current?.closePopup(); });
          popup.append(button);
        }
        marker.bindPopup(popup, { maxWidth: 300, offset: [0, -14] });
        marker.on('popupopen', () => marker.closeTooltip());
      } else marker.on('click', () => onSelect(report.id));
      if (active && point.accuracy) {
        L.circle([point.lat, point.lng], { radius: point.accuracy, color: '#294c35', weight: 1, fillOpacity: 0.07, interactive: false, className: 'ops-accuracy' }).addTo(layer);
      }
      const entry = { marker, group };
      decorate(entry, Date.now());
      for (const item of group) entries.current.set(item.id, entry);
    }
    // mapRevision and freshKey summarise reports/fresh, so routine polling does not rebuild markers.
  }, [mapRevision, selected, freshKey, onSelect]);

  // Waiting badges and rings advance once a minute without rebuilding markers.
  useEffect(() => {
    const seen = new Set<Entry>();
    for (const entry of entries.current.values()) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      decorate(entry, now);
    }
  }, [minute, mapRevision]);

  // Hovering a queue row highlights its pin and shows its summary card.
  useEffect(() => {
    const entry = hovered ? entries.current.get(hovered) : undefined;
    if (!entry) return;
    const node = entry.marker.getElement();
    node?.classList.add('is-hover');
    const bounds = map.current?.getBounds();
    if (bounds?.contains(entry.marker.getLatLng())) entry.marker.openTooltip();
    return () => { node?.classList.remove('is-hover'); entry.marker.closeTooltip(); };
  }, [hovered, mapRevision, selected, freshKey]);

  // Camera: frame everything on first data, then follow the selected report clear of the drawer.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const reduced = prefersReducedMotion();
    if (current?.location) {
      const { lat, lng } = current.location;
      const focusKey = `${current.id}:${lat}:${lng}`;
      if (lastFocus.current === focusKey) return;
      const target = L.latLngBounds([[lat, lng], [lat, lng]]);
      const options = { paddingTopLeft: [24, 72] as [number, number], paddingBottomRight: [insetRight + 24, 24] as [number, number], maxZoom: Math.max(instance.getZoom(), 15) };
      if (didFit.current && !reduced) instance.flyToBounds(target, { ...options, duration: 0.6 });
      else instance.fitBounds(target, options);
      lastFocus.current = focusKey;
      didFit.current = true;
    } else if (!selected) {
      lastFocus.current = null;
      if (!didFit.current && located.length) {
        instance.fitBounds(boundsOf(located), { padding: [64, 64], maxZoom: 16 });
        didFit.current = true;
      }
    }
  }, [current?.id, current?.location?.lat, current?.location?.lng, selected, insetRight, located.length]);

  function boundsOf(list: Report[]) {
    return L.latLngBounds(list.map(report => [report.location!.lat, report.location!.lng] as [number, number]));
  }

  function fitReports() {
    const instance = map.current;
    if (!instance || !located.length) return;
    const options = { paddingTopLeft: [56, 80] as [number, number], paddingBottomRight: [insetRight + 56, 56] as [number, number], maxZoom: 16 };
    if (prefersReducedMotion()) instance.fitBounds(boundsOf(located), options);
    else instance.flyToBounds(boundsOf(located), { ...options, duration: 0.6 });
  }

  function focusSelected() {
    const instance = map.current;
    if (!instance || !current?.location) return;
    const { lat, lng } = current.location;
    const options = { paddingTopLeft: [24, 72] as [number, number], paddingBottomRight: [insetRight + 24, 24] as [number, number], maxZoom: 17 };
    const target = L.latLngBounds([[lat, lng], [lat, lng]]);
    if (prefersReducedMotion()) instance.fitBounds(target, options);
    else instance.flyToBounds(target, { ...options, duration: 0.55 });
  }

  const unmapped = reports.length - located.length;

  return (
    <div className={`ops-map-canvas ${basemap === 'muted' ? 'is-muted' : ''}`} style={{ '--inset': `${insetRight}px` } as CSSProperties}>
      <div ref={element} className="ops-map" aria-label="Map of received incident locations" />

      <div className="ops-map-toolbar">
        <div className="ops-map-group">
          <button type="button" onClick={fitReports} disabled={!located.length}><Scan size={14} />Fit all</button>
          <button type="button" onClick={focusSelected} disabled={!current?.location}><Crosshair size={14} />Focus</button>
        </div>
        <div className="ops-map-group ops-basemap" role="group" aria-label="Basemap style">
          <button type="button" aria-pressed={basemap === 'muted'} onClick={() => setBasemap('muted')}>Muted</button>
          <button type="button" aria-pressed={basemap === 'streets'} onClick={() => setBasemap('streets')}>Streets</button>
        </div>
        <span className="ops-map-count">
          <MapPin size={13} />{located.length} mapped{unmapped > 0 && <em> · {unmapped} without GPS</em>}
        </span>
      </div>

      {tileState !== 'ready' && (
        <div className={`ops-tile-status ${tileState === 'error' ? 'is-error' : ''}`} role="status">
          {tileState === 'error' ? 'Basemap unavailable. Report locations remain visible.' : 'Loading map tiles…'}
        </div>
      )}
      {current && !current.location && (
        <div className="ops-location-missing" role="status"><MapPin size={15} /> This report has no shared location. Use the landmark.</div>
      )}

      <div className="ops-map-dock">
        <div className="ops-map-zoom" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}><Plus size={16} /></button>
          <button type="button" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}><Minus size={16} /></button>
        </div>
        <div className="ops-map-legend" aria-label="Map legend">
          <span><i className="ops-dot is-open" />Needs review</span>
          <span><i className="ops-dot is-wait" />Waiting 5m+</span>
          <span><i className="ops-dot is-ack" />Acknowledged</span>
          <span><i className="ops-ring" />GPS accuracy</span>
        </div>
      </div>
    </div>
  );
}
