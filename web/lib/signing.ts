import { Transaction, VersionedTransaction, Connection, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { signSolanaMessage, signSolanaTransaction } from './trezor';
import { respondToSessionRequest, rejectSessionRequest } from './walletconnect';
import { useAppStore } from './store';
import { DEFAULT_SOLANA_RPC } from './constants';
import {
  decodeSolanaPublicKey,
  equalBytes,
  serializeSolanaOffchainMessageV1
} from './solanaOffchainMessage';
import { verifyTrezorSolanaMessageResult } from './solanaMessageSigning';
import { prepareWalletConnectSolanaMessage } from './walletConnectSolanaMessage';

/**
 * Convert hex signature to 64-byte Buffer.
 * Trezor returns signature as hex string (128 chars = 64 bytes).
 */
export function normalizeSignature(hexSig: string): Buffer {
  console.log('[Signing] Signature hex:', {
    length: hexSig.length,
    expectedHexLength: 128,
    first16: hexSig.substring(0, 16),
    last16: hexSig.substring(hexSig.length - 16)
  });

  const sigBytes = Buffer.from(hexSig, 'hex');
  console.log('[Signing] Signature bytes:', sigBytes.length, 'expected: 64');

  if (sigBytes.length !== 64) {
    throw new Error(`Unexpected signature length: ${sigBytes.length} bytes (expected 64, hex was ${hexSig.length} chars)`);
  }
  return sigBytes;
}

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
  const { chainId } = event.params;

  console.log('[Signing] session_request received', {
    id,
    topic,
    method,
    chainId,
    params: JSON.stringify(params).substring(0, 200) + '...'
  });

  try {
    switch (method) {
      case 'solana_signTransaction':
        console.log('[Signing] Handling solana_signTransaction');
        return await handleSolanaSignTransaction(topic, id, params);
      case 'solana_signAllTransactions':
        console.log('[Signing] Handling solana_signAllTransactions');
        return await handleSolanaSignAllTransactions(topic, id, params);
      case 'solana_signMessage':
        console.log('[Signing] Handling solana_signMessage');
        return await handleSolanaSignMessage(topic, id, params);
      case 'solana_signAndSendTransaction':
        console.log('[Signing] Handling solana_signAndSendTransaction');
        return await handleSolanaSignAndSendTransaction(topic, id, params);
      default:
        console.warn('[Signing] Unsupported method:', method);
        await rejectSessionRequest(topic, id, `Unsupported method: ${method}`);
    }
  } catch (error: any) {
    console.error('[Signing] Request failed:', error);
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

  // Find the signer address from the transaction
  let signerAddress: string;
  try {
    const vtx = VersionedTransaction.deserialize(rawBytes!);
    signerAddress = vtx.message.staticAccountKeys[0].toBase58();
  } catch {
    const tx = Transaction.from(rawBytes!);
    signerAddress = tx.feePayer?.toBase58() || '';
  }

  // Find the derivation path for this signer from our accounts
  const matchingAccount = store.solanaAccounts.find(
    (acc) => acc.address === signerAddress
  );

  if (!matchingAccount) {
    throw new Error(
      `No account found for signer ${signerAddress}. ` +
      `Available accounts: ${store.solanaAccounts.map(a => a.address).join(', ')}`
    );
  }

  const derivationPath = matchingAccount.path;

  console.log('[Signing] Signing with:', {
    derivationPath,
    signerAddress,
    storeAddress: store.solanaAddress,
    messageBytesLength: messageBytes.length,
    messageBytesHex: Buffer.from(messageBytes).toString('hex').substring(0, 64) + '...'
  });

  const { signature: hexSig } = await signSolanaTransaction(
    messageBytes,
    derivationPath
  );

  const sigBytes = normalizeSignature(hexSig);

  let signedTxBase64: string;
  let isVersioned = false;

  try {
    const vtx = VersionedTransaction.deserialize(rawBytes!);
    isVersioned = true;
    const signerKey = vtx.message.staticAccountKeys[0];
    console.log('[Signing] VersionedTransaction signer:', signerKey.toBase58());
    console.log('[Signing] Derivation path signer matches:', signerAddress === signerKey.toBase58());

    // Verify signature locally before adding
    const isValid = nacl.sign.detached.verify(
      messageBytes,
      sigBytes,
      signerKey.toBytes()
    );
    console.log('[Signing] Local signature verification:', isValid ? 'VALID' : 'INVALID');

    vtx.addSignature(signerKey, sigBytes);
    signedTxBase64 = Buffer.from(vtx.serialize()).toString('base64');
  } catch (versionedError: any) {
    if (isVersioned) {
      // VersionedTransaction parsing worked but addSignature failed
      console.error('[Signing] VersionedTransaction addSignature failed:', versionedError);
      throw versionedError;
    }
    // Try legacy Transaction
    console.log('[Signing] Trying legacy Transaction format');
    const tx = Transaction.from(rawBytes!);
    console.log('[Signing] Legacy Transaction feePayer:', tx.feePayer?.toBase58());
    console.log('[Signing] Legacy Transaction signatures:', tx.signatures.map(s => s.publicKey.toBase58()));
    if (!tx.feePayer) {
      throw new Error('Transaction has no feePayer set');
    }
    tx.addSignature(tx.feePayer, sigBytes);
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

    const sigBytes = normalizeSignature(hexSig);

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

  const sigBytes = normalizeSignature(hexSig);
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
  const store = useAppStore.getState();
  const session = store.activeSessions.find((item) => item.topic === topic);
  if (!session) {
    throw new Error('WalletConnect session is no longer active');
  }
  const prepared = prepareWalletConnectSolanaMessage(
    params,
    session.walletAddress,
    store.solanaAccounts
  );

  console.log('[Signing] Solana OCMS v1 request', {
    rawMessageBytes: prepared.messageBytes.length,
    signedDataBytes: prepared.expectedSignedData.length,
    signerAddress: prepared.signerAddress,
    derivationPath: prepared.derivationPath,
    preview: prepared.messageText.substring(0, 120)
  });

  store.setPendingRequest({
    type: 'solana_signMessage',
    topic,
    requestId,
    messageBytes: prepared.messageBytes,
    humanMessage: prepared.messageText,
    messageText: prepared.messageText,
    messageSignerAddress: prepared.signerAddress,
    messageDerivationPath: prepared.derivationPath,
    expectedSignedData: prepared.expectedSignedData,
    messageProtocol: 'ocms-v1'
  });
}

export async function approveMessageRequest() {
  const store = useAppStore.getState();
  const pending = store.pendingRequest;
  if (!pending || pending.type !== 'solana_signMessage') {
    throw new Error('No message request pending');
  }

  const {
    messageText,
    messageSignerAddress,
    messageDerivationPath,
    expectedSignedData
  } = pending;
  if (
    !messageText ||
    !messageSignerAddress ||
    !messageDerivationPath ||
    !expectedSignedData
  ) {
    throw new Error('Solana off-chain signing request is incomplete');
  }

  const session = store.activeSessions.find(
    (item) => item.topic === pending.topic
  );
  if (!session || session.walletAddress !== messageSignerAddress) {
    throw new Error('WalletConnect signer changed before approval');
  }
  const account = store.solanaAccounts.find(
    (item) => item.address === messageSignerAddress
  );
  if (!account || account.path !== messageDerivationPath) {
    throw new Error('Trezor account changed before approval');
  }

  const signerPublicKey = decodeSolanaPublicKey(messageSignerAddress);
  const locallySerialized = serializeSolanaOffchainMessageV1(messageText, [
    signerPublicKey
  ]);
  if (!equalBytes(locallySerialized, expectedSignedData)) {
    throw new Error('Solana off-chain message changed before approval');
  }

  const { signature: signatureHex, signedData: signedDataHex } =
    await signSolanaMessage(messageText, messageDerivationPath, [
      messageSignerAddress
    ]);
  const verified = verifyTrezorSolanaMessageResult({
    message: messageText,
    signerAddress: messageSignerAddress,
    signatureHex,
    signedDataHex
  });

  console.log('[Signing] OCMS v1 signature verified locally', {
    signerAddress: messageSignerAddress,
    signedDataBytes: verified.signedDataBytes.length
  });
  await respondToSessionRequest(pending.topic, pending.requestId, {
    signature: verified.signature,
    signedMessage: verified.signedMessage,
    messageVersion: 1
  });
  store.clearPendingRequest();
}
