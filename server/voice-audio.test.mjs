import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceAudio } from '../src/voice-audio.ts';

test('muted microphone sends only silence for VAD, unmute restores input, and close stops forwarding', async () => {
  const previousContext = globalThis.AudioContext;
  const previousWorklet = globalThis.AudioWorkletNode;
  let capture;
  let contextsClosed = 0;
  globalThis.AudioContext = class {
    audioWorklet = { addModule: async () => {} };
    destination = {};
    currentTime = 0;
    resume = async () => {};
    createMediaStreamSource = () => ({ connect() {}, disconnect() {} });
    close = async () => { contextsClosed++; };
  };
  globalThis.AudioWorkletNode = class {
    port = { onmessage: null, close() {} };
    constructor() { capture = this; }
    connect() {}
    disconnect() {}
  };
  try {
    const chunks = [];
    const audio = createVoiceAudio(() => {});
    await audio.attach({}, buffer => chunks.push([...new Int16Array(buffer)]));
    const emit = () => capture.port.onmessage?.({ data: new Int16Array([1200, -3200, 81]).buffer });
    emit();
    audio.mute(true); emit(); emit();
    audio.mute(false); emit();
    assert.deepEqual(chunks, [[1200, -3200, 81], [0, 0, 0], [0, 0, 0], [1200, -3200, 81]]);
    audio.close(); audio.close(); emit();
    assert.equal(chunks.length, 4);
    assert.equal(contextsClosed, 1);
  } finally {
    if (previousContext === undefined) delete globalThis.AudioContext; else globalThis.AudioContext = previousContext;
    if (previousWorklet === undefined) delete globalThis.AudioWorkletNode; else globalThis.AudioWorkletNode = previousWorklet;
  }
});
