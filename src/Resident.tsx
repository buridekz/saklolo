import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ArrowRight, Check, CheckCheck, ChevronDown, CircleHelp, Clock3, Flame, HeartPulse, House, LocateFixed, MapPin, Mic, MicOff, Plus, Radio, RefreshCw, Shield, Square, Waves, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { categories, db, editReport, labels, syncReports, type Category, type Report } from './data';
import { useDeviceLocation } from './useDeviceLocation';
import type { VoiceStatus, VoiceTranscript } from './voice';
import './resident.css';
import LocationPreview from './LocationPreview';

const icons = { Medical: HeartPulse, Fire: Flame, Safety: Shield, Flood: Waves, Other: CircleHelp };
const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function Resident({ connected }: { connected: boolean; openDesk: () => void }) {
  const [category, setCategory] = useState<Category>('Other');
  const [description, setDescription] = useState('');
  const [landmark, setLandmark] = useState('');
  const gps = useDeviceLocation();
  const location = gps.location;
  const locationNote = gps.state === 'active' ? gps.stale ? 'Last known location · tap to refresh' : 'Location is on' : gps.state === 'requesting' ? 'Finding your location…' : gps.state === 'denied' ? 'Location permission blocked' : 'Location unavailable';
  const [reports, setReports] = useState<Report[]>([]);
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('help');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem('saklolo-active-report'));
  const [voiceState, setVoiceState] = useState<'idle' | 'connecting' | 'active'>('idle');
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('ended');
  const [transcript, setTranscript] = useState<VoiceTranscript[]>([]);
  const [muted, setMuted] = useState(false);
  const voice = useRef<{ close: () => void; mute: (muted: boolean) => void } | null>(null);
  const voiceAbort = useRef<AbortController | null>(null);
  const voiceReport = useRef<string | null>(null);
  const activeReport = useRef<string | null>(activeId);
  const mounted = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  const details = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => {
    const saved = await db.reports.orderBy('createdAt').reverse().toArray();
    setReports(saved); setReportsLoaded(true);
    if (activeReport.current && !saved.some(report => report.id === activeReport.current)) {
      activeReport.current = null; setActiveId(null); localStorage.removeItem('saklolo-active-report');
    }
  }, []);
  const currentReport = reports.find(report => report.id === activeId);

  function selectReport(report: Report) {
    activeReport.current = report.id; setActiveId(report.id);
    localStorage.setItem('saklolo-active-report', report.id);
    setCategory(report.category); setDescription(report.description); setLandmark(report.landmark);
    setDetailsOpen(false); setTab('help'); setMessage('');
  }

  function startNewRequest() {
    voiceAbort.current?.abort(); voice.current?.close(); voice.current = null;
    setVoiceState('idle'); setVoiceStatus('ended'); setTranscript([]);
    activeReport.current = null; voiceReport.current = null; setActiveId(null);
    localStorage.removeItem('saklolo-active-report');
    setCategory('Other'); setDescription(''); setLandmark(''); setMessage(''); setDetailsOpen(false); setLocationOpen(false);
  }

  function openDetails() {
    if (currentReport) { setCategory(currentReport.category); setDescription(currentReport.description); setLandmark(currentReport.landmark); }
    setDetailsOpen(true);
    requestAnimationFrame(() => document.querySelector('.phone-details')?.scrollIntoView({ behavior: 'instant', block: 'start' }));
  }

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const updated = () => void refresh();
    window.addEventListener('reports-updated', updated);
    return () => { mounted.current = false; voiceAbort.current?.abort(); voice.current?.close(); window.removeEventListener('reports-updated', updated); };
  }, [refresh]);

  useEffect(() => {
    if (gps.state === 'denied' || gps.state === 'unavailable') setDetailsOpen(true);
  }, [gps.state]);

  useEffect(() => {
    // An SOS never waits for GPS. Refresh the active incident at most every 10s.
    if (!gps.location || !gps.capturedAt || !activeReport.current) return;
    const id = activeReport.current;
    void db.reports.get(id).then(async report => {
      if (!report || activeReport.current !== id) return;
      if (report.location && report.locationCapturedAt && Date.parse(gps.capturedAt!) - Date.parse(report.locationCapturedAt) < 10000) return;
      await editReport(id, { location: gps.location, locationCapturedAt: gps.capturedAt });
      await syncReports();
    }).catch(() => setMessage('Location could not be added to the saved report. Add a landmark or retry.'));
  }, [gps.location, gps.capturedAt]);

  useLayoutEffect(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(root.current!.querySelectorAll('[data-arrive]'), { y: 12 }, { y: 0, duration: .55, stagger: .055, ease: 'power3.out', clearProps: 'transform' });
    });
    return () => media.revert();
  }, [tab, activeId]);

  useLayoutEffect(() => {
    if (!details.current || !detailsOpen) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(details.current, { height: 0, opacity: .35 }, { height: 'auto', opacity: 1, duration: .32, ease: 'power3.out', clearProps: 'height,opacity' });
    });
    return () => media.revert();
  }, [detailsOpen]);

  useLayoutEffect(() => {
    if (!message) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(root.current!.querySelector('[role="status"]'), { y: 6 }, { y: 0, duration: .25, ease: 'power2.out' });
    });
    return () => media.revert();
  }, [message]);

  function locate() {
    if (gps.state === 'denied') setMessage('Allow Location in this site’s browser permissions, then tap location again. You can still send a report with a landmark.');
    gps.retry();
  }

  async function confirmLocation() {
    const fix = gps.snapshot();
    if (!fix.location) { setMessage('No GPS fix is available yet. Refresh location or add a landmark.'); return; }
    try {
      if (activeReport.current) {
        await editReport(activeReport.current, { location: fix.location, locationCapturedAt: fix.capturedAt });
        void syncReports();
      }
      setLocationOpen(false);
      setMessage(activeReport.current ? 'Location saved with your request. Check its delivery status above.' : 'GPS location selected. It will be included with your request.');
    } catch { setMessage('Location could not be saved. Retry or add a landmark.'); }
  }

  async function submit(nextCategory: Category, text: string, place: string, source: Report['source']) {
    const fix = gps.snapshot();
    const existingId = activeReport.current || (source === 'voice' ? voiceReport.current : null);
    const report: Report = { id: existingId || crypto.randomUUID(), createdAt: new Date().toISOString(), category: nextCategory, description: text, landmark: place, location: fix.location, locationCapturedAt: fix.capturedAt, revision: 1, source, status: 'pending' };
    if (existingId) {
      await editReport(existingId, { category: nextCategory, description: text, landmark: place, ...(fix.location ? { location: fix.location, locationCapturedAt: fix.capturedAt } : {}) });
    } else {
      await db.reports.put(report);
      if (source === 'voice') voiceReport.current = report.id;
    }
    activeReport.current = report.id;
    setActiveId(report.id); localStorage.setItem('saklolo-active-report', report.id);
    const laterFix = gps.snapshot();
    if (!report.location && laterFix.location) await editReport(report.id, { location: laterFix.location, locationCapturedAt: laterFix.capturedAt });
    await refresh();
    setDetailsOpen(false);
    setMessage('Saved on this phone. Trying to reach the demo desk.');
    await syncReports();
    const saved = await db.reports.get(report.id);
    const status = saved?.status || 'pending';
    const result = saved?.needsSync ? 'Changes saved on this phone. Updated details are waiting for delivery.' : status === 'pending' ? 'Saved on this phone. Not delivered yet; we’ll retry while the app is open.' : status === 'acknowledged' ? 'Acknowledged by the demo desk. No real responder has been dispatched.' : 'Delivered to the demo desk. Waiting for an operator to acknowledge.';
    if (mounted.current) setMessage(result);
    return result;
  }

  async function send(source: 'sos' | 'form') {
    if (busy || !reportsLoaded) return;
    setBusy(true);
    try {
      await submit(category, description.trim(), landmark.trim(), source);
      root.current?.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
    catch { setMessage('Could not save this report. Please try again.'); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function toggleVoice() {
    if (voiceState !== 'idle') { voiceAbort.current?.abort(); voice.current?.close(); voice.current = null; setVoiceState('idle'); setVoiceStatus('ended'); setMessage('Voice session ended. Your saved reports are in Reports.'); return; }
    const controller = new AbortController(); voiceAbort.current = controller;
    voiceReport.current = activeReport.current;
    setTranscript([]); setMuted(false); setVoiceState('connecting'); setMessage('Connecting voice. Allow microphone access when your browser asks.');
    try {
      const { startVoice } = await import('./voice');
      const session = await startVoice(async (nextCategory, text, place) => {
        setCategory(nextCategory); setDescription(text); setLandmark(place);
        return submit(nextCategory, text, place, 'voice');
      }, setMessage, {
        signal: controller.signal,
        onStatus: status => { if (!mounted.current || voiceAbort.current !== controller) return; setVoiceStatus(status); if (status === 'ended') { setVoiceState('idle'); voice.current = null; } },
        onTranscript: items => { if (mounted.current && voiceAbort.current === controller) setTranscript(items); }
      });
      if (!mounted.current || controller.signal.aborted) { session.close(); return; }
      voice.current = session; setVoiceState('active'); setMessage('Voice connected. Speak naturally; you can interrupt the assistant. Audio is sent to OpenAI.');
    } catch (error) { if (mounted.current && !controller.signal.aborted) { setVoiceState('idle'); setMessage(error instanceof Error ? error.message : 'Voice unavailable. You can still send an SOS.'); } }
  }

  function toggleMute() { const next = !muted; voice.current?.mute(next); setMuted(next); }

  const delivered = currentReport && currentReport.status !== 'pending';
  const acknowledged = currentReport?.status === 'acknowledged';
  const requestTitle = acknowledged ? 'Your request was reviewed' : delivered ? 'Request delivered' : 'Saved on this phone';
  const requestExplanation = acknowledged ? 'The demo desk acknowledged your request. No responder has been dispatched.' : delivered ? 'Waiting for an operator to review your request.' : 'Not delivered yet. Keep the app open; we’ll retry when the desk is reachable.';
  const voiceLabel = muted ? 'Microphone muted' : voiceStatus === 'speaking' ? 'Assistant speaking' : voiceStatus === 'saving' ? 'Saving your report' : voiceState === 'connecting' ? 'Connecting voice…' : 'Listening to you';

  return <div className="resident-stage">
    <div ref={root} className="phone-app">
      <div className="phone-topbar">
        <a href="/" className="phone-brand" aria-label="Saklolo home"><span><Plus size={20} strokeWidth={2.5} /></span>Saklolo</a>
        <Badge variant="outline" className="phone-demo">Prototype</Badge>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="phone-tabs">
        <TabsContent value="help" className="phone-tab-content">
          <div className={`resident-connection ${connected ? '' : 'is-offline'}`} role="status">{connected ? <span className="online-dot" /> : <WifiOff size={15} />}<span>{connected ? 'Demo desk reachable' : 'Offline · requests wait on this phone'}</span></div>
          {currentReport ? <section className={`active-request ${delivered ? 'is-delivered' : 'is-pending'}`} aria-label="Active request" data-arrive>
            <span className="request-status-symbol">{acknowledged ? <CheckCheck size={28} /> : delivered ? <Check size={28} /> : <Clock3 size={28} />}</span>
            <h1>{requestTitle}</h1><p className="request-explanation" role="status">{requestExplanation}</p>
            <div className="request-reference"><span>Request #{currentReport.id.slice(0, 8).toUpperCase()}</span><time>{time(currentReport.createdAt)}</time></div>
            <ol className="request-progress" aria-label="Request progress">{[
              { name: 'Saved on phone', done: true, detail: time(currentReport.createdAt) },
              { name: 'Delivered to desk', done: Boolean(delivered), detail: currentReport.receivedAt ? time(currentReport.receivedAt) : 'Waiting for connection' },
              { name: 'Acknowledged', done: acknowledged, detail: currentReport.acknowledgedAt ? time(currentReport.acknowledgedAt) : 'Waiting for operator' }
            ].map(step => <li key={step.name} className={step.done ? 'is-complete' : ''}><span>{step.done ? <Check size={14} /> : <span />}</span><div><strong>{step.name}</strong><small>{step.detail}</small></div></li>)}</ol>
            {currentReport.needsSync && <p className="request-update-pending">New details saved on this phone. Waiting to deliver the update.</p>}
            <div className="request-location-note"><MapPin size={16} /><span>{currentReport.location ? 'Location included' : currentReport.landmark ? `Landmark: ${currentReport.landmark}` : 'Location missing — add a landmark below'}</span></div>
            <Button variant="outline" className="request-add-info" onClick={openDetails}><Plus size={18} />Add information<ArrowRight size={16} /></Button>
            {currentReport.status === 'pending' && <Button variant="ghost" className="request-retry" disabled={busy} onClick={() => void syncReports()}><RefreshCw size={16} />Retry delivery</Button>}
          </section> : <><div className="phone-greeting" data-arrive><h1>Need help?</h1><p>Send your location and ask for assistance.</p></div>
          <div className="sos-area" data-arrive>
            <div className="sos-orbit"><Button className="sos-circle" aria-label="Send SOS" onClick={() => void send('sos')} disabled={busy}>
              <Radio size={27} strokeWidth={1.7} /><strong>{busy ? 'Saving' : 'SOS'}</strong><span>{!reportsLoaded ? 'Loading requests…' : busy ? 'Please wait…' : 'Request help'}</span>
            </Button></div>
            <p>Tap once. Add more details afterward.</p>
          </div></>}
          <div className="phone-actions" data-arrive>
            {voiceState === 'idle' ? <><Button variant="outline" className="phone-voice" disabled={!connected} onClick={() => void toggleVoice()}><Mic size={20} /><span>{currentReport ? 'Talk about this request' : 'Talk to Saklolo'}</span><ArrowRight size={16} /></Button><p className="voice-privacy">{connected ? 'Internet required · microphone starts when you allow it' : 'Voice needs a connection. You can still save an SOS.'}</p></> : <section className="resident-voice-session" aria-label="Live voice session"><div className="voice-session-heading"><Mic size={20} /><h2>Talk to Saklolo</h2><Badge variant="outline">{voiceState === 'active' ? 'Live' : 'Connecting'}</Badge></div><p className="voice-session-status" role="status"><i />{voiceLabel}</p><p className="voice-session-note">Speak naturally. You can correct any detail.</p><div className="resident-voice-buttons"><Button variant="outline" disabled={voiceState !== 'active'} onClick={toggleMute}>{muted ? <MicOff size={18} /> : <Mic size={18} />}{muted ? 'Unmute' : 'Mute'}</Button><Button variant="outline" onClick={() => void toggleVoice()}><Square size={16} />{voiceState === 'connecting' ? 'Cancel' : 'End voice'}</Button></div><small>Audio is sent to OpenAI while connected.</small></section>}
            <Button variant="ghost" className="phone-location" aria-expanded={locationOpen} onClick={() => setLocationOpen(!locationOpen)}><LocateFixed size={20} /><span><strong>{locationNote}</strong><small>{location ? `Accuracy ±${Math.round(location.accuracy || 0)} m · ${gps.stale ? 'Review before using' : 'Your location will be included'}` : 'A landmark works too. Review location options.'}</small></span><span className="location-review">{locationOpen ? 'Close' : 'Review'}</span></Button>
            {locationOpen && <section className="resident-location-review" aria-label="Review your location">{location ? <><LocationPreview location={location} /><p className="location-coordinates">{location.lat.toFixed(5)}, {location.lng.toFixed(5)}<span>{gps.capturedAt ? `Captured ${time(gps.capturedAt)}` : ''}</span></p><Button variant="outline" className="use-location" onClick={() => void confirmLocation()}><Check size={16} />Use this location</Button></> : <p>{gps.state === 'denied' ? 'Location access is blocked. Allow it in browser permissions, or add a landmark.' : 'We don’t have a GPS fix yet. You can still request help with a landmark.'}</p>}<div className="location-review-actions"><Button variant="ghost" onClick={locate}><RefreshCw size={16} />Refresh GPS</Button><Button variant="ghost" onClick={() => { openDetails(); setLocationOpen(false); }}>Add a landmark</Button></div></section>}
          </div>
          {transcript.length > 0 && <section className="voice-transcript" aria-label="Voice conversation"><h2>Conversation</h2>{transcript.slice(-6).map(line => <p key={line.id} className={line.role}><strong>{line.role === 'user' ? 'You' : 'Saklolo'}</strong>{line.text}</p>)}</section>}
          {currentReport?.description && <section className="request-summary"><div><h2>Request details</h2><Button variant="ghost" onClick={openDetails}>Edit</Button></div><p>{currentReport.description}</p><small>{currentReport.category} assistance{currentReport.landmark ? ` · ${currentReport.landmark}` : ''}</small></section>}
          {message && <div className="phone-feedback" role="status"><Radio size={16} /><p>{message}</p></div>}
          <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="phone-details" data-arrive>
            <CollapsibleTrigger asChild><Button variant="ghost" className="details-trigger" onClick={() => { if (!detailsOpen && currentReport) { setCategory(currentReport.category); setDescription(currentReport.description); setLandmark(currentReport.landmark); } }}><span>{currentReport ? 'Update request details' : 'Add details'} <small>Optional</small></span><ChevronDown size={17} className={detailsOpen ? 'chevron-open' : ''} /></Button></CollapsibleTrigger>
            <CollapsibleContent><div ref={details} className="details-body"><form onSubmit={e => { e.preventDefault(); void send('form'); }}>
              <fieldset><legend>What kind of help?</legend><div className="phone-categories">{categories.map(item => { const Icon = icons[item]; return <Button key={item} variant="outline" type="button" aria-pressed={category === item} className={category === item ? 'is-selected' : ''} onClick={() => setCategory(item)}><Icon size={20} />{item}</Button>; })}</div></fieldset>
              <label htmlFor="description">What happened?</label><Textarea id="description" rows={3} maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Tell us what help you need…" />
              <label htmlFor="landmark">Nearest landmark</label><Input id="landmark" value={landmark} maxLength={240} onChange={e => setLandmark(e.target.value)} placeholder="Street, building, or barangay" />
              <Button className="phone-send" disabled={busy}>{busy ? 'Saving…' : currentReport ? 'Save updated details' : 'Send request'}<ArrowRight size={17} /></Button>
            </form></div></CollapsibleContent>
          </Collapsible>
          {currentReport && <Button variant="ghost" className="new-request" disabled={busy || voiceState !== 'idle'} onClick={startNewRequest}><Plus size={16} />Start a separate request</Button>}
        </TabsContent>
        <TabsContent value="reports" className="phone-tab-content reports-tab">
          <div className="reports-heading" data-arrive><div><h1>Your reports</h1><p>Every request, with a clear status.</p></div><Button variant="ghost" size="icon" aria-label="Refresh reports" onClick={() => void syncReports()}><RefreshCw size={18} /></Button></div>
          {reports.length === 0 ? <div className="phone-empty" data-arrive><span><Clock3 size={30} strokeWidth={1.5} /></span><h2>Nothing to follow up yet</h2><p>Your saved requests and delivery<br />updates will appear here.</p><Button variant="outline" onClick={() => setTab('help')}>Back to help<ArrowRight size={16} /></Button></div> : <div className="phone-reports" data-arrive>{reports.map(report => <article className="phone-report" key={report.id}><div className="report-top"><span className={`report-symbol ${report.status}`}>{report.status === 'acknowledged' ? <CheckCheck size={20} /> : report.status === 'pending' ? <Clock3 size={20} /> : <Radio size={20} />}</span><div><h2>{report.category} assistance</h2><time>{new Date(report.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {time(report.createdAt)}</time></div></div><p className="report-state">{labels[report.status]}</p>{report.needsSync && <small>Updated details are saved locally; waiting for delivery.</small>}{report.description && <p className="report-copy">{report.description}</p>}{report.landmark && <p className="report-place"><MapPin size={13} />{report.landmark}</p>}{report.status === 'pending' && <small>We’ll retry while the app is open.</small>}<Button variant="ghost" className="open-request" onClick={() => selectReport(report)}>View request<ArrowRight size={16} /></Button></article>)}</div>}
          {message && <div className="phone-feedback" role="status"><Radio size={16} /><p>{message}</p></div>}
        </TabsContent>
        <div className="phone-bottom"><p className="phone-disclaimer">Prototype only. No emergency service connected.</p><TabsList className="phone-navigation" aria-label="Resident navigation"><TabsTrigger value="help"><House size={20} /><span>Help</span></TabsTrigger><TabsTrigger value="reports"><Clock3 size={20} /><span>Reports{reports.length > 0 && <span className="report-count">{reports.length}</span>}</span></TabsTrigger></TabsList></div>
      </Tabs>
    </div>
    <p className="desktop-caption">Saklolo <span>·</span> Community response, closer to you.</p>
  </div>;
}
