import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import TrezorConnect from './trezorConnect';

/**
 * Device-session arbiter.
 *
 * Every logical Trezor operation flows through one FIFO runner. Before this
 * existed, several flows (background enumeration, address confirmation,
 * signing, locking, disconnect) drove one device with ad-hoc flags, and each
 * new race got a new flag — which produced three separate "PIN prompt out of
 * nowhere" bugs. The arbiter replaces all of that with a single owner.
 *
 * Two hard rules encoded here:
 *
 *  - Authentication belongs to firmware. Operations share the current
 *    in-memory device session, so the Trezor asks for PIN/passphrase only when
 *    its own state requires it. Explicit Disconnect ends and locks the session.
 *
 *  - Never call runDeviceOperation from inside another op's fn. Single-flight
 *    FIFO makes that an instant deadlock. Fire-and-forget device reads inside
 *    an op (e.g. getFeatures during enumeration) stay RAW calls, serialized by
 *    the wire-level queue in trezorConnect, not wrapped here.
 */

export type DeviceStatus = 'disconnected' | 'connecting' | 'ready';

export interface ActiveOp {
  id: number;
  label: string;
  exclusive: boolean;
}

export interface DeviceSessionState {
  status: DeviceStatus;
  activeOp: ActiveOp | null;
  queuedOps: number;
}

export interface RunOpts {
  label: string;
  exclusive: boolean;
  /** Join an in-flight/queued op with the same label instead of enqueuing. */
  coalesce?: boolean;
}

export interface OpContext {
  signal: AbortSignal;
}

export interface DeviceSessionDeps {
  endAndLock: () => Promise<{ success: boolean }>;
  dispose: () => Promise<void>;
}

/** Carried on rejections so the UI can tell "you disconnected" from a real error. */
export const DISCONNECTED = 'Trezor_Disconnected';

const TEARDOWN_LOCK_TIMEOUT_MS = 3000;

interface QueueEntry {
  id: number;
  label: string;
  exclusive: boolean;
  fn: (ctx: OpContext) => Promise<unknown>;
  controller: AbortController;
  /** True when closeDeviceGate aborted this entry (vs. a preemption abort). */
  abortedByGate: boolean;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  /** Set once the entry is running, so callers can join via coalesce. */
  promise: Promise<unknown>;
}

