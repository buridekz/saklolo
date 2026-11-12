/** Browser-owned microphone capture and playback for the TLS WebSocket transport. */
export function createVoiceAudio(onPlayback: (playing: boolean) => void) {
  // Construct/resume synchronously before the caller's first await to retain user activation.
  const context = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
  if (!context.audioWorklet) { void context.close(); throw new Error('This browser does not support live audio capture.'); }
  let closed = false;
  let muted = false;
  let source: MediaStreamAudioSourceNode | undefined;
  let capture: AudioWorkletNode | undefined;
  let nextPlayback = 0;
  const sources = new Set<AudioBufferSourceNode>();
  const ready = Promise.all([context.resume(), context.audioWorklet.addModule('/pcm-capture.js')]);
  // The caller awaits ready after acquiring microphone permission.
  void ready.catch(() => {});

  const clearPlayback = () => {
    for (const node of sources) { node.onended = null; try { node.stop(); } catch { /* Already stopped. */ } node.disconnect(); }
    sources.clear(); nextPlayback = context.currentTime;
    if (!closed) onPlayback(false);
  };
  return {
    async attach(stream: MediaStream, onChunk: (buffer: ArrayBuffer) => void) {
      await ready;
      if (closed) return;
      source = context.createMediaStreamSource(stream);
      capture = new AudioWorkletNode(context, 'saklolo-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
      capture.port.onmessage = event => {
        if (!closed && event.data instanceof ArrayBuffer) {
          // Silence lets server VAD finish a turn if mute is pressed mid-speech.
          // Microphone samples are replaced before anything is transmitted.
          if (muted) new Uint8Array(event.data).fill(0);
          onChunk(event.data);
        }
      };
      source.connect(capture);
      capture.connect(context.destination);
    },
    play(pcm: ArrayBuffer) {
      if (closed || pcm.byteLength === 0) return;
      if (nextPlayback - context.currentTime > 30) {
        clearPlayback();
        throw new Error('Voice playback fell behind. Please repeat your request.');
      }
      const view = new DataView(pcm);
      const buffer = context.createBuffer(1, Math.floor(pcm.byteLength / 2), 24000);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < channel.length; index++) channel[index] = view.getInt16(index * 2, true) / 32768;
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(context.destination);
      const wasEmpty = sources.size === 0;
      sources.add(node);
      node.onended = () => { sources.delete(node); node.disconnect(); if (!closed && sources.size === 0) onPlayback(false); };
      const startAt = Math.max(context.currentTime + .025, nextPlayback);
      nextPlayback = startAt + buffer.duration;
      node.start(startAt);
      if (wasEmpty) onPlayback(true);
    },
    clearPlayback,
    mute(value: boolean) { muted = value; },
    close() {
      if (closed) return;
      closed = true;
      if (capture) { capture.port.onmessage = null; capture.port.close(); capture.disconnect(); }
      source?.disconnect();
      clearPlayback();
      void context.close().catch(() => {});
    },
  };
}
