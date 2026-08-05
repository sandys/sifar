'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import {
  getSolanaAddresses,
  getTrezorDeviceInfo,
  requestWebUSBDevice,
  disconnectTrezor
} from '@/lib/trezor';
import { getAllBalances } from '@/lib/solana';
import { useAppStore } from '@/lib/store';

const CONNECTION_TIMEOUT_MS = 60000;

export function TrezorConnect() {
  const trezorConnected = useAppStore((state) => state.trezorConnected);
  const trezorDeviceInfo = useAppStore((state) => state.trezorDeviceInfo);
  const setTrezorConnected = useAppStore((state) => state.setTrezorConnected);
  const setTrezorDeviceInfo = useAppStore(
    (state) => state.setTrezorDeviceInfo
  );
  const setSolanaAccounts = useAppStore((state) => state.setSolanaAccounts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef(false);

  const handleDisconnect = async () => {
    abortRef.current = true;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try {
      await disconnectTrezor();
    } catch {
      // Ignore disconnect errors
    }
    setTrezorConnected(false);
    setTrezorDeviceInfo(null);
    setSolanaAccounts([]);
    setLoading(false);
    setError(null);
  };

  const handleConnect = async () => {
    setError(null);
    setLoading(true);
    abortRef.current = false;

    // Reads live state: the captured `loading` is always false at click time,
    // so the old condition could never fire.
    timeoutRef.current = setTimeout(() => {
      if (!useAppStore.getState().trezorConnected) {
        setError('Connection timed out. Device may be unresponsive. Try unplugging and reconnecting.');
        handleDisconnect();
      }
    }, CONNECTION_TIMEOUT_MS);

    try {
      await requestWebUSBDevice();
      if (abortRef.current) return;

      const accounts = await getSolanaAddresses(3);
      if (abortRef.current) return;

      // Clear timeout once we get addresses
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      const info = await getTrezorDeviceInfo();
      setTrezorConnected(true);
      setTrezorDeviceInfo(info);

      const accountsWithBalances = await Promise.all(
        accounts.map(async (account) => {
          const { sol, tokens } = await getAllBalances(account.address);
          return {
            address: account.address,
            path: account.path,
            balance: sol,
            tokens,
            balanceStatus: 'ok' as const,
            balanceError: null
          };
        })
      );

      setSolanaAccounts(accountsWithBalances);
    } catch (err: any) {
      setTrezorConnected(false);
      setError(err.message || 'Failed to connect to Trezor');
    } finally {
      setLoading(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  };

  return (
    <section className="rounded-3xl border border-amber-200/40 bg-white/70 p-6 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.6)]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-rakkas text-5xl tracking-wide text-ink">
            Sifar
          </h1>
          <p className="mt-1 font-aref text-lg text-amber-700">
            Zero. This wallet does nothing.
          </p>
        </div>
        <div className="rounded-full bg-ember px-3 py-1 text-xs font-semibold text-white">
          Android + Chrome
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-steel">
        Your Trezor does everything. Connect via USB-OTG, then scan a WalletConnect
        QR. No keys, no storage, no trust required.
      </p>
      <div className="mt-4 flex items-center gap-3">
        {trezorConnected ? (
          <button
            onClick={handleDisconnect}
            className="rounded-xl border-2 border-red-400 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-100"
          >
            Disconnect Trezor
          </button>
        ) : (
          <Button onClick={handleConnect} disabled={loading}>
            {loading ? 'Connecting…' : 'Connect Trezor'}
          </Button>
        )}
        {loading && (
          <button
            onClick={handleDisconnect}
            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-100"
          >
            Cancel
          </button>
        )}
      </div>
      {loading && (
        <div className="mt-4">
          <LoadingSpinner label="Waiting for Trezor…" />
        </div>
      )}
      {error && <p className="mt-3 text-xs text-ember">{error}</p>}
      {trezorConnected && trezorDeviceInfo && (
        <div className="mt-3 rounded-xl border border-moss/30 bg-moss/10 p-3">
          <p className="text-xs font-semibold text-moss">Connected</p>
          <div className="mt-2 grid gap-1 text-xs text-steel">
            <div><span className="font-medium">Device:</span> {trezorDeviceInfo.label}</div>
            <div><span className="font-medium">Model:</span> {trezorDeviceInfo.model}</div>
            <div><span className="font-medium">Firmware:</span> {trezorDeviceInfo.firmwareVersion}</div>
          </div>
        </div>
      )}
    </section>
  );
}
