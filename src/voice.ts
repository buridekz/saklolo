import { OpenAIRealtimeWebSocket, RealtimeAgent, RealtimeSession, tool } from '@openai/agents/realtime';
import { z } from 'zod';
import { api, categories, type Category } from './data';
import { createVoiceAudio } from './voice-audio';
export type VoiceStatus = 'connecting' | 'listening' | 'speaking' | 'saving' | 'ended';
export type VoiceTranscript = { id: string; role: 'user' | 'assistant'; text: string };
export type VoiceOptions = {
  signal?: AbortSignal;
  onStatus?: (status: VoiceStatus) => void;
  onTranscript?: (items: VoiceTranscript[]) => void;
};

function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

class VoiceSetupError extends Error {}

const voiceErrorMessages: Record<string, string> = {
  insufficient_quota: 'OpenAI voice quota is exhausted. Check API billing or use the written report.',
  rate_limit_exceeded: 'OpenAI voice is rate limited. Wait briefly and try again.',
  invalid_api_key: 'OpenAI rejected the voice credential. Check the backend API configuration.',
  authentication_error: 'OpenAI could not authenticate this voice session. Try reconnecting.',
  permission_denied: 'This OpenAI project does not have access to the voice service.',
  model_not_found: 'The configured voice model is unavailable to this OpenAI project.',
  invalid_request_error: 'OpenAI rejected the voice session configuration.',
  invalid_value: 'OpenAI rejected a value in the voice session configuration.',
  unknown_parameter: 'The voice session contains a parameter unsupported by OpenAI.',
  unsupported_parameter: 'The voice session contains a parameter unsupported by this model.',
  server_error: 'The OpenAI voice service encountered an error. Please retry.',
};

const recoverableVoiceErrors: Record<string, string> = {
  conversation_already_has_active_response: 'The assistant is finishing its response. You can keep speaking or wait a moment.',
  response_cancel_not_active: 'The previous response has already ended. You can keep speaking.',
  input_audio_buffer_commit_empty: 'No speech was captured in that turn. Please say your request again.',
  transcription_failed: 'That speech could not be transcribed. Please repeat it or use the written report.',
};

function recoverableMessage(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const item = current as { code?: unknown; error?: unknown };
    if (typeof item.code === 'string' && Object.hasOwn(recoverableVoiceErrors, item.code)) {
      console.warn('Saklolo voice recoverable event:', item.code);
      return recoverableVoiceErrors[item.code];
    }
    current = item.error;
  }
  return null;
}

function providerError(error: unknown): VoiceSetupError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const item = current as { code?: unknown; type?: unknown; error?: unknown };
    for (const value of [item.code, item.type]) {
      if (typeof value === 'string' && Object.hasOwn(voiceErrorMessages, value)) {
        // Print only a known diagnostic identifier, never the raw provider event.
        console.warn('Saklolo voice service:', value);
        return new VoiceSetupError(`${voiceErrorMessages[value]} (${value})`);
      }
    }
    current = item.error;
  }
  return null;
}

function friendlyError(error: unknown): Error {
  if (error instanceof VoiceSetupError) return error;
  const knownProviderError = providerError(error);
  if (knownProviderError) return knownProviderError;
  if (error instanceof DOMException && error.name === 'NotAllowedError') return new Error('Microphone permission was denied. Allow microphone access in your browser, then try again.');
  if (error instanceof DOMException && error.name === 'NotFoundError') return new Error('No microphone was found. Connect one or use the SOS button.');
  if (error instanceof DOMException && error.name === 'NotReadableError') return new Error('Your microphone is busy or unavailable. Close other recording apps and try again.');
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return error;
  // Avoid forwarding SDK errors that could contain connection details or credentials.
  return new Error('Could not connect voice. Check internet and microphone access, then retry. The SOS button still works.');
}

