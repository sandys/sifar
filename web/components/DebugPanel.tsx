'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/lib/store';

export function DebugPanel() {
  const trezorConnected = useAppStore((state) => state.trezorConnected);
  const trezorUiRequest = useAppStore((state) => state.trezorUiRequest);
  const solanaAddress = useAppStore((state) => state.solanaAddress);
  const solanaAccounts = useAppStore((state) => state.solanaAccounts);
  const statusMessage = useAppStore((state) => state.statusMessage);
  const debugLogs = useAppStore((state) => state.debugLogs);
  const clearDebugLog = useAppStore((state) => state.clearDebugLog);
  const [mounted, setMounted] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy');

  useEffect(() => {
    setMounted(true);
  }, []);

  // Telemetry now lives in lib/hooks/useDebugTelemetry.ts, called from the
  // always-mounted shell. This panel only displays what was already recorded,
  // so opening it after a failure still shows the lines from before it.
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
      <p className="font-aref text-lg text-amber-700">
        Debug
      </p>
      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-steel">Console log</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              // Also drop the window buffer, or a later remount replays
              // everything the user just cleared.
              if (typeof window !== 'undefined') {
                const buffer = (window as any).__sifarLogBuffer;
                if (Array.isArray(buffer)) buffer.length = 0;
              }
              clearDebugLog();
            }}
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
