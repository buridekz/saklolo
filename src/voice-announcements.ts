export type AnnounceableReport = {
  id: string;
  status: 'pending' | 'delivered' | 'acknowledged';
  needsSync?: boolean;
};

const rank = { pending: 0, delivered: 1, acknowledged: 2 };
const key = (state: AnnounceableReport) => `${state.id}:${state.status}`;

/** Pure scheduling policy; timers and speech dispatch are injected for deterministic tests. */
export function createAnnouncementScheduler<T extends AnnounceableReport>(options: {
  announce: (state: T) => void;
  enabled?: boolean;
  settleMs?: number;
  schedule?: (run: () => void, delay: number) => unknown;
  cancel?: (handle: unknown) => void;
}) {
  const schedule = options.schedule || ((run, delay) => setTimeout(run, delay));
  const cancel = options.cancel || (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const spoken = new Set<string>();
  const highest = new Map<string, number>();
  const busy = new Set<string>();
  let enabled = options.enabled ?? true;
  let closed = false;
  let pending: T | null = null;
  let timer: unknown;

  const clearTimer = () => { if (timer !== undefined) cancel(timer); timer = undefined; };
  const pump = () => {
    clearTimer();
    if (closed || !enabled || busy.size || !pending) return;
    timer = schedule(() => {
      timer = undefined;
      if (closed || !enabled || busy.size || !pending) return;
      const state = pending;
      pending = null;
      if (spoken.has(key(state))) return;
      spoken.add(key(state));
      options.announce(state);
    }, options.settleMs ?? 700);
  };

  return {
    notify(state: T) {
      if (closed) return;
      const previous = highest.get(state.id) ?? -1;
      if (rank[state.status] < previous) return;
      highest.set(state.id, rank[state.status]);
      // Updates while disabled are intentionally not replayed on re-enable.
      if (!enabled) { spoken.add(key(state)); return; }
      if (spoken.has(key(state))) return;
      if (pending?.id === state.id && rank[pending.status] > rank[state.status]) return;
      const samePendingStatus = pending && key(pending) === key(state);
      pending = { ...state };
      // GPS revisions shouldn't postpone the same status announcement indefinitely.
      if (!samePendingStatus) pump();
    },
    coveredByTool(state: T) {
      if (closed) return;
      highest.set(state.id, Math.max(highest.get(state.id) ?? -1, rank[state.status]));
      for (const status of ['pending', 'delivered', 'acknowledged'] as const) {
        if (rank[status] <= rank[state.status]) spoken.add(`${state.id}:${status}`);
      }
      if (pending?.id === state.id && rank[pending.status] <= rank[state.status]) pending = null;
      pump();
    },
    setBusy(reason: string, value: boolean) {
      if (closed) return;
      if (value) busy.add(reason); else busy.delete(reason);
      pump();
    },
    setEnabled(value: boolean) {
      if (closed) return;
      enabled = value;
      if (!enabled) { if (pending) spoken.add(key(pending)); pending = null; }
      pump();
    },
    close() { closed = true; pending = null; busy.clear(); clearTimer(); },
  };
}

export function verifiedStatusSentence(state: AnnounceableReport): string {
  const base = state.status === 'acknowledged'
    ? 'The demo desk has acknowledged your request. This does not mean a responder has been dispatched.'
    : state.status === 'delivered'
      ? 'Your request reached the demo desk and is waiting for an operator to review it.'
      : 'Your request is saved on this device and has not been delivered yet.';
  return base + (state.needsSync && state.status !== 'pending' ? ' Your latest changes are saved locally and are still waiting to be delivered.' : '');
}
