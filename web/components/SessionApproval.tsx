'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { approveSessionProposal, rejectSessionProposal } from '@/lib/walletconnect';
import { useAppStore } from '@/lib/store';

export function SessionApproval() {
  const pendingProposal = useAppStore((state) => state.pendingProposal);
  const solanaAddress = useAppStore((state) => state.solanaAddress);
  const addActiveSession = useAppStore((state) => state.addActiveSession);
  const clearPendingProposal = useAppStore(
    (state) => state.clearPendingProposal
  );
  const setStatusMessage = useAppStore((state) => state.setStatusMessage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Countdown timer for proposal expiration
  useEffect(() => {
    if (!pendingProposal?.params?.expiryTimestamp) {
      setTimeLeft(null);
      return;
    }

    const updateTimer = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = pendingProposal.params.expiryTimestamp - now;
      if (remaining <= 0) {
        setTimeLeft(0);
        clearPendingProposal();
        setStatusMessage('Session proposal expired. Please scan the QR code again.');
      } else {
        setTimeLeft(remaining);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [pendingProposal, clearPendingProposal, setStatusMessage]);

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
      const session = await approveSessionProposal(
        id,
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
      clearPendingProposal();
      setStatusMessage(`Connected to ${proposer.name}.`);
    } catch (err: any) {
      const message = err.message || 'Failed to approve session';
      // Handle expired/deleted proposal errors gracefully
      if (message.includes('expired') || message.includes('deleted') || message.includes('No matching key')) {
        clearPendingProposal();
        setStatusMessage('Session proposal expired. Please scan the QR code again.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    setError(null);
    try {
      await rejectSessionProposal(id);
      clearPendingProposal();
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

      {timeLeft !== null && (
        <p className={`mt-2 text-xs font-semibold ${timeLeft < 60 ? 'text-ember' : 'text-amber-600'}`}>
          Expires in {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
        </p>
      )}

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
