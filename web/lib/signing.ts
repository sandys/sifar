import { Transaction, VersionedTransaction, Connection, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { signSolanaMessage, signSolanaTransaction } from './trezor';
import { respondToSessionRequest, rejectSessionRequest } from './walletconnect';
import { useAppStore, type SolanaAccount } from './store';
import { DEFAULT_SOLANA_RPC } from './constants';
import {
  decodeSolanaPublicKey,
  equalBytes,
  serializeSolanaOffchainMessageV1
} from './solanaOffchainMessage';
import { verifyTrezorSolanaMessageResult } from './solanaMessageSigning';
import { prepareWalletConnectSolanaMessage } from './walletConnectSolanaMessage';

/**
 * Error codes returned to dApps.
 *
 * A dApp branches on these, so they must describe what actually happened.
 * Reporting everything as 4001 tells the dApp the user declined, which is a
 * lie for a broadcast failure and makes the failure undiagnosable from the
 * other side.
 */
export const WC_ERROR_USER_REJECTED = 4001;
/** EIP-1193 "resource unavailable": another request is already awaiting input. */
export const WC_ERROR_REQUEST_PENDING = -32002;
/** EIP-1474 "transaction rejected": signed, but the network would not take it. */
export const WC_ERROR_TRANSACTION_FAILED = -32003;

/**
 * Thrown when the dApp has already been given a final answer for this request.
 *
 * The UI catch-all rejects any request that fails, which is what stops a dApp
 * hanging. Without this marker that safety net would send a second, wrong
 * response (4001) on top of the accurate one already on the wire.
 */
export class RequestAnsweredError extends Error {
  readonly requestAnswered = true;

  constructor(message: string) {
    super(message);
    this.name = 'RequestAnsweredError';
  }
}

export function isRequestAnsweredError(error: unknown): boolean {
  return !!(error as { requestAnswered?: boolean } | null)?.requestAnswered;
}

/**
 * Convert hex signature to 64-byte Buffer.
 * Trezor returns signature as hex string (128 chars = 64 bytes).
 */
function normalizeSignature(hexSig: string): Buffer {
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

/**
 * Address this WalletConnect session was approved for.
 * Throws if the session is gone, so callers fail closed rather than falling
 * back to whatever account the UI happens to have selected.
 */
function requireSessionWalletAddress(topic: string): string {
  const session = useAppStore
    .getState()
    .activeSessions.find((item) => item.topic === topic);
  if (!session) {
    throw new Error('WalletConnect session is no longer active');
  }
  return session.walletAddress;
}

/**
 * Resolve which Trezor account must sign this transaction.
 *
 * The signer comes from the transaction bytes, never from UI state, and must be
 * the address the requesting session was approved for — otherwise a dApp
 * connected to one account could harvest signatures from any other enumerated
 * account. Every required-signature slot is considered, so transactions where
 * the wallet co-signs without paying the fee still resolve.
 */
export function resolveTransactionSigner(
  rawBytes: Uint8Array,
  sessionWalletAddress: string
): { account: SolanaAccount; signerKey: PublicKey } {
  const store = useAppStore.getState();

  let requiredSigners: PublicKey[];
  try {
    const vtx = VersionedTransaction.deserialize(rawBytes);
    const required = vtx.message.header.numRequiredSignatures;
    requiredSigners = vtx.message.staticAccountKeys.slice(0, required);
  } catch {
    const tx = Transaction.from(rawBytes);
    requiredSigners = tx.signatures.map((entry) => entry.publicKey);
    if (requiredSigners.length === 0 && tx.feePayer) {
      requiredSigners = [tx.feePayer];
    }
  }

  if (requiredSigners.length === 0) {
    throw new Error('Transaction declares no required signers');
  }

  const signerKey = requiredSigners.find(
    (key) => key.toBase58() === sessionWalletAddress
  );
  if (!signerKey) {
    throw new Error(
      `Transaction does not require a signature from the connected account ` +
        `${sessionWalletAddress}. Required signers: ` +
        requiredSigners.map((key) => key.toBase58()).join(', ')
    );
  }

  const matchingAccount = store.solanaAccounts.find(
    (acc) => acc.address === sessionWalletAddress
  );
  if (!matchingAccount) {
    throw new Error(
      `No Trezor account found for signer ${sessionWalletAddress}. ` +
        `Available accounts: ${store.solanaAccounts
          .map((a) => a.address)
          .join(', ')}`
    );
  }

  return { account: matchingAccount, signerKey };
}

/**
 * Sign one transaction on the device and attach the signature to the slot that
 * actually belongs to the signing key.
 *
 * Fails closed: a signature that does not verify locally is never returned to
 * the dApp, because neither VersionedTransaction.addSignature nor serialize()
 * checks it.
 */
async function signTransactionForSession(
  rawBytes: Uint8Array,
  messageBytes: Uint8Array,
  sessionWalletAddress: string
): Promise<{ signedTxBase64: string; sigBytes: Buffer; signerAddress: string }> {
  const { account, signerKey } = resolveTransactionSigner(
    rawBytes,
    sessionWalletAddress
  );

  console.log('[Signing] Signing with:', {
    derivationPath: account.path,
    signerAddress: account.address,
    messageBytesLength: messageBytes.length
  });

  const { signature: hexSig } = await signSolanaTransaction(
    messageBytes,
    account.path
  );
  const sigBytes = normalizeSignature(hexSig);

  const isValid = nacl.sign.detached.verify(
    messageBytes,
    sigBytes,
    signerKey.toBytes()
  );
  console.log(
    '[Signing] Local signature verification:',
    isValid ? 'VALID' : 'INVALID'
  );
  if (!isValid) {
    throw new Error(
      `Local signature verification failed for ${signerKey.toBase58()}. ` +
        'Refusing to return an unverified signature.'
    );
  }

  let versioned: VersionedTransaction | null = null;
  try {
    versioned = VersionedTransaction.deserialize(rawBytes);
  } catch {
    versioned = null;
  }

  let signedTxBytes: Uint8Array;
  if (versioned) {
    versioned.addSignature(signerKey, sigBytes);
    signedTxBytes = versioned.serialize();
  } else {
    const tx = Transaction.from(rawBytes);
    tx.addSignature(signerKey, sigBytes);
    signedTxBytes = tx.serialize();
  }

  return {
    signedTxBase64: Buffer.from(signedTxBytes).toString('base64'),
    sigBytes,
    signerAddress: account.address
  };
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

  // One request at a time. Staging a second one would overwrite `pendingRequest`
  // and silently strand the first: it disappears from the UI while its dApp
  // stays blocked on an id that can now never be answered. Refuse the newcomer
  // instead — it is the one that can still be retried.
  const inFlight = useAppStore.getState().pendingRequest;
  if (inFlight && !(inFlight.topic === topic && inFlight.requestId === id)) {
    console.warn('[Signing] Rejecting request: another is awaiting approval', {
      incomingId: id,
      awaitingId: inFlight.requestId
    });
    await rejectSessionRequest(
      topic,
      id,
      'Sifar is already waiting for approval of another request. ' +
        'Answer that one first, then send this again.',
      WC_ERROR_REQUEST_PENDING
    );
    return;
  }

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

  // Resolve the signer now so an unauthorized request is rejected immediately
  // instead of being staged and left for the user to discover.
  const { account } = resolveTransactionSigner(
    txBytes,
    requireSessionWalletAddress(topic)
  );

  const store = useAppStore.getState();
  store.setPendingRequest({
    type: 'solana_signTransaction',
    topic,
    requestId,
    transaction: txForDisplay,
    rawBytes: txBytes,
    messageBytes,
    signerAddress: account.address
  });
}

export async function approveCurrentRequest() {
  const store = useAppStore.getState();
  const pending = store.pendingRequest;
  if (!pending) throw new Error('No pending request');
  if (pending.type !== 'solana_signTransaction') {
    throw new Error('No transaction request pending');
  }

  const { topic, requestId, rawBytes, messageBytes } = pending;
  if (!rawBytes) throw new Error('Pending request has no transaction bytes');

  // Re-resolve against the live session: the session or account list may have
  // changed while the request sat on screen.
  const sessionWalletAddress = requireSessionWalletAddress(topic);
  if (pending.signerAddress && pending.signerAddress !== sessionWalletAddress) {
    throw new Error('WalletConnect signer changed before approval');
  }

  const { signedTxBase64, sigBytes } = await signTransactionForSession(
    rawBytes,
    messageBytes,
    sessionWalletAddress
  );

  try {
    await respondToSessionRequest(topic, requestId, {
      signature: bs58.encode(sigBytes),
      transaction: signedTxBase64
    });
  } finally {
    store.clearPendingRequest();
  }
}

export async function rejectCurrentRequest() {
  const store = useAppStore.getState();
  const pending = store.pendingRequest;
  if (!pending) return;

  try {
    await rejectSessionRequest(
      pending.topic,
      pending.requestId,
      'User rejected'
    );
  } finally {
    // Clear regardless: a dead session must not wedge the UI on a request that
    // can never be answered.
    store.clearPendingRequest();
  }
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

  const sessionWalletAddress = requireSessionWalletAddress(topic);

  const staged = transactions.map((txBase64) => {
    const txBytes = Buffer.from(txBase64, 'base64');
    let messageBytes: Uint8Array;
    try {
      const vtx = VersionedTransaction.deserialize(txBytes);
      messageBytes = vtx.message.serialize();
    } catch {
      const tx = Transaction.from(txBytes);
      messageBytes = tx.serializeMessage();
    }
    // Reject the whole batch up front if any member is not signable by the
    // connected account, rather than part-signing and failing midway.
    resolveTransactionSigner(txBytes, sessionWalletAddress);
    return { rawBytes: txBytes, messageBytes };
  });

  const store = useAppStore.getState();
  store.setPendingRequest({
    type: 'solana_signAllTransactions',
    topic,
    requestId,
    transactions: staged,
    messageBytes: new Uint8Array(),
    signerAddress: sessionWalletAddress
  });
}

export async function approveBatchRequest() {
  const store = useAppStore.getState();
  const pending = store.pendingRequest;
  if (!pending || pending.type !== 'solana_signAllTransactions') {
    throw new Error('No batch request pending');
  }

  const sessionWalletAddress = requireSessionWalletAddress(pending.topic);
  if (pending.signerAddress && pending.signerAddress !== sessionWalletAddress) {
    throw new Error('WalletConnect signer changed before approval');
  }

  const signedTransactions: string[] = [];

  for (const tx of pending.transactions || []) {
    const { signedTxBase64 } = await signTransactionForSession(
      tx.rawBytes,
      tx.messageBytes,
      sessionWalletAddress
    );
    signedTransactions.push(signedTxBase64);
  }

  try {
    await respondToSessionRequest(pending.topic, pending.requestId, {
      transactions: signedTransactions
    });
  } finally {
    store.clearPendingRequest();
  }
}

async function handleSolanaSignAndSendTransaction(
  topic: string,
  requestId: number,
  params: any
) {
  const txBase64 = typeof params === 'string' ? params : params.transaction;
  if (!txBase64) throw new Error('No transaction data in request');

  const txBytes = Buffer.from(txBase64, 'base64');

  let messageBytes: Uint8Array;
  try {
    const vtx = VersionedTransaction.deserialize(txBytes);
    messageBytes = vtx.message.serialize();
  } catch {
    const tx = Transaction.from(txBytes);
    messageBytes = tx.serializeMessage();
  }

  const { account } = resolveTransactionSigner(
    txBytes,
    requireSessionWalletAddress(topic)
  );

  const store = useAppStore.getState();
  store.setPendingRequest({
    type: 'solana_signAndSendTransaction',
    topic,
    requestId,
    rawBytes: txBytes,
    messageBytes,
    sendAfterSign: true,
    signerAddress: account.address
  });
}

export async function approveAndSendRequest() {
  const store = useAppStore.getState();
  const pending = store.pendingRequest;
  if (!pending || !pending.sendAfterSign) {
    throw new Error('No send-after-sign request pending');
  }
  if (!pending.rawBytes) {
    throw new Error('Pending request has no transaction bytes');
  }

  const sessionWalletAddress = requireSessionWalletAddress(pending.topic);
  if (pending.signerAddress && pending.signerAddress !== sessionWalletAddress) {
    throw new Error('WalletConnect signer changed before approval');
  }

  const { signedTxBase64 } = await signTransactionForSession(
    pending.rawBytes,
    pending.messageBytes,
    sessionWalletAddress
  );
  const signedTxBytes = Buffer.from(signedTxBase64, 'base64');

  const rpcUrl =
    DEFAULT_SOLANA_RPC.startsWith('/') && typeof window !== 'undefined'
      ? new URL(DEFAULT_SOLANA_RPC, window.location.origin).toString()
      : DEFAULT_SOLANA_RPC;
  const connection = new Connection(rpcUrl, 'confirmed');

  let txHash: string;
  try {
    txHash = await connection.sendRawTransaction(signedTxBytes, {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });
  } catch (error: any) {
    // The device already signed. Letting this propagate as a plain error made
    // the UI's catch-all answer the dApp with 4001 "User rejected" — wrong on
    // both counts: the user approved, and a send that timed out may still
    // confirm on chain. Answer accurately here and mark it as answered.
    const detail = error?.message || 'Unknown broadcast error';
    console.error('[Signing] Broadcast failed after signing:', detail);
    try {
      await rejectSessionRequest(
        pending.topic,
        pending.requestId,
        `Transaction was signed but could not be broadcast: ${detail}. ` +
          'It may still confirm — check the account before signing again.',
        WC_ERROR_TRANSACTION_FAILED
      );
    } finally {
      store.clearPendingRequest();
    }
    throw new RequestAnsweredError(
      `Signed, but broadcasting failed: ${detail}`
    );
  }

  try {
    await respondToSessionRequest(pending.topic, pending.requestId, {
      signature: txHash
    });
  } finally {
    store.clearPendingRequest();
  }
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
  try {
    await respondToSessionRequest(pending.topic, pending.requestId, {
      signature: verified.signature,
      signedMessage: verified.signedMessage,
      messageVersion: 1
    });
  } finally {
    store.clearPendingRequest();
  }
}
