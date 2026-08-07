'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';

/**
 * Records environment and state-change lines into the debug log.
 *
 * Lives in a hook called from the always-mounted shell rather than inside
 * DebugPanel. The panel is now a sheet the user opens *after* something goes
 * wrong, so effects living there would only start recording once the incident
 * was over — losing exactly the connect-time lines needed to diagnose it.
 */
export function useDebugTelemetry() {
  const appendDebugLog = useAppStore((state) => state.appendDebugLog);
  const trezorConnected = useAppStore((state) => state.trezorConnected);
  const trezorUiRequest = useAppStore((state) => state.trezorUiRequest);
  const solanaAddress = useAppStore((state) => state.solanaAddress);
  const accountCount = useAppStore((state) => state.solanaAccounts.length);

  // Replay anything the console patch buffered before this mounted — once.
  const replayed = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || replayed.current) return;
    replayed.current = true;
    const buffer = (window as any).__sifarLogBuffer;
    if (Array.isArray(buffer) && buffer.length) {
      buffer.forEach((line: string) => appendDebugLog(line));
    }
  }, [appendDebugLog]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    appendDebugLog(`[Env] ${window.location.href}`);
    appendDebugLog(`[Env] secureContext=${window.isSecureContext}`);
    appendDebugLog(`[Env] userAgent=${navigator.userAgent}`);
    appendDebugLog(
      `[Env] webusb=${(navigator as any).usb ? 'available' : 'missing'}`
    );
    appendDebugLog(
      `[Env] camera=${navigator.mediaDevices ? 'available' : 'missing'}`
    );
  }, [appendDebugLog]);

  useEffect(() => {
    appendDebugLog(`[State] trezorConnected=${trezorConnected}`);
  }, [appendDebugLog, trezorConnected]);

  useEffect(() => {
    appendDebugLog(`[State] trezorUiRequest=${trezorUiRequest?.type || 'none'}`);
  }, [appendDebugLog, trezorUiRequest]);

  useEffect(() => {
    appendDebugLog(`[State] solanaAddress=${solanaAddress || '—'}`);
  }, [appendDebugLog, solanaAddress]);

  useEffect(() => {
    appendDebugLog(`[State] solanaAccounts=${accountCount}`);
  }, [appendDebugLog, accountCount]);
}
