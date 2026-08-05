'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import TrezorConnect from '@/lib/trezorConnect';
import {
  approveSessionProposal,
  hasWalletConnectProjectId,
  initWalletConnect,
  onWalletConnectReady,
  setWalletConnectProjectId
} from '@/lib/walletconnect';
import { handleSessionRequest } from '@/lib/signing';
import { useAppStore } from '@/lib/store';
import { getStateFromHash, clearStateFromHash } from '@/lib/urlState';

// Module-level so it survives remounts: handlers must attach exactly once per
// wallet instance, no matter how many times the provider mounts.
const walletsWithHandlers = new WeakSet<object>();

export function AppProviders({ children }: { children: React.ReactNode }) {
  const setWcInitialized = useAppStore((state) => state.setWcInitialized);
  const setAppReady = useAppStore((state) => state.setAppReady);
  const setPendingProposal = useAppStore((state) => state.setPendingProposal);
  const removeActiveSession = useAppStore((state) => state.removeActiveSession);
  const setTrezorUiRequest = useAppStore((state) => state.setTrezorUiRequest);
  const setWcProjectId = useAppStore((state) => state.setWcProjectId);
  const setSolanaAccounts = useAppStore((state) => state.setSolanaAccounts);
  const refreshSolanaAccountBalance = useAppStore(
    (state) => state.refreshSolanaAccountBalance
  );
  const urlStateRestored = useRef(false);

  // Restore state from URL hash on mount (runs before WC init)
  useEffect(() => {
    if (urlStateRestored.current) return;
    urlStateRestored.current = true;

    // Debug: log what we're seeing
    console.log('[URL State] Hash on mount:', typeof window !== 'undefined' ? window.location.hash : 'SSR');

    const restored = getStateFromHash();
    console.log('[URL State] Restored:', restored ? `${restored.accounts.length} accounts` : 'null');

    if (restored) {
      console.log('[URL State] Restoring from URL:', {
        accounts: restored.accounts.length,
        activeIndex: restored.activeAccountIndex,
        sessions: restored.sessionHints.length
      });

      // Restore project ID
      setWcProjectId(restored.wcProjectId);
      setWalletConnectProjectId(restored.wcProjectId);

      // Restore accounts with loading state
      const accounts = restored.accounts.map((acc) => ({
        address: acc.address,
        path: acc.path,
        balance: null,
        tokens: [],
        balanceStatus: 'loading' as const,
        balanceError: null
      }));
      setSolanaAccounts(accounts);

      // Store the activeAccountIndex for WalletDisplay to use
      // We store it in sessionStorage so WalletDisplay can read it on mount
      sessionStorage.setItem(
        'urlState_activeAccountIndex',
        String(restored.activeAccountIndex)
      );

      // Store session hints for WC init to use later
      if (restored.sessionHints.length > 0) {
        sessionStorage.setItem(
          'urlState_sessionHints',
          JSON.stringify(restored.sessionHints)
        );
      }

      // Only refresh the active account's balance to avoid rate limiting
      // Other balances will be fetched on-demand when the user views them
      const activeIndex = restored.activeAccountIndex;
      if (activeIndex >= 0 && activeIndex < restored.accounts.length) {
        refreshSolanaAccountBalance(activeIndex).catch((err) => {
          console.warn('[URL State] Balance fetch failed for active account', err);
        });
      }

      // Clear the hash after restoring to avoid re-restoration on refresh
      // (user can generate new URL when needed)
      clearStateFromHash();
    } else {
      // No URL state, use env project ID if available
      const envProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
      if (envProjectId) {
        setWcProjectId(envProjectId);
        setWalletConnectProjectId(envProjectId);
      } else {
        // No project ID available, app is ready immediately
        // User will need to enter project ID manually
        setAppReady(true);
      }
    }
  }, [setWcProjectId, setSolanaAccounts, refreshSolanaAccountBalance, setAppReady]);

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

    const BUFFER_LIMIT = 500;
    const buffer: string[] = ((window as any).__sifarLogBuffer =
      (window as any).__sifarLogBuffer || []);
    const push = (line: string) => {
      buffer.push(line);
      // Bounded like the store's log, so a long enumeration cannot grow this
      // without limit for the whole session.
      if (buffer.length > BUFFER_LIMIT) {
        buffer.splice(0, buffer.length - BUFFER_LIMIT);
      }
    };

    levels.forEach((level) => {
      const original = (console[level] as (...args: any[]) => void).bind(console);
      originals.set(level, original);
      (console as any)[level] = (...args: any[]) => {
        original(...args);
        // Filter out WalletConnect internal cleanup noise
        const formatted = args.map(format).join(' ');
        if (formatted.includes('Record was recently deleted') ||
            formatted.includes('Missing or invalid')) {
          return; // Skip WC internal cleanup messages
        }
        const line = `[${stamp()}] ${level.toUpperCase()} ${formatted}`;
        push(line);
        append(line);
      };
    });

    const onError = (event: ErrorEvent) => {
      const line = `[${stamp()}] ERROR ${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`;
      push(line);
      append(line);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const line = `[${stamp()}] REJECTION ${format(event.reason)}`;
      push(line);
      append(line);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      levels.forEach((level) => {
        const original = originals.get(level);
        if (original) {
          (console as any)[level] = original;
        }
      });
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      // Must clear: the guard above would otherwise skip re-patching after a
      // StrictMode remount, leaving debug capture dead for the whole session.
      (window as any).__sifarConsolePatched = false;
    };
  }, []);

  useEffect(() => {
    // No mount-once ref guard here: it left the watchdog below disarmed after a
    // StrictMode remount. Re-entrancy is handled where it matters instead —
    // initWalletConnect memoizes, attachWallet is idempotent per wallet.

    // Timeout to prevent infinite loading spinner
    const timeout = setTimeout(() => {
      if (!useAppStore.getState().appReady) {
        console.warn('[Sifar] Init timeout - forcing app ready');
        setAppReady(true);
      }
    }, 5000);

    // Attach to whichever wallet instance appears, including one created later
    // by pairWithDApp after the user enters a Project ID by hand. Idempotent per
    // wallet, so a remount cannot double-register and handle each request twice.
    function attachWallet(wallet: Awaited<ReturnType<typeof initWalletConnect>>) {
      if (walletsWithHandlers.has(wallet)) return;
      walletsWithHandlers.add(wallet);
      setWcInitialized(true);
      setAppReady(true);

      try {
        // Sync existing sessions from WC IndexedDB to our store
        const existingSessions = wallet.getActiveSessions();
        const sessionTopics = Object.keys(existingSessions);

        // Get session hints from URL state (if available).
        // sessionStorage throws in Safari private mode; a failure here must not
        // abort handler registration below.
        let sessionHints: Array<{ topic: string; peerName: string; walletAddress: string }> = [];
        try {
          const hintsJson = sessionStorage.getItem('urlState_sessionHints');
          sessionHints = hintsJson ? JSON.parse(hintsJson) : [];
          sessionStorage.removeItem('urlState_sessionHints');
        } catch (error) {
          console.warn('[WC] Could not read session hints:', error);
        }

        console.log('[WC] Session sync:', {
          existingInIndexedDB: sessionTopics.length,
          hintsFromUrl: sessionHints.length,
          existingTopics: sessionTopics.map(t => t.substring(0, 16) + '...'),
          hintTopics: sessionHints.map(h => h.topic.substring(0, 16) + '...')
        });

        if (sessionTopics.length > 0) {

          const store = useAppStore.getState();

          for (const topic of sessionTopics) {
            const session = existingSessions[topic];
            const hint = sessionHints.find((h) => h.topic === topic);

            // The session's own namespaces are authoritative. A URL hint is only
            // a fallback for display: letting it override meant a crafted
            // #state= link could rebind a live session to a different account,
            // which the message-signing path then trusts as the signer.
            let walletAddress: string | undefined;
            const solanaNamespace = session.namespaces?.solana;
            const namespaceAccounts = solanaNamespace?.accounts || [];
            if (namespaceAccounts.length > 0) {
              const parts = namespaceAccounts[0].split(':');
              walletAddress = parts[parts.length - 1];
            }
            if (!walletAddress) {
              walletAddress = hint?.walletAddress;
            }

            if (walletAddress) {
              console.log('[WC] Restoring session:', {
                topic: topic.substring(0, 16) + '...',
                peer: session.peer?.metadata?.name,
                walletAddress
              });

              store.addActiveSession({
                topic,
                peerName: session.peer?.metadata?.name || 'Unknown',
                peerUrl: session.peer?.metadata?.url || '',
                peerIcon: session.peer?.metadata?.icons?.[0],
                chains: Object.keys(session.namespaces || {}),
                walletAddress
              });
            }
          }
        } else if (sessionHints.length > 0) {
          // URL had session hints but IndexedDB has no sessions
          // This happens in a fresh browser - sessions can't be restored
          console.warn('[WC] URL contained session hints but no matching sessions in IndexedDB.');
          console.warn('[WC] Sessions must be re-established - scan QR codes again.');
        }

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
          const store = useAppStore.getState();
          store.addWcEvent({
            type: 'session_deleted',
            topic: event.topic,
            details: `Session deleted: ${event.topic.substring(0, 16)}...`,
            rawParams: JSON.stringify(event, null, 2)
          });
          removeActiveSession(event.topic);

          // Drop anything staged against the dead topic, otherwise the modal
          // stays pinned to a request that can never be answered.
          if (store.pendingRequest?.topic === event.topic) {
            store.clearPendingRequest();
            store.setStatusMessage('dApp disconnected. Pending request cancelled.');
          }
        });

        wallet.on('session_request_expire', (event) => {
          console.log('[WC] session_request_expire received:', event.id);
          const store = useAppStore.getState();
          if (store.pendingRequest?.requestId === event.id) {
            store.clearPendingRequest();
            store.addWcEvent({
              type: 'request_rejected',
              details: `Request ${event.id} expired before approval`
            });
            store.setStatusMessage('Signing request expired.');
          }
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
        console.error('[WC] Handler attach failed:', error);
        useAppStore.getState().addWcEvent({
          type: 'error',
          details: `WalletConnect setup failed: ${error?.message || 'Unknown error'}`,
          rawParams: JSON.stringify({ error: error?.message, stack: error?.stack }, null, 2)
        });
        // Still mark app as ready so user can interact (maybe fix project ID)
        setAppReady(true);
      }
    }

    const detachReadyListener = onWalletConnectReady(attachWallet);

    async function init() {
      if (!hasWalletConnectProjectId()) {
        console.warn('[WC] Deferring init: WalletConnect Project ID missing');
        setAppReady(true);
        return;
      }
      try {
        await initWalletConnect();
      } catch (error: any) {
        console.error('[WC] Init failed:', error);
        useAppStore.getState().addWcEvent({
          type: 'error',
          details: `WalletConnect init failed: ${error?.message || 'Unknown error'}`,
          rawParams: JSON.stringify({ error: error?.message, stack: error?.stack }, null, 2)
        });
        setAppReady(true);
      }
    }

    init();

    return () => {
      clearTimeout(timeout);
      detachReadyListener();
    };
  }, [removeActiveSession, setPendingProposal, setWcInitialized, setAppReady]);

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
