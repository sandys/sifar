'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/lib/store';

export function StatusBar() {
  const { trezorConnected, wcInitialized, activeSession } = useAppStore();

  const webUsbSupported = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return !!(navigator as any).usb;
  }, []);

  return (
    <section className="rounded-3xl border border-amber-200/40 bg-white/80 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            webUsbSupported ? 'bg-moss text-white' : 'bg-black text-white'
          }`}
        >
          WebUSB {webUsbSupported ? 'Ready' : 'Unavailable'}
        </span>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            trezorConnected ? 'bg-moss text-white' : 'bg-amber-200 text-steel'
          }`}
        >
          Trezor {trezorConnected ? 'Connected' : 'Disconnected'}
        </span>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            wcInitialized ? 'bg-moss text-white' : 'bg-amber-200 text-steel'
          }`}
        >
          WalletConnect {wcInitialized ? 'Ready' : 'Offline'}
        </span>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            activeSession ? 'bg-moss text-white' : 'bg-amber-200 text-steel'
          }`}
        >
          Session {activeSession ? 'Active' : 'Idle'}
        </span>
      </div>
      {!webUsbSupported && (
        <p className="mt-3 text-xs text-ember">
          This browser does not support WebUSB. Use Chrome on Android.
        </p>
      )}
    </section>
  );
}
