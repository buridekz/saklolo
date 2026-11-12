import { useCallback, useEffect, useRef, useState } from 'react';
import Resident from './Resident';
import './operator.css';
import L from 'leaflet';
import { io } from 'socket.io-client';
import { ArrowRight, Check, CheckCheck, Clock3, Search, RefreshCw, Mic, ShieldCheck, LayoutDashboard, MapPin, Plus, Radio, Smartphone, Wifi, WifiOff } from 'lucide-react';
import { api, syncReports, type Report } from './data';

const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function IncidentMap({ reports, selected, onSelect }: { reports: Report[]; selected: string | null; onSelect: (id: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const lastFocus = useRef<string | null>(null);
  const [tileState, setTileState] = useState<'loading' | 'ready' | 'error'>('loading');
  const located = reports.filter(report => report.location);
  const current = reports.find(report => report.id === selected);
  const mapRevision = JSON.stringify(reports.map(({ id, location, category, status, landmark, createdAt }) => ({ id, location, category, status, landmark, createdAt })));
  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { zoomControl: false }).setView([14.5547, 121.0244], 13);
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
    const observer = new ResizeObserver(() => instance.invalidateSize()); observer.observe(element.current);
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
    const symbols: Record<string, string> = {
      Medical: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
      Fire: '<path d="M12 3c2 5 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-6 0 3 2 4 3 4 1-3 1-6 0-9z"/>',
      Safety: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/>',
      Flood: '<path d="M2 8c3-4 4 4 7 0s4 4 7 0 4 4 6 0M2 14c3-4 4 4 7 0s4 4 7 0 4 4 6 0M2 20c3-4 4 4 7 0s4 4 7 0 4 4 6 0"/>',
      Other: '<path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17v1"/><circle cx="12" cy="12" r="10"/>',
    };
    for (const group of groups.values()) {
      const report = group.find(item => item.id === selected) || group[0];
      const point = report.location!;
      const active = group.some(item => item.id === selected);
      const reviewed = group.every(item => item.status === 'acknowledged');
      const icon = L.divIcon({ className: `ops-map-pin ${reviewed ? 'is-reviewed' : ''} ${active ? 'is-active' : ''}`, html: group.length > 1 ? `<span>${group.length}</span>` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${symbols[report.category] || symbols.Other}</svg>`, iconSize: [36, 36], iconAnchor: [18, 18] });
      const marker = L.marker([point.lat, point.lng], { icon, title: group.length > 1 ? `${group.length} reports at this location` : `${report.category} assistance`, keyboard: true, zIndexOffset: active ? 1000 : 0 }).addTo(layer);
      if (group.length > 1) {
        const popup = document.createElement('div'); popup.className = 'ops-map-popup';
        const title = document.createElement('strong'); title.textContent = `${group.length} reports near this location`; popup.append(title);
        const note = document.createElement('p'); note.textContent = 'Locations within approximately 15 m. Select a report to review.'; popup.append(note);
        for (const item of group) {
          const button = document.createElement('button'); button.type = 'button';
          button.textContent = `${item.category} - ${item.landmark || 'Shared GPS location'} (${time(item.createdAt)})`;
          button.addEventListener('click', () => { onSelect(item.id); map.current?.closePopup(); }); popup.append(button);
        }
        marker.bindPopup(popup, { maxWidth: 280 });
      } else marker.on('click', () => onSelect(report.id));
      if (active && point.accuracy) L.circle([point.lat, point.lng], { radius: point.accuracy, color: '#294c35', weight: 1, fillOpacity: 0.07, interactive: false }).addTo(layer);
    }
    const report = reports.find(item => item.id === selected);
    if (report?.location) {
      const { lat, lng } = report.location;
      const focusKey = `${report.id}:${lat}:${lng}`;
      if (lastFocus.current !== focusKey) { map.current?.setView([lat, lng], Math.max(map.current.getZoom(), 14)); lastFocus.current = focusKey; }
    }
  }, [mapRevision, selected, onSelect]);
  function fitReports() {
    if (located.length) map.current?.fitBounds(L.latLngBounds(located.map(report => [report.location!.lat, report.location!.lng] as [number, number])), { padding: [48, 48], maxZoom: 16 });
  }
  function focusSelected() {
    if (current?.location) map.current?.setView([current.location.lat, current.location.lng], 16);
  }
  return <div className="ops-map-section"><div className="ops-map-canvas"><div ref={element} className="map" aria-label="Map of received incident locations"/><div className="ops-map-controls"><button onClick={fitReports} disabled={!located.length}><MapPin size={14}/>Fit reports</button><button onClick={focusSelected} disabled={!current?.location}><Search size={14}/>Focus selected</button></div>{tileState !== 'ready' && <div className={`ops-tile-status ${tileState === 'error' ? 'is-error' : ''}`} role="status">{tileState === 'error' ? 'Basemap unavailable. Report locations remain visible.' : 'Loading map tiles...'}</div>}{current && !current.location && <div className="ops-location-missing"><MapPin size={15}/> Selected report has no shared location</div>}</div><div className="ops-map-caption"><span><MapPin size={12}/>{located.length} mapped / {reports.length} visible reports</span><span>Circle = GPS accuracy · Number = nearby reports</span></div></div>;
}

function Operator() {
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [updated, setUpdated] = useState<string | null>(null);
  const select = useCallback((id: string) => setSelected(id), []);
  const refresh = useCallback(async () => {
    try { const data = await api<Report[]>('/api/reports'); setReports(data); setError(''); setUpdated(new Date().toISOString()); }
    catch { setError('Connection interrupted. Last received reports remain available below.'); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { void refresh(); const socket = io(); socket.on('reports:changed', refresh); const timer = setInterval(refresh, 5000); return () => { socket.disconnect(); clearInterval(timer); }; }, [refresh]);
  const pending = reports.filter(report => report.status !== 'acknowledged').length;
  const visible = reports.filter(report => (status === 'all' || (status === 'review' ? report.status !== 'acknowledged' : report.status === 'acknowledged')) && (category === 'all' || report.category === category) && `${report.category} ${report.description} ${report.landmark} ${report.id}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => Number(a.status === 'acknowledged') - Number(b.status === 'acknowledged') || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const incident = visible.find(report => report.id === selected) || visible[0];
  async function acknowledge() {
    if (!incident) return; setBusy(true);
    try { await api(`/api/reports/${incident.id}/acknowledge`, { method: 'POST' }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Acknowledgement failed.'); }
    finally { setBusy(false); }
  }
  return <section className="operations">
    <div className="operations-title"><div><h1>Community response desk</h1><p>Review incoming requests. Keep every report accounted for.</p></div><button className="ops-refresh" onClick={() => void refresh()}><RefreshCw size={16}/> Refresh reports</button></div>
    <div className="ops-summary"><span><i className="needs-review-dot"/><strong>{pending}</strong> awaiting review</span><span><CheckCheck size={15}/><strong>{reports.length-pending}</strong> acknowledged</span><span><MapPin size={15}/><strong>{reports.filter(r=>r.location).length}</strong> with location</span><small>{updated ? `Updated ${time(updated)}` : 'Connecting to response desk…'}</small></div>
    {error && <div className="ops-alert" role="alert"><WifiOff size={17}/>{error}</div>}
    <div className="ops-workspace">
      <aside className="ops-queue" aria-label="Incident queue">
        <div className="ops-queue-tools"><div className="ops-queue-title"><h2>Incoming reports</h2><span>{reports.length}</span></div><div className="ops-search"><Search size={17}/><input aria-label="Search reports" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search report or landmark"/></div><div className="ops-status-filter" aria-label="Filter by status">{[['all','All'],['review','Needs review'],['acknowledged','Acknowledged']].map(([value,label])=><button key={value} aria-pressed={status===value} onClick={()=>setStatus(value)}>{label}</button>)}</div><div className="ops-filter-row"><label htmlFor="ops-category">Category</label><select id="ops-category" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All categories</option>{['Medical','Fire','Safety','Flood','Other'].map(c=><option key={c}>{c}</option>)}</select></div></div>
        <div className="ops-report-list">{!loaded ? <div className="ops-empty"><Radio size={28}/><h3>Loading reports</h3><p>Connecting to the receiving system.</p></div> : visible.length===0 ? <div className="ops-empty"><Search size={28}/><h3>{reports.length ? 'No matching reports' : 'Ready to receive'}</h3><p>{reports.length ? 'Try another search or clear your filters.' : 'Delivered resident requests will appear here.'}</p>{reports.length>0 && <button onClick={()=>{setQuery('');setCategory('all');setStatus('all');}}>Clear filters</button>}</div> : visible.map(report=><button key={report.id} className={`ops-report ${incident?.id===report.id?'is-selected':''}`} aria-pressed={incident?.id===report.id} onClick={()=>setSelected(report.id)}><div className="ops-report-heading"><strong>{report.category} assistance</strong><time>{time(report.createdAt)}</time></div><p>{report.landmark || (report.location ? 'GPS location shared' : 'Location needs confirmation')}</p><div className="ops-report-bottom"><span className={`ops-state ${report.status==='acknowledged'?'is-ack':'is-new'}`}>{report.status==='acknowledged'?<Check size={12}/>:<span/>}{report.status==='acknowledged'?'Acknowledged':'Needs review'}</span><span className="ops-source">{report.source==='voice'?<Mic size={12}/>:<Smartphone size={12}/>} {report.source==='voice'?'Voice':'Resident'}</span></div></button>)}</div>
        <div className="ops-queue-footer">{visible.length} of {reports.length} reports · newest unreviewed first</div>
      </aside>
      <div className="ops-main"><div className="ops-map-heading"><h2><MapPin size={17}/> Incident map</h2><div><span className="needs-review-dot"/> Needs review <span className="ack-dot"/> Acknowledged</div></div><IncidentMap reports={visible} selected={incident?.id || null} onSelect={select}/>
      {incident ? <section className="ops-detail" aria-label="Selected incident"><div className="ops-detail-heading"><div><h2>{incident.category} assistance</h2><p>Report #{incident.id.slice(0,8).toUpperCase()} · {incident.source==='voice'?'Voice-assisted report':'Resident report'}</p></div><span className={`ops-state ${incident.status==='acknowledged'?'is-ack':'is-new'}`}>{incident.status==='acknowledged'?<CheckCheck size={14}/>:<Clock3 size={14}/>} {incident.status==='acknowledged'?'Acknowledged':'Awaiting review'}</span></div><div className="ops-detail-body"><div className="ops-description"><h3>What happened</h3><p>{incident.description || 'No description was provided. Confirm the situation with the reporter.'}</p><div className="ops-landmark"><MapPin size={17}/><div><span>Nearest landmark</span><strong>{incident.landmark || 'Not provided'}</strong></div></div></div><dl><div><dt>Location</dt><dd>{incident.location?`${incident.location.lat.toFixed(5)}, ${incident.location.lng.toFixed(5)}`:'Not shared'}</dd>{incident.location?.accuracy!=null && <small>Accuracy ±{Math.round(incident.location.accuracy)} m</small>}</div><div><dt>Location captured</dt><dd>{incident.locationCapturedAt?new Date(incident.locationCapturedAt).toLocaleString(): 'Not available'}</dd></div><div><dt>Recorded / received</dt><dd>{time(incident.createdAt)} / {incident.receivedAt?time(incident.receivedAt):'Pending'}</dd></div></dl></div><div className="ops-action"><p><ShieldCheck size={17}/><span>{incident.status==='acknowledged'?'Review confirmed. No responder has been dispatched.':'Acknowledge once you have reviewed this request.'}<small>This action confirms review; it does not dispatch a responder.</small></span></p><button className="ops-acknowledge" disabled={busy || incident.status==='acknowledged'} onClick={()=>void acknowledge()}><CheckCheck size={17}/>{busy?'Saving…':incident.status==='acknowledged'?'Acknowledged':'Acknowledge report'}</button></div></section> : <div className="ops-no-selection"><Radio size={28}/><h2>Select a report to begin</h2><p>Incident details and review controls will appear here.</p></div>}
      </div>
    </div>
  </section>;
}

export default function App() {
  const [route, setRoute] = useState(location.pathname === '/operator' ? 'operator' : 'resident');
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const sync = () => void syncReports();
    sync(); const timer = setInterval(sync, 5000);
    window.addEventListener('online', sync);
    return () => { clearInterval(timer); window.removeEventListener('online', sync); };
  }, []);
  useEffect(() => {
    const check = async () => { try { await api('/api/health'); setConnected(true); } catch { setConnected(false); } };
    void check(); const timer = setInterval(check, 5000); return () => clearInterval(timer);
  }, []);
  useEffect(() => { const pop = () => setRoute(location.pathname === '/operator' ? 'operator' : 'resident'); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  const navigate = (next: string) => { history.pushState({}, '', next === 'operator' ? '/operator' : '/'); setRoute(next); };
  if (route === 'resident') return <Resident connected={connected} openDesk={() => navigate('operator')} />;
  return <><div className="demo-banner">Hackathon prototype · No real emergency service is connected.</div><header><a href="/" className="brand" onClick={e => { e.preventDefault(); navigate('resident'); }}><span><Plus size={25} strokeWidth={3} /></span>Saklolo<span className="brand-sub">Community response</span></a><nav aria-label="Main navigation"><button className={route === 'resident' ? 'current' : ''} onClick={() => navigate('resident')}><Smartphone size={17} /> Resident</button><button className={route === 'operator' ? 'current' : ''} onClick={() => navigate('operator')}><LayoutDashboard size={17} /> Response desk</button></nav><div className={`connection ${connected ? 'connected' : ''}`}>{connected ? <Wifi size={15} /> : <WifiOff size={15} />}<span>{connected ? 'Desk reachable' : 'Desk unreachable'}</span></div></header><main><Operator /></main><footer><span>Saklolo · Manila Hack prototype</span><span>Saved locally. Delivery confirmed separately.</span></footer></>;
}