export function createDeviceSession(deps: DeviceSessionDeps) {
  const store = createStore<DeviceSessionState>(() => ({
    status: 'disconnected',
    activeOp: null,
    queuedOps: 0
  }));

  // Non-serializable internals live here, not in the store: they carry no
  // render value and must not trigger re-renders.
  const queue: QueueEntry[] = [];
  let active: QueueEntry | null = null;
  let idCounter = 0;
  let pumping = false;
  let shutdownInFlight: Promise<void> | null = null;

  const setQueuedCount = () => store.setState({ queuedOps: queue.length });

  function openDeviceGate() {
    if (store.getState().status === 'disconnected') {
      store.setState({ status: 'connecting' });
    }
  }

  function markDeviceReady() {
    // Only from 'connecting': a straggling first-address callback that lands
    // after a disconnect must not resurrect the gate.
    if (store.getState().status === 'connecting') {
      store.setState({ status: 'ready' });
    }
  }

  function closeDeviceGate() {
    store.setState({ status: 'disconnected' });

    if (active) {
      active.abortedByGate = true;
      active.controller.abort();
    }
    // Reject everything still waiting; nothing queued should survive a gate close.
    for (const entry of queue) {
      entry.abortedByGate = true;
      entry.reject(new Error(DISCONNECTED));
    }
    queue.length = 0;
    setQueuedCount();
  }

  function findJoinable(label: string): QueueEntry | null {
    if (active && active.label === label) return active;
    return queue.find((e) => e.label === label) ?? null;
  }

  function runDeviceOperation<T>(
    opts: RunOpts,
    fn: (ctx: OpContext) => Promise<T>
  ): Promise<T> {
    // Sync gate check first — never queue against a closed gate.
    if (store.getState().status === 'disconnected') {
      return Promise.reject(new Error(DISCONNECTED));
    }

    if (opts.coalesce) {
      const existing = findJoinable(opts.label);
      if (existing) return existing.promise as Promise<T>;
    }

    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const entry: QueueEntry = {
      id: ++idCounter,
      label: opts.label,
      exclusive: opts.exclusive,
      fn: fn as (ctx: OpContext) => Promise<unknown>,
      controller: new AbortController(),
      abortedByGate: false,
      resolve,
      reject,
      promise
    };

    queue.push(entry);
    setQueuedCount();

    // An exclusive op preempts a running preemptible one. The pump still waits
    // for the aborted operation to settle before starting the exclusive work.
    if (entry.exclusive && active && !active.exclusive) {
      active.controller.abort();
    }

    void pump();
    return promise as Promise<T>;
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0) {
        const entry = queue.shift()!;
        active = entry;
        setQueuedCount();
        store.setState({
          activeOp: { id: entry.id, label: entry.label, exclusive: entry.exclusive }
        });

        let settledValue: unknown;
        let rejected = false;
        let rejection: unknown;

        try {
          settledValue = await entry.fn({ signal: entry.controller.signal });
        } catch (err) {
          rejected = true;
          // If the gate closed under this op, surface a disconnect rather than
          // the wire's incidental error (e.g. dispose()'s 'Disposed'), so the
          // UI filter matches instead of showing a spurious error card.
          if (entry.abortedByGate) {
            const normalized = new Error(DISCONNECTED);
            (normalized as any).cause = err;
            rejection = normalized;
          } else {
            rejection = err;
          }
        }

        if (rejected) entry.reject(rejection);
        else entry.resolve(settledValue);

        active = null;
        store.setState({ activeOp: null });
      }
    } finally {
      pumping = false;
    }
  }

  function shutdownDeviceSession() {
    if (shutdownInFlight) return shutdownInFlight;
    closeDeviceGate();

    const shutdown = (async () => {
      // TrezorConnect serializes wire calls, so this queues behind any command
      // already on USB. Bound teardown so a removed/stuck device cannot hang
      // the Disconnect action forever.
      await Promise.race([
        deps.endAndLock().catch(() => ({ success: false })),
        new Promise((r) => setTimeout(r, TEARDOWN_LOCK_TIMEOUT_MS))
      ]);

      await deps.dispose().catch(() => {});

      // Reset so a later openDeviceGate() starts from a clean queue.
      queue.length = 0;
      active = null;
      setQueuedCount();
    })();

    shutdownInFlight = shutdown;
    return shutdown.finally(() => {
      if (shutdownInFlight === shutdown) shutdownInFlight = null;
    });
  }

  return {
    store,
    openDeviceGate,
    markDeviceReady,
    closeDeviceGate,
    runDeviceOperation,
    shutdownDeviceSession
  };
}

// --- Wired singleton -------------------------------------------------------

const wiredEndAndLock = () =>
  TrezorConnect.hasTransport()
    ? TrezorConnect.lockDevice().then((r) => ({ success: r.success }))
    : Promise.resolve({ success: true });

const wiredDispose = () => TrezorConnect.dispose();

const session = createDeviceSession({
  endAndLock: wiredEndAndLock,
  dispose: wiredDispose
});

export const {
  openDeviceGate,
  markDeviceReady,
  closeDeviceGate,
  runDeviceOperation,
  shutdownDeviceSession
} = session;

/** React hook — always pass a selector (lint enforces this). */
export function useDeviceStore<U>(selector: (s: DeviceSessionState) => U): U {
  return useStore(session.store, selector);
}

/** Non-hook read for lib code and async loops. */
export function getDeviceSessionState(): DeviceSessionState {
  return session.store.getState();
}

// Physical unplug: the transport emits ui-no_transport. Closing the gate here
// is the entire unplug story — no trezorConnect changes needed. Idempotent, so
// stacked deviceEvents listeners firing it N times is harmless.
TrezorConnect.on((event) => {
  if (event.type === 'ui-no_transport') {
    closeDeviceGate();
  }
});
