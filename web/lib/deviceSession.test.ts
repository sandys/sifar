import { describe, it, expect, vi } from 'vitest';
import { createDeviceSession, DISCONNECTED } from './deviceSession';

/** A promise you resolve by hand, for ordering assertions. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSession(
  lockImpl?: () => Promise<{ success: boolean }>,
  log?: string[]
) {
  const lock = vi.fn(
    lockImpl ??
      (async () => {
        log?.push('lock');
        return { success: true };
      })
  );
  const dispose = vi.fn(async () => {
    log?.push('dispose');
  });
  const s = createDeviceSession({ lock, dispose });
  s.openDeviceGate();
  return { ...s, lock, dispose };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('runDeviceOperation — FIFO and locking', () => {
  it('runs ops FIFO with a lock between them', async () => {
    const log: string[] = [];
    const s = makeSession(undefined, log);

    const p1 = s.runDeviceOperation({ label: 'a', exclusive: true }, async () => {
      log.push('op1');
    });
    const p2 = s.runDeviceOperation({ label: 'b', exclusive: true }, async () => {
      log.push('op2');
    });

    await Promise.all([p1, p2]);
    expect(log).toEqual(['op1', 'lock', 'op2', 'lock']);
  });

  it('resolves the caller at fn settle, before the lock finishes', async () => {
    const gate = deferred();
    const s = makeSession(async () => {
      await gate.promise;
      return { success: true };
    });

    let resolvedWhileLockPending = false;
    await s.runDeviceOperation({ label: 'a', exclusive: true }, async () => {});
    // The caller above already resolved; activeOp is still set until the lock
    // settles, proving the op slot spans fn + lock.
    resolvedWhileLockPending = s.store.getState().activeOp !== null;
    expect(resolvedWhileLockPending).toBe(true);

    gate.resolve();
    await tick();
    expect(s.store.getState().activeOp).toBeNull();
  });

  it('locks after a rejected op (device may be left unlocked)', async () => {
    const s = makeSession();
    await expect(
      s.runDeviceOperation({ label: 'a', exclusive: true }, async () => {
        throw new Error('mismatch');
      })
    ).rejects.toThrow('mismatch');
    expect(s.lock).toHaveBeenCalledTimes(1);
  });

  it('skips the lock when a reject means there is nothing to lock', async () => {
    const s = makeSession();
    for (const message of ['Transport_Missing', DISCONNECTED]) {
      s.lock.mockClear();
      await expect(
        s.runDeviceOperation({ label: 'a', exclusive: true }, async () => {
          throw new Error(message);
        })
      ).rejects.toThrow(message);
      expect(s.lock).not.toHaveBeenCalled();
    }
  });

  it('bumps lockFailedNonce when the lock fails, not when it succeeds', async () => {
    const s = makeSession(async () => ({ success: false }));
    expect(s.store.getState().lockFailedNonce).toBe(0);
    await s.runDeviceOperation({ label: 'a', exclusive: true }, async () => {});
    // The caller resolves at fn-settle; the lock runs after, so let it settle.
    await tick();
    expect(s.store.getState().lockFailedNonce).toBe(1);
  });
});

describe('runDeviceOperation — gate and abort', () => {
  it('rejects immediately when the gate is closed, without invoking fn or lock', async () => {
    const s = makeSession();
    s.closeDeviceGate();
    const fn = vi.fn(async () => {});
    await expect(
      s.runDeviceOperation({ label: 'a', exclusive: true }, fn)
    ).rejects.toThrow(DISCONNECTED);
    expect(fn).not.toHaveBeenCalled();
    expect(s.lock).not.toHaveBeenCalled();
  });

  it('aborts the active op and rejects queued ops on closeGate', async () => {
    const s = makeSession();
    let sawAbort = false;
    const started = deferred();

    const p1 = s.runDeviceOperation(
      { label: 'a', exclusive: false },
      async ({ signal }) => {
        started.resolve();
        await new Promise<void>((res) => {
          signal.addEventListener('abort', () => {
            sawAbort = true;
            res(); // preemptible: break with partial result
          });
        });
        return 'partial';
      }
    );
    const p2 = s.runDeviceOperation({ label: 'b', exclusive: true }, async () => 'never');

    await started.promise;
    s.closeDeviceGate();

    await expect(p1).resolves.toBe('partial');
    expect(sawAbort).toBe(true);
    await expect(p2).rejects.toThrow(DISCONNECTED);
    expect(s.store.getState().queuedOps).toBe(0);
  });

  it('normalizes a gate-close rejection to Trezor_Disconnected', async () => {
    const s = makeSession();
    const started = deferred();
    const p = s.runDeviceOperation(
      { label: 'a', exclusive: true },
      async ({ signal }) => {
        started.resolve();
        await new Promise<void>((_, rej) => {
          signal.addEventListener('abort', () => rej(new Error('Disposed')));
        });
      }
    );
    await started.promise;
    s.closeDeviceGate();
    // The wire threw 'Disposed', but the caller sees a disconnect so the UI
    // filter matches instead of showing a "Disposed" error card.
    await expect(p).rejects.toThrow(DISCONNECTED);
  });
});

describe('runDeviceOperation — preemption', () => {
  it('exclusive preempts preemptible: order is scan → scan-lock → confirm → confirm-lock', async () => {
    const log: string[] = [];
    const s = makeSession(undefined, log);
    const scanStarted = deferred();

    const scan = s.runDeviceOperation(
      { label: 'enumerate', exclusive: false },
      async ({ signal }) => {
        scanStarted.resolve();
        await new Promise<void>((res) => {
          signal.addEventListener('abort', () => {
            log.push('scan-break');
            res();
          });
        });
      }
    );

    await scanStarted.promise;

    const confirm = s.runDeviceOperation(
      { label: 'confirm-address', exclusive: true },
      async () => {
        log.push('confirm');
      }
    );

    await Promise.all([scan, confirm]);
    expect(log).toEqual(['scan-break', 'lock', 'confirm', 'lock']);
  });

  it('an exclusive op does not preempt another exclusive op', async () => {
    const s = makeSession();
    let firstAborted = false;
    const firstStarted = deferred();
    const release = deferred();

    const p1 = s.runDeviceOperation(
      { label: 'sign', exclusive: true },
      async ({ signal }) => {
        signal.addEventListener('abort', () => {
          firstAborted = true;
        });
        firstStarted.resolve();
        await release.promise;
      }
    );
    await firstStarted.promise;
    const p2 = s.runDeviceOperation({ label: 'confirm-address', exclusive: true }, async () => {});

    release.resolve();
    await Promise.all([p1, p2]);
    expect(firstAborted).toBe(false);
  });
});

describe('runDeviceOperation — coalesce', () => {
  it('joins a same-label op instead of running fn twice', async () => {
    const s = makeSession();
    const fn = vi.fn(async () => 'result');
    const release = deferred();

    const p1 = s.runDeviceOperation(
      { label: 'enumerate', exclusive: false, coalesce: true },
      async () => {
        await release.promise;
        return fn();
      }
    );
    const p2 = s.runDeviceOperation(
      { label: 'enumerate', exclusive: false, coalesce: true },
      async () => fn()
    );

    expect(p1).toBe(p2);
    release.resolve();
    await Promise.all([p1, p2]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not join a different label', async () => {
    const s = makeSession();
    const p1 = s.runDeviceOperation({ label: 'enumerate', exclusive: false, coalesce: true }, async () => 1);
    const p2 = s.runDeviceOperation({ label: 'other', exclusive: false, coalesce: true }, async () => 2);
    expect(p1).not.toBe(p2);
    await Promise.all([p1, p2]);
  });
});

describe('state machine and shutdown', () => {
  it('transitions connecting -> ready, and refuses to resurrect after close', () => {
    const s = createDeviceSession({
      lock: async () => ({ success: true }),
      dispose: async () => {}
    });
    expect(s.store.getState().status).toBe('disconnected');
    s.openDeviceGate();
    expect(s.store.getState().status).toBe('connecting');
    s.markDeviceReady();
    expect(s.store.getState().status).toBe('ready');
    s.closeDeviceGate();
    s.markDeviceReady();
    expect(s.store.getState().status).toBe('disconnected');
  });

  it('shutdown avoids a double lock while one is in flight, then disposes', async () => {
    const log: string[] = [];
    const lockGate = deferred();
    const s = makeSession(async () => {
      log.push('lock-start');
      await lockGate.promise;
      log.push('lock-end');
      return { success: true };
    }, undefined);

    // Start an op whose lockAfter is stuck mid-flight.
    const op = s.runDeviceOperation({ label: 'a', exclusive: true }, async () => {});
    await op; // caller resolves at fn settle; lock is now pending
    await tick();

    const shutdown = s.shutdownDeviceSession();
    lockGate.resolve();
    await shutdown;

    // Exactly one lock total (the op's), then dispose.
    expect(s.lock).toHaveBeenCalledTimes(1);
    expect(s.dispose).toHaveBeenCalledTimes(1);
  });

  it('shutdown while idle runs one teardown lock then disposes', async () => {
    const s = makeSession();
    await s.shutdownDeviceSession();
    expect(s.lock).toHaveBeenCalledTimes(1);
    expect(s.dispose).toHaveBeenCalledTimes(1);
  });
});
