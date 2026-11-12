// Produces a narrated demo video of Saklolo with no human recording.
//   node e2e/demo-video.mjs <baseUrl> <outDir> <envFile>
// 1. Narration: OpenAI text-to-speech per scene (cached by text, so re-runs are free).
// 2. Recording: Playwright drives the resident phone and the LGU desk; each scene lasts as long as its line.
// 3. Editing: ffmpeg puts desk + phone side by side, adds captions and the voice, exports MP4.
// Uses synthetic TEST data only. Dispatch shown is simulated.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const [base = 'http://127.0.0.1:3003', outArg = 'output/video', envFile = '.env'] = process.argv.slice(2);
const out = path.resolve(outArg);
const voiceDir = path.join(out, 'voice');
const rawDir = path.join(out, 'raw');
mkdirSync(voiceDir, { recursive: true });
rmSync(rawDir, { recursive: true, force: true });
mkdirSync(rawDir, { recursive: true });
dotenv.config({ path: envFile, quiet: true });
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error('OPENAI_API_KEY is not set in the env file.');

const SCENES = [
  { id: 'intro', caption: 'Saklolo · resident phone + barangay response desk', say: 'This is Saklolo, a nine-one-one style emergency front door for barangays. On the right is a resident\'s phone. On the left, the barangay response desk.' },
  { id: 'sos', caption: 'One tap SOS · GPS attached automatically', say: 'In an emergency, one tap sends an S O S with the phone\'s G P S location, straight to the barangay.' },
  { id: 'questions', caption: 'Three questions: what happened · how many · nearest landmark', say: 'Then three quick questions, like a call-taker would ask: what happened, how many people need help, and the nearest landmark.' },
  { id: 'desk', caption: 'Live on the desk map · trust signals help prioritise', say: 'At the desk, the report appears instantly on the map. Trust signals, like live G P S and nearby reports, help the operator decide who goes first. No S O S is ever blocked.' },
  { id: 'ack', caption: 'A human acknowledges · resident sees it instantly', say: 'The operator acknowledges, and the resident sees it right away.' },
  { id: 'dispatch', caption: 'Hand-off to the right agency (simulated) → resolved', say: 'The report is handed to the right agency, here disaster response for a flood, and the resident follows every step until it\'s resolved. Dispatch is simulated in this prototype.' },
  { id: 'offline', caption: 'No signal · the phone goes offline', say: 'Now the hard case. The phone loses its signal.' },
  { id: 'saved', caption: 'Still works · saved on the phone, nothing lost', say: 'The S O S still works. It\'s saved on the phone, so nothing is lost, and the barangay can\'t see it yet.' },
  { id: 'sms', caption: 'SMS fallback · the barangay logs the text → pin on the map', say: 'With no data, the report can travel as a plain text message. The barangay logs it, and it lands on the map with the location.' },
  { id: 'back', caption: 'Signal returns · same report syncs, no duplicate', say: 'When the signal returns, the phone syncs the same report automatically. No duplicates, and the resident sees it was already reviewed.' },
  { id: 'outro', caption: 'Saklolo · help that doesn\'t disappear when the signal does', say: 'Saklolo. One tap, a call-taker, and a barangay desk that sees every request live. Help that doesn\'t disappear when the signal does.' },
];

const seconds = file => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());

async function speak(text) {
  const file = path.join(voiceDir, `${createHash('sha1').update(text).digest('hex').slice(0, 12)}.mp3`);
  if (existsSync(file)) return file;
  const attempts = [
    { model: 'gpt-4o-mini-tts', voice: 'coral', instructions: 'Warm, calm, clear product-demo narrator. Natural pace, confident, friendly.' },
    { model: 'tts-1-hd', voice: 'nova' },
  ];
  for (const attempt of attempts) {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...attempt, input: text, response_format: 'mp3' }),
    });
    if (response.ok) { writeFileSync(file, Buffer.from(await response.arrayBuffer())); return file; }
    console.log(`  tts ${attempt.model} unavailable (${response.status}), trying next`);
  }
  throw new Error('Text-to-speech failed for every model.');
}

console.log('1/3 narration');
for (const scene of SCENES) { scene.audio = await speak(scene.say); scene.duration = seconds(scene.audio); }
console.log(`  ${SCENES.length} lines, ${SCENES.reduce((sum, s) => sum + s.duration, 0).toFixed(1)} s of speech`);

