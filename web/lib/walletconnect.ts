import { Core } from '@walletconnect/core';
import { Web3Wallet, IWeb3Wallet } from '@walletconnect/web3wallet';
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils';
import { SOLANA_MAINNET_CAIP2 } from './constants';
import { useAppStore } from './store';
import {
  getSafeWalletConnectUriLog,
  parseWalletConnectUri
} from './walletConnectUri';

let web3wallet: IWeb3Wallet | null = null;
let initPromise: Promise<IWeb3Wallet> | null = null;
let projectIdOverride: string | null = null;

type WalletReadyListener = (wallet: IWeb3Wallet) => void;
const walletReadyListeners = new Set<WalletReadyListener>();

/**
 * Run `listener` as soon as the Web3Wallet exists, and for every wallet created
 * afterwards.
 *
 * Event handlers must not be tied to a single init call site: the wallet is
 * created lazily by pairWithDApp when the user supplies a Project ID at runtime,
 * and a wallet with no listeners silently swallows every proposal and request.
 */
export function onWalletConnectReady(listener: WalletReadyListener) {
  walletReadyListeners.add(listener);
  if (web3wallet) listener(web3wallet);
  return () => {
    walletReadyListeners.delete(listener);
  };
}

function getProjectId() {
  const storeId =
    typeof useAppStore === 'function'
      ? useAppStore.getState().wcProjectId
      : null;
  return (
    projectIdOverride ||
    storeId ||
    process.env.NEXT_PUBLIC_WC_PROJECT_ID ||
    ''
  );
}

export function setWalletConnectProjectId(projectId: string | null) {
  projectIdOverride = projectId?.trim() || null;
}

export function hasWalletConnectProjectId() {
  return !!getProjectId();
}

