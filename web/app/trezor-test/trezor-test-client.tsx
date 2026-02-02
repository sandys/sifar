'use client';

import { useRef, useState } from 'react';
import { Buffer } from 'buffer';
import TrezorConnect from '@/lib/trezorConnect';
import { Button } from '@/components/ui/Button';

function ensureBuffer() {
  if (typeof globalThis.Buffer === 'undefined') {
    globalThis.Buffer = Buffer;
  }
}

function base58Like(address: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

export function TrezorTestClient() {
  const initialized = useRef(false);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const [status, setStatus] = useState('Idle');
  const [error, setError] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [startIndex, setStartIndex] = useState(0);
  const [count, setCount] = useState(3);

  const init = async () => {
    if (initPromiseRef.current) return initPromiseRef.current;

    initPromiseRef.current = (async () => {
      if (initialized.current) return;
      ensureBuffer();
      setStatus('Initializing Trezor Connect');
      setError(null);

      await TrezorConnect.init({
        manifest: {
          email: 'dev@vaultbridge.io',
          appUrl: 'http://localhost:3000'
        },
        debug: true
      });

      await TrezorConnect.requestWebUSBDevice();

      initialized.current = true;
      setStatus('Initialized');
    })();

    try {
      await initPromiseRef.current;
    } catch (err) {
      initPromiseRef.current = null;
      throw err;
    }
  };

  const fetchAddresses = async () => {
    try {
      await init();
      setStatus('Fetching addresses');
      setError(null);
      const results: string[] = [];

      for (let i = 0; i < count; i += 1) {
        const index = startIndex + i;
        const path = `m/44'/501'/${index}'/0'`;
        const result = await TrezorConnect.solanaGetAddress({
          path,
          showOnTrezor: false
        });

        if (!result.success) {
          throw new Error(result.payload.error || 'Trezor error');
        }

        const address = result.payload.address;
        if (!base58Like(address)) {
          throw new Error('Invalid address format');
        }
        results.push(address);
      }

      setAddresses(results);
      setStatus('Fetched');
    } catch (err: any) {
      setStatus('Error');
      setError(err.message || 'Failed');
    }
  };

  return (
    <section className="rounded-3xl border border-amber-200/40 bg-white/80 p-5">
      <p className="text-sm text-steel">
        WebUSB-only test harness (manual device access required).
      </p>
      <div className="mt-3 flex items-center gap-3">
        <label className="text-sm text-steel">
          Start index
          <input
            data-testid="start-index"
            type="number"
            value={startIndex}
            onChange={(event) => setStartIndex(Number(event.target.value))}
            className="ml-2 w-20 rounded-lg border border-amber-200 px-2 py-1"
          />
        </label>
        <label className="text-sm text-steel">
          Count
          <input
            data-testid="count"
            type="number"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            className="ml-2 w-16 rounded-lg border border-amber-200 px-2 py-1"
          />
        </label>
      </div>
      <div className="mt-4 flex gap-3">
        <Button data-testid="init" onClick={init}>
          Init
        </Button>
        <Button data-testid="fetch" onClick={fetchAddresses} variant="ghost">
          Fetch Addresses
        </Button>
      </div>
      <p data-testid="status" className="mt-4 text-xs text-steel">
        {status}
      </p>
      {error && (
        <p data-testid="error" className="text-xs text-ember">
          {error}
        </p>
      )}
      <div className="mt-4 grid gap-2">
        {addresses.map((address) => (
          <div
            key={address}
            data-testid="address-item"
            className="rounded-xl border border-amber-100 bg-white px-3 py-2 font-mono text-xs"
          >
            {address}
          </div>
        ))}
      </div>
    </section>
  );
}
