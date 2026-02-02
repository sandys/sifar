'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { getSolanaAddress, getTrezorDeviceInfo, requestWebUSBDevice } from '@/lib/trezor';
import { useAppStore } from '@/lib/store';

export function TrezorUsbClient() {
  const trezorConnected = useAppStore((state) => state.trezorConnected);
  const solanaAddress = useAppStore((state) => state.solanaAddress);
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
  const [loading, setLoading] = useState(false);
  const [enumerating, setEnumerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onDeviceOnly, setOnDeviceOnly] = useState(false);
  const [progress, setProgress] = useState({ scanned: 0, found: 0 });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  useEffect(() => {
    setPassphraseOnDeviceOnly(onDeviceOnly);
    return () => setPassphraseOnDeviceOnly(false);
  }, [onDeviceOnly, setPassphraseOnDeviceOnly]);

  const connected = useMemo(
    () => trezorConnected && !!solanaAddress,
    [trezorConnected, solanaAddress]
  );

  const handleConnect = async () => {
    setError(null);
    setLoading(true);
    setEnumerating(false);
    setProgress({ scanned: 0, found: 0 });
    setStatusMessage('Connecting to Trezor…');
    try {
      await requestWebUSBDevice();
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
        const account = await getSolanaAddress(i, i === 0);
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
          setLoading(false);
          setEnumerating(true);
        }
        if (!connectedSet) {
          connectedSet = true;
          setTrezorConnected(true);
          deviceInfoPromise.then((info) => setTrezorDeviceInfo(info));
        }
        setProgress({ scanned: accounts.length, found: 0 });
      }

      setSolanaAccounts([...accounts]);
      setEnumerating(false);
      setStatusMessage('Refreshing balances…');

      const refreshBalances = async () => {
        for (let i = 0; i < accounts.length; i += 1) {
          await refreshSolanaAccountBalance(i);
          if (i < accounts.length - 1) {
            await sleep(5000);
          }
        }
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
    }
  };

  return (
    <div className="grid gap-6">
      <Card title="USB Trezor Connect">
        <p className="text-sm text-steel">
          Choose how to enter the passphrase if your Trezor requires one. The
          browser will ask for WebUSB access first.
        </p>
        <label className="mt-3 flex items-center gap-2 text-xs text-steel">
          <input
            type="checkbox"
            checked={onDeviceOnly}
            onChange={(event) => setOnDeviceOnly(event.target.checked)}
          />
          Require passphrase entry on device only
        </label>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={handleConnect} disabled={loading}>
            {loading ? 'Connecting…' : 'Connect + List'}
          </Button>
        </div>
        {loading && (
          <div className="mt-4">
            <LoadingSpinner label="Waiting for Trezor…" />
          </div>
        )}
        {!loading && enumerating && (
          <p className="mt-3 text-xs text-steel">
            Loading accounts in the background ({progress.scanned} loaded).
          </p>
        )}
        {error && <p className="mt-3 text-xs text-ember">{error}</p>}
        {connected && (
          <p className="mt-3 text-xs text-moss">Trezor connected.</p>
        )}
      </Card>
    </div>
  );
}
