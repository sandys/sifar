'use client';

import { useMemo, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { SigningRequestBody } from '@/components/WalletConnectModal';
import { TransactionSummary } from '@/components/TransactionSummary';
import { shortenAddress } from '@/lib/format';
import { runDeviceOperation } from '@/lib/deviceSession';
import { ActionDisclosurePanel } from '@/components/ActionDisclosure';
import { signingRequestDisclosure } from '@/lib/actionDisclosure';
import {
  approveCurrentRequest,
  approveBatchRequest,
  approveAndSendRequest,
  approveMessageRequest,
  isRequestAnsweredError,
  rejectCurrentRequest
} from '@/lib/signing';

/**
 * Review and sign.
 *
 * Driven purely by `pendingRequest`. It deliberately does not touch the
 * selected account: `lib/signing.ts` resolves the signer from the transaction
 * bytes and binds it to the approved session, so the UI's selection is
 * irrelevant to correctness and switching it would only mislead.
 */
export function SigningSheet() {
  const pendingRequest = useAppStore((state) => state.pendingRequest);
  const activeSessions = useAppStore((state) => state.activeSessions);
  const addWcEvent = useAppStore((state) => state.addWcEvent);
  const setStatus = useAppStore((state) => state.setStatus);

  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const session = useMemo(
    () => activeSessions.find((s) => s.topic === pendingRequest?.topic) || null,
    [activeSessions, pendingRequest?.topic]
  );

  const summary = useMemo(() => {
    if (!pendingRequest) return null;
    switch (pendingRequest.type) {
      case 'solana_signMessage':
        return { title: 'Sign message', detail: 'A dApp wants a signed message.' };
      case 'solana_signAllTransactions':
        return {
          title: 'Sign multiple transactions',
          detail: `${pendingRequest.transactions?.length || 0} transactions in one request.`
        };
      case 'solana_signAndSendTransaction':
        return {
          title: 'Sign and send',
          detail: 'This will be broadcast to Solana mainnet after signing.'
        };
      default:
        return { title: 'Sign transaction', detail: 'A single Solana transaction.' };
    }
  }, [pendingRequest]);

  const disclosure = useMemo(
    () =>
      pendingRequest
        ? signingRequestDisclosure({
            type: pendingRequest.type,
            transactionCount: pendingRequest.transactions?.length
          })
        : null,
    [pendingRequest]
  );

  if (!pendingRequest || !summary || !disclosure) return null;

  const approve = async () => {
    setSigning(true);
    setError(null);
    try {
      // Exclusive device op. The approve* helpers sign AND respond to the dApp
      // on the wire, so the whole switch is one logical operation. Firmware
      // decides whether the current in-memory auth session needs more input.
      await runDeviceOperation({ label: 'sign', exclusive: true }, async () => {
        switch (pendingRequest.type) {
          case 'solana_signMessage':
            await approveMessageRequest();
            break;
          case 'solana_signAllTransactions':
            await approveBatchRequest();
            break;
          case 'solana_signAndSendTransaction':
            await approveAndSendRequest();
            break;
          default:
            await approveCurrentRequest();
        }
      });
      addWcEvent({
        type: 'request_approved',
        peerName: session?.peerName,
        method: pendingRequest.type,
        topic: pendingRequest.topic,
        details: `Approved ${pendingRequest.type}`
      });
      setStatus('Signed.');
    } catch (err: any) {
      console.error('[Signing] failed:', err);
      setError(err?.message || 'Signing failed.');
      addWcEvent({
        type: 'error',
        method: pendingRequest.type,
        topic: pendingRequest.topic,
        details: `Signing failed: ${err?.message || 'Unknown error'}`
      });
      // The dApp is still blocked on this request id; answer it rather than
      // letting it time out. Outside the op, so a gate rejection still answers.
      // Unless it has already been answered accurately (e.g. a broadcast
      // failure), in which case a second response would replace the real
      // reason with a false "user rejected".
      if (!isRequestAnsweredError(err)) {
        try {
          await rejectCurrentRequest();
        } catch (rejectErr) {
          console.warn('[Signing] reject after failure failed:', rejectErr);
        }
      }
    } finally {
      setSigning(false);
    }
  };

  const reject = async () => {
    setError(null);
    try {
      await rejectCurrentRequest();
      addWcEvent({
        type: 'request_rejected',
        peerName: session?.peerName,
        method: pendingRequest.type,
        topic: pendingRequest.topic,
        details: `Rejected ${pendingRequest.type}`
      });
      setStatus('Request rejected.');
    } catch (err: any) {
      setError(err?.message || 'Could not reject.');
    }
  };

  const signerAddress =
    pendingRequest.signerAddress || pendingRequest.messageSignerAddress || null;

  return (
    <Sheet
      open
      title={summary.title}
      subtitle={session?.peerName || 'Unknown dApp'}
      // Not dismissible: a dApp is blocked on this request id, so it must be
      // answered. Reject is the only exit and it responds on the wire.
      dismissible={false}
      footer={
        <div className="grid gap-2">
          <Button size="lg" fullWidth onClick={approve} disabled={signing}>
            {signing ? 'Waiting for Trezor…' : disclosure.primaryLabel}
          </Button>
          <Button variant="ghost" fullWidth onClick={reject} disabled={signing}>
            {signing ? 'Cancel' : 'Reject'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <ActionDisclosurePanel disclosure={disclosure} />

        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-ink">
          This summary is advisory. The Trezor screen is what you are signing.
        </p>

        <p className="text-sm text-steel">{summary.detail}</p>

        {signerAddress && (
          <div className="rounded-2xl border border-amber-200 bg-white/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-steel">
              Signing account
            </p>
            <p className="mt-1 font-mono text-base text-ink">
              {shortenAddress(signerAddress, 8, 8)}
            </p>
          </div>
        )}

        <SigningRequestBody
          type={pendingRequest.type}
          messageText={pendingRequest.messageText}
        />

        <TransactionSummary request={pendingRequest} />

        {error && <p className="text-sm text-ember">{error}</p>}
      </div>
    </Sheet>
  );
}
