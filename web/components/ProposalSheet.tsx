'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { shortenAddress } from '@/lib/format';
import {
  approveSessionProposal,
  getSolanaProposalRequest,
  rejectSessionProposal
} from '@/lib/walletconnect';
import { ActionDisclosurePanel } from '@/components/ActionDisclosure';
import { sessionProposalDisclosure } from '@/lib/actionDisclosure';

/**
 * Session proposal approval.
 *
 * Replaces two competing UIs that used to render at the same time off the same
 * `pendingProposal` — one of which was hidden behind the other's backdrop and
 * carried the only expiry countdown. That countdown lives here now.
 */
export function ProposalSheet() {
  const pendingProposal = useAppStore((state) => state.pendingProposal);
  const setPendingProposal = useAppStore((state) => state.setPendingProposal);
  const addActiveSession = useAppStore((state) => state.addActiveSession);
  const addWcEvent = useAppStore((state) => state.addWcEvent);
  const setStatus = useAppStore((state) => state.setStatus);
  const solanaAddress = useAppStore((state) => state.solanaAddress);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const expiry = pendingProposal?.params?.expiryTimestamp as number | undefined;

  useEffect(() => {
    if (!pendingProposal || !expiry) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => {
      const remaining = expiry - Math.floor(Date.now() / 1000);
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        setPendingProposal(null);
        setStatus('Session proposal expired. Please try again.', 'warn');
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [pendingProposal, expiry, setPendingProposal, setStatus]);

  useEffect(() => {
    setError(null);
  }, [pendingProposal?.id]);

  if (!pendingProposal || !solanaAddress) return null;

  const proposer = pendingProposal.proposer;
  const requested = getSolanaProposalRequest(
    pendingProposal.requiredNamespaces,
    pendingProposal.optionalNamespaces
  );
  const disclosure = sessionProposalDisclosure({
    dappName: proposer.name,
    address: solanaAddress,
    chains: requested.chains,
    methods: requested.methods
  });

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await approveSessionProposal(
        pendingProposal.id,
        solanaAddress,
        pendingProposal.params
      );
      addActiveSession({
        topic: session.topic,
        peerName: session.peer.metadata.name,
        peerUrl: session.peer.metadata.url,
        peerIcon: session.peer.metadata.icons?.[0],
        chains: Object.keys(session.namespaces || {}),
        walletAddress: solanaAddress
      });
      addWcEvent({
        type: 'session_approved',
        peerName: session.peer.metadata.name,
        topic: session.topic,
        details: `Approved session with ${session.peer.metadata.name}`
      });
      setPendingProposal(null);
      setStatus(`Connected to ${session.peer.metadata.name}.`);
    } catch (err: any) {
      setError(err?.message || 'Could not approve this connection.');
      // Approval can fail for reasons retrying will not fix (expired proposal,
      // namespaces we cannot satisfy). Answer the dApp rather than leaving it
      // waiting on a proposal that will never be accepted.
      try {
        await rejectSessionProposal(pendingProposal.id);
      } catch {
        // Nothing more we can do; the proposal will expire on its own.
      }
      setPendingProposal(null);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    try {
      await rejectSessionProposal(pendingProposal.id);
      addWcEvent({
        type: 'session_rejected',
        peerName: proposer.name,
        details: `Rejected session from ${proposer.name}`
      });
    } catch {
      // Rejection is best effort; clearing locally is what unblocks the UI.
    } finally {
      setPendingProposal(null);
      setBusy(false);
    }
  };

  const countdown =
    secondsLeft === null
      ? null
      : `${Math.floor(Math.max(0, secondsLeft) / 60)}:${String(
          Math.max(0, secondsLeft) % 60
        ).padStart(2, '0')}`;

  return (
    <Sheet
      open
      title="Connection request"
      subtitle={proposer.url}
      // Not dismissible: the dApp is waiting on an answer. Reject is the exit.
      dismissible={false}
      footer={
        <div className="grid gap-2">
          <Button size="lg" fullWidth onClick={approve} disabled={busy}>
            {busy ? 'Connecting…' : disclosure.primaryLabel}
          </Button>
          <Button variant="ghost" fullWidth onClick={reject} disabled={busy}>
            Reject
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <div className="flex items-center gap-3">
          {proposer.icons?.[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={proposer.icons[0]}
              alt=""
              className="h-12 w-12 rounded-xl"
            />
          ) : (
            <div className="h-12 w-12 rounded-xl bg-amber-100" />
          )}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-ink">
              {proposer.name}
            </p>
            <p className="truncate text-sm text-steel">{proposer.url}</p>
          </div>
        </div>

        <p className="text-sm font-semibold text-ink">
          Check that the domain above matches the site you opened.
        </p>

        <div className="rounded-2xl border border-amber-200 bg-white/70 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-steel">
            Connecting account
          </p>
          <p className="mt-1 font-mono text-base text-ink">
            {shortenAddress(solanaAddress, 8, 8)}
          </p>
        </div>

        {countdown && (
          <p
            className={`text-sm ${
              (secondsLeft ?? 0) < 60 ? 'text-ember' : 'text-steel'
            }`}
          >
            Expires in {countdown}
          </p>
        )}

        <ActionDisclosurePanel disclosure={disclosure} />

        {error && <p className="text-sm text-ember">{error}</p>}
      </div>
    </Sheet>
  );
}
