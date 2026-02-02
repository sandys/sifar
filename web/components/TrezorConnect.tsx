'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  getSolanaAddresses,
  getTrezorDeviceInfo,
  requestWebUSBDevice
} from '@/lib/trezor';
import { getAllBalances } from '@/lib/solana';
import { useAppStore } from '@/lib/store';

export function TrezorConnect() {
  const setTrezorConnected = useAppStore((state) => state.setTrezorConnected);
  const setTrezorDeviceInfo = useAppStore(
    (state) => state.setTrezorDeviceInfo
  );
  const setSolanaAccounts = useAppStore((state) => state.setSolanaAccounts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setError(null);
    setLoading(true);
    try {
      await requestWebUSBDevice();
      const accounts = await getSolanaAddresses(3);
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
            tokens
          };
        })
      );

      setSolanaAccounts(accountsWithBalances);
    } catch (err: any) {
      setTrezorConnected(false);
      setError(err.message || 'Failed to connect to Trezor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="Connect Trezor">
      <p className="text-sm text-steel">
        Every visit starts fresh. Connect your Trezor via USB-OTG and verify the
        address on-device. Chrome will ask for USB access.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <Button onClick={handleConnect} disabled={loading}>
          {loading ? 'Connecting...' : 'Connect Trezor'}
        </Button>
        {error && <p className="text-xs text-ember">{error}</p>}
      </div>
    </Card>
  );
}
