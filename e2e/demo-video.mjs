// Produces a narrated demo video of Saklolo with no human recording.
//   node e2e/demo-video.mjs <baseUrl> <outDir> <envFile>
// 1. Narration + resident lines: OpenAI text-to-speech (cached by text, so re-runs are free).
// 2. Recording: Playwright drives the resident phone and the LGU desk. The online part uses the LIVE
//    voice call-taker (OpenAI gpt-realtime): the resident's lines are fed in as a fake microphone and the
//    AI's real spoken replies are captured from the page. The offline part is typed.
// 3. Editing: ffmpeg puts desk + phone side by side, adds captions and mixes narrator, resident and AI.
// Uses synthetic TEST data only. Dispatch shown is simulated. The live voice session costs a little.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  { id: 'voice', caption: 'With internet: talk instead of typing', say: 'With internet, she doesn\'t even need to type. She taps Talk instead, and an A I call-taker picks up instantly.' },
  { id: 'call', caption: 'Live AI call-taker (OpenAI gpt-realtime) · resident speaking', say: null },
  { id: 'deskVoice', caption: 'Live on the desk map · filled in from her voice', say: 'At the desk, the report is already on the map, filled in from what she said: what happened, how many people, and where. Trust signals help the operator decide who goes first.' },
  { id: 'ack', caption: 'A human acknowledges · resident sees it instantly', say: 'The operator acknowledges, and the resident sees it right away.' },
  { id: 'dispatch', caption: 'Hand-off to the right agency (simulated) → resolved', say: 'The report is handed to the right agency, here disaster response for a flood, and the resident follows every step until it\'s resolved. Dispatch is simulated in this prototype.' },
  { id: 'offline', caption: 'No signal · the phone goes offline', say: 'Now the hard case. The phone loses its signal. Voice needs internet, so this time he taps.' },
  { id: 'saved', caption: 'Still works · saved on the phone, nothing lost', say: 'The S O S still works. It\'s saved on the phone, so nothing is lost, and the barangay can\'t see it yet.' },
  { id: 'sms', caption: 'SMS fallback · the barangay logs the text → pin on the map', say: 'With no data, the report can travel as a plain text message. The barangay logs it, and it lands on the map with the location.' },
  { id: 'back', caption: 'Signal returns · same report syncs, no duplicate', say: 'When the signal returns, the phone syncs the same report automatically. No duplicates, and the resident sees it was already reviewed.' },
  { id: 'outro', caption: 'Saklolo · help that doesn\'t disappear when the signal does', say: 'Saklolo. One tap, a call-taker, and a barangay desk that sees every request live. Help that doesn\'t disappear when the signal does.' },
];
// The resident's side of the live call. Each line is spoken into a virtual microphone only after the AI has
// finished talking (real turn-taking), so nobody talks over anybody.
const RESIDENT_LINES = [
  'Hello, there\'s a flood at our house. The water is coming in fast.',
  'Three of us. Me, my son, and my lola.',
  'Beside San Roque Chapel, in Barangay San Roque.',
];

const seconds = file => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());

async function speak(text, { voice = 'coral', instructions = 'Warm, calm, clear product-demo narrator. Natural pace, confident, friendly.', format = 'mp3' } = {}) {
  const file = path.join(voiceDir, `${createHash('sha1').update(`${voice}|${instructions}|${text}`).digest('hex').slice(0, 12)}.${format}`);
  if (existsSync(file)) return file;
  const attempts = [{ model: 'gpt-4o-mini-tts', voice, instructions }, { model: 'tts-1-hd', voice: voice === 'coral' ? 'nova' : 'shimmer' }];
  for (const attempt of attempts) {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...attempt, input: text, response_format: format }),
    });
    if (response.ok) { writeFileSync(file, Buffer.from(await response.arrayBuffer())); return file; }
    console.log(`  tts ${attempt.model} unavailable (${response.status}), trying next`);
  }
  throw new Error('Text-to-speech failed for every model.');
}