// Shows where clicks land, since headless recordings have no cursor.
const ripple = () => {
  addEventListener('pointerdown', event => {
    const dot = document.createElement('div');
    dot.style.cssText = `position:fixed;left:${event.clientX - 22}px;top:${event.clientY - 22}px;width:44px;height:44px;border-radius:50%;background:rgba(36,62,54,.28);border:2px solid rgba(36,62,54,.75);pointer-events:none;z-index:2147483647;transition:transform .5s ease-out,opacity .5s ease-out`;
    document.documentElement.append(dot);
    requestAnimationFrame(() => { dot.style.transform = 'scale(1.6)'; dot.style.opacity = '0'; });
    setTimeout(() => dot.remove(), 600);
  }, true);
};

console.log('2/3 recording');
let browser;
try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }
const deskSize = { width: 1440, height: 810 };
const phoneSize = { width: 390, height: 844 };
const deskContext = await browser.newContext({ viewport: deskSize, recordVideo: { dir: rawDir, size: deskSize } });
const phoneContext = await browser.newContext({ viewport: phoneSize, recordVideo: { dir: rawDir, size: phoneSize }, permissions: ['geolocation'], geolocation: { latitude: 14.5600, longitude: 121.0290, accuracy: 14 } });
await deskContext.addInitScript(ripple);
await phoneContext.addInitScript(ripple);
const desk = await deskContext.newPage(); const deskStart = Date.now();
const phone = await phoneContext.newPage(); const phoneStart = Date.now();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

await desk.goto(base + '/');
await desk.evaluate(() => { history.pushState({}, '', '/operator'); dispatchEvent(new PopStateEvent('popstate')); });
await desk.getByRole('heading', { name: 'Community response desk' }).waitFor({ timeout: 20000 });
await phone.goto(base + '/');
await phone.getByText('Demo desk reachable').waitFor({ timeout: 20000 });
await pause(2500); // tiles and first GPS fix settle before the story starts

const timeline = Date.now();
const at = () => (Date.now() - timeline) / 1000;
let smsBodyText = '';
let smsId = '';
const actions = {
  intro: async () => {},
  sos: async () => { await phone.getByRole('button', { name: 'Send SOS' }).click(); await phone.getByRole('heading', { name: 'What happened?' }).waitFor({ timeout: 10000 }); },
  questions: async () => {
    await phone.locator('.quick-intake-types').getByRole('button', { name: 'Flood' }).click(); await pause(500);
    await phone.getByRole('textbox', { name: /Describe what happened/ }).pressSequentially('Water entering the house', { delay: 45 }); await pause(300);
    await phone.getByRole('button', { name: 'Next' }).click(); await pause(900);
    await phone.getByRole('button', { name: '3–5' }).click(); await pause(700);
    await phone.getByRole('textbox', { name: 'Nearest landmark' }).pressSequentially('Beside San Roque Chapel', { delay: 45 }); await pause(300);
    await phone.getByRole('button', { name: 'Send details' }).click();
  },
  desk: async () => { await pause(600); await desk.locator('.ops-report').first().click(); await desk.getByRole('heading', { name: 'Trust signals' }).waitFor({ timeout: 8000 }); await pause(1200); await desk.locator('.ops-drawer .ops-detail-scroll').evaluate(node => node.scrollBy({ top: 420, behavior: 'smooth' })); },
  ack: async () => { await desk.getByRole('button', { name: 'Acknowledge report' }).click(); await phone.getByText('Your request was reviewed').first().waitFor({ timeout: 10000 }); },
  dispatch: async () => {
    const drawer = desk.locator('.ops-drawer');
    await drawer.locator('.ops-dispatch-panel').scrollIntoViewIfNeeded();
    await drawer.getByRole('button', { name: /Simulate call to/ }).click(); await pause(1600);
    for (const action of ['Mark on the way', 'Mark on scene', 'Mark resolved']) { await drawer.getByRole('button', { name: action }).click(); await pause(1500); }
    await phone.getByText('Request resolved').first().waitFor({ timeout: 10000 });
  },
  offline: async () => {
    await desk.locator('.ops-drawer-close').click();
    await phone.getByRole('button', { name: 'Start a separate request' }).click(); await pause(800);
    await phone.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' })); await pause(500);
    await phone.getByRole('button', { name: /Signal/ }).click();
    await phone.getByText('Offline. SOS still works.').waitFor({ timeout: 5000 });
  },
  saved: async () => {
    await phone.getByRole('button', { name: 'Send SOS' }).click();
    await phone.getByRole('heading', { name: 'What happened?' }).waitFor({ timeout: 10000 });
    await phone.locator('.quick-intake-types').getByRole('button', { name: 'Fire' }).click(); await pause(400);
    await phone.getByRole('button', { name: 'Next' }).click(); await pause(600);
    await phone.getByRole('button', { name: '1', exact: true }).click(); await pause(500);
    await phone.getByRole('textbox', { name: 'Nearest landmark' }).pressSequentially('Behind the barangay hall', { delay: 40 });
    await phone.getByRole('button', { name: 'Send details' }).click();
    await phone.getByText('No data signal?').waitFor({ timeout: 10000 });
    await phone.locator('.sms-fallback').scrollIntoViewIfNeeded();
  },
  sms: async () => {
    const href = await phone.locator('a.sms-send').getAttribute('href');
    smsBodyText = decodeURIComponent(href.split('body=')[1]);
    smsId = smsBodyText.match(/id:([0-9a-f-]{36})/)[1];
    await phone.getByRole('button', { name: 'Copy text' }).click(); await pause(900);
    await desk.getByRole('button', { name: 'Log SMS' }).click(); await pause(500);
    await desk.getByRole('textbox', { name: 'SMS text' }).fill(smsBodyText); await pause(1600);
    await desk.getByRole('button', { name: 'Add to queue' }).click();
    await desk.locator(`[data-report-id="${smsId}"]`).waitFor({ timeout: 10000 }); await pause(800);
    await desk.getByRole('button', { name: 'Acknowledge report' }).click();
  },
  back: async () => {
    await phone.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' })); await pause(500);
    await phone.getByRole('button', { name: /No signal/ }).click();
    await phone.getByText('Your request was reviewed').first().waitFor({ timeout: 15000 });
  },
  outro: async () => { await desk.locator('.ops-drawer-close').click().catch(() => {}); },
};

