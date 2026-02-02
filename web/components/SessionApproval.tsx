'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { approveSessionProposal, rejectSessionProposal } from '@/lib/walletconnect';
import { useAppStore } from '@/lib/store';

export function SessionApproval() {
  const store = useAppStore();
  const { pendingProposal, solanaAddress } = store;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pendingProposal) return null;

  const { proposer, id } = pendingProposal;

  const handleApprove = async () => {
    if (!solanaAddress) {
      setError('Connect Trezor and fetch an address first.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const session = await approveSessionProposal(id, solanaAddress);
      store.setActiveSession({
        topic: session.topic,
        peerName: session.peer.metadata.name,
        peerUrl: session.peer.metadata.url,
        peerIcon: session.peer.metadata.icons?.[0],
        chains: Object.keys(session.namespaces || {})
      });
      store.clearPendingProposal();
      store.setStatusMessage(`Connected to ${proposer.name}.`);
    } catch (err: any) {
      setError(err.message || 'Failed to approve session');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    setError(null);
    try {
      await rejectSessionProposal(id);
      store.clearPendingProposal();
    } catch (err: any) {
      setError(err.message || 'Failed to reject session');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="Session Proposal">
      <div className="flex items-center gap-3">
        {proposer.icons?.[0] ? (
          <img
            src={proposer.icons[0]}
            alt={proposer.name}
            className="h-10 w-10 rounded-xl border border-amber-200/40"
          />
        ) : (
          <div className="h-10 w-10 rounded-xl bg-amber-100" />
        )}
        <div>
          <p className="text-sm font-semibold">{proposer.name}</p>
          <p className="text-xs text-steel">{proposer.url}</p>
        </div>
      </div>

      <p className="mt-3 text-sm text-steel">
        This dApp wants to connect to your Solana address. Verify the domain
        before approving.
      </p>

      <div className="mt-4 flex gap-3">
        <Button variant="ghost" onClick={handleReject} disabled={loading}>
          Reject
        </Button>
        <Button onClick={handleApprove} disabled={loading}>
          {loading ? 'Processing...' : 'Approve'}
        </Button>
      </div>

      {error && <p className="mt-3 text-xs text-ember">{error}</p>}
    </Card>
  );
}
