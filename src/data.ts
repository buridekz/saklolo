import Dexie, { type Table } from 'dexie';
export const categories = ['Medical', 'Fire', 'Safety', 'Flood', 'Other'] as const;
export type Category = typeof categories[number];
export type Coordinates = { lat: number; lng: number; accuracy: number | null };
export type Report = { id: string; createdAt: string; category: Category; description: string; landmark: string; location: Coordinates | null; locationCapturedAt?: string | null; revision?: number; needsSync?: boolean; source: 'sos' | 'form' | 'voice' | 'sms'; status: 'pending' | 'delivered' | 'acknowledged'; receivedAt?: string; acknowledgedAt?: string | null; deliveryError?: string; dispatch?: Dispatch | null; dispatchHistory?: Dispatch[] };
/** DEMO ONLY: simulated responder dispatch set by the operator desk. No agency is ever contacted. */
export const dispatchStages = ['notified', 'en_route', 'on_scene', 'resolved'] as const;
export type DispatchStage = typeof dispatchStages[number];
export type Agency = 'BFP' | 'EMS' | 'MDRRMO' | 'PNP' | 'Barangay';
export type Dispatch = { agency: Agency; stage: DispatchStage; simulated: true; updatedAt: string };
export const agencyNames: Record<Agency, string> = { BFP: 'Fire protection (BFP)', EMS: 'Ambulance / EMS', MDRRMO: 'Disaster response (MDRRMO)', PNP: 'Police (PNP)', Barangay: 'Barangay responders' };
export const stageLabels: Record<DispatchStage, string> = { notified: 'Agency notified', en_route: 'Responders on the way', on_scene: 'Responders on scene', resolved: 'Resolved' };
class LocalDatabase extends Dexie {
  reports!: Table<Report>;
  constructor() { super('saklolo'); this.version(1).stores({ reports: 'id,status,createdAt' }); }
}
export const db = new LocalDatabase();
export const labels = { pending: 'Saved on this device', delivered: 'Delivered · awaiting review', acknowledged: 'Acknowledged by demo desk' };
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, signal: options?.signal ?? AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed. Please try again.');
  return body;
}
let syncPromise: Promise<void> | null = null;
export async function editReport(id: string, changes: Partial<Pick<Report, 'category' | 'description' | 'landmark' | 'location' | 'locationCapturedAt'>>) {
  await db.transaction('rw', db.reports, async () => {
    const current = await db.reports.get(id);
    if (!current) throw new Error('Report no longer exists on this device.');
    await db.reports.put({ ...current, ...changes, revision: (current.revision || 1) + 1, needsSync: true });
  });
  window.dispatchEvent(new Event('reports-updated'));
}
async function acceptRemote(remote: Report) {
  await db.transaction('rw', db.reports, async () => {
    const local = await db.reports.get(remote.id);
    if (!local) return;
    if ((local.revision || 1) > (remote.revision || 1)) {
      await db.reports.put({ ...local, status: remote.status, receivedAt: remote.receivedAt, acknowledgedAt: remote.acknowledgedAt, needsSync: true });
    } else await db.reports.put({ ...remote, needsSync: false });
  });
}
function patchBody(report: Report) {
  return { revision: report.revision || 1, category: report.category, description: report.description, landmark: report.landmark, location: report.location, locationCapturedAt: report.locationCapturedAt || null };
}
/**
 * DEMO ONLY: "Simulate no signal" switch. Stored in localStorage so it applies to every tab of
 * this browser; otherwise the desk tab (same storage) would quietly deliver the resident's
 * "offline" reports. While on, nothing on this device syncs; logging an SMS on the desk still works.
 */
const DEMO_OFFLINE_KEY = 'saklolo-demo-offline';
export function demoOffline() {
  try { return localStorage.getItem(DEMO_OFFLINE_KEY) === 'on'; } catch { return false; }
}
export function setDemoOffline(on: boolean) {
  try { if (on) localStorage.setItem(DEMO_OFFLINE_KEY, 'on'); else localStorage.removeItem(DEMO_OFFLINE_KEY); } catch { /* Optional demo control. */ }
  window.dispatchEvent(new Event('demo-offline-changed'));
  if (!on) void syncReports();
}

/** True when the device itself reports no network (Wi-Fi and data off). Matches the offline banner. */
const deviceOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

export function syncReports() {
  // Wait instead of sending when the device is offline. The 'online' event triggers a sync on reconnect.
  // (A server on the same laptop stays reachable with Wi-Fi off, so without this the banner said
  // "Offline" while reports were still being delivered.)
  if (demoOffline() || deviceOffline()) return Promise.resolve();
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    for (const report of (await db.reports.toArray()).filter(report => report.status === 'pending' || report.needsSync)) {
      try {
        let saved = report.receivedAt
          ? await api<Report>(`/api/reports/${report.id}`, { method: 'PATCH', body: JSON.stringify(patchBody(report)) })
          : await api<Report>('/api/reports', { method: 'POST', body: JSON.stringify(report) });
        if ((saved.revision || 1) < (report.revision || 1)) saved = await api<Report>(`/api/reports/${report.id}`, { method: 'PATCH', body: JSON.stringify(patchBody(report)) });
        await acceptRemote(saved);
      }
      catch (error) { await db.reports.update(report.id, { deliveryError: error instanceof Error ? error.message : 'Waiting for connection.' }); }
    }
    try {
      const remote = await api<Report[]>('/api/reports');
      for (const report of remote) await acceptRemote(report);
    } catch { /* Keep confirmed local state when the desk is unreachable. */ }
    window.dispatchEvent(new Event('reports-updated'));
  })().finally(() => { syncPromise = null; });
  return syncPromise;
}
