import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import path from 'node:path';

const editableFields = {
  category: z.enum(['Medical', 'Fire', 'Safety', 'Flood', 'Other']),
  description: z.string().max(4000), landmark: z.string().max(240),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().nonnegative().nullable() }).strict().nullable(),
  locationCapturedAt: z.string().datetime().nullable().optional()
};
const reportSchema = z.object({
  id: z.string().uuid(), createdAt: z.string().datetime(),
  ...editableFields,
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
  source: z.enum(['sos', 'form', 'voice'])
});
const patchSchema = z.object({ ...editableFields }).partial().extend({ revision: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER) }).strict().refine(value => Object.keys(value).some(key => key !== 'revision'), { message: 'Include a report field to update.' });
function voiceFailure(status, upstreamCode) {
  if (status === 401) return { code: 'voice_authentication_failed', error: 'OpenAI rejected the server API key. Replace the backend key and restart the server. SOS reporting still works.' };
  if (status === 403) return { code: 'voice_access_denied', error: 'This OpenAI project does not have access to voice sessions. Check project permissions and model access.' };
  if (upstreamCode === 'insufficient_quota' || upstreamCode === 'billing_hard_limit_reached') return { code: 'voice_quota_exceeded', error: 'OpenAI voice is out of API credit or has reached its spending limit. Check project billing. SOS reporting still works.' };
  if (status === 429) return { code: 'voice_rate_limited', error: 'OpenAI is limiting voice requests. Wait briefly and try again, or use the SOS button.' };
  if (status === 404 || upstreamCode === 'model_not_found') return { code: 'voice_model_unavailable', error: 'The configured voice model is unavailable to this project. Check OPENAI_REALTIME_MODEL on the server.' };
  if (status === 400) return { code: 'voice_configuration_invalid', error: 'OpenAI rejected the voice-session configuration. Check the server model setting.' };
  return { code: 'voice_provider_unavailable', error: 'OpenAI voice is temporarily unavailable. Retry shortly, or use the SOS button.' };
}

export function createApp({ database = ':memory:', apiKey = '', model = 'gpt-realtime', notify = () => {}, fetchImpl = fetch, voiceTimeoutMs = 15000 } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // This unauthenticated prototype is local-only. Reject browser requests
    // initiated by unrelated websites, including calls that could spend API credits.
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Open the demo directly to use this endpoint.' });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  const db = new DatabaseSync(database);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  const get = id => { const row = db.prepare('SELECT body FROM reports WHERE id=?').get(id); return row ? JSON.parse(row.body) : null; };
  const save = report => db.prepare('INSERT INTO reports(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(report.id, JSON.stringify(report));
  let lastVoiceAttempt = null;
  app.get('/api/health', (_req, res) => res.json({ ok: true, voiceConfigured: Boolean(apiKey), mode: 'local-demo' }));
  app.get('/api/voice/status', (_req, res) => res.json({ configured: Boolean(apiKey), model, requiresInternet: true, transport: 'websocket', microphoneRequiresSecureContext: true, lastAttempt: lastVoiceAttempt }));
  app.get('/api/reports', (_req, res) => res.json(db.prepare('SELECT body FROM reports ORDER BY rowid DESC').all().map(row => JSON.parse(row.body))));
  app.post('/api/reports', (req, res) => {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid report. Check the location and report details.' });
    const existing = get(parsed.data.id);
    if (existing) return res.json(existing);
    const report = { ...parsed.data, status: 'delivered', receivedAt: new Date().toISOString(), acknowledgedAt: null };
    save(report); notify(); res.status(201).json(report);
  });
  app.patch('/api/reports/:id', (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid update. Include an incremented revision and valid report details.' });
    const existing = get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Report not found.' });
    if (parsed.data.revision <= (existing.revision || 1)) return res.json(existing);
    const report = { ...existing, ...parsed.data, updatedAt: new Date().toISOString() };
    save(report); notify(); res.json(report);
  });
  app.post('/api/reports/:id/acknowledge', (req, res) => {
    const report = get(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    if (report.status !== 'acknowledged') { report.status = 'acknowledged'; report.acknowledgedAt = new Date().toISOString(); save(report); notify(); }
    res.json(report);
  });
  app.post('/api/voice/session', rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { code: 'voice_session_limit', error: 'Too many voice sessions. Wait a minute, or use the SOS button.' } }), async (_req, res) => {
    if (!apiKey) return res.status(503).json({ code: 'voice_not_configured', error: 'Voice is not configured. You can still send an SOS.' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Voice service timed out', 'TimeoutError')), voiceTimeoutMs);
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', onClose);
    const finish = (result, status) => {
      lastVoiceAttempt = { at: new Date().toISOString(), status, code: result.code || 'voice_session_created' };
      if (!res.destroyed) res.status(status).json(result);
    };
    try {
      const upstream = await fetchImpl('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: { type: 'realtime', model } }), signal: controller.signal
      });
      if (!upstream.ok) {
        // Only compare known provider codes. Never forward raw messages, headers,
        // request bodies, or credentials to the client or diagnostics endpoint.
        const failure = await upstream.json().catch(() => null);
        return finish(voiceFailure(upstream.status, failure?.error?.code), 502);
      }
      const data = await upstream.json();
      if (typeof data.value !== 'string' || !data.value) return finish({ code: 'voice_response_invalid', error: 'OpenAI returned an incomplete voice session. Please retry.' }, 502);
      finish({ value: data.value, model, ...(Number.isFinite(data.expires_at) ? { expiresAt: data.expires_at } : {}) }, 200);
    } catch {
      if (res.destroyed) return;
      const timedOut = controller.signal.reason?.name === 'TimeoutError';
      finish({ code: timedOut ? 'voice_timeout' : 'voice_network_error', error: timedOut ? 'OpenAI voice took too long to respond. Please retry, or use the SOS button.' : 'Cannot reach OpenAI voice. Check the server internet connection. SOS reporting still works.' }, timedOut ? 504 : 502);
    } finally { clearTimeout(timeout); res.off('close', onClose); }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use(express.static(path.resolve('dist')));
  app.get('/{*path}', (_req, res, next) => res.sendFile(path.resolve('dist/index.html'), err => err && next(err)));
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request must contain valid JSON.' });
    if (err.status === 413) return res.status(413).json({ error: 'Report is too large.' });
    if (err.status === 404) return res.status(404).json({ error: 'Page not found. Build the frontend with npm run build first.' });
    res.status(500).json({ error: 'Request could not be completed.' });
  });
  return { app, close: () => db.close() };
}
