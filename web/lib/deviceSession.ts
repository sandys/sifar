import { createStore, type StoreApi } from 'zustand/vanilla';
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
 *  - Every operation ends with the device LOCKED (EndSession + LockDevice,
 *    which also drops the passphrase session). The op slot spans fn + lock, so
 *    nothing can interleave between an operation finishing and the device
 *    locking. This is the security model: the next operation needs the PIN
 *    again rather than riding an already-unlocked session.
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
  /** Monotonic; bumped whenever a lockAfter fails. Never reset. */
  lockFailedNonce: number;
}

export interface RunOpts {
  label: string;
  exclusive: boolean;
  /** Lock the device after the op settles. Default true — the security model. */
  lockAfter?: boolean;
  /** Join an in-flight/queued op with the same label instead of enqueuing. */
  coalesce?: boolean;
}

export interface OpContext {
  signal: AbortSignal;
}

export interface DeviceSessionDeps {
  lock: () => Promise<{ success: boolean }>;
  dispose: () => Promise<void>;
}

/** Carried on rejections so the UI can tell "you disconnected" from a real error. */
export const DISCONNECTED = 'Trezor_Disconnected';

const SKIP_LOCK_ON_REJECT = /Trezor_Disconnected|Transport_Missing/;
const TEARDOWN_LOCK_TIMEOUT_MS = 3000;

interface QueueEntry {
  id: number;
  label: string;
  exclusive: boolean;
  lockAfter: boolean;
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
    queuedOps: 0,
    lockFailedNonce: 0
  }));

  // Non-serializable internals live here, not in the store: they carry no
  // render value and must not trigger re-renders.
  const queue: QueueEntry[] = [];
  let active: QueueEntry | null = null;
  let idCounter = 0;
  let pumping = false;
  let lockInFlight: Promise<void> | null = null;

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
      lockAfter: opts.lockAfter ?? true,
      fn: fn as (ctx: OpContext) => Promise<unknown>,
      controller: new AbortController(),
      abortedByGate: false,
      resolve,
      reject,
      promise
    };

    queue.push(entry);
    setQueuedCount();

    // An exclusive op preempts a running preemptible one. Abort it; the pump's
    // normal settle → lockAfter → next-op flow does the rest, so the preempted
    // op's device state is still locked before this one starts.
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

        // Resolve the caller now — the lock runs in the background; no caller
        // ever depended on the lock completing.
        if (rejected) entry.reject(rejection);
        else entry.resolve(settledValue);

        await maybeLockAfter(entry, rejected, rejection);

        active = null;
        store.setState({ activeOp: null });
      }
    } finally {
      pumping = false;
    }
  }

  async function maybeLockAfter(
    entry: QueueEntry,
    rejected: boolean,
    rejection: unknown
  ) {
    if (!entry.lockAfter) return;
    // Gate closed: shutdown owns teardown; do not lock here.
    if (store.getState().status === 'disconnected') return;
    if (rejected) {
      const message = (rejection as any)?.message ?? '';
      if (SKIP_LOCK_ON_REJECT.test(message)) return;
    }

    const p = (async () => {
      try {
        const result = await deps.lock();
        if (!result.success) {
          store.setState((s) => ({ lockFailedNonce: s.lockFailedNonce + 1 }));
        }
      } catch {
        store.setState((s) => ({ lockFailedNonce: s.lockFailedNonce + 1 }));
      }
    })();
    lockInFlight = p;
    try {
      await p;
    } finally {
      if (lockInFlight === p) lockInFlight = null;
    }
  }

  async function shutdownDeviceSession() {
    closeDeviceGate();

    // Avoid a double lock: if an op's lockAfter is already on the wire, let it
    // finish and skip the teardown lock. Otherwise run one teardown lock,
    // bounded so a stuck wire call can't hang disconnect forever.
    const pending = lockInFlight;
    if (pending) {
      await pending.catch(() => {});
    } else {
      await Promise.race([
        deps.lock().catch(() => ({ success: false })),
        new Promise((r) => setTimeout(r, TEARDOWN_LOCK_TIMEOUT_MS))
      ]);
    }

    await deps.dispose().catch(() => {});

    // Reset so a later openDeviceGate() starts from a clean queue.
    queue.length = 0;
    active = null;
    lockInFlight = null;
    setQueuedCount();
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

const wiredLock = () =>
  TrezorConnect.hasTransport()
    ? TrezorConnect.lockDevice().then((r) => ({ success: r.success }))
    : Promise.resolve({ success: true });

const wiredDispose = () => TrezorConnect.dispose();

const session = createDeviceSession({ lock: wiredLock, dispose: wiredDispose });

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
