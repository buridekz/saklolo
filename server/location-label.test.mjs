import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocationLabelService, createLookupGate, validCoordinates } from './location-label.mjs';

test('coordinates reject missing, nonnumeric, infinite and out of range', () => {
  for (const pair of [[null, 1], ['1', 2], [91, 2], [1, -181], [NaN, 2], [Infinity, 0]]) assert.equal(validCoordinates(...pair), false);
  assert.equal(validCoordinates(14.5, 121), true);
});
test('unconfigured provider never transmits coordinates', async () => {
  let called = false;
  const lookup = createLocationLabelService({ endpoint: '', fetchImpl: async () => { called = true; } });
  assert.equal((await lookup(10, 20)).label, null); assert.equal(called, false);
});
test('lookup identifies app, caches results and coalesces same coordinates', async () => {
  let calls = 0;
  const lookup = createLocationLabelService({ endpoint: 'https://example.test/reverse', gate: task => task(), fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.searchParams.get('lat'), '10.00000');
    assert.equal(url.searchParams.get('layer'), 'address');
    assert.match(options.headers['User-Agent'], /Saklolo/);
    assert.ok(options.signal);
    return { ok: true, json: async () => ({ display_name: 'Example Street, Test District' }) };
  } });
  const results = await Promise.all([lookup(10, 20), lookup(10, 20)]);
  assert.equal(results[0].label, 'Example Street, Test District');
  await lookup(10, 20); assert.equal(calls, 1);
});
test('provider failure is a cached unavailable result, never invented address', async () => {
  let calls = 0;
  const lookup = createLocationLabelService({ endpoint: 'https://example.test/reverse', gate: task => task(), fetchImpl: async () => { calls++; throw new Error('offline'); } });
  assert.equal((await lookup(10, 20)).label, null);
  await lookup(10, 20); assert.equal(calls, 1);
});
test('one global-style serial gate starts requests at least 1100ms apart', async () => {
  let clock = 0;
  const starts = [];
  const gate = createLookupGate({ now: () => clock, wait: async ms => { clock += ms; } });
  await Promise.all([gate(() => starts.push(clock)), gate(() => starts.push(clock)), gate(() => starts.push(clock))]);
  assert.deepEqual(starts, [0, 1100, 2200]);
});
test('queue rejects overload without running extra provider calls', async () => {
  let release;
  const gate = createLookupGate({ maxQueued: 1 });
  const first = gate(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  await assert.rejects(gate(() => assert.fail('must not run')), /queue is full/);
  release(); await first;
});

test('location endpoint validates requests and returns injected labels without touching reports', async () => {
  const { createApp } = await import('./app.mjs');
  const calls = [];
  const { app, close } = createApp({ locationLabelService: async (lat, lng) => { calls.push([lat, lng]); return { label: 'Synthetic Street, Test Barangay', source: 'OpenStreetMap', available: true }; } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const query of ['', '?lat=&lng=1', '?lat=999&lng=2', '?lat=1&lng=NaN']) assert.equal((await fetch(base + '/api/location-label' + query)).status, 400);
    const response = await fetch(base + '/api/location-label?lat=10&lng=20');
    assert.equal(response.status, 200); assert.equal((await response.json()).label, 'Synthetic Street, Test Barangay');
    assert.deepEqual(calls, [[10, 20]]);
    assert.deepEqual(await (await fetch(base + '/api/reports')).json(), []);
  } finally { await new Promise(resolve => server.close(resolve)); close(); }
});
