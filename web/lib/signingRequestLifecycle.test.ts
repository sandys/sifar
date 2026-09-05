import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction
} from '@solana/web3.js';
import bs58 from 'bs58';
import { Buffer } from 'buffer';

const responded: Array<{ topic: string; id: number; result: any }> = [];
const rejected: Array<{
  topic: string;
  id: number;
  message: string;
  code?: number;
}> = [];

vi.mock('./walletconnect', () => ({
  respondToSessionRequest: (topic: string, id: number, result: any) => {
    responded.push({ topic, id, result });
    return Promise.resolve();
  },
  rejectSessionRequest: (
    topic: string,
    id: number,
    message: string,
    code?: number
  ) => {
    rejected.push({ topic, id, message, code });
    return Promise.resolve();
  }
}));

const signTransactionMock = vi.fn(() =>
  Promise.resolve({ signature: '00'.repeat(64) })
);

vi.mock('./trezor', () => ({
  signSolanaTransaction: () => signTransactionMock(),
  signSolanaMessage: () => Promise.resolve({ signature: '', signedData: '' })
}));

const {
  handleSessionRequest,
  isRequestAnsweredError,
  WC_ERROR_REQUEST_PENDING,
  WC_ERROR_USER_REJECTED
} = await import('./signing');
const { useAppStore } = await import('./store');

const BLOCKHASH = bs58.encode(new Uint8Array(32).fill(7));
const wallet = Keypair.generate().publicKey;

function account(address: PublicKey, index: number) {
  return {
    address: address.toBase58(),
    path: `m/44'/501'/${index}'/0'`,
    balance: null,
    tokens: [],
    balanceStatus: 'loading' as const,
    balanceError: null
  };
}

function buildTx(payer: PublicKey) {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: BLOCKHASH,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1
      })
    ]
  }).compileToV0Message();
  return new VersionedTransaction(message).serialize();
}

function signTransactionEvent(id: number, topic: string) {
  return {
    id,
    topic,
    params: {
      request: {
        method: 'solana_signTransaction',
        params: {
          transaction: Buffer.from(buildTx(wallet)).toString('base64')
        }
      },
      chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
    }
  };
}

describe('concurrent session requests', () => {
  beforeEach(() => {
    responded.length = 0;
    rejected.length = 0;
    const store = useAppStore.getState();
    store.setSolanaAccounts([account(wallet, 0)]);
    store.clearPendingRequest();
    store.removeActiveSession('topic-1');
    store.removeActiveSession('topic-2');
    store.addActiveSession({
      topic: 'topic-1',
      peerName: 'dApp One',
      peerUrl: 'https://one.example',
      chains: ['solana'],
      walletAddress: wallet.toBase58()
    });
  });

  it('keeps the first request staged and rejects the second', async () => {
    await handleSessionRequest(signTransactionEvent(1001, 'topic-1'));
    expect(useAppStore.getState().pendingRequest?.requestId).toBe(1001);

    await handleSessionRequest(signTransactionEvent(1002, 'topic-1'));

    // The staged request is untouched: the user is still answering 1001.
    expect(useAppStore.getState().pendingRequest?.requestId).toBe(1001);

    // The newcomer got a definitive answer, so its dApp does not hang.
    expect(rejected).toHaveLength(1);
    expect(rejected[0].id).toBe(1002);
    expect(rejected[0].code).toBe(WC_ERROR_REQUEST_PENDING);
    // -32002 is "resource unavailable", not "user rejected": nobody declined.
    expect(rejected[0].code).not.toBe(WC_ERROR_USER_REJECTED);
  });

  it('never leaves a request both unstaged and unanswered', async () => {
    await handleSessionRequest(signTransactionEvent(1001, 'topic-1'));
    await handleSessionRequest(signTransactionEvent(1002, 'topic-1'));

    const staged = useAppStore.getState().pendingRequest?.requestId;
    const answered = [...responded, ...rejected].map((entry) => entry.id);

    for (const id of [1001, 1002]) {
      expect(staged === id || answered.includes(id)).toBe(true);
    }
  });

  it('rejects a second request arriving from a different dApp', async () => {
    const store = useAppStore.getState();
    store.addActiveSession({
      topic: 'topic-2',
      peerName: 'dApp Two',
      peerUrl: 'https://two.example',
      chains: ['solana'],
      walletAddress: wallet.toBase58()
    });

    await handleSessionRequest(signTransactionEvent(2001, 'topic-1'));
    await handleSessionRequest(signTransactionEvent(2002, 'topic-2'));

    expect(useAppStore.getState().pendingRequest?.topic).toBe('topic-1');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].topic).toBe('topic-2');
    expect(rejected[0].code).toBe(WC_ERROR_REQUEST_PENDING);
  });

  it('re-staging the same id is not treated as a second request', async () => {
    await handleSessionRequest(signTransactionEvent(3001, 'topic-1'));
    await handleSessionRequest(signTransactionEvent(3001, 'topic-1'));

    expect(useAppStore.getState().pendingRequest?.requestId).toBe(3001);
    expect(rejected).toHaveLength(0);
  });
});

describe('isRequestAnsweredError', () => {
  it('recognises the marker and ignores ordinary errors', async () => {
    const { RequestAnsweredError } = await import('./signing');
    expect(isRequestAnsweredError(new RequestAnsweredError('done'))).toBe(true);
    expect(isRequestAnsweredError(new Error('device said no'))).toBe(false);
    expect(isRequestAnsweredError(null)).toBe(false);
    expect(isRequestAnsweredError(undefined)).toBe(false);
  });
});