export async function startVoice(onReport: (category: Category, description: string, landmark: string) => Promise<string>, onError: (message: string) => void, options: VoiceOptions = {}) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Voice needs HTTPS or localhost and microphone access. You can still use the SOS button.');
  }
  if (!navigator.onLine) throw new Error('OpenAI voice needs internet. Use the SOS button to save a report on this device.');
  const lifecycle = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, lifecycle.signal]) : lifecycle.signal;
  let media: MediaStream | undefined;
  let session: RealtimeSession | undefined;
  let closed = false;
  let connected = false;
  let terminalError: Error | undefined;
  let reportQueue: Promise<unknown> = Promise.resolve();
  const status = (value: VoiceStatus) => options.onStatus?.(value);
  const audio = createVoiceAudio(playing => { if (!closed) status(playing ? 'speaking' : 'listening'); });
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(connectTimer);
    signal.removeEventListener('abort', close);
    session?.close();
    media?.getTracks().forEach(track => track.stop());
    audio.close();
    lifecycle.abort(new DOMException('Voice session ended.', 'AbortError'));
    status('ended');
  };
  const connectTimer = window.setTimeout(() => lifecycle.abort(new DOMException('Voice connection timed out. Check microphone permissions and retry.', 'TimeoutError')), 35_000);
  signal.addEventListener('abort', close, { once: true });
  status('connecting');
  try {
    // If permission is granted after cancellation, stop the new stream immediately.
    const microphone = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(stream => {
      if (signal.aborted) { stream.getTracks().forEach(track => track.stop()); throw signal.reason; }
      media = stream; return stream;
    });
    await cancellable(microphone, signal);
    const token = await api<{ value: string; model: string }>('/api/voice/session', { method: 'POST', signal }).catch(error => {
      // The backend deliberately returns safe, actionable quota/auth/model diagnostics.
      if (error instanceof Error && error.name === 'Error') throw new VoiceSetupError(error.message);
      throw error;
    });
    if (!token.value || !token.model) throw new Error('Voice session could not be created.');
  const agent = new RealtimeAgent({
    name: 'Saklolo intake assistant',
    instructions: `You are a calm emergency-report intake assistant in a HACKATHON DEMO, not a real emergency service. Speak concise English or Filipino matching the user. Never diagnose, assess medical severity, promise rescue, or invent status. Help the user describe an incident and ask one short question at a time. If the user explicitly asks for help, call submit_report promptly using only stated facts. Do not delay the report for missing details. Preserve uncertainty and use Other if the category is unclear. Landmark may be empty; GPS is attached by the app, never invent coordinates. Do not infer unconsciousness or safety from silence. Read back the exact tool delivery status; saved locally is not delivered, and acknowledged is not dispatched. Never claim a report was delivered or responders dispatched without evidence. A failed tool call means the report or update is not confirmed saved: say so. This session manages one incident. When the user gives additional facts or corrections, call submit_report again to UPDATE that same incident. Every call must contain the cumulative current description, category, and landmark, preserving earlier facts except explicit corrections. Do not overwrite a known landmark with empty text. Do not call it again when nothing changed. Explain that voice needs internet if asked.`,
    tools: [tool({ name: 'submit_report', description: 'Create or update the single incident for this voice session on the resident device and attempt delivery to the simulated desk. Always include the full current description and landmark, not only the latest detail. Returns actual delivery status.', parameters: z.object({ category: z.enum(categories), description: z.string().max(4000), landmark: z.string().max(240) }), execute: async ({ category, description, landmark }) => {
      const result = reportQueue.then(async () => {
        if (closed) return 'SESSION_ENDED: No report update was saved by this call.';
        status('saving');
        try { return await onReport(category, description, landmark); }
        catch { return 'REPORT_SAVE_FAILED: Saving this report or update could not be confirmed. Do not say it was saved or delivered. Ask the user to use the SOS button or written form.'; }
        finally { if (!closed) status('listening'); }
      });
      reportQueue = result.catch(() => {});
      return result;
    } })]
  });
    const transport = new OpenAIRealtimeWebSocket();
    session = new RealtimeSession(agent, {
      model: token.model, transport, tracingDisabled: true,
      config: { audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: 'gpt-4o-mini-transcribe' }, turnDetection: { type: 'server_vad', silenceDurationMs: 700, createResponse: true, interruptResponse: true } }, output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'marin' } } },
    });
    session.on('history_updated', history => {
      if (closed) return;
      const lines: VoiceTranscript[] = [];
      for (const item of history) {
        if (item.type !== 'message' || item.role === 'system') continue;
        const text = item.content.map(part => 'text' in part ? part.text : part.transcript || '').join(' ').trim();
        if (text) lines.push({ id: item.itemId, role: item.role, text });
      }
      options.onTranscript?.(lines);
    });
    session.on('audio', event => {
      if (closed) return;
      try { audio.play(event.data); }
      catch { onError('Voice playback fell behind. Please repeat your request.'); }
    });
    session.on('audio_interrupted', () => { if (!closed) audio.clearPlayback(); });
    session.on('error', event => {
      if (closed) return;
      const recovery = connected ? recoverableMessage(event) : null;
      if (recovery) { onError(recovery); return; }
      terminalError = providerError(event) || new VoiceSetupError('Voice encountered a connection or service error. Please retry, or use the SOS button.');
      onError(terminalError.message);
      close();
    });
    session.on('transport_event', event => {
      if (!closed && connected && event.type === 'conversation.item.input_audio_transcription.failed') {
        onError('That turn could not be transcribed. The voice session is still connected; please repeat or use the written report.');
      }
    });
    transport.on('connection_change', state => {
      if (state === 'disconnected' && connected && !closed) {
        onError('Voice disconnected. Saved reports are preserved; you can reconnect or use the SOS button.');
        close();
      }
    });
    await cancellable(session.connect({ apiKey: token.value }), signal);
    if (closed || signal.aborted) throw signal.reason || new DOMException('Voice session ended.', 'AbortError');
    await cancellable(audio.attach(media!, chunk => {
      if (!connected || closed) return;
      try { session!.sendAudio(chunk); }
      catch { onError('Voice audio could not be sent. Please reconnect or use the written report.'); close(); }
    }), signal);
    clearTimeout(connectTimer);
    connected = true;
    status('listening');
    transport.sendEvent({ type: 'response.create', response: { instructions: 'Greet the user briefly in English: "This is the Saklolo demo assistant. Tell me what happened and what help you need." Do not create a report from this greeting. Then listen.' } });
    return {
      close,
      mute: (muted: boolean) => { if (!closed) audio.mute(muted); },
      sendMessage: (message: string) => { if (!closed) session!.sendMessage(message); },
    };
  } catch (error) { close(); throw terminalError || friendlyError(error); }
}
