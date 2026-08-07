'use client';

import { useAppStore } from '@/lib/store';
import { SigningSheet } from '@/components/SigningSheet';
import { ProposalSheet } from '@/components/ProposalSheet';

/**
 * Resolves which request sheet is showing.
 *
 * A single switch, so at most one request sheet can exist at a time. The
 * device prompt is a separate layer above this one, which is how a PIN or
 * passphrase request stays reachable while a signing sheet is open — the case
 * that used to be hard-blocked.
 *
 * Signing outranks a proposal: if both are somehow live, the one a dApp is
 * actively blocked on wins.
 */
export function SheetHost() {
  const pendingRequest = useAppStore((state) => state.pendingRequest);
  const pendingProposal = useAppStore((state) => state.pendingProposal);

  if (pendingRequest) return <SigningSheet />;
  if (pendingProposal) return <ProposalSheet />;
  return null;
}
