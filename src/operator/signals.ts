import type { Report } from '../data';

/**
 * Trust signals help an operator judge a report. None of them proves a report real or fake,
 * and the desk never delays or hides a report because a signal is missing.
 * Kept free of runtime imports so it runs directly under `node --test`.
 */
export type SignalState = 'strong' | 'partial' | 'missing';
export type Signal = { id: string; state: SignalState; label: string; detail: string };

const LIVE_LOCATION_MS = 2 * 60 * 1000;
export const NEARBY_RADIUS_M = 300;
export const NEARBY_WINDOW_MS = 60 * 60 * 1000;

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Other reports within NEARBY_RADIUS_M and NEARBY_WINDOW_MS of this one. */
export function nearbyReports(report: Report, all: Report[]) {
  const here = report.location;
  if (!here) return [];
  const at = Date.parse(report.createdAt);
  return all.filter(other => other.id !== report.id
    && other.location
    && Math.abs(Date.parse(other.createdAt) - at) <= NEARBY_WINDOW_MS
    && distanceMeters(here, other.location) <= NEARBY_RADIUS_M);
}

function span(ms: number) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes === 1) return '1 minute';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

export function trustSignals(report: Report, nearby: number, now: number): Signal[] {
  const signals: Signal[] = [];
  const location = report.location;

  if (!location) {
    signals.push({ id: 'gps', state: 'missing', label: 'No GPS shared', detail: 'Confirm the place using the landmark or by asking the resident.' });
  } else {
    const capturedAt = report.locationCapturedAt ? Date.parse(report.locationCapturedAt) : Number.NaN;
    if (Number.isFinite(capturedAt) && now - capturedAt <= LIVE_LOCATION_MS) {
      signals.push({ id: 'gps', state: 'strong', label: 'Live GPS from the device', detail: `Last update ${span(now - capturedAt)} ago.` });
    } else {
      signals.push({ id: 'gps', state: 'partial', label: 'GPS shared earlier', detail: Number.isFinite(capturedAt) ? `Last fix ${span(now - capturedAt)} ago. The resident may have moved.` : 'Capture time unknown.' });
    }
    const accuracy = location.accuracy;
    if (accuracy == null) signals.push({ id: 'accuracy', state: 'partial', label: 'Accuracy unknown', detail: 'Treat the pin as approximate.' });
    else if (accuracy <= 50) signals.push({ id: 'accuracy', state: 'strong', label: `Precise location (±${Math.round(accuracy)} m)`, detail: 'Typical of a phone with a clear GPS fix.' });
    else if (accuracy <= 200) signals.push({ id: 'accuracy', state: 'partial', label: `Approximate location (±${Math.round(accuracy)} m)`, detail: 'Close enough to search the immediate area.' });
    else signals.push({ id: 'accuracy', state: 'missing', label: `Broad location (±${Math.round(accuracy)} m)`, detail: 'Use the landmark to narrow it down.' });
  }

  if (report.landmark.trim()) signals.push({ id: 'landmark', state: 'strong', label: 'Landmark given', detail: 'Check that it matches the map pin.' });
  else signals.push({ id: 'landmark', state: 'missing', label: 'No landmark', detail: 'Ask for a nearby building, street or store.' });

  if (nearby > 0) signals.push({ id: 'nearby', state: 'strong', label: `${nearby} other ${nearby === 1 ? 'report' : 'reports'} nearby`, detail: `Independent reports within ${NEARBY_RADIUS_M} m and an hour.` });
  else signals.push({ id: 'nearby', state: 'partial', label: 'No other reports nearby yet', detail: 'A single report is normal. This updates as reports arrive.' });

  const length = report.description.trim().length;
  if (length >= 30) signals.push({ id: 'details', state: 'strong', label: 'Specific description', detail: 'Concrete details can be checked by responders.' });
  else if (length > 0) signals.push({ id: 'details', state: 'partial', label: 'Short description', detail: 'Ask what is happening and who needs help.' });
  else signals.push({ id: 'details', state: 'missing', label: 'No description', detail: 'Confirm the situation with the resident.' });

  if ((report.revision || 1) > 1) {
    signals.push({ id: 'revision', state: 'strong', label: 'Resident updated the report', detail: `Revision ${report.revision}, sent after the first report.` });
  }

  if (report.source === 'voice') signals.push({ id: 'source', state: 'strong', label: 'Spoken report', detail: 'Created in a live voice session.' });
  else if (report.source === 'sos') signals.push({ id: 'source', state: 'partial', label: 'One-tap SOS', detail: 'Fast to send, so fewer details are expected.' });
  else signals.push({ id: 'source', state: 'partial', label: 'Written report', detail: 'Submitted through the report form.' });

  return signals;
}
