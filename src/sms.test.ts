// Run with: node --test src/sms.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSms, smsBody, smsHref } from './sms.ts';

const report = {
  id: '3f2a1c9e-0b7d-4c1a-9e2f-1234567890ab',
  createdAt: '2026-11-12T10:42:05.123Z',
  category: 'Flood' as const,
  description: 'Water rising | family upstairs',
  landmark: 'Near  Ayala Triangle',
  location: { lat: 14.5547, lng: 121.0244, accuracy: 12.4 },
};

test('round-trips a report through the SMS text', () => {
  const body = smsBody(report);
  assert.match(body, /^SAKLOLO SOS Flood @14\.55470,121\.02440 ±12m 2026-11-12T10:42:05Z\n/);
  const parsed = parseSms(body);
  assert.ok(parsed.ok);
  assert.equal(parsed.report.id, report.id);
  assert.equal(parsed.report.category, 'Flood');
  assert.deepEqual(parsed.report.location, { lat: 14.5547, lng: 121.0244, accuracy: 12 });
  assert.equal(parsed.report.landmark, 'Near Ayala Triangle');
  assert.equal(parsed.report.description, 'Water rising / family upstairs');
  assert.equal(parsed.report.createdAt, '2026-11-12T10:42:05.000Z');
});

test('handles missing GPS, empty text, and forwarded messages with extra text', () => {
  const body = smsBody({ ...report, location: null, landmark: '', description: '' });
  const parsed = parseSms(`Fwd from +63...\n\n${body}\n\nSent from my phone`);
  assert.ok(parsed.ok);
  assert.equal(parsed.report.location, null);
  assert.equal(parsed.report.landmark, '');
  assert.equal(parsed.report.description, '', 'text added by the phone is not part of the report');
});

test('refuses to guess when the message is incomplete or not ours', () => {
  assert.equal(parseSms('help please').ok, false);
  assert.equal(parseSms(smsBody(report).replace(/id:.*/, '')).ok, false);
  assert.equal(parseSms(smsBody(report).replace('Flood', 'Volcano')).ok, false);
  assert.equal(parseSms(smsBody(report).replace('14.55470', '99.00000')).ok, false);
});

test('keeps long messages bounded and builds an sms link', () => {
  const body = smsBody({ ...report, description: 'x'.repeat(2000) });
  assert.ok(body.length < 420);
  assert.match(smsHref('hi there', ''), /^sms:\?&body=hi%20there$/);
  assert.match(smsHref('a', '09171234567'), /^sms:09171234567\?&body=a$/);
});
