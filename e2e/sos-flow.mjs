// End-to-end check of the demo flow against a running server (default http://127.0.0.1:3001).
//   node e2e/sos-flow.mjs [baseUrl]
// Resident sends an SOS with simulated GPS -> desk receives it -> operator acknowledges and
// verifies -> resident sees the review. Uses synthetic data only; prints PASS/FAIL lines.
import { chromium } from '@playwright/test';

const base = process.argv[2] || 'http://127.0.0.1:3001';
const results = [];
const errors = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
const ids = async () => new Set((await (await fetch(`${base}/api/reports`)).json()).map(report => report.id));

// Prefer an installed Chrome so no browser download is needed; fall back to Playwright's bundled build.
async function launch() {
  try { return await chromium.launch({ channel: 'chrome' }); }
  catch { return chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}); }
}
const browser = await launch();
try {
  const resident = await browser.newContext({ geolocation: { latitude: 14.5547, longitude: 121.0244, accuracy: 12 }, permissions: ['geolocation'], viewport: { width: 390, height: 844 } });
  const operator = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const residentPage = await resident.newPage();
  const operatorPage = await operator.newPage();
  for (const [label, page] of [['resident', residentPage], ['operator', operatorPage]]) {
    page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${label} console: ${message.text()}`); });
  }

  // Operator desk open first, so the arrival is observed live.
  await operatorPage.goto(base + '/');
  await operatorPage.evaluate(() => { history.pushState({}, '', '/operator'); dispatchEvent(new PopStateEvent('popstate')); });
  await operatorPage.getByRole('heading', { name: 'Community response desk' }).waitFor({ timeout: 15000 });
  check('operator desk loads', true);

  const before = await ids();
  await residentPage.goto(base + '/');
  const sos = residentPage.getByRole('button', { name: 'Send SOS' });
  await sos.waitFor({ timeout: 15000 });
  await sos.click();
  await residentPage.getByText(/Request delivered|Delivered to the demo desk/).first().waitFor({ timeout: 15000 });
  check('resident SOS is delivered to the server', true);

  const after = await ids();
  const created = [...after].filter(id => !before.has(id));
  check('exactly one new report on the server', created.length === 1, `${created.length} new`);
  const id = created[0];
  const stored = (await (await fetch(`${base}/api/reports`)).json()).find(report => report.id === id);
  check('report carries the simulated GPS fix', Boolean(stored?.location) && Math.abs(stored.location.lat - 14.5547) < 0.001, stored?.location ? `±${stored.location.accuracy} m` : 'no location');

  const row = operatorPage.locator(`[data-report-id="${id}"]`);
  await row.waitFor({ timeout: 10000 });
  check('report appears in the operator queue without reload', true);
  await row.click();
  await operatorPage.getByRole('heading', { name: 'Trust signals' }).waitFor({ timeout: 5000 });
  check('drawer opens with trust signals', true);

  await operatorPage.getByRole('button', { name: 'Acknowledge report' }).click();
  const acknowledgedAt = Date.now();
  await operatorPage.locator('.ops-drawer').getByRole('button', { name: 'Acknowledged' }).waitFor({ timeout: 10000 });
  check('operator acknowledgement is saved', true);

  await residentPage.getByText('Your request was reviewed').first().waitFor({ timeout: 10000 });
  check('resident sees the review', true, `${((Date.now() - acknowledgedAt) / 1000).toFixed(1)} s after acknowledging`);

  await operatorPage.getByRole('button', { name: 'Confirmed with resident' }).click();
  await operatorPage.getByRole('textbox', { name: 'Note (optional)' }).fill('E2E test: synthetic callback');
  await operatorPage.getByRole('button', { name: 'Save', exact: true }).click();
  await operatorPage.locator(`[data-report-id="${id}"]`).getByText('Verified').waitFor({ timeout: 10000 });
  const verified = (await (await fetch(`${base}/api/reports`)).json()).find(report => report.id === id);
  check('verification is recorded and shown in the queue', verified?.verification?.status === 'confirmed' && verified.status === 'acknowledged');

  // Simulated dispatch: notify the suggested agency, then advance to resolved.
  const drawer = operatorPage.locator('.ops-drawer');
  await drawer.getByRole('button', { name: /Simulate call to/ }).click();
  await residentPage.getByText(/notified$/).first().waitFor({ timeout: 10000 });
  check('resident sees the agency was notified (simulated)', await residentPage.getByText(/No real agency was contacted/).first().isVisible());
  for (const action of ['Mark on the way', 'Mark on scene', 'Mark resolved']) {
    await drawer.getByRole('button', { name: action }).click();
    await drawer.getByRole('button', { name: action }).waitFor({ state: 'detached', timeout: 10000 });
  }
  await residentPage.getByText('Request resolved').first().waitFor({ timeout: 10000 });
  const done = (await (await fetch(`${base}/api/reports`)).json()).find(report => report.id === id);
  check('dispatch reaches resolved on both screens', done?.dispatch?.stage === 'resolved' && done.dispatch.simulated === true);

  check('no page errors on either side', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  check('flow completed', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  if (errors.length) console.log('page errors:', errors.slice(0, 5).join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter(result => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
