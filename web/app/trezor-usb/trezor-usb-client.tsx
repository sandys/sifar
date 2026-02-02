'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getAllBalances } from '@/lib/solana';
import {
  getSolanaAddresses,
  getTrezorDeviceInfo,
  requestWebUSBDevice
} from '@/lib/trezor';
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
  const [count, setCount] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onDeviceOnly, setOnDeviceOnly] = useState(false);

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
    try {
      await requestWebUSBDevice();
      const accounts = await getSolanaAddresses(count);
      const info = await getTrezorDeviceInfo();

      const accountsWithBalances = await Promise.all(
        accounts.map(async (account) => {
          const { sol, tokens } = await getAllBalances(account.address);
          return {
            address: account.address,
            path: account.path,
            balance: sol,
            tokens
          };
        })
      );

      setTrezorConnected(true);
      setTrezorDeviceInfo(info);
      setSolanaAccounts(accountsWithBalances);
    } catch (err: any) {
      setTrezorConnected(false);
      setError(err.message || 'Failed to connect');
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
          <label className="text-sm text-steel">
            Accounts
            <input
              className="ml-2 w-20 rounded-lg border border-amber-200 px-2 py-1"
              type="number"
              min={1}
              max={10}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </label>
          <Button onClick={handleConnect} disabled={loading}>
            {loading ? 'Connecting…' : 'Connect + List'}
          </Button>
        </div>
        {error && <p className="mt-3 text-xs text-ember">{error}</p>}
        {connected && (
          <p className="mt-3 text-xs text-moss">Trezor connected.</p>
        )}
      </Card>
    </div>
  );
}
