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
import { deriveStep } from '@/lib/wizard';
import { WalletDisplay } from '@/components/WalletDisplay';
import { WalletConnectModal } from '@/components/WalletConnectModal';
import { HomeStep } from '@/components/HomeStep';
import { UnsupportedScreen } from '@/components/UnsupportedScreen';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useDebugTelemetry } from '@/lib/hooks/useDebugTelemetry';

const CONNECTION_TIMEOUT_MS = 60000; // 60 seconds timeout

export function TrezorUsbClient() {
  const trezorConnected = useAppStore((state) => state.trezorConnected);
  const trezorDeviceInfo = useAppStore((state) => state.trezorDeviceInfo);
  const solanaAddress = useAppStore((state) => state.solanaAddress);
  const solanaAccounts = useAppStore((state) => state.solanaAccounts);
  const accountChosen = useAppStore((state) => state.accountChosen);
  const wizardIntent = useAppStore((state) => state.wizardIntent);
  const activeSessions = useAppStore((state) => state.activeSessions);
  const setPassphraseOnDeviceOnly = useAppStore(
    (state) => state.setPassphraseOnDeviceOnly
  );
  const setTrezorConnected = useAppStore((state) => state.setTrezorConnected);
  const setTrezorDeviceInfo = useAppStore((state) => state.setTrezorDeviceInfo);
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

  const capabilities = useCapabilities();
  // Records env + state lines for the whole session, not just while the
  // diagnostics sheet happens to be open.
  useDebugTelemetry();

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  useEffect(() => {
    setPassphraseOnDeviceOnly(onDeviceOnly);
    return () => setPassphraseOnDeviceOnly(false);
  }, [onDeviceOnly, setPassphraseOnDeviceOnly]);

  const step = useMemo(
    () =>
      deriveStep({
        trezorConnected,
        accountCount: solanaAccounts.length,
        accountChosen,
        solanaAddress,
        linkedAddresses: activeSessions.map((s) => s.walletAddress),
        wizardIntent
      }),
    [
      trezorConnected,
      solanaAccounts.length,
      accountChosen,
      solanaAddress,
      activeSessions,
      wizardIntent
    ]
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

  // Distinct from handleDisconnect: this aborts a connect attempt that has not
  // succeeded yet, so it reads as "Cancel" and is styled as a secondary action.
  // Disconnecting an established device is a loud, primary-weight action and
  // lives on Home.
  const handleCancelConnect = handleDisconnect;

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
      // Must stay the first await in this handler: Chrome requires
      // requestDevice() to run inside the click's user-activation window.
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

  // Branding lives in this component rather than in page.tsx: the lint forbids
  // a large standalone <header> in a page file.
  const brand = (
    <header className="text-center">
      <h1 className="font-rakkas text-4xl leading-none text-ink">Sifar</h1>
      <p className="mt-1 font-aref text-base text-steel">
        Zero. Your Trezor does everything.
      </p>
    </header>
  );

  if (capabilities.hydrated && !capabilities.canSign) {
    return (
      <div className="grid gap-6">
        {brand}
        <UnsupportedScreen capabilities={capabilities} />
      </div>
    );
  }

  if (step === 'connect') {
    return (
      <div className="grid gap-6">
        {brand}
        <section className="grid gap-4 rounded-3xl border border-amber-200/50 bg-white/70 p-5">
          <p className="text-base text-steel">
            Connect your Trezor over USB-OTG. Sifar never sees a key — the
            device signs everything.
          </p>

          <label className="flex min-h-[48px] items-center gap-3 text-base text-steel">
            <input
              type="checkbox"
              checked={onDeviceOnly}
              onChange={(event) => setOnDeviceOnly(event.target.checked)}
              className="h-6 w-6 rounded border-amber-300"
            />
            Enter passphrase on device only
          </label>

          <Button
            size="lg"
            fullWidth
            onClick={handleConnect}
            disabled={loading || !capabilities.hydrated}
          >
            {loading ? 'Connecting…' : 'Connect Trezor'}
          </Button>

          {loading && (
            <>
              <LoadingSpinner label="Waiting for Trezor…" />
              <p className="text-sm text-steel">
                Times out after 60s if the device does not respond.
              </p>
              <Button variant="ghost" fullWidth onClick={handleCancelConnect}>
                Cancel
              </Button>
            </>
          )}

          {enumerating && (
            <p className="text-sm text-steel">
              Loading accounts… ({progress.scanned} found)
            </p>
          )}

          {error && (
            <div className="grid gap-2 rounded-2xl border border-red-300 bg-red-50 p-4">
              <p className="text-sm text-ink">{error}</p>
              {/* A button, never an auto-retry: requestDevice() must run inside
                  a real user gesture. */}
              <Button variant="ghost" onClick={handleConnect}>
                Try again
              </Button>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {brand}

      {step === 'accounts' && <WalletDisplay />}
      {step === 'link' && <WalletConnectModal />}
      {step === 'home' && (
        <HomeStep
          deviceInfo={trezorDeviceInfo}
          linkLabel="Open WalletConnect"
          onLinkAnother={() =>
            openWalletConnectModal(useAppStore.getState().activeAccountIndex)
          }
          onDisconnect={handleDisconnect}
        />
      )}
    </div>
  );
}
