// Checks that tapping SOS while online starts the voice call-taker automatically.
//   node e2e/sos-voice.mjs [baseUrl]
// Uses Chrome's fake microphone, starts ONE real OpenAI Realtime session (small cost), then ends it.
import { chromium } from '@playwright/test';

const base = process.argv[2] || 'http://127.0.0.1:3001';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
let browser;
try { browser = await chromium.launch({ channel: 'chrome', args }); } catch { browser = await chromium.launch({ args }); }
const errors = [];
try {
  const context = await browser.newContext({ permissions: ['geolocation', 'microphone'], geolocation: { latitude: 14.56, longitude: 121.03, accuracy: 15 }, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/');
  await page.getByText('Demo desk reachable').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Send SOS' }).click();
  await page.getByRole('heading', { name: 'Saklolo voice companion' }).waitFor({ timeout: 15000 });
  check('SOS opens the voice companion automatically', true);
  await page.getByText('Live', { exact: true }).first().waitFor({ timeout: 25000 });
  check('voice session connects', true);
  const greeting = page.locator('.voice-transcript').getByText(/Saklolo here/i).first();
  await greeting.waitFor({ timeout: 25000 });
  check('assistant greets like a call-taker', true, (await greeting.innerText()).slice(0, 90));
  const reports = await (await fetch(`${base}/api/reports`)).json();
  check('the SOS itself was already delivered', reports.length >= 1 && reports[0].source === 'sos');
  await page.getByRole('button', { name: /End voice/ }).first().click();
  await page.getByRole('heading', { name: 'Saklolo voice companion' }).waitFor({ state: 'detached', timeout: 10000 });
  check('voice session ends cleanly', true);
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('flow completed', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
} finally {
  await browser.close();
}
const failed = results.filter(ok => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
