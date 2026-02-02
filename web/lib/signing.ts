import { Transaction, VersionedTransaction, Connection } from '@solana/web3.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { signSolanaTransaction, signSolanaMessage } from './trezor';
import { respondToSessionRequest, rejectSessionRequest } from './walletconnect';
import { useAppStore } from './store';
import { DEFAULT_SOLANA_RPC } from './constants';

export async function handleSessionRequest(event: {
  id: number;
  topic: string;
  params: {
    request: {
      method: string;
      params: any;
    };
    chainId: string;
  };
}) {
  const { id, topic } = event;
  const { method, params } = event.params.request;

  try {
    switch (method) {
      case 'solana_signTransaction':
        return await handleSolanaSignTransaction(topic, id, params);
      case 'solana_signAllTransactions':
        return await handleSolanaSignAllTransactions(topic, id, params);
      case 'solana_signMessage':
        return await handleSolanaSignMessage(topic, id, params);
      case 'solana_signAndSendTransaction':
        return await handleSolanaSignAndSendTransaction(topic, id, params);
      default:
        await rejectSessionRequest(topic, id, `Unsupported method: ${method}`);
    }
  } catch (error: any) {
    await rejectSessionRequest(topic, id, error.message || 'Signing failed');
  }
}

async function handleSolanaSignTransaction(
  topic: string,
  requestId: number,
  params: any
) {
  const txBase64 = typeof params === 'string' ? params : params.transaction;
  if (!txBase64) throw new Error('No transaction data in request');

  const txBytes = Buffer.from(txBase64, 'base64');

  let txForDisplay: Transaction | VersionedTransaction;
  let messageBytes: Uint8Array;

  try {
    const vtx = VersionedTransaction.deserialize(txBytes);
    txForDisplay = vtx;
    messageBytes = vtx.message.serialize();
  } catch {
    const tx = Transaction.from(txBytes);
    txForDisplay = tx;
    messageBytes = tx.serializeMessage();
  }

  const store = useAppStore.getState();
  store.setPendingRequest({
    type: 'solana_signTransaction',
    topic,
    requestId,
    transaction: txForDisplay,
    rawBytes: txBytes,
    messageBytes
  });
}

export async function approveCurrentRequest() {
  const store = useAppStore.getState();
  const pending = store.pendingRequest;
  if (!pending) throw new Error('No pending request');

  const { topic, requestId, rawBytes, messageBytes } = pending;
  const { signature: hexSig } = await signSolanaTransaction(
    messageBytes,
    store.solanaDerivationPath
  );

  const sigBytes = Buffer.from(hexSig, 'hex');
  let signedTxBase64: string;

  try {
    const vtx = VersionedTransaction.deserialize(rawBytes!);
    vtx.addSignature(vtx.message.staticAccountKeys[0], sigBytes);
    signedTxBase64 = Buffer.from(vtx.serialize()).toString('base64');
  } catch {
    const tx = Transaction.from(rawBytes!);
    tx.addSignature(tx.feePayer!, sigBytes);
    signedTxBase64 = Buffer.from(tx.serialize()).toString('base64');
  }

  const response = {
    signature: bs58.encode(sigBytes),
    transaction: signedTxBase64
  };

  await respondToSessionRequest(topic, requestId, response);
  store.clearPendingRequest();
}

export async function rejectCurrentRequest() {
  const store = useAppStore.getState();
  const pending = store.pendingRequest;
  if (!pending) return;

  await rejectSessionRequest(pending.topic, pending.requestId, 'User rejected');
  store.clearPendingRequest();
}

async function handleSolanaSignAllTransactions(
  topic: string,
  requestId: number,
  params: any
) {
  const transactions: string[] = params.transactions || params;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    throw new Error('No transactions in request');
  }

  const store = useAppStore.getState();
  store.setPendingRequest({
    type: 'solana_signAllTransactions',
    topic,
    requestId,
    transactions: transactions.map((txBase64) => {
      const txBytes = Buffer.from(txBase64, 'base64');
      let messageBytes: Uint8Array;
      try {
        const vtx = VersionedTransaction.deserialize(txBytes);
        messageBytes = vtx.message.serialize();
      } catch {
        const tx = Transaction.from(txBytes);
        messageBytes = tx.serializeMessage();
      }
      return { rawBytes: txBytes, messageBytes };
    }),
    messageBytes: new Uint8Array()
  });
}

