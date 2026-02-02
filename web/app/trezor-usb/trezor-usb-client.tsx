'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { getAllBalances } from '@/lib/solana';
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
  const updateSolanaAccount = useAppStore((state) => state.updateSolanaAccount);
  const setStatusMessage = useAppStore((state) => state.setStatusMessage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onDeviceOnly, setOnDeviceOnly] = useState(false);
  const [progress, setProgress] = useState({ scanned: 0, found: 0 });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const getBalancesWithRetry = async (address: string) => {
    const MAX_RETRIES = 3;
    let delay = 500;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        return await getAllBalances(address);
      } catch (err: any) {
        const message = err?.message || String(err);
        if (message.includes('429') || message.includes('Too Many Requests')) {
          await sleep(delay);
          delay *= 2;
          continue;
        }
        throw err;
      }
    }
    throw new Error('RPC rate limited');
  };

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
    setProgress({ scanned: 0, found: 0 });
    setStatusMessage('Connecting to Trezor…');
    try {
      await requestWebUSBDevice();
      setStatusMessage('Fetching accounts…');

      const accounts: Array<{
        address: string;
        path: string;
        balance: number | null;
        tokens: any[];
        balanceStatus: 'loading' | 'ok' | 'error';
        balanceError?: string | null;
      }> = [];

      const GAP_LIMIT = 10;
      const BATCH_SIZE = 5;
      const MAX_ACCOUNTS = 200;
      let consecutiveEmpty = 0;
      let index = 0;
      let found = 0;

      while (index < MAX_ACCOUNTS && consecutiveEmpty < GAP_LIMIT) {
        const batch = Array.from({ length: BATCH_SIZE })
          .map((_, i) => index + i)
          .filter((i) => i < MAX_ACCOUNTS);
        if (batch.length === 0) break;

        const batchAddresses = [];
        for (const i of batch) {
          batchAddresses.push(await getSolanaAddress(i, i === 0));
        }

        for (const account of batchAddresses) {
          const accountIndex = accounts.length;
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
          setProgress({ scanned: accounts.length, found });
          setStatusMessage(`Scanned ${accounts.length} accounts`);

          try {
            const { sol, tokens } = await getBalancesWithRetry(account.address);
            updateSolanaAccount(accountIndex, {
              balance: sol,
              tokens,
              balanceStatus: 'ok',
              balanceError: null
            });
            const hasBalance = sol > 0 || tokens.length > 0;
            if (hasBalance) {
              consecutiveEmpty = 0;
              found += 1;
            } else {
              consecutiveEmpty += 1;
            }
          } catch (err: any) {
            updateSolanaAccount(accountIndex, {
              balance: null,
              tokens: [],
              balanceStatus: 'error',
              balanceError: err?.message || 'Balance failed'
            });
            consecutiveEmpty += 1;
          }

          setProgress({ scanned: accounts.length, found });
          await sleep(250);
        }

        index += batch.length;
      }

      const info = await getTrezorDeviceInfo();
      setTrezorConnected(true);
      setTrezorDeviceInfo(info);
      setSolanaAccounts([...accounts]);
      setStatusMessage('Ready');
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
            <LoadingSpinner
              label={`Scanning accounts (${progress.scanned} scanned)`}
            />
          </div>
        )}
        {error && <p className="mt-3 text-xs text-ember">{error}</p>}
        {connected && (
          <p className="mt-3 text-xs text-moss">Trezor connected.</p>
        )}
      </Card>
    </div>
  );
}