for (const scene of SCENES) {
  scene.start = at();
  await actions[scene.id]();
  const minimum = scene.duration + 0.6;
  const spent = at() - scene.start;
  if (spent < minimum) await pause((minimum - spent) * 1000);
  scene.end = at();
  console.log(`  ${scene.id.padEnd(9)} ${scene.start.toFixed(1).padStart(5)}s → ${scene.end.toFixed(1)}s`);
}
await pause(1500);
const total = at();
const deskVideo = await desk.video().path();
const phoneVideo = await phone.video().path();
await deskContext.close(); await phoneContext.close(); await browser.close();
const deskOffset = (timeline - deskStart) / 1000;
const phoneOffset = (timeline - phoneStart) / 1000;

console.log('3/3 editing');
copyFileSync('C:/Windows/Fonts/segoeuib.ttf', path.join(out, 'bold.ttf'));
copyFileSync('C:/Windows/Fonts/segoeui.ttf', path.join(out, 'regular.ttf'));
writeFileSync(path.join(out, 'title.txt'), 'Saklolo  ·  911-style emergency front door for barangays');
writeFileSync(path.join(out, 'note.txt'), 'Prototype demo  ·  synthetic TEST data  ·  agency dispatch is simulated');
SCENES.forEach((scene, index) => writeFileSync(path.join(out, `cap${index}.txt`), scene.caption));
const captions = SCENES.map((scene, index) => `drawtext=fontfile=bold.ttf:textfile=cap${index}.txt:fontcolor=white:fontsize=34:x=40:y=968:enable='between(t,${scene.start.toFixed(2)},${scene.end.toFixed(2)})'`).join(',');
const audioInputs = SCENES.flatMap(scene => ['-i', scene.audio]);
const delays = SCENES.map((scene, index) => `[${index + 2}:a]adelay=${Math.round(scene.start * 1000)}:all=1[a${index}]`).join(';');
const mix = `${SCENES.map((_, index) => `[a${index}]`).join('')}amix=inputs=${SCENES.length}:normalize=0[aout]`;
const filter = [
  `color=c=0x1f3530:s=1920x1080:r=30:d=${total.toFixed(2)}[bg]`,
  `[0:v]trim=start=${deskOffset.toFixed(3)},setpts=PTS-STARTPTS,scale=1400:788[d]`,
  `[1:v]trim=start=${phoneOffset.toFixed(3)},setpts=PTS-STARTPTS,scale=-2:868[p]`,
  `[bg][d]overlay=40:150:shortest=0[t1]`,
  `[t1][p]overlay=1476:150:shortest=0,drawtext=fontfile=bold.ttf:textfile=title.txt:fontcolor=white:fontsize=40:x=40:y=52,drawtext=fontfile=regular.ttf:textfile=note.txt:fontcolor=0xb9d2c1:fontsize=24:x=40:y=104,${captions}[vout]`,
  delays,
  mix,
].join(';');
const output = path.join(out, 'saklolo-demo.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', deskVideo, '-i', phoneVideo, ...audioInputs, '-filter_complex', filter, '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(2), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output], { cwd: out, stdio: 'inherit' });
console.log(`done: ${output} (${seconds(output).toFixed(1)} s)`);
