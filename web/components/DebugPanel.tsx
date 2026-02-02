'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';

export function DebugPanel() {
  const {
    trezorConnected,
    trezorUiRequest,
    solanaAddress,
    solanaAccounts,
    statusMessage
  } = useAppStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  return (
    <section className="rounded-3xl border border-amber-200/40 bg-white/80 p-5 text-xs text-steel">
      <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-amber-700">
        Debug
      </p>
      <div className="mt-2 grid gap-1">
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
