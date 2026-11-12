import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from './app.mjs';

test('delivery retries are idempotent and cannot reverse acknowledgement', async () => {
  const { app, close } = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = { id: randomUUID(), createdAt: new Date().toISOString(), category: 'Flood', description: 'Demo only', landmark: 'Test hall', location: null, source: 'sos' };
  const post = (url, data) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  try {
    assert.equal((await post('/api/reports', { ...body, location: { lat: 999, lng: 0, accuracy: null } })).status, 400);
    assert.equal((await post('/api/reports', body)).status, 201);
    const ack = await (await post(`/api/reports/${body.id}/acknowledge`, {})).json();
    assert.equal(ack.status, 'acknowledged');
    assert.ok(ack.acknowledgedAt);
    const retry = await (await post('/api/reports', body)).json();
    assert.equal(retry.status, 'acknowledged');
    assert.equal((await (await fetch(base + '/api/reports')).json()).length, 1);
    assert.equal((await post('/api/voice/session', {})).status, 503);
  } finally { await new Promise(resolve => server.close(resolve)); close(); }
});

async function runServer(options, run) {
  const { app, close } = createApp(options);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); close(); }
}

test('SQLite preserves reports and acknowledgements across a server restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'saklolo-test-'));
  const database = path.join(directory, 'reports.sqlite');
  const report = { id: randomUUID(), createdAt: new Date().toISOString(), category: 'Medical', description: 'Test report', landmark: '', location: { lat: 14.55, lng: 121.02, accuracy: 35 }, source: 'form' };
  try {
    await runServer({ database }, async base => {
      await fetch(base + '/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
      await fetch(base + `/api/reports/${report.id}/acknowledge`, { method: 'POST' });
    });
    await runServer({ database }, async base => {
      const reports = await (await fetch(base + '/api/reports')).json();
      assert.equal(reports.length, 1);
      assert.equal(reports[0].id, report.id);
      assert.equal(reports[0].status, 'acknowledged');
      assert.deepEqual(reports[0].location, report.location);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('voice endpoint returns only temporary credentials and handles provider failure without leaking secrets', async () => {
  let calls = 0;
  await runServer({ apiKey: 'test-server-secret', fetchImpl: async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-server-secret');
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ value: 'test-ephemeral-token', extra: 'must not be forwarded' }));
    return new Response(JSON.stringify({ error: { message: 'test-server-secret' } }), { status: 401 });
  } }, async base => {
    const response = await fetch(base + '/api/voice/session', { method: 'POST' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { value: 'test-ephemeral-token', model: 'gpt-realtime' });
    const failure = await fetch(base + '/api/voice/session', { method: 'POST' });
    assert.equal(failure.status, 502);
    assert.ok(!(await failure.text()).includes('test-server-secret'));
  });
});

test('malformed JSON and unrelated browser origins are rejected', async () => {
  await runServer({}, async base => {
    const malformed = await fetch(base + '/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers.get('cache-control'), 'no-store');
    const crossSite = await fetch(base + '/api/voice/session', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(crossSite.status, 403);
    const missing = await fetch(base + `/api/reports/${randomUUID()}/acknowledge`, { method: 'POST' });
    assert.equal(missing.status, 404);
  });
});

test('voice errors distinguish quota, model access, and invalid upstream responses without exposing provider text', async () => {
  const responses = [
    new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'sensitive provider text' } }), { status: 429 }),
    new Response(JSON.stringify({ error: { code: 'model_not_found', message: 'sensitive provider text' } }), { status: 400 }),
    new Response(JSON.stringify({ value: { secret: 'sensitive provider text' } }))
  ];
  await runServer({ apiKey: 'test-secret', fetchImpl: async () => responses.shift() }, async base => {
    const initial = await (await fetch(base + '/api/voice/status')).json();
    assert.equal(initial.configured, true);
    assert.equal(initial.requiresInternet, true);
    assert.equal(initial.lastAttempt, null);
    for (const code of ['voice_quota_exceeded', 'voice_model_unavailable', 'voice_response_invalid']) {
      const result = await (await fetch(base + '/api/voice/session', { method: 'POST' })).json();
      assert.equal(result.code, code);
      assert.ok(!JSON.stringify(result).includes('sensitive provider text'));
      const status = await (await fetch(base + '/api/voice/status')).json();
      assert.equal(status.lastAttempt.code, code);
      assert.ok(!JSON.stringify(status).includes('test-secret'));
    }
  });
});

test('voice session creation has a bounded timeout and readable recovery message', async () => {
  await runServer({ apiKey: 'test-secret', voiceTimeoutMs: 20, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) }, async base => {
    const response = await fetch(base + '/api/voice/session', { method: 'POST' });
    assert.equal(response.status, 504);
    assert.equal((await response.json()).code, 'voice_timeout');
    const health = await (await fetch(base + '/api/health')).json();
    assert.equal(health.ok, true);
  });
});

