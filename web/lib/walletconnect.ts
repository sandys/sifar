import { Core } from '@walletconnect/core';
import { Web3Wallet, IWeb3Wallet } from '@walletconnect/web3wallet';
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils';
import { SOLANA_MAINNET_CAIP2 } from './constants';
import { useAppStore } from './store';

let web3wallet: IWeb3Wallet | null = null;
let projectIdOverride: string | null = null;

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
  const projectId = getProjectId();
  if (!projectId) {
    throw new Error('Missing NEXT_PUBLIC_WC_PROJECT_ID');
  }

  const core = new Core({
    projectId
  }) as any;

  web3wallet = await Web3Wallet.init({
    core,
    metadata: {
      name: 'Vault Bridge',
      description: 'Hardware-signed wallet powered by Trezor',
      url: 'https://vaultbridge.io',
      icons: ['https://vaultbridge.io/icon.png']
    }
  });

  return web3wallet;
}

export function getWeb3Wallet(): IWeb3Wallet {
  if (!web3wallet) throw new Error('WalletConnect not initialized');
  return web3wallet;
}

export async function pairWithDApp(wcUri: string): Promise<void> {
  console.log('[WC] pairWithDApp called with URI:', wcUri.substring(0, 50) + '...');
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
  requiredNamespaces?: Record<string, any>,
  optionalNamespaces?: Record<string, any>,
  ethereumAddress?: string
): Promise<any> {
  const wallet = getWeb3Wallet();

  console.log('[WC] approveSessionProposal called', {
    proposalId,
    solanaAddress,
    requiredNamespaces,
    optionalNamespaces
  });

  const solanaRequest = collectSolanaRequest(
    requiredNamespaces,
    optionalNamespaces
  );
  const supportedNamespaces: Record<string, any> = {
    solana: {
      chains: solanaRequest.chains,
      methods: DEFAULT_SOLANA_METHODS,
      events: solanaRequest.events,
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

  console.log('[WC] Building namespaces with', { supportedNamespaces });

  const namespaces = buildApprovedNamespaces({
    proposal: {
      requiredNamespaces: requiredNamespaces || {},
      optionalNamespaces: optionalNamespaces || {}
    },
    supportedNamespaces
  });

  console.log('[WC] Built namespaces:', namespaces);
  console.log('[WC] Calling wallet.approveSession...');

  const session = await wallet.approveSession({
    id: proposalId,
    namespaces
  });

  console.log('[WC] Session approved successfully:', {
    topic: session.topic,
    peer: session.peer?.metadata?.name
  });

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

export function getActiveSessions() {
  return getWeb3Wallet().getActiveSessions();
}

export async function disconnectSession(topic: string): Promise<void> {
  const wallet = getWeb3Wallet();
  await wallet.disconnectSession({
    topic,
    reason: getSdkError('USER_DISCONNECTED')
  });
}
