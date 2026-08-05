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
  const appendDebugLog = useAppStore((state) => state.appendDebugLog);
  const clearDebugLog = useAppStore((state) => state.clearDebugLog);
  const [mounted, setMounted] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const buffer = (window as any).__sifarLogBuffer;
    if (Array.isArray(buffer) && buffer.length && debugLogs.length === 0) {
      buffer.forEach((line: string) => appendDebugLog(line));
    }
  }, [appendDebugLog, debugLogs.length]);

  useEffect(() => {
    appendDebugLog(
      `[Env] ${typeof window !== 'undefined' ? window.location.href : 'server'}`
    );
    appendDebugLog(
      `[Env] secureContext=${typeof window !== 'undefined' ? window.isSecureContext : false}`
    );
    appendDebugLog(
      `[Env] userAgent=${typeof navigator !== 'undefined' ? navigator.userAgent : 'server'}`
    );
    appendDebugLog(
      `[Env] webusb=${typeof navigator !== 'undefined' && (navigator as any).usb ? 'available' : 'missing'}`
    );
  }, [appendDebugLog]);

  useEffect(() => {
    appendDebugLog(`[State] trezorConnected=${trezorConnected}`);
  }, [appendDebugLog, trezorConnected]);

  useEffect(() => {
    appendDebugLog(
      `[State] trezorUiRequest=${trezorUiRequest?.type || 'none'}`
    );
  }, [appendDebugLog, trezorUiRequest]);

  useEffect(() => {
    appendDebugLog(`[State] solanaAddress=${solanaAddress || '—'}`);
  }, [appendDebugLog, solanaAddress]);

  useEffect(() => {
    appendDebugLog(`[State] solanaAccounts=${solanaAccounts.length}`);
  }, [appendDebugLog, solanaAccounts.length]);

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
