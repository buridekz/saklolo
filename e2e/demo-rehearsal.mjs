// Rehearses the live demo exactly as presented and saves screenshots of each moment.
//   node e2e/demo-rehearsal.mjs [baseUrl] [outDir]
// Part 1 (online): SOS -> desk -> acknowledge -> simulated dispatch -> resolved.
// Part 2 (no data): typed request offline -> SMS text -> desk Log SMS -> back online, one report.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:3001';
const out = process.argv[3] || 'output/demo';
mkdirSync(out, { recursive: true });
const started = Date.now();
const log = [];
const step = (name, ok = true) => { const line = `${ok ? 'OK  ' : 'FAIL'} ${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s  ${name}`; log.push({ ok }); console.log(line); };
let shot = 0;
const snap = async (page, name) => page.screenshot({ path: `${out}/${String(++shot).padStart(2, '0')}-${name}.png` });

async function launch() {
  try { return await chromium.launch({ channel: 'chrome' }); }
  catch { return chromium.launch(); }
}
const browser = await launch();
const errors = [];
try {
  const resident = await browser.newContext({ geolocation: { latitude: 14.5600, longitude: 121.0290, accuracy: 14 }, permissions: ['geolocation'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const phone = await resident.newPage();
  const ops = await desk.newPage();
  for (const [label, page] of [['resident', phone], ['desk', ops]]) page.on('pageerror', error => errors.push(`${label}: ${error.message}`));

  await ops.goto(base + '/');
  await ops.evaluate(() => { history.pushState({}, '', '/operator'); dispatchEvent(new PopStateEvent('popstate')); });
  await ops.getByRole('heading', { name: 'Community response desk' }).waitFor({ timeout: 15000 });
  await ops.waitForTimeout(1500);
  await snap(ops, 'desk-ready');
  await phone.goto(base + '/');
  await phone.getByRole('button', { name: 'Send SOS' }).waitFor({ timeout: 15000 });
  await phone.waitForTimeout(800);
  await snap(phone, 'resident-home');
  step('setup: both screens ready');

  // ── Part 1: online ──
  await phone.getByRole('button', { name: 'Send SOS' }).click();
  await phone.getByText(/Request delivered/).first().waitFor({ timeout: 15000 });
  await snap(phone, 'resident-delivered');
  step('1. resident taps SOS -> "Request delivered"');

  const row = ops.locator('.ops-report').first();
  await ops.locator('.ops-toast').first().waitFor({ timeout: 10000 });
  await ops.waitForTimeout(500);
  await snap(ops, 'desk-new-report');
  await row.click();
  await ops.getByRole('heading', { name: 'Trust signals' }).waitFor({ timeout: 5000 });
  await ops.waitForTimeout(700);
  await snap(ops, 'desk-drawer');
  step('2. desk shows notice + pin, drawer opens with trust signals');

  await ops.getByRole('button', { name: 'Acknowledge report' }).click();
  await phone.getByText('Your request was reviewed').first().waitFor({ timeout: 10000 });
  await snap(phone, 'resident-reviewed');
  step('3. acknowledge -> resident "Your request was reviewed"');

  const drawer = ops.locator('.ops-drawer');
  await drawer.locator('.ops-dispatch-panel').scrollIntoViewIfNeeded();
  await snap(ops, 'desk-dispatch');
  await drawer.getByRole('button', { name: /Simulate call to/ }).click();
  await phone.getByText(/notified$/).first().waitFor({ timeout: 10000 });
  for (const action of ['Mark on the way', 'Mark on scene', 'Mark resolved']) {
    await drawer.getByRole('button', { name: action }).click();
    await drawer.getByRole('button', { name: action }).waitFor({ state: 'detached', timeout: 10000 });
  }
  await phone.getByText('Request resolved').first().waitFor({ timeout: 10000 });
  await snap(phone, 'resident-resolved');
  await snap(ops, 'desk-resolved');
  step('4. simulated dispatch -> on the way -> on scene -> resolved (resident follows)');

  // ── Part 2: no data, typed ──
  await ops.locator('.ops-drawer-close').click();
  await phone.getByRole('button', { name: 'Start a separate request' }).click();
  await phone.getByRole('button', { name: 'Send SOS' }).waitFor({ timeout: 5000 });
  await resident.setOffline(true);
  await phone.getByText('Offline. SOS still works.').waitFor({ timeout: 10000 });
  await snap(phone, 'resident-offline');
  step('5. resident goes offline -> clear offline banner');

  await phone.getByRole('button', { name: /Add details/ }).click();
  await phone.getByRole('button', { name: 'Flood', exact: true }).click();
  await phone.locator('#description').fill('Water up to the knees, family of four on the second floor.');
  await phone.locator('#landmark').fill('Beside San Roque Chapel');
  await snap(phone, 'resident-typed-form');
  await phone.getByRole('button', { name: 'Send request' }).click();
  await phone.getByText('No data signal?').waitFor({ timeout: 10000 });
  await phone.locator('.sms-fallback').scrollIntoViewIfNeeded();
  await snap(phone, 'resident-saved-sms');
  step('6. typed request -> "Saved on this phone" + SMS card');

  const href = await phone.locator('a.sms-send').getAttribute('href');
  const body = decodeURIComponent(href.split('body=')[1]);
  await ops.getByRole('button', { name: 'Log SMS' }).click();
  await ops.getByRole('textbox', { name: 'SMS text' }).fill(body);
  await ops.locator('.ops-sms-preview.is-ok').waitFor({ timeout: 5000 });
  await ops.waitForTimeout(400); // let the dialog finish fading in
  await snap(ops, 'desk-sms-dialog');
  await ops.getByRole('button', { name: 'Add to queue' }).click();
  const id = body.match(/id:([0-9a-f-]{36})/)[1];
  await ops.locator(`[data-report-id="${id}"]`).getByText('SMS').waitFor({ timeout: 10000 });
  await ops.getByRole('button', { name: 'Acknowledge report' }).click();
  await ops.locator('.ops-drawer').getByRole('button', { name: 'Acknowledged' }).waitFor({ timeout: 10000 });
  await snap(ops, 'desk-sms-report');
  step('7. desk Log SMS -> report in queue with SMS badge -> acknowledged');

  const before = (await (await fetch(`${base}/api/reports`)).json()).length;
  await resident.setOffline(false);
  await phone.getByText('Your request was reviewed').first().waitFor({ timeout: 20000 });
  await snap(phone, 'resident-back-online');
  const after = await (await fetch(`${base}/api/reports`)).json();
  step('8. back online -> resident "reviewed", still one report', after.length === before && after.filter(r => r.id === id).length === 1);

  step('no page errors', errors.length === 0);
} catch (error) {
  step(`stopped: ${error instanceof Error ? error.message.split('\n')[0] : error}`, false);
  if (errors.length) console.log('page errors:', errors.slice(0, 4).join(' | '));
} finally {
  await browser.close();
}
const failed = log.filter(entry => !entry.ok).length;
console.log(`\n${log.length - failed}/${log.length} steps OK · screenshots in ${out}`);
process.exit(failed ? 1 : 0);
