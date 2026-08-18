'use client';

import { useState, type ClipboardEvent } from 'react';
import { pairWithDApp, setWalletConnectProjectId } from '@/lib/walletconnect';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { QrScanner } from '@/components/QrScanner';
import { decodeQrFromBlob, imageFromClipboard } from '@/lib/qrDecode';
import { shortenAddress } from '@/lib/format';
import {
  getSafeWalletConnectUriLog,
  parseWalletConnectUri,
  type WalletConnectUriInfo
} from '@/lib/walletConnectUri';
import { ActionDisclosureSheet } from '@/components/ActionDisclosure';
import { walletConnectPairingDisclosure } from '@/lib/actionDisclosure';

/**
 * Link step: connect this account to a dApp.
 *
 * Previously this file was a 1,029-line modal that rendered eight screens at
 * once. It is now just the linking surface; proposals, signing, sessions and
 * the event log moved to their own sheets and to Home.
 */
export function WalletConnectModal() {
  const account = useAppStore((state) => {
    const index = state.activeAccountIndex;
    return state.solanaAccounts[index] ?? null;
  });
  const wcProjectId = useAppStore((state) => state.wcProjectId);
  const setWcProjectId = useAppStore((state) => state.setWcProjectId);
  const setStatus = useAppStore((state) => state.setStatus);
  const addWcEvent = useAppStore((state) => state.addWcEvent);
  const setWizardIntent = useAppStore((state) => state.setWizardIntent);
  const hasSessions = useAppStore((state) =>
    state.activeSessions.some((s) => s.walletAddress === state.solanaAddress)
  );

  const [scannerOpen, setScannerOpen] = useState(false);
  const [wcUri, setWcUri] = useState('');
  const [projectIdInput, setProjectIdInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPairing, setPendingPairing] = useState<{
    uri: string;
    info: WalletConnectUriInfo;
  } | null>(null);

  const preparePairing = (uri: string) => {
    const trimmed = uri.trim();
    if (!trimmed) return false;

    const parsed = (() => {
      try {
        return parseWalletConnectUri(trimmed);
      } catch (err: any) {
        setError(err?.message || 'That is not a valid WalletConnect link.');
        return null;
      }
    })();
    if (!parsed) return false;

    setError(null);
    // Do not retain or repeat a pairing secret once validation succeeds. The
    // pending value stays only in this component until confirm/cancel.
    setWcUri('');
    setPendingPairing({ uri: trimmed, info: parsed });
    return true;
  };

  const pair = async (uri: string, parsed: WalletConnectUriInfo) => {
    setPendingPairing(null);

    setError(null);
    setBusy(true);
    setStatus('Pairing with dApp…');
    addWcEvent({
      type: 'pairing_started',
      details: `Pairing ${JSON.stringify(getSafeWalletConnectUriLog(parsed))}`
    });

    try {
      await pairWithDApp(uri);
      setWcUri('');
      setStatus('Paired. Waiting for the dApp to send a proposal…');
      return true;
    } catch (err: any) {
      setError(err?.message || 'Pairing failed.');
      setStatus(null);
      addWcEvent({
        type: 'error',
        details: `Pairing failed: ${err?.message || 'Unknown error'}`
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Returning false keeps the camera running on a non-WalletConnect code.
  const onScanned = (value: string) => {
    if (!value.startsWith('wc:')) return false;
    const valid = preparePairing(value);
    if (valid) setScannerOpen(false);
    return valid;
  };

  const onPasteImage = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = imageFromClipboard(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    setBusy(true);
    setStatus('Decoding QR image…');
    try {
      const value = await decodeQrFromBlob(file);
      if (!value) throw new Error('No QR code found in that image.');
      preparePairing(value);
    } catch (err: any) {
      setError(err?.message || 'Could not read that image.');
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  if (!account) return null;

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">
          Link a dApp
        </h2>
        <p className="mt-1 text-sm text-steel">
          Open the dApp on your computer, choose WalletConnect, then scan its QR
          code.
        </p>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-white/70 px-4 py-3">
        <p className="text-xs uppercase tracking-[0.2em] text-steel">
          Linking as
        </p>
        <p className="mt-1 font-mono text-base text-ink">
          {shortenAddress(account.address, 8, 8)}
        </p>
        <button
          type="button"
          onClick={() => setWizardIntent('accounts')}
          className="mt-1 min-h-[44px] text-sm font-semibold text-ember underline"
        >
          Change account
        </button>
      </div>

      {!wcProjectId ? (
        <div className="grid gap-2 rounded-2xl border border-amber-200 bg-white/70 p-4">
          <p className="text-sm font-semibold text-ink">
            WalletConnect Project ID
          </p>
          <p className="text-sm text-steel">
            Sifar needs a WalletConnect Project ID to reach the relay.
          </p>
          <input
            value={projectIdInput}
            onChange={(event) => setProjectIdInput(event.target.value)}
            placeholder="Project ID"
            className="min-h-[48px] w-full rounded-2xl border border-amber-200 bg-white px-4 text-ink"
          />
          <Button
            fullWidth
            onClick={() => {
              const value = projectIdInput.trim();
              if (!value) {
                setError('Project ID is required.');
                return;
              }
              setError(null);
              setWcProjectId(value);
              setWalletConnectProjectId(value);
              setStatus('Project ID saved.');
            }}
          >
            Save Project ID
          </Button>
        </div>
      ) : (
        <>
          <Button
            size="lg"
            fullWidth
            onClick={() => setScannerOpen(true)}
            disabled={busy}
          >
            Scan QR code
          </Button>

          <details className="rounded-2xl border border-amber-200 bg-white/70 p-4">
            <summary className="min-h-[44px] cursor-pointer text-sm font-semibold text-steel">
              Paste a link instead
            </summary>
            <textarea
              value={wcUri}
              onChange={(event) => setWcUri(event.target.value)}
              onPaste={onPasteImage}
              placeholder="wc:…"
              rows={3}
              className="mt-3 w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 text-ink"
            />
            <Button
              fullWidth
              className="mt-2"
              disabled={busy || !wcUri.trim()}
              onClick={() => preparePairing(wcUri)}
            >
              Connect WalletConnect
            </Button>
            <p className="mt-2 text-sm text-steel">
              On a computer you can also paste a QR screenshot into the box
              above.
            </p>
          </details>
        </>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-300 bg-red-50 p-4">
          <p className="flex-1 text-sm text-ink">{error}</p>
          <Button size="sm" variant="ghost" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <p className="rounded-2xl border border-amber-200 bg-white/60 p-4 text-sm text-steel">
        Session approval does not use Trezor. Hardware confirmation only happens
        when a signing request arrives.
      </p>

      {hasSessions && (
        <Button variant="ghost" fullWidth onClick={() => setWizardIntent(null)}>
          Back to sessions
        </Button>
      )}

      <Sheet
        open={scannerOpen}
        title="Scan WalletConnect QR"
        onClose={() => setScannerOpen(false)}
      >
        <QrScanner onDecode={onScanned} />
      </Sheet>

      {pendingPairing && (
        <ActionDisclosureSheet
          open
          disclosure={walletConnectPairingDisclosure(pendingPairing.info)}
          onConfirm={() => {
            const pairing = pendingPairing;
            void pair(pairing.uri, pairing.info);
          }}
          onCancel={() => {
            setPendingPairing(null);
            setStatus(null);
          }}
        />
      )}
    </section>
  );
}

/**
 * The body of a signing request, rendered inside the signing sheet.
 *
 * Lives here so the OCMS explanation stays beside the linking surface it
 * relates to.
 */
export function SigningRequestBody({
  type,
  messageText
}: {
  type: string;
  messageText?: string;
}) {
  if (type !== 'solana_signMessage') return null;

  return (
    <div className="grid gap-2 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-steel">
      <p className="font-semibold text-ink">Message signing</p>
      {messageText && (
        <p className="break-words rounded-xl bg-white p-3 font-mono text-sm text-ink">
          {messageText}
        </p>
      )}
      <p>
        Stable firmware OCMS v1 wraps this text in a domain-separated envelope
        before your Trezor signs it. Sifar checks the bytes the device returns
        against the bytes it asked for.
      </p>
      <p>
        Some legacy dApps verify the raw WalletConnect message instead of the
        envelope and may reject an otherwise valid hardware signature.
      </p>
    </div>
  );
}
