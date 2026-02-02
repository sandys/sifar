'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  approveBatchRequest,
  approveCurrentRequest,
  approveAndSendRequest,
  approveMessageRequest,
  rejectCurrentRequest
} from '@/lib/signing';
import { useAppStore } from '@/lib/store';

export function SigningFlow() {
  const pendingRequest = useAppStore((state) => state.pendingRequest);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pendingRequest) return null;

  const handleApprove = async () => {
    setLoading(true);
    setError(null);
    try {
      switch (pendingRequest.type) {
        case 'solana_signAllTransactions':
          await approveBatchRequest();
          break;
        case 'solana_signAndSendTransaction':
          await approveAndSendRequest();
          break;
        case 'solana_signMessage':
          await approveMessageRequest();
          break;
        default:
          await approveCurrentRequest();
      }
    } catch (err: any) {
      setError(err.message || 'Signing failed');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    setError(null);
    try {
      await rejectCurrentRequest();
    } catch (err: any) {
      setError(err.message || 'Failed to reject');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="Signing Action">
      <p className="text-sm text-steel">
        Confirm on your Trezor device once you tap approve. The phone will stay on
        this screen while the device confirms the action.
      </p>
      <div className="mt-4 flex gap-3">
        <Button variant="ghost" onClick={handleReject} disabled={loading}>
          Reject
        </Button>
        <Button onClick={handleApprove} disabled={loading}>
          {loading ? 'Processing...' : 'Sign with Trezor'}
        </Button>
      </div>
      {error && <p className="mt-3 text-xs text-ember">{error}</p>}
    </Card>
  );
}
