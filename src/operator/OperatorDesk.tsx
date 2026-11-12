import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import {
  ArrowRight, Check, CheckCheck, CircleDashed, Clock3, Copy, ExternalLink, Inbox, LayoutDashboard, LoaderCircle,
  MapPin, Mic, Plus, Radio, RefreshCw, Search, ShieldCheck, Smartphone, Timer, Truck, Wifi, WifiOff, X,
} from 'lucide-react';
import { api, categories, type Category, type Report } from '../data';
import IncidentMap from './IncidentMap';
import { useCountUp, useMediaQuery, useNow } from './hooks';
import {
  CATEGORY_ICONS, STALE_LOCATION_MS, age, ageLabel, clockTime, fullTime, isOpen, locationLine, prefersReducedMotion,
  shortId, sourceLabel,
} from './format';
import './operator.css';

type StatusFilter = 'all' | 'review' | 'acknowledged';
type Toast = { id: number; tone: 'new' | 'success' | 'info' | 'error'; title: string; body?: string; action?: { label: string; run: () => void } };

const FRESH_MS = 2600;

export default function OperatorDesk({ connected, onNavigate }: { connected: boolean; onNavigate: (route: 'resident' | 'operator') => void }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [updated, setUpdated] = useState<string | null>(null);
  const [spinKey, setSpinKey] = useState(0);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const now = useNow(20000);
  const known = useRef<Map<string, number> | null>(null);
  const requestSeq = useRef(0);
  const appliedSeq = useRef(0);
  const toastSeq = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const lastShown = useRef<Report | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const wide = useMediaQuery('(min-width: 900px)');

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++toastSeq.current;
    setToasts(list => [...list.slice(-2), { ...toast, id }]);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts(list => list.filter(toast => toast.id !== id)), []);

  const markFresh = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setFresh(current => new Set([...current, ...ids]));
    window.setTimeout(() => setFresh(current => {
      const next = new Set(current);
      ids.forEach(id => next.delete(id));
      return next;
    }), FRESH_MS);
  }, []);

  const reveal = useCallback((id: string) => {
    setQuery(''); setStatus('all'); setCategory('all'); setSelected(id); setDrawerOpen(true);
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const data = await api<Report[]>('/api/reports');
      if (seq < appliedSeq.current) return; // A newer response already landed.
      appliedSeq.current = seq;
      const previous = known.current;
      if (previous) {
        const added = data.filter(report => !previous.has(report.id));
        const revised = data.filter(report => previous.has(report.id) && (report.revision || 1) > (previous.get(report.id) || 1));
        if (added.length === 1) {
          const [report] = added;
          pushToast({ tone: 'new', title: `New ${report.category.toLowerCase()} report`, body: locationLine(report), action: { label: 'Review', run: () => reveal(report.id) } });
        } else if (added.length > 1) {
          pushToast({ tone: 'new', title: `${added.length} new reports`, body: 'Unreviewed reports are listed first.', action: { label: 'Show', run: () => { setQuery(''); setCategory('all'); setStatus('review'); } } });
        }
        if (revised.length) {
          pushToast({ tone: 'info', title: revised.length === 1 ? `Report #${shortId(revised[0])} updated` : `${revised.length} reports updated`, body: 'The resident sent new details or a newer location.' });
        }
        markFresh([...added, ...revised].map(report => report.id));
      }
      known.current = new Map(data.map(report => [report.id, report.revision || 1]));
      setReports(data);
      setError('');
      setUpdated(new Date().toISOString());
    } catch {
      setError('Connection interrupted. Last received reports remain available below.');
    } finally {
      setLoaded(true);
    }
  }, [pushToast, markFresh, reveal]);

  useEffect(() => {
    void refresh();
    const socket = io();
    socket.on('reports:changed', () => void refresh());
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { socket.disconnect(); window.clearInterval(timer); };
  }, [refresh]);

  const open = useMemo(() => reports.filter(isOpen), [reports]);
  const oldestOpen = useMemo(() => open.reduce<Report | null>((oldest, report) => !oldest || Date.parse(report.createdAt) < Date.parse(oldest.createdAt) ? report : oldest, null), [open]);
  const located = reports.filter(report => report.location).length;
  const categoryCounts = useMemo(() => {
    const counts = new Map<Category, number>();
    for (const report of reports) counts.set(report.category, (counts.get(report.category) || 0) + 1);
    return counts;
  }, [reports]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return reports
      .filter(report => status === 'all' || (status === 'review' ? isOpen(report) : !isOpen(report)))
      .filter(report => category === 'all' || report.category === category)
      .filter(report => !needle || `${report.category} ${report.description} ${report.landmark} ${report.id}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [reports, status, category, query]);

  // The drawer shows exactly the chosen report; arrivals and re-sorts never swap it.
  const incident = drawerOpen ? visible.find(report => report.id === selected) : undefined;
  if (incident) lastShown.current = incident;
  const drawerReport = incident ?? lastShown.current; // Keeps content in place while the drawer slides out.
  const insetRight = incident && wide ? drawerRef.current?.offsetWidth ?? 420 : 0;
  const nextOpen = visible.find(report => isOpen(report) && report.id !== incident?.id);
  const filtered = query.trim() !== '' || status !== 'all' || category !== 'all';

  useEffect(() => {
    if (drawerOpen && !incident) setDrawerOpen(false); // Chosen report was filtered out.
  }, [drawerOpen, incident]);

  useEffect(() => {
    const previous = document.title;
    document.title = open.length ? `(${open.length}) Response desk · Saklolo` : 'Response desk · Saklolo';
    return () => { document.title = previous; };
  }, [open.length]);

  // J/K anywhere (outside fields) and arrow keys inside the queue move the selection. "/" focuses search.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .leaflet-container')) {
        if (event.key === 'Escape' && target === searchRef.current) searchRef.current.blur();
        return;
      }
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); return; }
      if (event.key === 'Escape' && drawerOpen) { closeDrawer(); return; }
      const inQueue = Boolean(target?.closest('.ops-queue'));
      const step = event.key === 'j' || (inQueue && event.key === 'ArrowDown') ? 1 : event.key === 'k' || (inQueue && event.key === 'ArrowUp') ? -1 : 0;
      if (!step || !visible.length) return;
      event.preventDefault();
      const index = visible.findIndex(report => report.id === (incident?.id ?? selected));
      const next = index < 0 ? visible[0] : visible[Math.min(visible.length - 1, Math.max(0, index + step))];
      setSelected(next.id);
      setDrawerOpen(true);
      const rowFocused = Boolean(target?.closest('.ops-report'));
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`[data-report-id="${next.id}"]`);
        row?.scrollIntoView({ block: 'nearest' });
        if (rowFocused) row?.focus({ preventScroll: true });
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, incident?.id, selected, drawerOpen]);

  const choose = useCallback((id: string) => { setSelected(id); setDrawerOpen(true); }, []);
  const closeDrawer = useCallback(() => {
    // If focus was inside the drawer, hand it back to the report's queue row instead of losing it.
    const focusInside = drawerRef.current?.contains(document.activeElement);
    setDrawerOpen(false);
    if (focusInside && selected) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-report-id="${selected}"]`)?.focus({ preventScroll: true }));
    }
  }, [selected]);

  function filterBy(next: StatusFilter) {
    setStatus(current => current === next ? 'all' : next);
  }

  function manualRefresh() {
    setSpinKey(key => key + 1);
    void refresh();
  }

  async function acknowledge(report: Report) {
    setBusyId(report.id);
    try {
      const saved = await api<Report>(`/api/reports/${report.id}/acknowledge`, { method: 'POST' });
      setReports(list => list.map(item => item.id === saved.id ? saved : item));
      pushToast({ tone: 'success', title: `Review recorded · #${shortId(report)}`, body: 'Acknowledged on the demo desk. No responder has been dispatched.' });
      void refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Acknowledgement failed.';
      pushToast({ tone: 'error', title: 'Acknowledgement not saved', body: message });
    } finally {
      setBusyId(null);
    }
  }

  function clearFilters() { setQuery(''); setStatus('all'); setCategory('all'); }

  return (
    <div className="ops-shell">
      <div className="ops-banner">Hackathon prototype · No real emergency service is connected.</div>
      <header className="ops-topbar">
        <a href="/" className="ops-brand" onClick={event => { event.preventDefault(); onNavigate('resident'); }}>
          <span className="ops-brand-mark"><Plus size={20} strokeWidth={3} /></span>
          <span className="ops-brand-name">Saklolo</span>
          <span className="ops-brand-sub">Community response</span>
        </a>
        <nav className="ops-nav" aria-label="Main navigation">
          <button type="button" onClick={() => onNavigate('resident')}><Smartphone size={16} /> Resident</button>
          <button type="button" aria-current="page" className="is-current"><LayoutDashboard size={16} /> Response desk</button>
        </nav>
        <div className={`ops-connection ${connected ? 'is-up' : 'is-down'}`} role="status">
          {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          <span>{connected ? 'Desk reachable' : 'Desk unreachable'}</span>
        </div>
      </header>

      <main className="ops-page">
        <div className="ops-head">
          <div>
            <h1>Community response desk</h1>
            <p>Review incoming requests. Keep every report accounted for.</p>
          </div>
          <div className="ops-head-actions">
            <span className="ops-sync" title={updated ? fullTime(updated) : undefined}>
              <span className={`ops-live-dot ${error ? 'is-off' : ''}`} />
              {error ? 'Reconnecting…' : updated ? `Live · synced ${clockTime(updated)}` : 'Connecting…'}
            </span>
            <button type="button" className="ops-button ops-button-quiet" onClick={manualRefresh}>
              <RefreshCw key={spinKey} size={15} className={spinKey ? 'ops-spin-once' : undefined} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <section className="ops-stats" aria-label="Desk summary">
          <Stat tone="alert" icon={<Clock3 size={16} />} label="Awaiting review" value={open.length}
            pressed={status === 'review'} onPress={() => filterBy('review')}
            sub={oldestOpen ? <>Oldest waiting <strong>{age(oldestOpen.createdAt, now)}</strong></> : loaded ? 'Queue clear' : '—'} />
          <Stat tone="ok" icon={<CheckCheck size={16} />} label="Acknowledged" value={reports.length - open.length}
            pressed={status === 'acknowledged'} onPress={() => filterBy('acknowledged')}
            sub={reports.length ? `${Math.round(((reports.length - open.length) / reports.length) * 100)}% of received` : 'None yet'} />
          <Stat icon={<MapPin size={16} />} label="With location" value={located}
            sub={reports.length - located ? `${reports.length - located} need a landmark` : reports.length ? 'All reports mapped' : 'None yet'} />
          <Stat icon={<Inbox size={16} />} label="Received" value={reports.length}
            pressed={!filtered && reports.length > 0} onPress={clearFilters}
            sub={reports.length ? `Latest ${ageLabel(reports.reduce((a, b) => Date.parse(a.createdAt) > Date.parse(b.createdAt) ? a : b).createdAt, now)}` : 'Waiting for residents'} />
        </section>

        {error && <div className="ops-alert" role="alert"><WifiOff size={16} />{error}</div>}

        <div className="ops-workspace">
          <aside className="ops-queue" aria-label="Incident queue">
            <div className="ops-queue-inner">
              <div className="ops-queue-tools">
                <div className="ops-queue-title">
                  <h2>Incoming reports</h2>
                  <span className="ops-count">{reports.length}</span>
                </div>
                <label className="ops-search">
                  <Search size={16} aria-hidden />
                  <input ref={searchRef} aria-label="Search reports" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search report, landmark, ID" />
                  {query ? (
                    <button type="button" className="ops-search-clear" aria-label="Clear search" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X size={14} /></button>
                  ) : <kbd aria-hidden>/</kbd>}
                </label>
                <div className="ops-segment" role="group" aria-label="Filter by status" style={{ '--index': ['all', 'review', 'acknowledged'].indexOf(status) } as CSSProperties}>
                  <span className="ops-segment-thumb" aria-hidden />
                  {([['all', 'All', reports.length], ['review', 'Needs review', open.length], ['acknowledged', 'Done', reports.length - open.length]] as const).map(([value, label, count]) => (
                    <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}>
                      {label}<span>{count}</span>
                    </button>
                  ))}
                </div>
                <div className="ops-chips" role="group" aria-label="Filter by category">
                  <button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>All types</button>
                  {categories.map(name => {
                    const Icon = CATEGORY_ICONS[name];
                    const count = categoryCounts.get(name) || 0;
                    return (
                      <button key={name} type="button" aria-pressed={category === name} disabled={!count && category !== name} onClick={() => setCategory(category === name ? 'all' : name)}>
                        <Icon size={13} aria-hidden />{name}{count > 0 && <span>{count}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="ops-report-list">
                {!loaded ? (
                  <div className="ops-skeleton" aria-label="Loading reports" role="status">
                    {[0, 1, 2, 3].map(index => <div key={index} className="ops-skeleton-row" style={{ animationDelay: `${index * 90}ms` }} />)}
                  </div>
                ) : visible.length === 0 ? (
                  <div className="ops-empty">
                    <span className="ops-empty-icon">{reports.length ? <Search size={20} /> : <Radio size={20} />}</span>
                    <h3>{reports.length ? 'No matching reports' : 'Ready to receive'}</h3>
                    <p>{reports.length ? 'Try another search or clear your filters.' : 'Delivered resident requests will appear here the moment they arrive.'}</p>
                    {filtered && <button type="button" className="ops-button ops-button-quiet" onClick={clearFilters}>Clear filters</button>}
                  </div>
                ) : (
                  <ul className="ops-report-items">
                    {visible.map((report, index) => {
                      const Icon = CATEGORY_ICONS[report.category] || CATEGORY_ICONS.Other;
                      const active = incident?.id === report.id;
                      return (
                        <li key={report.id} style={{ '--stagger': Math.min(index, 8) } as CSSProperties}>
                          <button
                            type="button"
                            data-report-id={report.id}
                            className={['ops-report', active && 'is-selected', isOpen(report) ? 'is-open' : 'is-ack', fresh.has(report.id) && 'is-fresh'].filter(Boolean).join(' ')}
                            aria-pressed={active}
                            onClick={() => choose(report.id)}
                            onMouseEnter={() => setHovered(report.id)}
                            onMouseLeave={() => setHovered(current => current === report.id ? null : current)}
                            onFocus={() => setHovered(report.id)}
                            onBlur={() => setHovered(current => current === report.id ? null : current)}
                          >
                            <span className="ops-report-icon"><Icon size={16} /></span>
                            <span className="ops-report-body">
                              <span className="ops-report-heading">
                                <strong>{report.category} assistance</strong>
                                <time dateTime={report.createdAt} title={fullTime(report.createdAt)}>{age(report.createdAt, now)}</time>
                              </span>
                              <span className="ops-report-place">{locationLine(report)}</span>
                              <span className="ops-report-meta">
                                <StatusPill report={report} />
                                <span className="ops-source">{report.source === 'voice' ? <Mic size={12} /> : <Smartphone size={12} />}{sourceLabel(report)}</span>
                                {(report.revision || 1) > 1 && <span className="ops-source">Rev {report.revision}</span>}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="ops-queue-footer">
                <span>{visible.length} of {reports.length} · unreviewed first</span>
                <span className="ops-keys" aria-hidden><kbd>J</kbd><kbd>K</kbd> move</span>
              </div>
            </div>
          </aside>

          <section className="ops-map-pane" aria-label="Incident map">
            <IncidentMap reports={visible} selected={incident?.id || null} hovered={hovered} fresh={fresh} insetRight={insetRight} now={now} onSelect={choose} />
            {loaded && !visible.length && (
              <div className="ops-map-empty">
                <Radio size={18} />
                <span>{reports.length ? 'No reports match the current filters.' : 'Waiting for the first resident report.'}</span>
              </div>
            )}
            <div className={`ops-sheet-backdrop ${incident ? 'is-open' : ''}`} onClick={closeDrawer} aria-hidden />
            <div
              ref={drawerRef}
              className={`ops-drawer ${incident ? 'is-open' : ''}`}
              inert={!incident}
              aria-hidden={!incident}
              role="region"
              aria-label="Selected incident"
            >
              {drawerReport && (
                <IncidentDetail
                  key={drawerReport.id}
                  report={drawerReport}
                  now={now}
                  busy={busyId === drawerReport.id}
                  updated={fresh.has(drawerReport.id)}
                  nextOpen={nextOpen}
                  onAcknowledge={() => void acknowledge(drawerReport)}
                  onNext={() => nextOpen && choose(nextOpen.id)}
                  onClose={closeDrawer}
                  onCopyFailed={() => pushToast({ tone: 'error', title: 'Copy unavailable', body: 'This browser blocked clipboard access.' })}
                />
              )}
            </div>
          </section>
        </div>
      </main>

      <footer className="ops-footer">
        <span>Saklolo · Manila Hack prototype</span>
        <span>Acknowledgement records review only. It never dispatches responders.</span>
      </footer>

      <div className="ops-toasts" role="status" aria-live="polite">
        {toasts.map(toast => <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />)}
      </div>
    </div>
  );
}

type StatProps = { label: string; value: number; sub: ReactNode; icon: ReactNode; tone?: 'alert' | 'ok'; pressed?: boolean; onPress?: () => void };

/** Summary card; cards with onPress double as one-click queue filters. */
function Stat({ label, value, sub, icon, tone, pressed, onPress }: StatProps) {
  const display = useCountUp(value);
  const className = ['ops-stat', tone && `is-${tone}`, onPress && 'is-action'].filter(Boolean).join(' ');
  const content = (
    <>
      <span className="ops-stat-label">{icon}{label}</span>
      <strong className="ops-stat-value">{display}</strong>
      <span className="ops-stat-sub">{sub}</span>
    </>
  );
  return onPress
    ? <button type="button" className={className} aria-pressed={Boolean(pressed)} onClick={onPress} title={`Show ${label.toLowerCase()} in the queue`}>{content}</button>
    : <div className={className}>{content}</div>;
}

function StatusPill({ report, large }: { report: Report; large?: boolean }) {
  const open = isOpen(report);
  return (
    <span className={`ops-pill ${open ? 'is-open' : 'is-ack'} ${large ? 'is-large' : ''}`}>
      {open ? <span className="ops-pill-dot" /> : <Check size={large ? 14 : 12} />}
      {open ? (large ? 'Awaiting review' : 'Needs review') : 'Acknowledged'}
    </span>
  );
}

type DetailProps = {
  report: Report;
  now: number;
  busy: boolean;
  updated: boolean;
  nextOpen?: Report;
  onAcknowledge: () => void;
  onNext: () => void;
  onCopyFailed: () => void;
  onClose: () => void;
};

function IncidentDetail({ report, now, busy, updated, nextOpen, onAcknowledge, onNext, onCopyFailed, onClose }: DetailProps) {
  const [copied, setCopied] = useState(false);
  const Icon = CATEGORY_ICONS[report.category] || CATEGORY_ICONS.Other;
  const open = isOpen(report);
  const location = report.location;
  const coords = location ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : null;
  const capturedAt = report.locationCapturedAt || null;
  const stale = capturedAt ? now - Date.parse(capturedAt) > STALE_LOCATION_MS : false;
  const waitingMinutes = (now - Date.parse(report.createdAt)) / 60000;

  async function copyCoords() {
    if (!coords) return;
    try {
      await navigator.clipboard.writeText(coords);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { onCopyFailed(); }
  }

  const steps: { label: string; at?: string | null; done: boolean; note?: string; muted?: boolean }[] = [
    { label: 'Recorded on resident device', at: report.createdAt, done: true },
    { label: 'Delivered to response desk', at: report.receivedAt, done: Boolean(report.receivedAt) },
    { label: 'Reviewed and acknowledged', at: report.acknowledgedAt, done: !open },
    { label: 'Responder dispatch', done: false, note: 'Not connected in this prototype', muted: true },
  ];

  return (
    <article className={`ops-detail ${updated ? 'is-updated' : ''}`}>
      <div className="ops-drawer-bar">
        <span className="ops-sheet-handle" aria-hidden />
        <StatusPill report={report} large />
        <span className="ops-drawer-id">#{shortId(report)}</span>
        <button type="button" className="ops-icon-button ops-drawer-close" onClick={onClose} aria-label="Close report details" title="Close (Esc)">
          <X size={16} />
        </button>
      </div>
      <div className="ops-detail-scroll">
        <header className="ops-detail-head">
          <span className={`ops-detail-icon ${open ? 'is-open' : 'is-ack'}`}><Icon size={20} /></span>
          <div className="ops-detail-title">
            <h2>{report.category} assistance</h2>
            <p>{report.source === 'voice' ? 'Voice-assisted report' : 'Resident report'} · received {report.receivedAt ? ageLabel(report.receivedAt, now) : 'pending'}{(report.revision || 1) > 1 ? ` · revision ${report.revision}` : ''}</p>
          </div>
        </header>

        {open && (
          <div className={`ops-waiting ${waitingMinutes >= 5 ? 'is-long' : ''}`}>
            <Timer size={15} />
            <span>Waiting <strong>{age(report.createdAt, now) === 'now' ? 'under a minute' : age(report.createdAt, now)}</strong> for review</span>
          </div>
        )}

        <section className="ops-block">
          <h3>What happened</h3>
          <p className={`ops-description ${report.description ? '' : 'is-empty'}`}>
            {report.description || 'No description was provided. Confirm the situation with the reporter.'}
          </p>
        </section>

        <section className="ops-block">
          <h3>Location</h3>
          <div className="ops-location-card">
            <div className="ops-location-row">
              <MapPin size={16} />
              <div>
                <span>Nearest landmark</span>
                <strong>{report.landmark || 'Not provided'}</strong>
              </div>
            </div>
            <div className="ops-location-row">
              <Radio size={16} />
              <div>
                <span>GPS coordinates</span>
                <strong className="ops-mono">{coords || 'Not shared'}</strong>
                {location?.accuracy != null && <small>Accuracy ±{Math.round(location.accuracy)} m</small>}
              </div>
              {coords && (
                <div className="ops-location-actions">
                  <button type="button" className="ops-icon-button" onClick={() => void copyCoords()} aria-label={copied ? 'Coordinates copied' : 'Copy coordinates'} title="Copy coordinates">
                    <span key={String(copied)} className="ops-swap">{copied ? <Check size={15} /> : <Copy size={15} />}</span>
                  </button>
                  <a className="ops-icon-button" href={`https://www.openstreetmap.org/?mlat=${location!.lat}&mlon=${location!.lng}#map=17/${location!.lat}/${location!.lng}`} target="_blank" rel="noreferrer" aria-label="Open in OpenStreetMap" title="Open in OpenStreetMap">
                    <ExternalLink size={15} />
                  </a>
                </div>
              )}
            </div>
            {capturedAt && (
              <div className={`ops-capture ${stale ? 'is-stale' : ''}`}>
                <Clock3 size={13} />
                Location captured {ageLabel(capturedAt, now)}{stale ? ' · may be out of date' : ''}
              </div>
            )}
          </div>
        </section>

        <section className="ops-block">
          <h3>Timeline</h3>
          <ol className="ops-timeline">
            {steps.map(step => (
              <li key={step.label} className={step.done ? 'is-done' : step.muted ? 'is-muted' : 'is-waiting'}>
                <span className="ops-step-mark">{step.done ? <Check size={11} strokeWidth={3} /> : step.muted ? <Truck size={11} /> : <CircleDashed size={11} />}</span>
                <span className="ops-step-text">
                  <strong>{step.label}</strong>
                  <small>{step.at ? fullTime(step.at) : step.note || 'Pending'}</small>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <footer className="ops-action">
        <p>
          <ShieldCheck size={16} />
          <span>{open ? 'Acknowledge once you have reviewed this request.' : 'Review confirmed. No responder has been dispatched.'}</span>
        </p>
        <div className="ops-action-buttons">
          {!open && nextOpen && (
            <button type="button" className="ops-button ops-button-quiet" onClick={onNext}>
              Next in queue <ArrowRight size={15} />
            </button>
          )}
          <button type="button" className={`ops-button ops-acknowledge ${open ? '' : 'is-done'}`} disabled={busy || !open} onClick={onAcknowledge}>
            <span key={busy ? 'busy' : open ? 'open' : 'done'} className="ops-swap">
              {busy ? <><LoaderCircle size={16} className="ops-spinner" /> Saving…</>
                : open ? <><CheckCheck size={16} /> Acknowledge report</>
                : <><Check size={16} /> Acknowledged</>}
            </span>
          </button>
        </div>
      </footer>
    </article>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const close = useCallback(() => {
    setLeaving(true);
    window.setTimeout(() => onDismiss(toast.id), prefersReducedMotion() ? 0 : 160);
  }, [onDismiss, toast.id]);

  useEffect(() => {
    if (paused || leaving) return;
    const timer = window.setTimeout(close, toast.tone === 'error' ? 8000 : 5500);
    return () => window.clearTimeout(timer);
  }, [paused, leaving, close, toast.tone]);

  return (
    <div className={`ops-toast is-${toast.tone} ${leaving ? 'is-leaving' : ''}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <span className="ops-toast-mark" aria-hidden />
      <div className="ops-toast-copy">
        <strong>{toast.title}</strong>
        {toast.body && <p>{toast.body}</p>}
      </div>
      {toast.action && (
        <button type="button" className="ops-toast-action" onClick={() => { toast.action!.run(); close(); }}>{toast.action.label}</button>
      )}
      <button type="button" className="ops-toast-close" aria-label="Dismiss notification" onClick={close}><X size={14} /></button>
    </div>
  );
}