export async function initWalletConnect(): Promise<IWeb3Wallet> {
  if (web3wallet) return web3wallet;
  // Memoize the in-flight init: a slow relay handshake used to let a concurrent
  // caller start a second Web3Wallet and orphan the first one's listeners.
  if (initPromise) return initPromise;
  if (typeof window === 'undefined') {
    throw new Error('WalletConnect requires a browser environment.');
  }

  const projectId = getProjectId();
  if (!projectId) {
    throw new Error('Missing NEXT_PUBLIC_WC_PROJECT_ID');
  }

  initPromise = (async () => {
    const core = new Core({
      projectId
    }) as any;
    const appUrl = window.location.origin;

    const wallet = await Web3Wallet.init({
      core,
      metadata: {
        name: 'Sifar',
        description: 'Hardware-signed wallet powered by Trezor',
        url: appUrl,
        icons: [`${appUrl}/icon.svg`]
      }
    });

    web3wallet = wallet;
    walletReadyListeners.forEach((listener) => {
      try {
        listener(wallet);
      } catch (error) {
        console.error('[WC] Wallet-ready listener failed:', error);
      }
    });
    return wallet;
  })();

  try {
    return await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

function getWeb3Wallet(): IWeb3Wallet {
  if (!web3wallet) throw new Error('WalletConnect not initialized');
  return web3wallet;
}

export async function pairWithDApp(wcUri: string): Promise<void> {
  const uriInfo = parseWalletConnectUri(wcUri);
  console.log(
    '[WC] pairWithDApp called',
    getSafeWalletConnectUriLog(uriInfo)
  );
  const wallet = await initWalletConnect();
  console.log('[WC] Calling wallet.core.pairing.pair...');
  await wallet.core.pairing.pair({ uri: wcUri });
  console.log('[WC] Pairing complete, waiting for session_proposal event');
}

const DEFAULT_SOLANA_METHODS = [
  'solana_signTransaction',
  'solana_signMessage',
  'solana_signAllTransactions',
  'solana_signAndSendTransaction'
];

function collectSolanaRequest(
  requiredNamespaces?: Record<string, any>,
  optionalNamespaces?: Record<string, any>
) {
  const chains = new Set<string>();
  const methods = new Set<string>();
  const events = new Set<string>();

  const addNamespace = (key: string, ns: any) => {
    if (!ns) return;
    if (key.includes(':')) {
      const [namespace] = key.split(':');
      if (namespace === 'solana') {
        chains.add(key);
      }
    }
    if (key === 'solana') {
      (ns.chains || []).forEach((chain: string) => chains.add(chain));
    }
    (ns.methods || []).forEach((method: string) => methods.add(method));
    (ns.events || []).forEach((event: string) => events.add(event));
  };

  Object.entries(requiredNamespaces || {}).forEach(([key, ns]) =>
    addNamespace(key, ns)
  );
  Object.entries(optionalNamespaces || {}).forEach(([key, ns]) =>
    addNamespace(key, ns)
  );

  return {
    chains: chains.size ? Array.from(chains) : [SOLANA_MAINNET_CAIP2],
    methods: methods.size ? Array.from(methods) : DEFAULT_SOLANA_METHODS,
    events: events.size ? Array.from(events) : []
  };
}

export async function approveSessionProposal(
  proposalId: number,
  solanaAddress: string,
  proposalParams: any,
  ethereumAddress?: string
): Promise<any> {
  const wallet = getWeb3Wallet();
  const startTime = Date.now();

  const requiredNamespaces = proposalParams?.requiredNamespaces;
  const optionalNamespaces = proposalParams?.optionalNamespaces;
  const expiryTimestamp = proposalParams?.expiryTimestamp;
  const now = Math.floor(Date.now() / 1000);

  console.log('[WC] approveSessionProposal called', {
    proposalId,
    solanaAddress,
    expiryTimestamp,
    now,
    expiresInSeconds: expiryTimestamp ? expiryTimestamp - now : 'unknown',
    requiredNamespaces: JSON.stringify(requiredNamespaces, null, 2),
    optionalNamespaces: JSON.stringify(optionalNamespaces, null, 2)
  });

  // Check if proposal has already expired
  if (expiryTimestamp && now >= expiryTimestamp) {
    console.error('[WC] Proposal has already expired!', {
      expiryTimestamp,
      now,
      expiredSecondsAgo: now - expiryTimestamp
    });
    throw new Error('Session proposal has expired. Please try connecting again.');
  }

  const solanaRequest = collectSolanaRequest(
    requiredNamespaces,
    optionalNamespaces
  );

  // Always include accountsChanged event for Solana to ensure dApps receive
  // account notifications after session approval (required by some AppKit dApps)
  const solanaEvents = new Set(solanaRequest.events);
  solanaEvents.add('accountsChanged');

  const supportedNamespaces: Record<string, any> = {
    solana: {
      chains: solanaRequest.chains,
      methods: DEFAULT_SOLANA_METHODS,
      events: Array.from(solanaEvents),
      accounts: solanaRequest.chains.map(
        (chain: string) => `${chain}:${solanaAddress}`
      )
    }
  };

  if (ethereumAddress) {
    supportedNamespaces.eip155 = {
      chains: ['eip155:1'],
      methods: [
        'eth_sendTransaction',
        'eth_signTransaction',
        'personal_sign',
        'eth_signTypedData_v4'
      ],
      events: ['accountsChanged', 'chainChanged'],
      accounts: [`eip155:1:${ethereumAddress}`]
    };
  }

  console.log('[WC] Building namespaces with supportedNamespaces:', JSON.stringify(supportedNamespaces, null, 2));

  // Pass full proposal params as per WalletConnect docs
  const namespaces = buildApprovedNamespaces({
    proposal: proposalParams,
    supportedNamespaces
  });

  console.log('[WC] Built approved namespaces:', JSON.stringify(namespaces, null, 2));
  console.log('[WC] Calling wallet.approveSession with proposalId:', proposalId);

  const session = await wallet.approveSession({
    id: proposalId,
    namespaces
  });

  const approvalTime = Date.now() - startTime;
  console.log('[WC] Session approved successfully:', {
    topic: session.topic,
    peer: session.peer?.metadata?.name,
    approvalTimeMs: approvalTime,
    namespaces: JSON.stringify(session.namespaces, null, 2)
  });

  // Note: Solana namespace doesn't support accountsChanged events (unlike Ethereum).
  // The session approval itself notifies the dApp of the connected account.

  return session;
}

export async function rejectSessionProposal(proposalId: number): Promise<void> {
  const wallet = getWeb3Wallet();
  await wallet.rejectSession({
    id: proposalId,
    reason: getSdkError('USER_REJECTED')
  });
}

export async function respondToSessionRequest(
  topic: string,
  requestId: number,
  result: any
): Promise<void> {
  const wallet = getWeb3Wallet();
  await wallet.respondSessionRequest({
    topic,
    response: {
      id: requestId,
      jsonrpc: '2.0',
      result
    }
  });
}

export async function rejectSessionRequest(
  topic: string,
  requestId: number,
  message = 'User rejected the request'
): Promise<void> {
  const wallet = getWeb3Wallet();
  await wallet.respondSessionRequest({
    topic,
    response: {
      id: requestId,
      jsonrpc: '2.0',
      error: {
        code: 4001,
        message
      }
    }
  });
}

export async function disconnectSession(topic: string): Promise<void> {
  const wallet = getWeb3Wallet();

  // The store can hold a session the SDK no longer has (expired, or deleted by
  // the dApp while we were away). Calling disconnectSession on it throws
  // "No matching key", which used to abort before the local cleanup and leave a
  // row the user could never remove. Nothing to send in that case.
  const sessions = wallet.getActiveSessions();
  if (!sessions[topic]) {
    console.warn(
      '[WC] disconnectSession: no live session for topic, dropping locally only',
      topic.substring(0, 16) + '...'
    );
    return;
  }

  await wallet.disconnectSession({
    topic,
    reason: getSdkError('USER_DISCONNECTED')
  });
}

export async function pingSession(topic: string): Promise<boolean> {
  const wallet = getWeb3Wallet();
  try {
    // Session topics and pairing topics live in separate keychains. Pinging the
    // pairing store with a session topic always throws, so check which one this
    // is instead of failing first and falling back.
    const sessions = wallet.getActiveSessions();
    if (sessions[topic]) {
      console.log('[WC] Pinging session:', topic.substring(0, 16) + '...');
      await wallet.engine.signClient.ping({ topic });
      console.log('[WC] Session ping successful');
      return true;
    }

    console.log('[WC] Pinging pairing:', topic.substring(0, 16) + '...');
    await wallet.core.pairing.ping({ topic });
    console.log('[WC] Pairing ping successful');
    return true;
  } catch (error) {
    console.warn('[WC] Ping failed:', error);
    return false;
  }
}

export function getRelayConnectionState(): string {
  try {
    const wallet = getWeb3Wallet();
    // @ts-ignore - accessing internal state
    const relayer = wallet.core?.relayer;
    if (!relayer) return 'unknown';
    // @ts-ignore
    return relayer.connected ? 'connected' : 'disconnected';
  } catch {
    return 'unknown';
  }
}

export async function restartRelay(): Promise<void> {
  const wallet = getWeb3Wallet();
  console.log('[WC] Restarting relay connection...');
  try {
    // @ts-ignore - accessing internal method
    await wallet.core?.relayer?.restartTransport();
    console.log('[WC] Relay restarted');
  } catch (error) {
    console.error('[WC] Failed to restart relay:', error);
    throw error;
  }
}
