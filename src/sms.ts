import type { Category, Report } from './data';

/**
 * SMS fallback format. Plain SMS travels over the cellular network when mobile data is down.
 * The message stays human-readable for whoever receives it, and machine-parseable so the desk
 * can log it. It carries the report's id, so a later data delivery updates the same report.
 *
 *   SAKLOLO SOS Flood @14.55470,121.02440 ±12m 2026-11-12T10:42:05Z
 *   Near Ayala Triangle | Water rising
 *   id:3f2a1c9e-...
 *
 * Kept free of runtime imports so it runs directly under `node --test`.
 */
const CATEGORIES: readonly Category[] = ['Medical', 'Fire', 'Safety', 'Flood', 'Other'];
const MAX_TEXT = 300;

export function smsBody(report: Pick<Report, 'id' | 'createdAt' | 'category' | 'description' | 'landmark' | 'location'>) {
  const where = report.location
    ? `@${report.location.lat.toFixed(5)},${report.location.lng.toFixed(5)}${report.location.accuracy != null ? ` ±${Math.round(report.location.accuracy)}m` : ''}`
    : '@no-gps';
  const when = report.createdAt.replace(/\.\d{3}Z$/, 'Z');
  const clean = (text: string) => text.replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
  let details = [clean(report.landmark) || 'No landmark', clean(report.description) || 'No details'].join(' | ');
  if (details.length > MAX_TEXT) details = `${details.slice(0, MAX_TEXT - 1)}…`;
  return `SAKLOLO SOS ${report.category} ${where} ${when}\n${details}\nid:${report.id}`;
}

/** `sms:` link that opens the phone's messaging app; the recipient stays blank when no number is configured. */
export function smsHref(body: string, number = '') {
  // "?&body=" is understood by both Android and iOS messaging apps.
  return `sms:${encodeURIComponent(number)}?&body=${encodeURIComponent(body)}`;
}

export type ParsedSms = {
  id: string;
  createdAt: string;
  category: Category;
  location: { lat: number; lng: number; accuracy: number | null } | null;
  landmark: string;
  description: string;
};

/** Parses a pasted SAKLOLO SMS. Returns a reason instead of guessing when anything is missing. */
export function parseSms(text: string): { ok: true; report: ParsedSms } | { ok: false; reason: string } {
  const value = text.replace(/\r/g, '').trim();
  const head = value.match(/SAKLOLO SOS (\w+) @(no-gps|(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?: ±(\d+)m)?) (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/);
  if (!head) return { ok: false, reason: 'This does not look like a Saklolo SMS. It should start with "SAKLOLO SOS".' };
  const category = CATEGORIES.find(item => item.toLowerCase() === head[1].toLowerCase());
  if (!category) return { ok: false, reason: `Unknown category "${head[1]}".` };
  const id = value.match(/id:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1]?.toLowerCase();
  if (!id) return { ok: false, reason: 'The report ID line ("id:…") is missing or cut off. Ask the resident to resend the full message.' };
  let location: ParsedSms['location'] = null;
  if (head[2] !== 'no-gps') {
    const lat = Number(head[3]), lng = Number(head[4]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, reason: 'The GPS coordinates are not valid.' };
    location = { lat, lng, accuracy: head[5] ? Number(head[5]) : null };
  }
  // Details are the first line under the header; anything a phone adds when forwarding is ignored.
  const detailsLine = value.slice((head.index || 0) + head[0].length).split('\n').map(line => line.trim()).find(line => line && !/^id:/i.test(line)) || '';
  const [landmark = '', ...rest] = detailsLine.split('|').map(part => part.trim());
  const description = rest.join(' | ').trim();
  return {
    ok: true,
    report: {
      id,
      createdAt: new Date(head[6]).toISOString(),
      category,
      location,
      landmark: landmark === 'No landmark' ? '' : landmark.slice(0, 240),
      description: description === 'No details' ? '' : description.slice(0, 4000),
    },
  };
}
