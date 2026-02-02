'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/lib/store';

export function DebugPanel() {
  const {
    trezorConnected,
    trezorUiRequest,
    solanaAddress,
    solanaAccounts,
    statusMessage,
    debugLogs,
    appendDebugLog,
    clearDebugLog
  } = useAppStore();
  const [mounted, setMounted] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const existing = (window as any).__vaultDebugPatched;
    if (existing) return;

    (window as any).__vaultDebugPatched = true;
    const levels: Array<keyof Console> = ['log', 'info', 'warn', 'error'];
    const originals = new Map<keyof Console, (...args: any[]) => void>();

    const format = (value: any) => {
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };

    const stamp = () => new Date().toISOString();

    levels.forEach((level) => {
      const original = console[level].bind(console);
      originals.set(level, original);
      console[level] = (...args: any[]) => {
        original(...args);
        appendDebugLog(
          `[${stamp()}] ${level.toUpperCase()} ${args.map(format).join(' ')}`
        );
      };
    });

    const onError = (event: ErrorEvent) => {
      appendDebugLog(
        `[${stamp()}] ERROR ${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`
      );
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      appendDebugLog(
        `[${stamp()}] REJECTION ${format(event.reason)}`
      );
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      levels.forEach((level) => {
        const original = originals.get(level);
        if (original) {
          console[level] = original;
        }
      });
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [appendDebugLog]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[VaultDebug] env', {
      location: typeof window !== 'undefined' ? window.location.href : 'server',
      secureContext:
        typeof window !== 'undefined' ? window.isSecureContext : false,
      userAgent:
        typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
      hasWebUSB:
        typeof navigator !== 'undefined' ? !!(navigator as any).usb : false
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[VaultDebug] trezorConnected', trezorConnected);
  }, [trezorConnected]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[VaultDebug] trezorUiRequest', trezorUiRequest);
  }, [trezorUiRequest]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[VaultDebug] solanaAddress', solanaAddress);
  }, [solanaAddress]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[VaultDebug] solanaAccounts', solanaAccounts.length);
  }, [solanaAccounts.length]);

  const logText = useMemo(() => debugLogs.join('\n'), [debugLogs]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(logText);
      setCopyLabel('Copied');
      setTimeout(() => setCopyLabel('Copy'), 1200);
    } catch {
      setCopyLabel('Failed');
      setTimeout(() => setCopyLabel('Copy'), 1200);
    }
  }, [logText]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        handleCopy();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleCopy]);

  return (
    <section className="rounded-3xl border border-amber-200/40 bg-white/80 p-5 text-xs text-steel">
      <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-amber-700">
        Debug
      </p>
      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-steel">Console log</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => clearDebugLog()}
            className="rounded-lg border border-amber-200 px-2 py-1 text-[10px] uppercase tracking-wide"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg border border-amber-200 px-2 py-1 text-[10px] uppercase tracking-wide"
            aria-keyshortcuts="Ctrl+Shift+C"
          >
            {copyLabel}
          </button>
        </div>
      </div>
      <div className="mt-2 rounded-2xl bg-ink p-3 text-[11px] text-moss">
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono">
          {logText || 'No logs yet.'}
        </pre>
      </div>
      <div className="mt-3 grid gap-1">
        <div>
          <span className="font-semibold">Secure:</span>{' '}
          {mounted && typeof window !== 'undefined' && window.isSecureContext
            ? 'yes'
            : 'no'}
        </div>
        <div>
          <span className="font-semibold">WebUSB:</span>{' '}
          {mounted &&
          typeof navigator !== 'undefined' &&
          (navigator as any).usb
            ? 'available'
            : 'missing'}
        </div>
        <div>
          <span className="font-semibold">Trezor:</span>{' '}
          {trezorConnected ? 'connected' : 'not connected'}
        </div>
        <div>
          <span className="font-semibold">UI Request:</span>{' '}
          {trezorUiRequest?.type || 'none'}
        </div>
        <div>
          <span className="font-semibold">Address:</span>{' '}
          {solanaAddress || '—'}
        </div>
        <div>
          <span className="font-semibold">Accounts:</span>{' '}
          {solanaAccounts.length}
        </div>
        {statusMessage ? (
          <div>
            <span className="font-semibold">Status:</span> {statusMessage}
          </div>
        ) : null}
      </div>
    </section>
  );
}
