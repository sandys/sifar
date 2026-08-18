import { describe, expect, it, vi } from 'vitest';
import { createDeviceSession, DISCONNECTED } from './deviceSession';

/** A promise controlled by the test, useful for ordering assertions. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSession(
  endAndLockImpl?: () => Promise<{ success: boolean }>,
  log?: string[]
) {
  const endAndLock = vi.fn(
    endAndLockImpl ??
      (async () => {
        log?.push('end-and-lock');
        return { success: true };
      })
  );
  const dispose = vi.fn(async () => {
    log?.push('dispose');
  });
  const session = createDeviceSession({ endAndLock, dispose });
  session.openDeviceGate();
  return { ...session, endAndLock, dispose };
}

describe('runDeviceOperation - FIFO and firmware session reuse', () => {
  it('runs operations FIFO without locking between them', async () => {
    const log: string[] = [];
    const session = makeSession(undefined, log);

    const first = session.runDeviceOperation(
      { label: 'first', exclusive: true },
      async () => {
        log.push('first');
      }
    );
    const second = session.runDeviceOperation(
      { label: 'second', exclusive: true },
      async () => {
        log.push('second');
      }
    );

    await Promise.all([first, second]);
    expect(log).toEqual(['first', 'second']);
    expect(session.endAndLock).not.toHaveBeenCalled();
  });

  it('keeps the op slot until the operation settles', async () => {
    const session = makeSession();
    const release = deferred();
    const started = deferred();
    const second = vi.fn(async () => 'second');

    const firstPromise = session.runDeviceOperation(
      { label: 'first', exclusive: true },
      async () => {
        started.resolve();
        await release.promise;
        return 'first';
      }
    );
    await started.promise;
    const secondPromise = session.runDeviceOperation(
      { label: 'second', exclusive: true },
      second
    );

    expect(session.store.getState().activeOp?.label).toBe('first');
    expect(second).not.toHaveBeenCalled();
    release.resolve();
    await expect(firstPromise).resolves.toBe('first');
    await expect(secondPromise).resolves.toBe('second');
    expect(session.store.getState().activeOp).toBeNull();
  });

  it('does not end the firmware session after a rejected operation', async () => {
    const session = makeSession();
    await expect(
      session.runDeviceOperation(
        { label: 'mismatch', exclusive: true },
        async () => {
          throw new Error('mismatch');
        }
      )
    ).rejects.toThrow('mismatch');
    expect(session.endAndLock).not.toHaveBeenCalled();
  });
});

describe('runDeviceOperation - gate and abort', () => {
  it('rejects immediately when the gate is closed', async () => {
    const session = makeSession();
    session.closeDeviceGate();
    const fn = vi.fn(async () => undefined);

    await expect(
      session.runDeviceOperation({ label: 'closed', exclusive: true }, fn)
    ).rejects.toThrow(DISCONNECTED);
    expect(fn).not.toHaveBeenCalled();
    expect(session.endAndLock).not.toHaveBeenCalled();
  });

  it('aborts the active operation and rejects queued operations on close', async () => {
    const session = makeSession();
    const started = deferred();
    let sawAbort = false;

    const active = session.runDeviceOperation(
      { label: 'active', exclusive: false },
      async ({ signal }) => {
        started.resolve();
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            sawAbort = true;
            resolve();
          });
        });
        return 'partial';
      }
    );
    await started.promise;
    const queued = session.runDeviceOperation(
      { label: 'queued', exclusive: false },
      async () => 'never'
    );

    session.closeDeviceGate();

    await expect(active).resolves.toBe('partial');
    await expect(queued).rejects.toThrow(DISCONNECTED);
    expect(sawAbort).toBe(true);
    expect(session.store.getState().queuedOps).toBe(0);
  });

  it('normalizes an active rejection caused by gate close', async () => {
    const session = makeSession();
    const started = deferred();
    const operation = session.runDeviceOperation(
      { label: 'active', exclusive: true },
      async ({ signal }) => {
        started.resolve();
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Disposed')));
        });
      }
    );

    await started.promise;
    session.closeDeviceGate();
    await expect(operation).rejects.toThrow(DISCONNECTED);
  });
});

describe('runDeviceOperation - preemption', () => {
  it('lets an exclusive operation preempt a preemptible scan', async () => {
    const log: string[] = [];
    const session = makeSession(undefined, log);
    const scanStarted = deferred();

    const scan = session.runDeviceOperation(
      { label: 'enumerate', exclusive: false },
      async ({ signal }) => {
        scanStarted.resolve();
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            log.push('scan-break');
            resolve();
          });
        });
      }
    );
    await scanStarted.promise;

    const confirmation = session.runDeviceOperation(
      { label: 'confirm-address', exclusive: true },
      async () => {
        log.push('confirm');
      }
    );

    await Promise.all([scan, confirmation]);
    expect(log).toEqual(['scan-break', 'confirm']);
    expect(session.endAndLock).not.toHaveBeenCalled();
  });

  it('does not preempt another exclusive operation', async () => {
    const session = makeSession();
    const firstStarted = deferred();
    const release = deferred();
    let firstAborted = false;

    const first = session.runDeviceOperation(
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
    const second = session.runDeviceOperation(
      { label: 'confirm-address', exclusive: true },
      async () => undefined
    );

    release.resolve();
    await Promise.all([first, second]);
    expect(firstAborted).toBe(false);
  });
});

describe('runDeviceOperation - coalesce', () => {
  it('joins a same-label operation instead of running twice', async () => {
    const session = makeSession();
    const fn = vi.fn(async () => 'result');
    const release = deferred();

    const first = session.runDeviceOperation(
      { label: 'enumerate', exclusive: false, coalesce: true },
      async () => {
        await release.promise;
        return fn();
      }
    );
    const second = session.runDeviceOperation(
      { label: 'enumerate', exclusive: false, coalesce: true },
      async () => fn()
    );

    expect(first).toBe(second);
    release.resolve();
    await Promise.all([first, second]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not join a different label', async () => {
    const session = makeSession();
    const first = session.runDeviceOperation(
      { label: 'enumerate', exclusive: false, coalesce: true },
      async () => 1
    );
    const second = session.runDeviceOperation(
      { label: 'other', exclusive: false, coalesce: true },
      async () => 2
    );

    expect(first).not.toBe(second);
    await Promise.all([first, second]);
  });
});

describe('state machine and explicit shutdown', () => {
  it('transitions connecting -> ready and does not resurrect after close', () => {
    const session = createDeviceSession({
      endAndLock: async () => ({ success: true }),
      dispose: async () => undefined
    });

    expect(session.store.getState().status).toBe('disconnected');
    session.openDeviceGate();
    expect(session.store.getState().status).toBe('connecting');
    session.markDeviceReady();
    expect(session.store.getState().status).toBe('ready');
    session.closeDeviceGate();
    session.markDeviceReady();
    expect(session.store.getState().status).toBe('disconnected');
  });

  it('ends and locks once, then disposes, only on explicit shutdown', async () => {
    const log: string[] = [];
    const session = makeSession(undefined, log);

    await session.runDeviceOperation(
      { label: 'read-address', exclusive: true },
      async () => log.push('read-address')
    );
    expect(session.endAndLock).not.toHaveBeenCalled();

    await session.shutdownDeviceSession();
    expect(log).toEqual(['read-address', 'end-and-lock', 'dispose']);
    expect(session.endAndLock).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(session.store.getState().status).toBe('disconnected');
  });

  it('coalesces concurrent shutdown calls', async () => {
    const teardownGate = deferred();
    const session = makeSession(async () => {
      await teardownGate.promise;
      return { success: true };
    });

    const first = session.shutdownDeviceSession();
    const second = session.shutdownDeviceSession();
    expect(session.endAndLock).toHaveBeenCalledTimes(1);
    teardownGate.resolve();
    await Promise.all([first, second]);
    expect(session.endAndLock).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it('still disposes when end-and-lock fails', async () => {
    const session = makeSession(async () => {
      throw new Error('device removed');
    });

    await expect(session.shutdownDeviceSession()).resolves.toBeUndefined();
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });
});