test('report revisions update live location and details without reversing acknowledgement or accepting stale edits', async () => {
  let notifications = 0;
  await runServer({ notify: () => notifications++ }, async base => {
    const report = { id: randomUUID(), createdAt: new Date().toISOString(), category: 'Other', description: '', landmark: '', location: null, source: 'voice' };
    const send = (url, method, body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const created = await (await send('/api/reports', 'POST', report)).json();
    assert.equal(created.revision, 1);
    await send(`/api/reports/${report.id}/acknowledge`, 'POST', {});
    const route = `/api/reports/${report.id}`;
    const location = { lat: 14.55, lng: 121.02, accuracy: 10 };
    const captured = new Date().toISOString();
    const update = { revision: 2, location, locationCapturedAt: captured, category: 'Flood', description: 'Water is rising.' };
    const revised = await (await send(route, 'PATCH', update)).json();
    assert.equal(revised.revision, 2);
    assert.equal(revised.status, 'acknowledged');
    assert.ok(revised.acknowledgedAt);
    assert.deepEqual(revised.location, location);
    assert.equal(revised.locationCapturedAt, captured);
    const later = await (await send(route, 'PATCH', { revision: 4, description: 'Everyone has moved upstairs.' })).json();
    assert.equal(later.revision, 4);
    const stale = await (await send(route, 'PATCH', { revision: 3, description: 'Outdated description' })).json();
    assert.equal(stale.description, later.description);
    assert.equal((await send(route, 'PATCH', { revision: 5, status: 'delivered' })).status, 400);
    assert.equal((await send(route, 'PATCH', { revision: 5, location: { ...location, lat: 999 } })).status, 400);
    assert.equal((await send(route, 'PATCH', { revision: 5 })).status, 400);
    assert.equal((await send(route, 'PATCH', { revision: 5, locationCapturedAt: 'yesterday' })).status, 400);
    assert.equal((await (await fetch(base + '/api/reports')).json()).length, 1);
    assert.equal(notifications, 4);
  });
});

test('operator verification is recorded with a history and never changes review or report content', async () => {
  let notifications = 0;
  await runServer({ notify: () => { notifications += 1; } }, async base => {
    const send = (url, method, data) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const report = { id: randomUUID(), createdAt: new Date().toISOString(), category: 'Fire', description: 'Test smoke', landmark: 'Test hall', location: null, source: 'sos' };
    const route = `/api/reports/${report.id}/verification`;
    assert.equal((await send(route, 'POST', { status: 'confirmed' })).status, 404);
    assert.equal((await send('/api/reports', 'POST', { ...report, verification: { status: 'confirmed' } })).status, 201);
    const created = (await (await fetch(base + '/api/reports')).json())[0];
    assert.equal(created.verification, undefined, 'residents cannot self-verify on submission');

    assert.equal((await send(route, 'POST', { status: 'flagged', note: '' })).status, 400, 'flagging requires a reason');
    assert.equal((await send(route, 'POST', { status: 'real' })).status, 400);
    assert.equal((await send(route, 'POST', { status: 'confirmed', note: 'x'.repeat(281) })).status, 400);
    assert.equal((await send(route, 'POST', { status: 'confirmed', extra: true })).status, 400);

    const flagged = await (await send(route, 'POST', { status: 'flagged', note: '  Caller laughed and hung up  ' })).json();
    assert.equal(flagged.verification.status, 'flagged');
    assert.equal(flagged.verification.note, 'Caller laughed and hung up');
    assert.ok(flagged.verification.updatedAt);
    assert.equal(flagged.status, 'delivered', 'flagging never acknowledges, hides or deletes a report');
    assert.equal(flagged.description, 'Test smoke');

    await send(`/api/reports/${report.id}/acknowledge`, 'POST', {});
    const confirmed = await (await send(route, 'POST', { status: 'confirmed', note: 'Resident answered callback' })).json();
    assert.equal(confirmed.status, 'acknowledged');
    assert.deepEqual(confirmed.verificationHistory.map(entry => entry.status), ['flagged', 'confirmed']);

    assert.equal((await send(`/api/reports/${report.id}`, 'PATCH', { revision: 2, verification: { status: 'confirmed' } })).status, 400, 'residents cannot verify through edits');
    const edited = await (await send(`/api/reports/${report.id}`, 'PATCH', { revision: 2, description: 'Test smoke, now visible flames' })).json();
    assert.equal(edited.verification.status, 'confirmed', 'resident edits keep the operator verification');
    assert.equal((await (await fetch(base + '/api/reports')).json()).length, 1);
    assert.equal(notifications, 5);
  });
});
