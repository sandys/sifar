import { Core } from '@walletconnect/core';
import { Web3Wallet, IWeb3Wallet } from '@walletconnect/web3wallet';
import { getSdkError } from '@walletconnect/utils';
import { SOLANA_MAINNET_CAIP2 } from './constants';

let web3wallet: IWeb3Wallet | null = null;

const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID || '';

export async function initWalletConnect(): Promise<IWeb3Wallet> {
  if (web3wallet) return web3wallet;
  if (!WALLETCONNECT_PROJECT_ID) {
    throw new Error('Missing NEXT_PUBLIC_WC_PROJECT_ID');
  }

  const core = new Core({
    projectId: WALLETCONNECT_PROJECT_ID
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
  const wallet = await initWalletConnect();
  await wallet.core.pairing.pair({ uri: wcUri });
}

export async function approveSessionProposal(
  proposalId: number,
  solanaAddress: string,
  ethereumAddress?: string
): Promise<any> {
  const wallet = getWeb3Wallet();

  const namespaces: Record<string, any> = {
    solana: {
      chains: [SOLANA_MAINNET_CAIP2],
      methods: [
        'solana_signTransaction',
        'solana_signMessage',
        'solana_signAllTransactions',
        'solana_signAndSendTransaction'
      ],
      events: [],
      accounts: [`${SOLANA_MAINNET_CAIP2}:${solanaAddress}`]
    }
  };

  if (ethereumAddress) {
    namespaces.eip155 = {
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

  const session = await wallet.approveSession({
    id: proposalId,
    namespaces
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
