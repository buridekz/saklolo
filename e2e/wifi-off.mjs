// Reproduces "Wi-Fi off on the demo laptop": the browser reports no network, but the server on the
// same laptop is still reachable. Reports must wait on the phone, then deliver once on reconnect.
//   node e2e/wifi-off.mjs [baseUrl]
import { chromium } from '@playwright/test';

const base = process.argv[2] || 'http://127.0.0.1:3001';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
const reports = async () => (await fetch(`${base}/api/reports`)).json();
let browser;
try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }
const errors = [];
try {
  const context = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 14.56, longitude: 121.03, accuracy: 20 }, viewport: { width: 390, height: 844 } });
  // navigator.onLine follows window.__wifiOff, like a laptop whose Wi-Fi was switched off.
  await context.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => !window.__wifiOff }); });
  const desk = await context.newPage();
  const phone = await context.newPage();
  for (const page of [desk, phone]) page.on('pageerror', error => errors.push(error.message));
  const setWifi = async on => { for (const page of [desk, phone]) await page.evaluate(value => { window.__wifiOff = !value; dispatchEvent(new Event(value ? 'online' : 'offline')); }, on); };

  await desk.goto(base + '/');
  await desk.evaluate(() => { history.pushState({}, '', '/operator'); dispatchEvent(new PopStateEvent('popstate')); });
  await desk.getByRole('heading', { name: 'Community response desk' }).waitFor({ timeout: 15000 });
  await phone.goto(base + '/');
  await phone.getByText('Demo desk reachable').waitFor({ timeout: 15000 });
  await phone.waitForTimeout(800);

  await setWifi(false);
  await phone.getByText('Offline. SOS still works.').waitFor({ timeout: 5000 });
  const before = (await reports()).length;
  await phone.getByRole('button', { name: 'Send SOS' }).click();
  await phone.getByRole('heading', { name: 'Saved on this phone' }).waitFor({ timeout: 10000 });
  check('Wi-Fi off: SOS shows "Saved on this phone", not "delivered"', true);
  await phone.waitForTimeout(7000);
  check('nothing is delivered while offline, even with the desk tab open', (await reports()).length === before);

  await setWifi(true);
  await phone.getByRole('heading', { name: 'Request delivered' }).waitFor({ timeout: 15000 });
  check('Wi-Fi back: delivered once', (await reports()).length === before + 1);
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('flow completed', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
} finally {
  await browser.close();
}
const failed = results.filter(ok => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
