// Offline demo exactly as presented on one laptop: resident and desk are tabs of the SAME browser
// (shared storage). The in-app "Signal" switch must stop every tab from delivering.
//   node e2e/demo-offline-switch.mjs [baseUrl] [screenshotDir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:3001';
const out = process.argv[3];
if (out) mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
const reports = async () => (await fetch(`${base}/api/reports`)).json();
let browser;
try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }
const errors = [];
try {
  const context = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 14.5652, longitude: 121.0307, accuracy: 20 }, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const desk = await context.newPage();
  const phone = await context.newPage();
  for (const page of [desk, phone]) page.on('pageerror', error => errors.push(error.message));
  await desk.setViewportSize({ width: 1440, height: 900 });
  await desk.goto(base + '/');
  await desk.evaluate(() => { history.pushState({}, '', '/operator'); dispatchEvent(new PopStateEvent('popstate')); });
  await desk.getByRole('heading', { name: 'Community response desk' }).waitFor({ timeout: 15000 });
  await phone.goto(base + '/');
  await phone.getByText('Demo desk reachable').waitFor({ timeout: 15000 });
  await phone.waitForTimeout(800);

  await phone.getByRole('button', { name: /Signal/ }).click();
  await phone.getByText('Offline. SOS still works.').waitFor({ timeout: 5000 });
  check('one tap on the Signal switch puts the phone offline', true);

  const before = (await reports()).length;
  await phone.getByRole('button', { name: 'Send SOS' }).click();
  await phone.getByRole('heading', { name: 'What happened?' }).waitFor({ timeout: 10000 });
  await phone.locator('.quick-intake-types').getByRole('button', { name: 'Fire' }).click();
  await phone.getByRole('button', { name: 'Next' }).click();
  await phone.getByRole('button', { name: '1', exact: true }).click();
  await phone.getByRole('textbox', { name: 'Nearest landmark' }).fill('Behind the barangay hall');
  await phone.getByRole('button', { name: 'Send details' }).click();
  await phone.getByRole('heading', { name: 'Saved on this phone' }).waitFor({ timeout: 10000 });
  await phone.locator('.sms-fallback').scrollIntoViewIfNeeded();
  if (out) { await phone.waitForTimeout(400); await phone.screenshot({ path: `${out}/offline-saved.png` }); }
  check('SOS + three answers are saved on the phone', true);

  await desk.waitForTimeout(7000); // the desk tab runs its own 5 s sync loop
  check('desk tab does NOT deliver the offline report (shared storage)', (await reports()).length === before);
  check('desk itself stays online', await desk.getByText('Desk reachable').isVisible());

  const href = await phone.locator('a.sms-send').getAttribute('href');
  const body = decodeURIComponent(href.split('body=')[1]);
  const id = body.match(/id:([0-9a-f-]{36})/)[1];
  await desk.bringToFront();
  await desk.getByRole('button', { name: 'Log SMS' }).click();
  await desk.getByRole('textbox', { name: 'SMS text' }).fill(body);
  await desk.getByRole('button', { name: 'Add to queue' }).click();
  await desk.locator(`[data-report-id="${id}"]`).getByText('SMS').waitFor({ timeout: 10000 });
  check('desk logs the SMS report', true);

  await phone.bringToFront();
  await phone.getByRole('button', { name: /No signal/ }).click();
  await phone.getByText(/Request delivered|Your request was reviewed/).first().waitFor({ timeout: 15000 });
  const after = await reports();
  check('switching the signal back delivers once, no duplicate', after.length === before + 1 && after.filter(report => report.id === id).length === 1);
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('flow completed', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
} finally {
  await browser.close();
}
const failed = results.filter(ok => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
