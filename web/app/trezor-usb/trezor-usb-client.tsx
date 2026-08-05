'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import {
  disconnectTrezor,
  getSolanaAddress,
  getTrezorDeviceInfo,
  requestWebUSBDevice
} from '@/lib/trezor';
import { useAppStore } from '@/lib/store';

const CONNECTION_TIMEOUT_MS = 60000; // 60 seconds timeout

export function TrezorUsbClient() {
  const trezorConnected = useAppStore((state) => state.trezorConnected);
  const trezorDeviceInfo = useAppStore((state) => state.trezorDeviceInfo);
  const solanaAddress = useAppStore((state) => state.solanaAddress);
  const activeAccountIndex = useAppStore((state) => state.activeAccountIndex);
  const setPassphraseOnDeviceOnly = useAppStore(
    (state) => state.setPassphraseOnDeviceOnly
  );
  const setTrezorConnected = useAppStore((state) => state.setTrezorConnected);
  const setTrezorDeviceInfo = useAppStore(
    (state) => state.setTrezorDeviceInfo
  );
  const setSolanaAccounts = useAppStore((state) => state.setSolanaAccounts);
  const refreshSolanaAccountBalance = useAppStore(
    (state) => state.refreshSolanaAccountBalance
  );
  const setStatusMessage = useAppStore((state) => state.setStatusMessage);
  const openWalletConnectModal = useAppStore(
    (state) => state.openWalletConnectModal
  );
  const [loading, setLoading] = useState(false);
  const [enumerating, setEnumerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onDeviceOnly, setOnDeviceOnly] = useState(false);
  const [progress, setProgress] = useState({ scanned: 0, found: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef(false);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  useEffect(() => {
    setPassphraseOnDeviceOnly(onDeviceOnly);
    return () => setPassphraseOnDeviceOnly(false);
  }, [onDeviceOnly, setPassphraseOnDeviceOnly]);

  const connected = useMemo(
    () => trezorConnected && !!solanaAddress,
    [trezorConnected, solanaAddress]
  );

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
    setEnumerating(false);
    setError(null);
    setStatusMessage(null);
  };

  const handleConnect = async () => {
    setError(null);
    setLoading(true);
    setEnumerating(false);
    setProgress({ scanned: 0, found: 0 });
    setStatusMessage('Connecting to Trezor…');
    abortRef.current = false;

    // Set timeout for connection.
    // Reads live state rather than the `loading`/`trezorConnected` values
    // captured when this handler was created — those are always false at click
    // time, which made the watchdog a no-op.
    timeoutRef.current = setTimeout(() => {
      if (!useAppStore.getState().trezorConnected) {
        setError('Connection timed out. Device may be unresponsive. Try unplugging and reconnecting.');
        handleDisconnect();
      }
    }, CONNECTION_TIMEOUT_MS);

    try {
      await requestWebUSBDevice();
      if (abortRef.current) return;
      setStatusMessage('Fetching addresses…');

      const deviceInfoPromise = getTrezorDeviceInfo().catch(() => null);

      const accounts: Array<{
        address: string;
        path: string;
        balance: number | null;
        tokens: any[];
        balanceStatus: 'loading' | 'ok' | 'error';
        balanceError?: string | null;
      }> = [];

      const MAX_ACCOUNTS = 200;
      let connectedSet = false;
      for (let i = 0; i < MAX_ACCOUNTS; i += 1) {
        if (abortRef.current) return;
        try {
          const account = await getSolanaAddress(i, i === 0);
          if (abortRef.current) return;
          const accountEntry = {
            address: account.address,
            path: account.path,
            balance: null,
            tokens: [],
            balanceStatus: 'loading' as const,
            balanceError: null
          };
          accounts.push(accountEntry);
          setSolanaAccounts([...accounts]);
          if (i === 0) {
            // Clear timeout once we get first address - device is responding
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            setLoading(false);
            setEnumerating(true);
          }
          if (!connectedSet) {
            connectedSet = true;
            setTrezorConnected(true);
            deviceInfoPromise.then((info) => setTrezorDeviceInfo(info));
          }
          setProgress({ scanned: accounts.length, found: 0 });
        } catch (err: any) {
          const message = err?.message || '';
          if (message.includes('Forbidden key path')) {
            setStatusMessage('Reached end of supported Solana accounts.');
            break;
          }
          throw err;
        }
      }

      setSolanaAccounts([...accounts]);
      setEnumerating(false);
      setStatusMessage('Refreshing balances…');

      const refreshBalances = async () => {
        for (let i = 0; i < accounts.length; i += 1) {
          // Bail on disconnect: this loop runs for minutes across many
          // accounts, and a second one starting on reconnect would double the
          // RPC rate and race the first one's writes.
          if (abortRef.current) return;
          await refreshSolanaAccountBalance(i);
          if (i < accounts.length - 1) {
            await sleep(5000);
          }
        }
        if (abortRef.current) return;
        setStatusMessage('Ready');
      };

      refreshBalances().catch((refreshError) => {
        // eslint-disable-next-line no-console
        console.warn('[Balances] refresh failed', refreshError);
        setStatusMessage('Balance refresh failed');
      });
    } catch (err: any) {
      setTrezorConnected(false);
      const message = err?.message || 'Failed to connect';
      if (message.includes('No device selected')) {
        setError(
          'No device selected. Unlock your Trezor, then choose it in the Chrome USB prompt.'
        );
      } else if (message.includes('Transport_Missing')) {
        setError(
          'No Trezor detected. Make sure it is connected and unlocked before trying again.'
        );
      } else {
        setError(message);
      }
      setStatusMessage(null);
      setEnumerating(false);
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
      <h1 className="font-rakkas text-5xl tracking-wide text-ink">
        Sifar
      </h1>
      <p className="mt-1 font-aref text-lg text-amber-700">
        Zero. Your Trezor does everything.
      </p>
      <p className="mt-4 text-sm text-steel">
        Connect via USB-OTG, then Sifar steps aside. Passphrase entry happens on
        your device. Nothing is stored, nothing is trusted.
      </p>
        <label className="mt-3 flex items-center gap-2 text-xs text-steel">
          <input
            type="checkbox"
            checked={onDeviceOnly}
            onChange={(event) => setOnDeviceOnly(event.target.checked)}
          />
          Enter passphrase on device only
        </label>
        <div className="mt-4 flex items-center gap-3">
          {connected ? (
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
            <p className="mt-2 text-xs text-steel">
              Timeout in {Math.round(CONNECTION_TIMEOUT_MS / 1000)}s if device doesn&apos;t respond.
            </p>
          </div>
        )}
        {!loading && enumerating && (
          <p className="mt-3 text-xs text-steel">
            Loading accounts in the background ({progress.scanned} loaded).
          </p>
        )}
        {error && <p className="mt-3 text-xs text-ember">{error}</p>}
        {connected && trezorDeviceInfo && (
          <div className="mt-3 rounded-xl border border-moss/30 bg-moss/10 p-3">
            <p className="text-xs font-semibold text-moss">Connected</p>
            <div className="mt-2 grid gap-1 text-xs text-steel">
              <div><span className="font-medium">Device:</span> {trezorDeviceInfo.label}</div>
              <div><span className="font-medium">Model:</span> {trezorDeviceInfo.model}</div>
              <div><span className="font-medium">Firmware:</span> {trezorDeviceInfo.firmwareVersion}</div>
            </div>
          </div>
        )}
        {connected && !trezorDeviceInfo && (
          <p className="mt-3 text-xs text-moss">Trezor connected.</p>
        )}
        {connected && (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/70 p-3">
            <p className="text-xs font-semibold text-blue-800">
              Sign a WalletConnect request
            </p>
            <p className="mt-1 text-[11px] text-steel">
              Select a WalletConnect URI or QR for the active account. Pairing
              and session approval do not sign anything. Your Trezor asks for
              physical confirmation only when the dApp sends a transaction or
              message signing request.
            </p>
            <button
              type="button"
              onClick={() => openWalletConnectModal(activeAccountIndex)}
              className="mt-3 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 transition hover:bg-blue-100"
            >
              Open WalletConnect
            </button>
          </div>
        )}
    </section>
  );
}
