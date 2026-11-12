import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ArrowRight, Check, Copy, MessageSquareText, CheckCheck, ChevronDown, CircleHelp, Clock3, Flame, HeartPulse, House, LocateFixed, MapPin, Mic, MicOff, Plus, Radio, RefreshCw, Shield, Square, Truck, Volume2, VolumeX, Waves, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { agencyNames, categories, db, dispatchStages, editReport, labels, stageLabels, syncReports, type Category, type Report } from './data';
import { useDeviceLocation } from './useDeviceLocation';
import { smsBody, smsHref } from './sms';

/** After an online SOS, open the voice call-taker automatically. Off: SOS shows typed quick questions, with voice one tap away. */
const AUTO_VOICE_AFTER_SOS = false;
const PEOPLE_OPTIONS = ['1', '2', '3–5', 'More than 5', 'Not sure'];

/** Optional LGU hotline for the SMS fallback. Left blank, the resident chooses the recipient. */
const SMS_NUMBER = (import.meta.env.VITE_SMS_FALLBACK_NUMBER as string | undefined) || '';

/** Offline fallback: hand the report to the phone's own SMS app, which works without mobile data. */
function SmsFallback({ report }: { report: Report }) {
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const body = smsBody(report);
  async function copy() {
    try { await navigator.clipboard.writeText(body); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  }
  return <div className="sms-fallback" data-arrive>
    <div className="sms-fallback-copy"><MessageSquareText size={18} /><div><strong>No data signal?</strong><p>Send this request as a text message. SMS often gets through when mobile data doesn’t.</p></div></div>
    <div className="sms-actions">
      <Button asChild className="sms-send"><a href={smsHref(body, SMS_NUMBER)} onClick={() => setOpened(true)}><MessageSquareText size={17} />Send by SMS</a></Button>
      <Button variant="outline" className="sms-copy" onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy text'}</Button>
    </div>
    <small role="status">{opened ? 'Your messaging app opened with the report filled in. We’ll still deliver it over data when signal returns. The desk won’t get a duplicate.' : SMS_NUMBER ? `Goes to the LGU hotline ${SMS_NUMBER}.` : 'Choose your LGU or barangay hotline as the recipient.'}</small>
  </div>;
}
import type { VoiceReportState, VoiceStatus, VoiceTranscript } from './voice';
import './resident.css';
import LocationPreview from './LocationPreview';

const icons = { Medical: HeartPulse, Fire: Flame, Safety: Shield, Flood: Waves, Other: CircleHelp };
const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function Resident({ connected }: { connected: boolean; openDesk: () => void }) {
  const [category, setCategory] = useState<Category>('Other');
  const [description, setDescription] = useState('');
  const [intake, setIntake] = useState<{ id: string; step: number } | null>(null);
  const [intakeNote, setIntakeNote] = useState('');
  const [intakePeople, setIntakePeople] = useState('');
  const intakeCard = useRef<HTMLElement>(null);
  // Keep the current question on screen as the resident moves through the three steps.
  useEffect(() => {
    if (intake && intake.step < 3) requestAnimationFrame(() => intakeCard.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  }, [intake]);
  const [landmark, setLandmark] = useState('');
  const gps = useDeviceLocation();
  const location = gps.location;
  const locationNote = gps.state === 'active' ? gps.stale ? 'Last known location' : 'Location is on' : gps.state === 'requesting' ? 'Finding your location…' : gps.state === 'denied' ? 'Location permission blocked' : 'Location unavailable';
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
  const [spokenUpdates, setSpokenUpdates] = useState(() => localStorage.getItem('saklolo-spoken-updates') !== 'off');
  const voice = useRef<{ close: () => void; mute: (muted: boolean) => void; notifyReportState: (report: VoiceReportState) => void; setSpokenUpdates: (enabled: boolean) => void } | null>(null);
  const voiceAbort = useRef<AbortController | null>(null);
  const voiceReport = useRef<string | null>(null);
  const activeReport = useRef<string | null>(activeId);
  const trackingReport = useRef<string | null>(null);
  const hydratedDraft = useRef<string | null>(null);
  const reportWrites = useRef<Promise<unknown>>(Promise.resolve());
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
  const locationHint = currentReport && trackingReport.current !== currentReport.id ? 'Review to update this request’s location' : 'Your location will be included';

  function voiceSnapshot(report: Report): VoiceReportState {
    return { id: report.id, status: report.status, needsSync: report.needsSync, category: report.category, description: report.description, landmark: report.landmark, locationIncluded: Boolean(report.location), receivedAt: report.receivedAt, acknowledgedAt: report.acknowledgedAt };
  }

  const readVoiceReport = useCallback(async () => {
    const report = activeReport.current ? await db.reports.get(activeReport.current) : undefined;
    return report ? voiceSnapshot(report) : null;
  }, []);

  useEffect(() => {
    if (voiceState === 'active' && currentReport) voice.current?.notifyReportState(voiceSnapshot(currentReport));
  }, [voiceState, currentReport]);

  useEffect(() => {
    voice.current?.setSpokenUpdates(spokenUpdates);
  }, [spokenUpdates, voiceState]);

  useEffect(() => {
    if (!activeId) { hydratedDraft.current = null; return; }
    if (currentReport && hydratedDraft.current !== currentReport.id) {
      setCategory(currentReport.category); setDescription(currentReport.description); setLandmark(currentReport.landmark);
      hydratedDraft.current = currentReport.id;
    }
  }, [activeId, currentReport]);

  function selectReport(report: Report) {
    if (activeReport.current !== report.id) {
      trackingReport.current = null;
      voiceAbort.current?.abort(); voice.current?.close(); voice.current = null;
      setVoiceState('idle'); setVoiceStatus('ended'); setTranscript([]);
    }
    activeReport.current = report.id; setActiveId(report.id);
    localStorage.setItem('saklolo-active-report', report.id);
    setCategory(report.category); setDescription(report.description); setLandmark(report.landmark);
    setDetailsOpen(false); setTab('help'); setMessage('');
  }

  function startNewRequest() {
    voiceAbort.current?.abort(); voice.current?.close(); voice.current = null;
    setVoiceState('idle'); setVoiceStatus('ended'); setTranscript([]);
    activeReport.current = null; trackingReport.current = null; voiceReport.current = null; setActiveId(null);
    localStorage.removeItem('saklolo-active-report');
    setCategory('Other'); setDescription(''); setLandmark(''); setMessage(''); setDetailsOpen(false); setLocationOpen(false);
    setIntake(null); setIntakeNote(''); setIntakePeople('');
  }

  /** Typed call-taker: what happened, how many people, nearest landmark. Each answer updates the same report. */
  async function answerIntake(next: { category?: Category; note?: string; people?: string; landmark?: string }, advanceTo: number) {
    if (!intake) return;
    const nextCategory = next.category ?? category;
    const note = (next.note ?? intakeNote).trim();
    const people = next.people ?? intakePeople;
    const place = (next.landmark ?? landmark).trim();
    const text = [note, people && `People needing help: ${people}`].filter(Boolean).join('. ');
    setCategory(nextCategory); setDescription(text); setLandmark(place);
    if (next.people !== undefined) setIntakePeople(next.people);
    setIntake({ id: intake.id, step: advanceTo });
    try { await submit(nextCategory, text, place, 'form'); }
    catch { setMessage('Your answer is saved on this phone and will be sent with the request.'); }
    if (advanceTo >= 3 && mounted.current) setMessage('Thanks. The desk has your answers and your location.');
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
    // Track only incidents created during this visit. History keeps its original location.
    if (!gps.location || !gps.capturedAt || !activeReport.current || trackingReport.current !== activeReport.current) return;
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
      const feedback = root.current?.querySelector('.phone-feedback');
      if (feedback) gsap.fromTo(feedback, { y: 6 }, { y: 0, duration: .25, ease: 'power2.out' });
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

  function submit(nextCategory: Category, text: string, place: string, source: Report['source'], signal?: AbortSignal) {
    const target = activeReport.current;
    const result = reportWrites.current.then(() => {
      if (signal?.aborted || (target && activeReport.current !== target)) throw new Error('The active request changed. This update was not saved.');
      return saveRequest(nextCategory, text, place, source);
    });
    reportWrites.current = result.catch(() => {});
    return result;
  }

  async function saveRequest(nextCategory: Category, text: string, place: string, source: Report['source']) {
    const fix = gps.snapshot();
    const existingId = activeReport.current || (source === 'voice' ? voiceReport.current : null);
    const attachLocation = !existingId || trackingReport.current === existingId;
    const report: Report = { id: existingId || crypto.randomUUID(), createdAt: new Date().toISOString(), category: nextCategory, description: text, landmark: place, location: attachLocation ? fix.location : null, locationCapturedAt: attachLocation ? fix.capturedAt : null, revision: 1, source, status: 'pending' };
    if (existingId) {
      await editReport(existingId, { category: nextCategory, description: text, landmark: place, ...(attachLocation && fix.location ? { location: fix.location, locationCapturedAt: fix.capturedAt } : {}) });
    } else {
      await db.reports.put(report);
      trackingReport.current = report.id;
      if (source === 'voice') voiceReport.current = report.id;
    }
    activeReport.current = report.id;
    setActiveId(report.id); localStorage.setItem('saklolo-active-report', report.id);
    const laterFix = gps.snapshot();
    if (attachLocation && !report.location && laterFix.location) await editReport(report.id, { location: laterFix.location, locationCapturedAt: laterFix.capturedAt });
    await refresh();
    setDetailsOpen(false);
    setMessage('Saved on this phone. Trying to reach the demo desk.');
    await syncReports();
    const saved = await db.reports.get(report.id);
    const status = saved?.status || 'pending';
    const result = saved?.needsSync ? 'Changes saved on this phone. Updated details are waiting for delivery.' : status === 'pending' ? 'Saved on this phone. Not delivered yet; we’ll retry while the app is open.' : status === 'acknowledged' ? 'Acknowledged by the demo desk. No real responder has been dispatched.' : 'Delivered to the demo desk. Waiting for an operator to acknowledge.';
    if (mounted.current && activeReport.current === report.id) setMessage(result);
    return result;
  }

  async function send(source: 'sos' | 'form') {
    if (busy || !reportsLoaded) return;
    setBusy(true);
    try {
      await submit(category, description.trim(), landmark.trim(), source);
      root.current?.scrollIntoView({ behavior: 'instant', block: 'start' });
      // Like dialling an emergency line: when online, SOS goes straight to the voice call-taker,
      // which fills in this same report. Offline, SOS stays a one-tap save.
      if (source === 'sos' && AUTO_VOICE_AFTER_SOS && connected && voiceState === 'idle') void toggleVoice({ category, description: description.trim(), landmark: landmark.trim() });
      // Otherwise ask the three call-taker questions by typing; works offline too. Location is already attached.
      else if (source === 'sos' && activeReport.current) { setIntake({ id: activeReport.current, step: 0 }); setIntakeNote(''); }
    }
    catch { setMessage('Could not save this report. Please try again.'); }
    finally { if (mounted.current) setBusy(false); }
  }

  /** `afterSos` carries the report just saved by an SOS tap, so the assistant opens as a call-taker for it. */
  async function toggleVoice(afterSos?: { category: Category; description: string; landmark: string }) {
    if (voiceState !== 'idle') { voiceAbort.current?.abort(); voice.current?.close(); voice.current = null; setVoiceState('idle'); setVoiceStatus('ended'); setMessage('Voice session ended. Your saved reports are in Reports.'); return; }
    const controller = new AbortController(); voiceAbort.current = controller;
    voiceReport.current = activeReport.current;
    setTranscript([]); setMuted(false); setVoiceState('connecting'); setMessage('Connecting voice. Allow microphone access when your browser asks.');
    try {
      const { startVoice } = await import('./voice');
      const session = await startVoice(async (nextCategory, text, place) => {
        if (controller.signal.aborted || !mounted.current) throw new Error('Voice session has ended.');
        setCategory(nextCategory); setDescription(text); setLandmark(place);
        return submit(nextCategory, text, place, 'voice', controller.signal);
      }, setMessage, {
        signal: controller.signal,
        getReportState: readVoiceReport,
        spokenUpdates,
        reportContext: afterSos ?? (currentReport ? { category: currentReport.category, description: currentReport.description, landmark: currentReport.landmark } : undefined),
        afterSos: Boolean(afterSos),
        onStatus: status => { if (!mounted.current || voiceAbort.current !== controller) return; setVoiceStatus(status); if (status === 'ended') { setVoiceState('idle'); voice.current = null; } },
        onTranscript: items => { if (mounted.current && voiceAbort.current === controller) setTranscript(items); }
      });
      if (!mounted.current || controller.signal.aborted) { session.close(); return; }
      voice.current = session; setVoiceState('active'); setMessage('Voice connected. Speak naturally; you can interrupt the assistant. Audio is sent to OpenAI.');
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        setVoiceState('idle');
        setMessage(afterSos
          ? 'Your SOS was still sent. Voice isn’t available right now; tap “Talk about this request” to try again, or add details by typing.'
          : error instanceof Error ? error.message : 'Voice unavailable. You can still send an SOS.');
      }
    }
  }

  function toggleMute() { const next = !muted; voice.current?.mute(next); setMuted(next); }
  function toggleSpokenUpdates() {
    const next = !spokenUpdates; setSpokenUpdates(next);
    localStorage.setItem('saklolo-spoken-updates', next ? 'on' : 'off');
    voice.current?.setSpokenUpdates(next);
  }

  const delivered = currentReport && currentReport.status !== 'pending';
  const acknowledged = currentReport?.status === 'acknowledged';
  // DEMO ONLY: the desk can simulate a dispatch; every message says so.
  const dispatch = currentReport?.dispatch || null;
  const dispatchStep = dispatch ? dispatchStages.indexOf(dispatch.stage) : -1;
  const stageTime = (stage: (typeof dispatchStages)[number]) => {
    const entry = currentReport?.dispatchHistory?.find(item => item.stage === stage);
    return entry ? time(entry.updatedAt) : null;
  };
  const dispatchTitle = dispatch ? { notified: `${dispatch.agency} notified`, en_route: 'Help is on the way', on_scene: 'Responders are on scene', resolved: 'Request resolved' }[dispatch.stage] : null;
  const requestTitle = dispatchTitle || (acknowledged ? 'Your request was reviewed' : delivered ? 'Request delivered' : 'Saved on this phone');
  const requestExplanation = dispatch
    ? `Simulation: the demo desk marked ${agencyNames[dispatch.agency]} as “${stageLabels[dispatch.stage].toLowerCase()}”. No real agency was contacted.`
    : acknowledged ? 'The demo desk acknowledged your request. No responder has been dispatched.' : delivered ? 'Waiting for an operator to review your request.' : 'Not delivered yet. Keep the app open; we’ll retry when the desk is reachable.';
  const voiceLabel = muted ? 'Microphone muted' : voiceStatus === 'speaking' ? 'Assistant speaking' : voiceStatus === 'saving' ? 'Saving your report' : voiceState === 'connecting' ? 'Connecting voice…' : 'Listening to you';
  const conversation = transcript.length > 0 && <section className="voice-transcript" aria-label="Voice conversation"><h2>Live captions</h2><div role="log" aria-live="polite" aria-relevant="additions text">{transcript.slice(-6).map(line => <p key={line.id} className={line.role}><strong>{line.role === 'user' ? 'You' : 'Saklolo'}</strong>{line.text}</p>)}</div></section>;

  return <div className="resident-stage">
    <div ref={root} className="phone-app">
      <div className="phone-topbar">
        <a href="/" className="phone-brand" aria-label="Saklolo home"><span><Plus size={20} strokeWidth={2.5} /></span>Saklolo</a>
        <Badge variant="outline" className="phone-demo">Prototype</Badge>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="phone-tabs">
        <TabsContent value="help" className="phone-tab-content">
          <div className={`resident-connection ${connected ? '' : 'is-offline'}`} role="status">{connected ? <span className="online-dot" /> : <WifiOff size={15} />}{connected ? <span>Demo desk reachable</span> : <span><strong>Offline. SOS still works.</strong> Requests are saved on this phone and send themselves when signal returns.</span>}</div>
          {voiceState !== 'idle' && <section className={`resident-voice-session companion-session ${voiceStatus === 'speaking' && !muted ? 'is-speaking' : ''}`} aria-label="Live voice companion">
            <div className="voice-session-heading"><Mic size={20} /><h2>Saklolo voice companion</h2><Badge variant="outline">{voiceState === 'active' ? 'Live' : 'Connecting'}</Badge></div>
            <div className="companion-turn"><span className="companion-symbol">{muted ? <MicOff size={30} /> : voiceStatus === 'speaking' ? <Volume2 size={30} /> : <Mic size={30} />}</span><p className="voice-session-status" role="status">{voiceLabel}</p><p className="voice-session-note">{voiceState === 'connecting' ? 'Allow microphone access to start.' : muted ? 'Your microphone is off. You can still hear the assistant.' : 'Speak naturally. Add details or ask for your request status.'}</p></div>
            <div className="resident-voice-buttons"><Button variant="outline" aria-pressed={muted} disabled={voiceState !== 'active'} onClick={toggleMute}>{muted ? <MicOff size={18} /> : <Mic size={18} />}{muted ? 'Unmute mic' : 'Mute mic'}</Button><Button variant="outline" onClick={() => void toggleVoice()}><Square size={16} />{voiceState === 'connecting' ? 'Cancel' : 'End voice'}</Button></div>
            <Button variant="ghost" className="spoken-updates" aria-pressed={spokenUpdates} onClick={toggleSpokenUpdates}>{spokenUpdates ? <Volume2 size={16} /> : <VolumeX size={16} />}Spoken status updates {spokenUpdates ? 'on' : 'off'}</Button>
            <small>AI voice · internet required · audio is sent to OpenAI</small>
            {conversation || <p className="companion-caption-placeholder">Your conversation will appear here as you speak.</p>}
            {currentReport && <div className="companion-request-summary"><div><h3>Your request</h3><Button variant="ghost" onClick={openDetails}>Edit details</Button></div><p>{currentReport.description || 'Your request is saved. You can add details by speaking.'}</p><small>{currentReport.category} assistance{currentReport.landmark ? ` · ${currentReport.landmark}` : ''}</small><p className="companion-saved-status"><CheckCheck size={15} />{currentReport.needsSync ? 'Updated details waiting for delivery' : labels[currentReport.status]}</p></div>}
          </section>}
          {currentReport ? <section className={`active-request ${delivered ? 'is-delivered' : 'is-pending'}`} aria-label="Active request" data-arrive>
            <span className="request-status-symbol">{dispatch && dispatch.stage !== 'resolved' ? <Truck size={28} /> : acknowledged ? <CheckCheck size={28} /> : delivered ? <Check size={28} /> : <Clock3 size={28} />}</span>
            <h1>{requestTitle}</h1><p className="request-explanation" role="status">{requestExplanation}</p>
            <div className="request-reference"><span>{currentReport.category} · #{currentReport.id.slice(0, 8).toUpperCase()}</span><time>{time(currentReport.createdAt)}</time></div>
            {intake && intake.id === currentReport.id && intake.step < 3 && voiceState === 'idle' && <section ref={intakeCard} className="quick-intake" aria-label="Quick questions" key={intake.step}>
              <div className="quick-intake-head">
                <span className="quick-intake-step">Question {intake.step + 1} of 3</span>
                <span className="quick-intake-location"><MapPin size={13} />{currentReport.location ? 'Location attached' : 'No GPS yet'}</span>
              </div>
              {intake.step === 0 && <>
                <h2>What happened?</h2>
                <div className="quick-intake-types">{categories.map(item => { const Icon = icons[item]; return <Button key={item} type="button" variant="outline" aria-pressed={category === item} className={category === item ? 'is-selected' : ''} onClick={() => setCategory(item)}><Icon size={18} />{item}</Button>; })}</div>
                <Input aria-label="Describe what happened (optional)" value={intakeNote} maxLength={300} onChange={e => setIntakeNote(e.target.value)} placeholder="Short note, e.g. water rising fast" onKeyDown={e => { if (e.key === 'Enter') void answerIntake({}, 1); }} />
                <Button className="quick-intake-next" onClick={() => void answerIntake({}, 1)}>Next<ArrowRight size={17} /></Button>
              </>}
              {intake.step === 1 && <>
                <h2>How many people need help?</h2>
                <div className="quick-intake-people">{PEOPLE_OPTIONS.map(option => <Button key={option} type="button" variant="outline" onClick={() => void answerIntake({ people: option }, 2)}>{option}</Button>)}</div>
              </>}
              {intake.step === 2 && <>
                <h2>Nearest landmark?</h2>
                <Input aria-label="Nearest landmark" autoFocus value={landmark} maxLength={240} onChange={e => setLandmark(e.target.value)} placeholder="Church, school, store, street…" onKeyDown={e => { if (e.key === 'Enter') void answerIntake({}, 3); }} />
                <div className="quick-intake-actions">
                  <Button variant="ghost" onClick={() => void answerIntake({ landmark: '' }, 3)}>Skip</Button>
                  <Button className="quick-intake-next" onClick={() => void answerIntake({}, 3)}>Send details<ArrowRight size={17} /></Button>
                </div>
              </>}
              {connected && <Button variant="ghost" className="quick-intake-voice" onClick={() => { setIntake(null); void toggleVoice({ category, description, landmark }); }}><Mic size={16} />Talk instead</Button>}
            </section>}
            <ol className="request-progress" aria-label="Request progress">{[
              { name: 'Saved on phone', done: true, detail: time(currentReport.createdAt) },
              { name: 'Delivered to desk', done: Boolean(delivered), detail: currentReport.receivedAt ? time(currentReport.receivedAt) : 'Waiting for connection' },
              { name: 'Acknowledged', done: acknowledged, detail: currentReport.acknowledgedAt ? time(currentReport.acknowledgedAt) : 'Waiting for operator' },
              { name: 'Agency notified (simulated)', done: dispatchStep >= 0, detail: dispatch ? `${agencyNames[dispatch.agency]} · ${stageTime('notified') || ''}` : 'After review' },
              { name: dispatchStep >= 2 ? 'Responders on scene' : 'Responders on the way', done: dispatchStep >= 1, detail: (dispatchStep >= 2 ? stageTime('on_scene') : stageTime('en_route')) || 'Not yet' },
              { name: 'Resolved', done: dispatchStep >= 3, detail: stageTime('resolved') || 'Not yet' }
            ].map(step => <li key={step.name} className={step.done ? 'is-complete' : ''}><span>{step.done ? <Check size={14} /> : <span />}</span><div><strong>{step.name}</strong><small>{step.detail}</small></div></li>)}</ol>
            {/* Only for edits to an already-delivered request; an undelivered one shows the SMS fallback instead. */}
            {currentReport.needsSync && currentReport.status !== 'pending' && <p className="request-update-pending">New details saved on this phone. Waiting to deliver the update.</p>}
            {currentReport.status === 'pending' && <SmsFallback report={currentReport} />}
            <div className="request-location-note"><MapPin size={16} /><span>{currentReport.location ? 'Location included' : currentReport.landmark ? `Landmark: ${currentReport.landmark}` : 'Location missing — add a landmark below'}</span></div>
            <Button variant="outline" className="request-add-info" onClick={openDetails}><Plus size={18} />Add information<ArrowRight size={16} /></Button>
            {currentReport.status === 'pending' && <Button variant="ghost" className="request-retry" disabled={busy} onClick={() => void syncReports()}><RefreshCw size={16} />Retry delivery</Button>}
          </section> : voiceState === 'idle' ? <><div className="phone-greeting" data-arrive><h1>Need help?</h1><p>Send your location and ask for assistance.</p></div>
          <div className="sos-area" data-arrive>
            <div className="sos-orbit"><Button className="sos-circle" aria-label="Send SOS" onClick={() => void send('sos')} disabled={busy || !reportsLoaded}>
              <Radio size={27} strokeWidth={1.7} /><strong>{busy ? 'Saving' : 'SOS'}</strong><span>{!reportsLoaded ? 'Loading requests…' : busy ? 'Please wait…' : 'Request help'}</span>
            </Button></div>
            <p>Tap once. Add more details afterward.</p>
          </div></> : <Button className="companion-sos" disabled={busy || !reportsLoaded} onClick={() => void send('sos')}><Radio size={19} />{busy ? 'Saving…' : 'Send SOS now'}<ArrowRight size={18} /></Button>}
          <div className="phone-actions" data-arrive>
            {voiceState === 'idle' && <><Button variant="outline" className="phone-voice" disabled={!connected || !reportsLoaded} onClick={() => void toggleVoice()}><Mic size={20} /><span>{currentReport ? 'Talk about this request' : 'Talk to Saklolo'}</span><ArrowRight size={16} /></Button><p className="voice-privacy">{connected ? 'Internet required · microphone starts when you allow it' : 'Voice needs a connection. You can still save an SOS.'}</p></>}
            <Button variant="ghost" className="phone-location" aria-expanded={locationOpen} onClick={() => setLocationOpen(!locationOpen)}><LocateFixed size={20} /><span><strong>{locationNote}</strong><small>{location ? `Accuracy ±${Math.round(location.accuracy || 0)} m · ${gps.stale ? 'Review before using' : locationHint}` : 'A landmark works too. Review location options.'}</small></span><span className="location-review">{locationOpen ? 'Close' : 'Review'}</span></Button>
            {locationOpen && <section className="resident-location-review" aria-label="Review your location">{location ? <><LocationPreview location={location} /><p className="location-coordinates">{location.lat.toFixed(5)}, {location.lng.toFixed(5)}<span>{gps.capturedAt ? `Captured ${time(gps.capturedAt)}` : ''}</span></p><Button variant="outline" className="use-location" onClick={() => void confirmLocation()}><Check size={16} />Use this location</Button></> : <p>{gps.state === 'denied' ? 'Location access is blocked. Allow it in browser permissions, or add a landmark.' : 'We don’t have a GPS fix yet. You can still request help with a landmark.'}</p>}<div className="location-review-actions"><Button variant="ghost" onClick={locate}><RefreshCw size={16} />Refresh GPS</Button><Button variant="ghost" onClick={() => { openDetails(); setLocationOpen(false); }}>Add a landmark</Button></div></section>}
          </div>
          {voiceState === 'idle' && conversation}
          {voiceState === 'idle' && currentReport?.description && <section className="request-summary"><div><h2>Request details</h2><Button variant="ghost" onClick={openDetails}>Edit</Button></div><p>{currentReport.description}</p><small>{currentReport.category} assistance{currentReport.landmark ? ` · ${currentReport.landmark}` : ''}</small></section>}
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
          {voiceState !== 'idle' && <section className="companion-background-session" aria-label="Active voice controls"><p><Mic size={17} />{voiceLabel}</p><div><Button variant="outline" onClick={() => setTab('help')}>Back to voice</Button><Button variant="ghost" onClick={() => void toggleVoice()}><Square size={15} />End voice</Button></div></section>}
          {reports.length === 0 ? <div className="phone-empty" data-arrive><span><Clock3 size={30} strokeWidth={1.5} /></span><h2>Nothing to follow up yet</h2><p>Your saved requests and delivery<br />updates will appear here.</p><Button variant="outline" onClick={() => setTab('help')}>Back to help<ArrowRight size={16} /></Button></div> : <div className="phone-reports" data-arrive>{reports.map(report => <article className="phone-report" key={report.id}><div className="report-top"><span className={`report-symbol ${report.status}`}>{report.status === 'acknowledged' ? <CheckCheck size={20} /> : report.status === 'pending' ? <Clock3 size={20} /> : <Radio size={20} />}</span><div><h2>{report.category} assistance</h2><time>{new Date(report.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {time(report.createdAt)}</time></div></div><p className="report-state">{labels[report.status]}</p>{report.needsSync && <small>Updated details are saved locally; waiting for delivery.</small>}{report.description && <p className="report-copy">{report.description}</p>}{report.landmark && <p className="report-place"><MapPin size={13} />{report.landmark}</p>}{report.status === 'pending' && <small>We’ll retry while the app is open.</small>}<Button variant="ghost" className="open-request" onClick={() => selectReport(report)}>View request<ArrowRight size={16} /></Button></article>)}</div>}
          {message && <div className="phone-feedback" role="status"><Radio size={16} /><p>{message}</p></div>}
        </TabsContent>
        <div className="phone-bottom"><p className="phone-disclaimer">Prototype only. No emergency service connected.</p><TabsList className="phone-navigation" aria-label="Resident navigation"><TabsTrigger value="help"><House size={20} /><span>Help</span></TabsTrigger><TabsTrigger value="reports"><Clock3 size={20} /><span>Reports{reports.length > 0 && <span className="report-count">{reports.length}</span>}</span></TabsTrigger></TabsList></div>
      </Tabs>
    </div>
    <p className="desktop-caption">Saklolo <span>·</span> Community response, closer to you.</p>
  </div>;
}
