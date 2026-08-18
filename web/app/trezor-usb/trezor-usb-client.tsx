'use client';

import { useMemo, useState, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import {
  disconnectTrezor,
  getSolanaAddress,
  getTrezorDeviceInfo,
  requestWebUSBDevice
} from '@/lib/trezor';
import {
  openDeviceGate,
  closeDeviceGate,
  markDeviceReady,
  runDeviceOperation,
  getDeviceSessionState,
  useDeviceStore
} from '@/lib/deviceSession';
import { useAppStore } from '@/lib/store';
import { deriveStep } from '@/lib/wizard';
import { WalletDisplay } from '@/components/WalletDisplay';
import { WalletConnectModal } from '@/components/WalletConnectModal';
import { HomeStep } from '@/components/HomeStep';
import { UnsupportedScreen } from '@/components/UnsupportedScreen';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useDebugTelemetry } from '@/lib/hooks/useDebugTelemetry';
import { ActionDisclosureSheet } from '@/components/ActionDisclosure';
import { accountDiscoveryDisclosure } from '@/lib/actionDisclosure';

const CONNECTION_TIMEOUT_MS = 60000; // 60 seconds timeout

export function TrezorUsbClient() {
  const trezorConnected = useAppStore((state) => state.trezorConnected);
  const trezorDeviceInfo = useAppStore((state) => state.trezorDeviceInfo);
  const solanaAddress = useAppStore((state) => state.solanaAddress);
  const solanaAccounts = useAppStore((state) => state.solanaAccounts);
  const accountChosen = useAppStore((state) => state.accountChosen);
  const wizardIntent = useAppStore((state) => state.wizardIntent);
  const activeSessions = useAppStore((state) => state.activeSessions);
  const setTrezorConnected = useAppStore((state) => state.setTrezorConnected);
  const setTrezorDeviceInfo = useAppStore((state) => state.setTrezorDeviceInfo);
  const setSolanaAccounts = useAppStore((state) => state.setSolanaAccounts);
  const refreshSolanaAccountBalance = useAppStore(
    (state) => state.refreshSolanaAccountBalance
  );
  const setStatusMessage = useAppStore((state) => state.setStatusMessage);
  const setStatus = useAppStore((state) => state.setStatus);
  const clearConfirmedAddresses = useAppStore(
    (state) => state.clearConfirmedAddresses
  );
  const openWalletConnectModal = useAppStore(
    (state) => state.openWalletConnectModal
  );

  // `loading` is the pre-op chooser phase (before the first address arrives);
  // enumeration progress and disconnect are owned by the deviceSession arbiter.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discoveryDisclosure, setDiscoveryDisclosure] = useState<
    'connect' | 'rescan' | null
  >(null);
  const [progress, setProgress] = useState({ scanned: 0, found: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Derived, not local: the scan's liveness is whatever the arbiter says the
  // active op is. No abortRef/stopEnumerationRef — the arbiter's AbortSignal
  // and preemption replace both.
  const enumerating = useDeviceStore(
    (s) => s.activeOp?.label === 'enumerate'
  );

  const capabilities = useCapabilities();
  // Records env + state lines for the whole session, not just while the
  // diagnostics sheet happens to be open.
  useDebugTelemetry();

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try {
      // Closes the gate synchronously (aborting any in-flight op), locks, and
      // disposes. The store still owns UI cleanup below.
      await disconnectTrezor();
    } catch {
      // Ignore disconnect errors
    }
    setTrezorConnected(false);
    setTrezorDeviceInfo(null);
    setSolanaAccounts([]);
    setLoading(false);
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
    setProgress({ scanned: 0, found: 0 });
    setStatusMessage('Connecting to Trezor…');
    // Open the gate synchronously, before any await, so device ops are
    // permitted from this click onward.
    openDeviceGate();

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
      // Never wrap this in runDeviceOperation — a queued op could push it past
      // the activation window.
      await requestWebUSBDevice();
      await enumerateAccounts();
    } catch (err: any) {
      handleConnectError(err);
    } finally {
      setLoading(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  };

  /**
   * Read the account list from the device.
   *
   * Separate from handleConnect so it can be re-run later. Firmware owns the
   * authentication lifetime, so a re-scan reuses the in-memory device session
   * unless the Trezor itself asks for PIN/passphrase again.
   */
  const enumerateAccounts = () =>
    // Preemptible: choosing an account (an exclusive op) aborts this scan.
    // coalesce joins a duplicate submit from a render-lag double-tap.
    runDeviceOperation(
      { label: 'enumerate', exclusive: false, coalesce: true },
      async ({ signal }) => {
        setStatusMessage('Fetching addresses…');

        // Fire-and-forget, and deliberately a RAW device call: it must NOT be
        // wrapped in runDeviceOperation (single-flight would deadlock). The
        // wire-level queue serializes it behind the address gets below.
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
          // Aborted by disconnect (gate close) or by preemption. Either way
          // stop and keep the accounts found so far; the arbiter maps a
          // gate-close abort to Trezor_Disconnected for the caller.
          if (signal.aborted) break;
          try {
            // Discovery is intentionally silent. The one address the user
            // selects is displayed and confirmed on-device in WalletDisplay.
            const account = await getSolanaAddress(i, false);
            if (signal.aborted) break;
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
              // First address in: device is responding.
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }
              setLoading(false);
              markDeviceReady();
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
        setStatusMessage('Refreshing balances…');

        // Fire-and-forget: RPC only, no device. Stops when the gate closes.
        const refreshBalances = async () => {
          for (let i = 0; i < accounts.length; i += 1) {
            if (getDeviceSessionState().status === 'disconnected') return;
            await refreshSolanaAccountBalance(i);
            if (i < accounts.length - 1) {
              await sleep(5000);
            }
          }
          if (getDeviceSessionState().status === 'disconnected') return;
          setStatusMessage('Ready');
        };

        refreshBalances().catch((refreshError) => {
          // eslint-disable-next-line no-console
          console.warn('[Balances] refresh failed', refreshError);
          setStatusMessage('Balance refresh failed');
        });
      }
    );

  const handleConnectError = (err: any) => {
    const message = err?.message || 'Failed to connect';

    // The user disconnected while work was still queued. That is the outcome
    // they asked for, not a failure to report.
    if (message.includes('Trezor_Disconnected')) {
      setStatusMessage(null);
      return;
    }

    // Terminal connect failure (cancelled chooser, no transport). Close the
    // gate the click opened, or it leaks open into the error state.
    closeDeviceGate();
    setTrezorConnected(false);
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
  };

  /**
   * Re-read the account list from the device.
   *
   * Drops every prior confirmation: a fresh list has to be vouched for again,
   * otherwise a remembered tick would carry over to an address this scan
   * produced rather than the one the user actually confirmed.
   */
  const handleRescan = async () => {
    // Re-entrancy guard: a scan or confirm already owns the device.
    if (getDeviceSessionState().activeOp) return;
    setError(null);
    clearConfirmedAddresses();
    setStatus('Re-scanning public accounts…');
    try {
      await enumerateAccounts();
      setStatus('Accounts re-scanned. Confirm one to use it.');
    } catch (err: any) {
      handleConnectError(err);
    }
  };

  const confirmDiscovery = () => {
    const action = discoveryDisclosure;
    setDiscoveryDisclosure(null);
    if (action === 'connect') {
      // This click remains Chrome's user gesture. handleConnect performs no
      // await before requestWebUSBDevice(), so the chooser stays permitted.
      void handleConnect();
    } else if (action === 'rescan') {
      void handleRescan();
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

          <Button
            size="lg"
            fullWidth
            onClick={() => setDiscoveryDisclosure('connect')}
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

          {enumerating && !loading && (
            <p className="text-sm text-steel">
              Loading accounts… ({progress.scanned} found)
            </p>
          )}

          {error && (
            <div className="grid gap-2 rounded-2xl border border-red-300 bg-red-50 p-4">
              <p className="text-sm text-ink">{error}</p>
              {/* A button, never an auto-retry: requestDevice() must run inside
                  a real user gesture. */}
              <Button
                variant="ghost"
                onClick={() => setDiscoveryDisclosure('connect')}
              >
                Try again
              </Button>
            </div>
          )}
        </section>

        <ActionDisclosureSheet
          open={discoveryDisclosure === 'connect'}
          disclosure={accountDiscoveryDisclosure(false)}
          onConfirm={confirmDiscovery}
          onCancel={() => setDiscoveryDisclosure(null)}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {brand}

      {step === 'accounts' && (
        <WalletDisplay onRescan={() => setDiscoveryDisclosure('rescan')} />
      )}
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

      <ActionDisclosureSheet
        open={discoveryDisclosure === 'rescan'}
        disclosure={accountDiscoveryDisclosure(true)}
        onConfirm={confirmDiscovery}
        onCancel={() => setDiscoveryDisclosure(null)}
      />
    </div>
  );
}
