'use client';

import { useCallback, useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import {
  UrlEncodedState,
  setStateToHash,
  hasStateInHash
} from '@/lib/urlState';

/**
 * Hook for URL state management.
 * Provides ability to generate shareable URLs and check URL state.
 */
export function useUrlState() {
  const wcProjectId = useAppStore((state) => state.wcProjectId);
  const solanaAccounts = useAppStore((state) => state.solanaAccounts);
  const activeAccountIndex = useAppStore((state) => state.activeAccountIndex);
  const activeSessions = useAppStore((state) => state.activeSessions);

  /** Check if URL currently has state (deferred to client) */
  const [hasUrlState, setHasUrlState] = useState(false);
  useEffect(() => {
    setHasUrlState(hasStateInHash());
  }, []);

  /** Generate a shareable URL with current state */
  const generateShareableUrl = useCallback(
    (modalAccountIndex?: number): string | null => {
      if (!wcProjectId || solanaAccounts.length === 0) {
        return null;
      }

      const state: UrlEncodedState = {
        p: wcProjectId,
        a: solanaAccounts.map((acc) => [acc.address, acc.path]),
        i: modalAccountIndex ?? activeAccountIndex,
        s: activeSessions.map((session) => ({
          t: session.topic,
          n: session.peerName,
          w: session.walletAddress
        }))
      };

      // Update the current URL hash
      setStateToHash(state);

      // Return the full URL
      return window.location.href;
    },
    [wcProjectId, solanaAccounts, activeAccountIndex, activeSessions]
  );

  /** Copy shareable URL to clipboard */
  const copyShareableUrl = useCallback(
    async (modalAccountIndex?: number): Promise<boolean> => {
      const url = generateShareableUrl(modalAccountIndex);
      if (!url) return false;

      try {
        await navigator.clipboard.writeText(url);
        return true;
      } catch {
        return false;
      }
    },
    [generateShareableUrl]
  );

  return {
    hasUrlState,
    generateShareableUrl,
    copyShareableUrl
  };
}
