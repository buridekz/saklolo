// End-to-end check of offline continuity against a running server (default http://127.0.0.1:3001).
//   node e2e/offline-flow.mjs [baseUrl]
// Resident loses data -> SOS is kept on the phone -> report travels as SMS text -> desk logs it ->
// data returns -> phone delivers the same report without a duplicate. Synthetic data only.
import { chromium } from '@playwright/test';

const base = process.argv[2] || 'http://127.0.0.1:3001';
const results = [];
const pageErrors = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
const reports = async () => (await fetch(`${base}/api/reports`)).json();

async function launch() {
  try { return await chromium.launch({ channel: 'chrome' }); }
  catch { return chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}); }
}
const browser = await launch();
try {
  const resident = await browser.newContext({ geolocation: { latitude: 14.5639, longitude: 121.0366, accuracy: 25 }, permissions: ['geolocation'], viewport: { width: 390, height: 844 } });
  const operator = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const residentPage = await resident.newPage();
  const operatorPage = await operator.newPage();
  // Failed network requests are expected while offline; only uncaught exceptions count as errors.
  for (const [label, page] of [['resident', residentPage], ['operator', operatorPage]]) page.on('pageerror', error => pageErrors.push(`${label}: ${error.message}`));

  await operatorPage.goto(base + '/');
  await operatorPage.evaluate(() => { history.pushState({}, '', '/operator'); dispatchEvent(new PopStateEvent('popstate')); });
  await operatorPage.getByRole('heading', { name: 'Community response desk' }).waitFor({ timeout: 15000 });

  await residentPage.goto(base + '/');
  await residentPage.getByRole('button', { name: 'Send SOS' }).waitFor({ timeout: 15000 });
  await residentPage.waitForTimeout(800); // let the first GPS fix arrive
  await resident.setOffline(true);
  await residentPage.getByText('Offline. SOS still works.').waitFor({ timeout: 10000 });
  check('resident sees a clear offline message', true);

  const before = (await reports()).length;
  await residentPage.getByRole('button', { name: 'Send SOS' }).click();
  await residentPage.getByRole('heading', { name: 'Saved on this phone' }).waitFor({ timeout: 10000 });
  await residentPage.getByText('No data signal?').waitFor({ timeout: 5000 });
  check('SOS is kept on the phone and the SMS fallback is offered', true);
  check('nothing reached the server while offline', (await reports()).length === before);

  const href = await residentPage.locator('a.sms-send').getAttribute('href');
  const body = decodeURIComponent(href.split('body=')[1]);
  check('SMS link carries a Saklolo message with GPS', /^SAKLOLO SOS \w+ @14\.56\d+,121\.03\d+/.test(body) && /id:[0-9a-f-]{36}/.test(body));

  await operatorPage.getByRole('button', { name: 'Log SMS' }).click();
  await operatorPage.getByRole('textbox', { name: 'SMS text' }).fill(body);
  await operatorPage.locator('.ops-sms-preview.is-ok').waitFor({ timeout: 5000 });
  await operatorPage.getByRole('button', { name: 'Add to queue' }).click();
  const id = body.match(/id:([0-9a-f-]{36})/)[1];
  await operatorPage.locator(`[data-report-id="${id}"]`).getByText('SMS').waitFor({ timeout: 10000 });
  check('desk logs the SMS and shows it in the queue', true);

  await resident.setOffline(false);
  await residentPage.getByText(/Request delivered|Your request was reviewed/).first().waitFor({ timeout: 20000 });
  const after = await reports();
  const matching = after.filter(report => report.id === id);
  check('phone delivers once data returns, without a duplicate', after.length === before + 1 && matching.length === 1 && matching[0].source === 'sms', `${after.length - before} new`);

  check('no page errors on either side', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (error) {
  check('flow completed', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  if (pageErrors.length) console.log('page errors:', pageErrors.slice(0, 5).join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter(result => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
