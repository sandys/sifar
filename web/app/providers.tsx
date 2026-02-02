'use client';

import { useEffect, useRef } from 'react';
import TrezorConnect from '@/lib/trezorConnect';
import { initWalletConnect } from '@/lib/walletconnect';
import { handleSessionRequest } from '@/lib/signing';
import { useAppStore } from '@/lib/store';

export function AppProviders({ children }: { children: React.ReactNode }) {
  const store = useAppStore();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    async function init() {
      try {
        if (!process.env.NEXT_PUBLIC_WC_PROJECT_ID) {
          console.warn('[WC] Skipping init: NEXT_PUBLIC_WC_PROJECT_ID missing');
          return;
        }
        const wallet = await initWalletConnect();
        store.setWcInitialized(true);

        wallet.on('session_proposal', (proposal) => {
          const { id, params } = proposal;
          store.setPendingProposal({
            id,
            proposer: params.proposer.metadata,
            requiredNamespaces: params.requiredNamespaces,
            optionalNamespaces: params.optionalNamespaces
          });
        });

        wallet.on('session_request', async (event) => {
          await handleSessionRequest(event);
        });

        wallet.on('session_delete', (event) => {
          store.removeActiveSession(event.topic);
        });
      } catch (error) {
        console.error('[WC] Init failed:', error);
      }
    }

    init();
  }, [store]);

  useEffect(() => {
    const handler = (event: { type: string; payload?: any }) => {
      if (event.type === 'ui-close_window') {
        store.setTrezorUiRequest(null);
        return;
      }
      store.setTrezorUiRequest(event);
    };

    TrezorConnect.on(handler);
    return () => {
      TrezorConnect.off(handler);
    };
  }, [store]);

  return <>{children}</>;
}