export async function approveBatchRequest() {
  const store = useAppStore.getState();
  const pending = store.pendingRequest;
  if (!pending || pending.type !== 'solana_signAllTransactions') {
    throw new Error('No batch request pending');
  }

  const signedTransactions: string[] = [];

  for (const tx of pending.transactions || []) {
    const { signature: hexSig } = await signSolanaTransaction(
      tx.messageBytes,
      store.solanaDerivationPath
    );

    const sigBytes = Buffer.from(hexSig, 'hex');

    try {
      const vtx = VersionedTransaction.deserialize(tx.rawBytes);
      vtx.addSignature(vtx.message.staticAccountKeys[0], sigBytes);
      signedTransactions.push(Buffer.from(vtx.serialize()).toString('base64'));
    } catch {
      const legacyTx = Transaction.from(tx.rawBytes);
      legacyTx.addSignature(legacyTx.feePayer!, sigBytes);
      signedTransactions.push(
        Buffer.from(legacyTx.serialize()).toString('base64')
      );
    }
  }

  await respondToSessionRequest(pending.topic, pending.requestId, {
    transactions: signedTransactions
  });

  store.clearPendingRequest();
}

async function handleSolanaSignAndSendTransaction(
  topic: string,
  requestId: number,
  params: any
) {
  const txBase64 = typeof params === 'string' ? params : params.transaction;
  const txBytes = Buffer.from(txBase64, 'base64');

  let messageBytes: Uint8Array;
  try {
    const vtx = VersionedTransaction.deserialize(txBytes);
    messageBytes = vtx.message.serialize();
  } catch {
    const tx = Transaction.from(txBytes);
    messageBytes = tx.serializeMessage();
  }

  const store = useAppStore.getState();
  store.setPendingRequest({
    type: 'solana_signAndSendTransaction',
    topic,
    requestId,
    rawBytes: txBytes,
    messageBytes,
    sendAfterSign: true
  });
}

export async function approveAndSendRequest() {
  const store = useAppStore.getState();
  const pending = store.pendingRequest;
  if (!pending || !pending.sendAfterSign) {
    throw new Error('No send-after-sign request pending');
  }

  const { signature: hexSig } = await signSolanaTransaction(
    pending.messageBytes,
    store.solanaDerivationPath
  );

  const sigBytes = Buffer.from(hexSig, 'hex');
  let signedTxBytes: Uint8Array;

  try {
    const vtx = VersionedTransaction.deserialize(pending.rawBytes!);
    vtx.addSignature(vtx.message.staticAccountKeys[0], sigBytes);
    signedTxBytes = vtx.serialize();
  } catch {
    const tx = Transaction.from(pending.rawBytes!);
    tx.addSignature(tx.feePayer!, sigBytes);
    signedTxBytes = tx.serialize();
  }

  const rpcUrl =
    DEFAULT_SOLANA_RPC.startsWith('/') && typeof window !== 'undefined'
      ? new URL(DEFAULT_SOLANA_RPC, window.location.origin).toString()
      : DEFAULT_SOLANA_RPC;
  const connection = new Connection(rpcUrl, 'confirmed');
  const txHash = await connection.sendRawTransaction(signedTxBytes, {
    skipPreflight: false,
    preflightCommitment: 'confirmed'
  });

  await respondToSessionRequest(pending.topic, pending.requestId, {
    signature: txHash
  });

  store.clearPendingRequest();
}

async function handleSolanaSignMessage(
  topic: string,
  requestId: number,
  params: any
) {
  const message = params.message;
  const messageBytes =
    typeof message === 'string'
      ? Buffer.from(message, 'base64')
      : new Uint8Array(message);

  const store = useAppStore.getState();
  store.setPendingRequest({
    type: 'solana_signMessage',
    topic,
    requestId,
    messageBytes,
    humanMessage: new TextDecoder().decode(messageBytes)
  });
}

export async function approveMessageRequest() {
  const store = useAppStore.getState();
  const pending = store.pendingRequest;
  if (!pending || pending.type !== 'solana_signMessage') {
    throw new Error('No message request pending');
  }

  const { signature } = await signSolanaMessage(
    pending.messageBytes,
    store.solanaDerivationPath
  );

  const sigBytes = Buffer.from(signature, 'hex');
  await respondToSessionRequest(pending.topic, pending.requestId, {
    signature: bs58.encode(sigBytes)
  });

  store.clearPendingRequest();
}
