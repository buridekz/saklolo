// Checks the typed call-taker after SOS: what happened -> how many people -> nearest landmark.
//   node e2e/sos-typed.mjs [baseUrl] [screenshotDir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:3001';
const out = process.argv[3];
if (out) mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
let browser;
try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }
const errors = [];
try {
  const context = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 14.5652, longitude: 121.0307, accuracy: 20 }, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const snap = async name => { if (out) { await page.waitForTimeout(450); await page.screenshot({ path: `${out}/${name}.png` }); } };
  await page.goto(base + '/');
  await page.getByText('Demo desk reachable').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Send SOS' }).click();
  await page.getByRole('heading', { name: 'What happened?' }).waitFor({ timeout: 10000 });
  check('SOS opens the typed questions (no voice by default)', await page.getByRole('heading', { name: 'Saklolo voice companion' }).count() === 0);
  check('location is already attached', await page.getByText('Location attached').isVisible());
  await snap('q1-what-happened');

  await page.locator('.quick-intake-types').getByRole('button', { name: 'Flood' }).click();
  await page.getByRole('textbox', { name: /Describe what happened/ }).fill('Water rising fast');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('heading', { name: 'How many people need help?' }).waitFor({ timeout: 5000 });
  await snap('q2-how-many');
  await page.getByRole('button', { name: '3–5' }).click();
  await page.getByRole('heading', { name: 'Nearest landmark?' }).waitFor({ timeout: 5000 });
  await page.getByRole('textbox', { name: 'Nearest landmark' }).fill('Beside San Roque Chapel');
  await snap('q3-landmark');
  await page.getByRole('button', { name: 'Send details' }).click();
  await page.getByText('Thanks. The desk has your answers and your location.').waitFor({ timeout: 10000 });
  await snap('done');
  check('all three answers sent', true);

  let report;
  for (let attempt = 0; attempt < 20 && !(report?.landmark); attempt++) {
    await page.waitForTimeout(500);
    report = (await (await fetch(`${base}/api/reports`)).json())[0];
  }
  check('desk report has the type, people count and landmark', report?.category === 'Flood' && /People needing help: 3–5/.test(report.description) && report.landmark === 'Beside San Roque Chapel', report ? `${report.category} · ${report.description} · ${report.landmark}` : 'no report');
  check('desk report has GPS', Boolean(report?.location));
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('flow completed', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
} finally {
  await browser.close();
}
const failed = results.filter(ok => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
