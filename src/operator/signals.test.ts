// Run with: node --test src/operator/signals.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Report } from '../data';
import { distanceMeters, nearbyReports, trustSignals } from './signals.ts';

const now = Date.parse('2026-11-12T10:00:00Z');
const minutesAgo = (minutes: number) => new Date(now - minutes * 60000).toISOString();
const base = (overrides: Partial<Report> = {}): Report => ({
  id: 'a', createdAt: minutesAgo(3), category: 'Flood', description: 'Knee-deep water rising, family of four upstairs.',
  landmark: 'Corner of Kalayaan Ave', location: { lat: 14.5639, lng: 121.0366, accuracy: 20 }, locationCapturedAt: minutesAgo(1),
  revision: 1, source: 'sos', status: 'delivered', ...overrides,
});
const state = (report: Report, id: string, nearby = 0) => trustSignals(report, nearby, now).find(signal => signal.id === id)?.state;

test('fresh precise GPS with landmark and details reads as strong', () => {
  const report = base();
  assert.equal(state(report, 'gps'), 'strong');
  assert.equal(state(report, 'accuracy'), 'strong');
  assert.equal(state(report, 'landmark'), 'strong');
  assert.equal(state(report, 'details'), 'strong');
});

test('missing or old evidence is reported honestly, never invented', () => {
  assert.equal(state(base({ location: null, locationCapturedAt: null }), 'gps'), 'missing');
  assert.equal(state(base({ location: null }), 'accuracy'), undefined);
  assert.equal(state(base({ locationCapturedAt: minutesAgo(10) }), 'gps'), 'partial');
  assert.equal(state(base({ location: { lat: 14.56, lng: 121.03, accuracy: 900 } }), 'accuracy'), 'missing');
  assert.equal(state(base({ landmark: '  ' }), 'landmark'), 'missing');
  assert.equal(state(base({ description: '' }), 'details'), 'missing');
});

test('corroboration, revisions and voice add strong signals', () => {
  assert.equal(state(base(), 'nearby', 2), 'strong');
  assert.equal(state(base(), 'nearby', 0), 'partial');
  assert.equal(state(base({ revision: 3 }), 'revision'), 'strong');
  assert.equal(state(base(), 'revision'), undefined);
  assert.equal(state(base({ source: 'voice' }), 'source'), 'strong');
});

test('nearby reports are limited by distance and time', () => {
  const report = base();
  const close = base({ id: 'b', location: { lat: 14.5641, lng: 121.0368, accuracy: 30 } });
  const far = base({ id: 'c', location: { lat: 14.60, lng: 121.10, accuracy: 30 } });
  const old = base({ id: 'd', createdAt: minutesAgo(180) });
  const noGps = base({ id: 'e', location: null });
  assert.deepEqual(nearbyReports(report, [report, close, far, old, noGps]).map(r => r.id), ['b']);
  assert.ok(Math.abs(distanceMeters({ lat: 14.5639, lng: 121.0366 }, { lat: 14.5639, lng: 121.0466 }) - 1077) < 15);
});
