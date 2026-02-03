'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import TrezorConnect from '@/lib/trezorConnect';
import {
  approveSessionProposal,
  hasWalletConnectProjectId,
  initWalletConnect,
  setWalletConnectProjectId
} from '@/lib/walletconnect';
import { handleSessionRequest } from '@/lib/signing';
import { useAppStore } from '@/lib/store';

export function AppProviders({ children }: { children: React.ReactNode }) {
  const setWcInitialized = useAppStore((state) => state.setWcInitialized);
  const setPendingProposal = useAppStore((state) => state.setPendingProposal);
  const removeActiveSession = useAppStore((state) => state.removeActiveSession);
  const setTrezorUiRequest = useAppStore((state) => state.setTrezorUiRequest);
  const setWcProjectId = useAppStore((state) => state.setWcProjectId);
  const initialized = useRef(false);

  useEffect(() => {
    const envProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
    if (envProjectId) {
      setWcProjectId(envProjectId);
      setWalletConnectProjectId(envProjectId);
    }
  }, [setWcProjectId]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if ((window as any).__sifarConsolePatched) return;
    (window as any).__sifarConsolePatched = true;

    const levels: Array<keyof Console> = ['log', 'info', 'warn', 'error'];
    const originals = new Map<keyof Console, (...args: any[]) => void>();

    const format = (value: any) => {
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };

    const stamp = () => new Date().toISOString();

    const append = (line: string) => {
      useAppStore.getState().appendDebugLog(line);
    };

    append('[Debug] console capture enabled');

    const buffer = ((window as any).__sifarLogBuffer =
      (window as any).__sifarLogBuffer || []);

    levels.forEach((level) => {
      const original = console[level].bind(console);
      originals.set(level, original);
      console[level] = (...args: any[]) => {
        original(...args);
        const line = `[${stamp()}] ${level.toUpperCase()} ${args
          .map(format)
          .join(' ')}`;
        buffer.push(line);
        append(line);
      };
    });

    const onError = (event: ErrorEvent) => {
      const line = `[${stamp()}] ERROR ${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`;
      buffer.push(line);
      append(line);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const line = `[${stamp()}] REJECTION ${format(event.reason)}`;
      buffer.push(line);
      append(line);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      levels.forEach((level) => {
        const original = originals.get(level);
        if (original) {
          console[level] = original;
        }
      });
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    async function init() {
      try {
        if (!hasWalletConnectProjectId()) {
          console.warn('[WC] Skipping init: WalletConnect Project ID missing');
          return;
        }
        const wallet = await initWalletConnect();
        setWcInitialized(true);

        wallet.on('session_proposal', async (proposal) => {
          const { id, params } = proposal;
          const expiryTimestamp = params.expiryTimestamp;
          const now = Math.floor(Date.now() / 1000);
          const expiresIn = expiryTimestamp ? expiryTimestamp - now : 'unknown';
          console.log('[WC] session_proposal received', {
            id,
            proposer: params.proposer.metadata.name,
            expiryTimestamp,
            now,
            expiresInSeconds: expiresIn,
            requiredNamespaces: params.requiredNamespaces,
            optionalNamespaces: params.optionalNamespaces
          });
          const store = useAppStore.getState();

          // Log to event log
          store.addWcEvent({
            type: 'session_proposal',
            peerName: params.proposer.metadata.name,
            details: `Session proposal from ${params.proposer.metadata.name} (${params.proposer.metadata.url})`,
            rawParams: JSON.stringify({ id, requiredNamespaces: params.requiredNamespaces, optionalNamespaces: params.optionalNamespaces }, null, 2)
          });
          const autoAddress = store.wcAutoApproveAddress;

          if (autoAddress) {
            console.log('[WC] Auto-approving with address:', autoAddress);
            try {
              const session = await approveSessionProposal(
                id,
                autoAddress,
                params
              );
              console.log('[WC] Auto-approval successful, session topic:', session.topic);
              store.addActiveSession({
                topic: session.topic,
                peerName: session.peer.metadata.name,
                peerUrl: session.peer.metadata.url,
                peerIcon: session.peer.metadata.icons?.[0],
                chains: Object.keys(session.namespaces || {}),
                walletAddress: autoAddress
              });
              store.setStatusMessage(
                `Connected to ${session.peer.metadata.name}.`
              );
              store.setWcAutoApproveAddress(null);
              return;
            } catch (error) {
              console.error('[WC] Auto-approval failed:', error);
              store.setWcAutoApproveAddress(null);
            }
          }

          console.log('[WC] Setting pendingProposal for manual approval');
          setPendingProposal({
            id,
            params, // Store full params for buildApprovedNamespaces
            proposer: params.proposer.metadata,
            requiredNamespaces: params.requiredNamespaces,
            optionalNamespaces: params.optionalNamespaces
          });
        });

        wallet.on('session_request', async (event) => {
          const method = event.params?.request?.method;
          const params = event.params?.request?.params;
          console.log('[WC] session_request event received', {
            id: event.id,
            topic: event.topic,
            method
          });

          // Find the session to get peer name
          const sessions = wallet.getActiveSessions();
          const session = sessions[event.topic];
          const peerName = session?.peer?.metadata?.name || 'Unknown';

          // Log to event log
          useAppStore.getState().addWcEvent({
            type: 'session_request',
            peerName,
            method,
            topic: event.topic,
            details: `${method} request from ${peerName}`,
            rawParams: JSON.stringify({ id: event.id, topic: event.topic, method, params }, null, 2)
          });

          await handleSessionRequest(event);
        });

        wallet.on('session_delete', (event) => {
          console.log('[WC] session_delete received:', event.topic);
          useAppStore.getState().addWcEvent({
            type: 'session_deleted',
            topic: event.topic,
            details: `Session deleted: ${event.topic.substring(0, 16)}...`,
            rawParams: JSON.stringify(event, null, 2)
          });
          removeActiveSession(event.topic);
        });

        wallet.on('proposal_expire', (event) => {
          console.log('[WC] proposal_expire received:', event);
          // Clear pending proposal if it expired
          const store = useAppStore.getState();
          store.addWcEvent({
            type: 'error',
            details: `Session proposal expired (id: ${event.id})`,
            rawParams: JSON.stringify(event, null, 2)
          });
          if (store.pendingProposal?.id === event.id) {
            store.setPendingProposal(null);
            store.setStatusMessage('Session proposal expired. Please try again.');
          }
        });
      } catch (error: any) {
        console.error('[WC] Init failed:', error);
        useAppStore.getState().addWcEvent({
          type: 'error',
          details: `WalletConnect init failed: ${error?.message || 'Unknown error'}`,
          rawParams: JSON.stringify({ error: error?.message, stack: error?.stack }, null, 2)
        });
      }
    }

    init();
  }, [removeActiveSession, setPendingProposal, setWcInitialized]);

  useEffect(() => {
    const handler = (event: { type: string; payload?: any }) => {
      if (event.type === 'ui-close_window') {
        setTrezorUiRequest(null);
        return;
      }
      setTrezorUiRequest(event);
    };

    TrezorConnect.on(handler);
    return () => {
      TrezorConnect.off(handler);
    };
  }, [setTrezorUiRequest]);

  return <>{children}</>;
}
