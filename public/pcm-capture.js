// Runs on the audio rendering thread. Emits 100 ms of mono PCM16 at 24 kHz.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 24000;
    this.remaining = this.ratio;
    this.sum = 0;
    this.offset = 0;
    this.buffer = new ArrayBuffer(2400 * 2);
    this.view = new DataView(this.buffer);
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      let available = 1;
      while (available > 1e-8) {
        const weight = Math.min(available, this.remaining);
        this.sum += sample * weight;
        this.remaining -= weight;
        available -= weight;
        if (this.remaining <= 1e-8) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.view.setInt16(this.offset * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
          this.offset++;
          this.remaining = this.ratio;
          this.sum = 0;
          if (this.offset === 2400) {
            this.port.postMessage(this.buffer, [this.buffer]);
            this.buffer = new ArrayBuffer(2400 * 2);
            this.view = new DataView(this.buffer);
            this.offset = 0;
          }
        }
      }
    }
    // Outputs intentionally remain silent so the microphone is never played locally.
    return true;
  }
}
registerProcessor('saklolo-pcm-capture', PcmCapture);