console.log('1/3 voices');
for (const scene of SCENES) if (scene.say) { scene.audio = await speak(scene.say); scene.duration = seconds(scene.audio); }
const residentClips = [];
for (const line of RESIDENT_LINES) {
  const file = await speak(line, { voice: 'sage', instructions: 'A worried but clear Filipino mother calling for help during a flood. Slightly urgent, speaking English with a light Filipino accent.', format: 'wav' });
  residentClips.push({ file, duration: seconds(file) });
}
const residentData = residentClips.map(clip => readFileSync(clip.file).toString('base64'));
console.log(`  narration ${SCENES.filter(s => s.say).length} lines · resident ${residentClips.length} lines`);

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
// In the phone page: records the AI's spoken replies (its Web Audio playback), gives the app a virtual
// microphone, and speaks the resident's next line only after the AI has finished talking.
const tapVoice = clips => {
  // Each AI audio chunk is captured with the wall-clock time it actually plays, so the soundtrack can be
  // rebuilt sample-accurately (a stream recorder drops the silences between sentences).
  const ai = window.__ai = { pieces: [], active: 0, lastEnd: 0, spoke: 0 };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    const result = connect.call(this, target, ...rest);
    try {
      if (this instanceof AudioBufferSourceNode && target instanceof AudioDestinationNode && !this.__ai) {
        this.__ai = true;
        ai.active += 1; ai.spoke = Date.now();
        this.addEventListener('ended', () => { ai.active -= 1; ai.lastEnd = Date.now(); });
      }
    } catch { /* Best-effort; playback is unaffected. */ }
    return result;
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
    try {
      if (this.__ai && this.buffer) {
        const context = this.context;
        const delay = Math.max(0, when - context.currentTime);
        ai.pieces.push({ at: Date.now() + delay * 1000, rate: this.buffer.sampleRate, samples: Array.from(this.buffer.getChannelData(0)) });
      }
    } catch { /* Best-effort. */ }
    return start.call(this, when, ...rest);
  };
  const resident = window.__resident = { times: [], done: false };
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext({ sampleRate: 48000 });
    const microphone = context.createMediaStreamDestination();
    const buffers = await Promise.all(clips.map(data => context.decodeAudioData(Uint8Array.from(atob(data), c => c.charCodeAt(0)).buffer)));
    let next = 0;
    let speaking = false;
    let waitingSince = Date.now();
    const timer = setInterval(() => {
      if (speaking || next >= buffers.length) return;
      const aiQuiet = ai.active <= 0 && ai.lastEnd > 0 && Date.now() - ai.lastEnd > 1500;
      const aiAnswered = ai.spoke > (resident.times[next - 1] || 0);
      const tooLong = Date.now() - waitingSince > 14000; // never stall the video if the AI stays silent
      if (!((aiQuiet && aiAnswered) || tooLong)) return;
      speaking = true;
      const source = context.createBufferSource();
      source.buffer = buffers[next];
      source.connect(microphone);
      resident.times.push(Date.now());
      source.addEventListener('ended', () => {
        speaking = false; next += 1; waitingSince = Date.now();
        if (next >= buffers.length) { clearInterval(timer); setTimeout(() => { resident.done = true; }, 9000); }
      });
      source.start();
    }, 250);
    return microphone.stream;
  };
};

