'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import TrezorConnect from '@/lib/trezorConnect';
import { initWalletConnect } from '@/lib/walletconnect';
import { handleSessionRequest } from '@/lib/signing';
import { useAppStore } from '@/lib/store';

export function AppProviders({ children }: { children: React.ReactNode }) {
  const setWcInitialized = useAppStore((state) => state.setWcInitialized);
  const setPendingProposal = useAppStore((state) => state.setPendingProposal);
  const removeActiveSession = useAppStore((state) => state.removeActiveSession);
  const setTrezorUiRequest = useAppStore((state) => state.setTrezorUiRequest);
  const initialized = useRef(false);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if ((window as any).__vaultConsolePatched) return;
    (window as any).__vaultConsolePatched = true;

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

    const buffer = ((window as any).__vaultLogBuffer =
      (window as any).__vaultLogBuffer || []);

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
        if (!process.env.NEXT_PUBLIC_WC_PROJECT_ID) {
          console.warn('[WC] Skipping init: NEXT_PUBLIC_WC_PROJECT_ID missing');
          return;
        }
        const wallet = await initWalletConnect();
        setWcInitialized(true);

        wallet.on('session_proposal', (proposal) => {
          const { id, params } = proposal;
          setPendingProposal({
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
          removeActiveSession(event.topic);
        });
      } catch (error) {
        console.error('[WC] Init failed:', error);
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
