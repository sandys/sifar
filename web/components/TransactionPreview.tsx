'use client';

import { useMemo } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { useAppStore } from '@/lib/store';

export function TransactionPreview() {
  const pendingRequest = useAppStore((state) => state.pendingRequest);
  const clearPendingRequest = useAppStore((state) => state.clearPendingRequest);

  const summary = useMemo(() => {
    if (!pendingRequest) return null;
    if (pendingRequest.type === 'solana_signMessage') {
      return {
        title: 'Sign Message',
        description: pendingRequest.humanMessage || 'Binary message'
      };
    }
    if (pendingRequest.type === 'solana_signAllTransactions') {
      return {
        title: 'Sign Multiple Transactions',
        description: `${pendingRequest.transactions?.length || 0} transactions`
      };
    }
    if (pendingRequest.type === 'solana_signAndSendTransaction') {
      return {
        title: 'Sign & Send Transaction',
        description: 'Transaction will be broadcast to Solana mainnet.'
      };
    }
    return {
      title: 'Sign Transaction',
      description: 'Single Solana transaction request.'
    };
  }, [pendingRequest]);

  if (!pendingRequest || !summary) return null;

  return (
    <Sheet open={!!pendingRequest} onClose={clearPendingRequest} title="Request">
      <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4 text-sm">
        <p className="text-xs uppercase tracking-[0.25em] text-amber-700">
          {summary.title}
        </p>
        <p className="mt-2 text-steel">{summary.description}</p>
      </div>
      <p className="mt-4 text-xs text-steel">
        Always verify transaction details on your Trezor device before approving.
      </p>
    </Sheet>
  );
}