console.log('2/3 recording');
const args = ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
let browser;
try { browser = await chromium.launch({ channel: 'chrome', args }); } catch { browser = await chromium.launch({ args }); }
const deskSize = { width: 1440, height: 810 };
const phoneSize = { width: 390, height: 844 };
const deskContext = await browser.newContext({ viewport: deskSize, recordVideo: { dir: rawDir, size: deskSize } });
const phoneContext = await browser.newContext({ viewport: phoneSize, recordVideo: { dir: rawDir, size: phoneSize }, permissions: ['geolocation', 'microphone'], geolocation: { latitude: 14.5600, longitude: 121.0290, accuracy: 14 } });
await deskContext.addInitScript(ripple);
await phoneContext.addInitScript(ripple);
await phoneContext.addInitScript(tapVoice, residentData);
const desk = await deskContext.newPage(); const deskStart = Date.now();
const phone = await phoneContext.newPage(); const phoneStart = Date.now();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const latest = async () => (await (await fetch(`${base}/api/reports`)).json()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

await desk.goto(base + '/');
await desk.evaluate(() => { history.pushState({}, '', '/operator'); dispatchEvent(new PopStateEvent('popstate')); });
await desk.getByRole('heading', { name: 'Community response desk' }).waitFor({ timeout: 20000 });
await phone.goto(base + '/');
await phone.getByText('Demo desk reachable').waitFor({ timeout: 20000 });
await pause(2500); // tiles and first GPS fix settle before the story starts

const timeline = Date.now();
const at = () => (Date.now() - timeline) / 1000;
let aiAudio = null;
let residentTimes = [];
const actions = {
  intro: async () => {},
  sos: async () => { await phone.getByRole('button', { name: 'Send SOS' }).click(); await phone.getByRole('heading', { name: 'What happened?' }).waitFor({ timeout: 10000 }); },
  voice: async scene => {
    await pause(scene.duration * 1000 + 300); // let the narrator finish before the call starts
    await phone.getByRole('button', { name: 'Talk instead' }).click();
    await phone.getByRole('heading', { name: 'Saklolo voice companion' }).waitFor({ timeout: 15000 });
    // Spoken status updates make the AI announce delivery mid-sentence; a cleaner call for the video.
    const updates = phone.getByRole('button', { name: /Spoken status updates on/ });
    if (await updates.count()) await updates.click();
  },
  call: async () => {
    // The page speaks each resident line after the AI finishes; wait for the last reply to settle.
    await phone.waitForFunction(() => window.__resident?.done, null, { timeout: 120000, polling: 500 });
    residentTimes = await phone.evaluate(() => window.__resident.times);
    const report = await latest();
    console.log(`  AI filled the report: ${report.category} · "${report.description}" · ${report.landmark || 'no landmark'}`);
  },
  deskVoice: async () => {
    await phone.getByRole('button', { name: /End voice/ }).first().click();
    await pause(800);
    aiAudio = await phone.evaluate(() => {
      const pieces = window.__ai?.pieces || [];
      if (!pieces.length) return null;
      const rate = pieces[0].rate;
      const start = Math.min(...pieces.map(piece => piece.at));
      const length = Math.max(...pieces.map(piece => Math.round((piece.at - start) / 1000 * rate) + piece.samples.length));
      const mix = new Float32Array(length);
      for (const piece of pieces) {
        const offset = Math.round((piece.at - start) / 1000 * rate);
        piece.samples.forEach((sample, i) => { mix[offset + i] += sample; });
      }
      const pcm = new Int16Array(length);
      mix.forEach((sample, i) => { pcm[i] = Math.max(-1, Math.min(1, sample)) * 0x7fff; });
      const bytes = new Uint8Array(pcm.buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { start, rate, data: btoa(binary), pieces: pieces.length };
    });
    await desk.locator('.ops-report').first().click();
    await desk.getByRole('heading', { name: 'Trust signals' }).waitFor({ timeout: 8000 });
    await pause(1500);
    await desk.locator('.ops-drawer .ops-detail-scroll').evaluate(node => node.scrollBy({ top: 420, behavior: 'smooth' }));
  },
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
    const body = decodeURIComponent(href.split('body=')[1]);
    const id = body.match(/id:([0-9a-f-]{36})/)[1];
    await phone.getByRole('button', { name: 'Copy text' }).click(); await pause(900);
    await desk.getByRole('button', { name: 'Log SMS' }).click(); await pause(500);
    await desk.getByRole('textbox', { name: 'SMS text' }).fill(body); await pause(1600);
    await desk.getByRole('button', { name: 'Add to queue' }).click();
    await desk.locator(`[data-report-id="${id}"]`).waitFor({ timeout: 10000 }); await pause(800);
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
  await actions[scene.id](scene);
  const minimum = (scene.duration || 0) + 0.6;
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
const tracks = SCENES.filter(scene => scene.say).map(scene => ({ file: scene.audio, at: scene.start, volume: 1 }));
// Resident lines at the exact moments the page spoke them into the virtual microphone.
residentTimes.forEach((time, index) => tracks.push({ file: residentClips[index].file, at: (time - timeline) / 1000, volume: 1.6 }));
if (aiAudio) {
  const aiFile = path.join(out, 'ai-replies.wav');
  const pcm = Buffer.from(aiAudio.data, 'base64');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(aiAudio.rate, 24);
  header.writeUInt32LE(aiAudio.rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  writeFileSync(aiFile, Buffer.concat([header, pcm]));
  tracks.push({ file: aiFile, at: (aiAudio.start - timeline) / 1000, volume: 1.0 });
  console.log(`  AI voice captured: ${seconds(aiFile).toFixed(1)} s from ${aiAudio.pieces} chunks`);
} else console.log('  warning: no AI voice audio was captured');
copyFileSync('C:/Windows/Fonts/segoeuib.ttf', path.join(out, 'bold.ttf'));
copyFileSync('C:/Windows/Fonts/segoeui.ttf', path.join(out, 'regular.ttf'));
writeFileSync(path.join(out, 'title.txt'), 'Saklolo  ·  911-style emergency front door for barangays');
writeFileSync(path.join(out, 'note.txt'), 'Prototype demo  ·  synthetic TEST data  ·  agency dispatch is simulated');
SCENES.forEach((scene, index) => writeFileSync(path.join(out, `cap${index}.txt`), scene.caption));
const captions = SCENES.map((scene, index) => `drawtext=fontfile=bold.ttf:textfile=cap${index}.txt:fontcolor=white:fontsize=34:x=40:y=968:enable='between(t,${scene.start.toFixed(2)},${scene.end.toFixed(2)})'`).join(',');
const audioInputs = tracks.flatMap(track => ['-i', track.file]);
const delays = tracks.map((track, index) => `[${index + 2}:a]aresample=48000,volume=${track.volume},adelay=${Math.max(0, Math.round(track.at * 1000))}:all=1[a${index}]`).join(';');
const mix = `${tracks.map((_, index) => `[a${index}]`).join('')}amix=inputs=${tracks.length}:normalize=0[aout]`;
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
