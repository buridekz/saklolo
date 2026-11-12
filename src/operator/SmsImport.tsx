import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, MapPin, MessageSquareText, X } from 'lucide-react';
import type { Report } from '../data';
import { parseSms } from '../sms';
import { clockTime } from './format';

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called with the stored report and whether it was new to the desk. */
  onLogged: (report: Report, created: boolean) => void;
  onError: (message: string) => void;
};

/** Lets an operator log a Saklolo report that arrived as an SMS (resident had no mobile data). */
export default function SmsImport({ open, onClose, onLogged, onError }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = text.trim() ? parseSms(text) : null;

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) { setText(''); node.showModal(); }
    if (!open && node.open) node.close();
  }, [open]);

  async function submit() {
    if (!parsed?.ok || saving) return;
    const { report } = parsed;
    setSaving(true);
    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...report, locationCapturedAt: report.location ? report.createdAt : null, revision: 1, source: 'sms' }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'The SMS report could not be logged.');
      onLogged(body as Report, response.status === 201);
      onClose();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'The SMS report could not be logged.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} className="ops-sms-dialog" aria-labelledby="ops-sms-title" onClose={onClose} onCancel={onClose}>
      <form method="dialog" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <header>
          <span className="ops-sms-icon"><MessageSquareText size={18} /></span>
          <div>
            <h2 id="ops-sms-title">Log an SMS report</h2>
            <p>For residents who had no mobile data. Paste the text message exactly as received.</p>
          </div>
          <button type="button" className="ops-icon-button" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>

        <textarea
          aria-label="SMS text"
          rows={5}
          value={text}
          onChange={event => setText(event.target.value)}
          placeholder={'SAKLOLO SOS Flood @14.55470,121.02440 ±12m 2026-11-12T10:42:05Z\nNear Ayala Triangle | Water rising\nid:…'}
          autoFocus
        />

        <div className={`ops-sms-preview ${parsed ? (parsed.ok ? 'is-ok' : 'is-error') : ''}`} role="status" aria-live="polite">
          {!parsed ? (
            <span>The preview appears here. Nothing is added until you confirm.</span>
          ) : parsed.ok ? (
            <>
              <strong><Check size={14} /> {parsed.report.category} assistance · #{parsed.report.id.slice(0, 8).toUpperCase()}</strong>
              <span><MapPin size={13} />{parsed.report.location ? `${parsed.report.location.lat.toFixed(5)}, ${parsed.report.location.lng.toFixed(5)}${parsed.report.location.accuracy != null ? ` · ±${parsed.report.location.accuracy} m` : ''}` : 'No GPS in this message'}</span>
              <span>{parsed.report.landmark || 'No landmark'} · saved on the phone at {clockTime(parsed.report.createdAt)}</span>
              {parsed.report.description && <span className="ops-sms-desc">“{parsed.report.description}”</span>}
            </>
          ) : (
            <span>{parsed.reason}</span>
          )}
        </div>

        <footer>
          <small>If the phone later reconnects, the same report updates. It will not appear twice.</small>
          <button type="button" className="ops-button ops-button-quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="ops-button ops-acknowledge" disabled={!parsed?.ok || saving}>
            {saving ? <><LoaderCircle size={15} className="ops-spinner" /> Adding…</> : 'Add to queue'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
