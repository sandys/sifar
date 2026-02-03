'use client';

import { Keypair, Transaction, TransactionInstruction, PublicKey, Connection } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Buffer } from 'buffer';
import { DEFAULT_SOLANA_RPC } from './constants';

// Memo Program ID (SPL Memo v2)
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export interface SessionKey {
  publicKey: string;        // Base58 encoded
  secretKey: Uint8Array;    // 64 bytes
  authority: string;        // Trezor address that delegated
  expiresAt: number;        // Unix timestamp (ms)
  attestationTx: string;    // Base64 encoded signed transaction
}

export interface SessionKeyInfo {
  publicKey: string;
  authority: string;
  expiresAt: number;
  hasAttestation: boolean;
}

export interface SessionProof {
  signature: string;        // Base58 encoded signature
  sessionKey: string;       // Base58 session public key
  attestationTx: string;    // Base64 signed attestation transaction
}

const SESSION_KEY_PREFIX = 'sifar_session_key_';

/**
 * Generate a new ephemeral Ed25519 keypair for session signing.
 */
export function generateSessionKey(): { publicKey: string; secretKey: Uint8Array } {
  const keypair = Keypair.generate();
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: keypair.secretKey
  };
}

/**
 * Create the attestation message that will be embedded in a memo transaction.
 */
export function createAttestationMessage(
  authority: string,
  sessionPublicKey: string,
  expiresAt: number
): string {
  return [
    'Sifar Session Key Delegation v1',
    `Authority: ${authority}`,
    `Session: ${sessionPublicKey}`,
    `Expires: ${expiresAt}`,
    `Scope: message_signing`
  ].join('\n');
}

/**
 * Create an attestation transaction with a memo instruction.
 * This transaction is signed by Trezor to authorize the session key.
 * It is NOT broadcast - the signature alone proves delegation.
 */
export async function createAttestationTransaction(
  authority: string,
  sessionPublicKey: string,
  expiresAt: number
): Promise<Transaction> {
  const attestationMessage = createAttestationMessage(authority, sessionPublicKey, expiresAt);

  // Create a transaction with a memo instruction
  const transaction = new Transaction();

  transaction.add(
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(attestationMessage, 'utf-8')
    })
  );

  // Get a recent blockhash (required for signing, but we won't broadcast)
  const rpcUrl =
    DEFAULT_SOLANA_RPC.startsWith('/') && typeof window !== 'undefined'
      ? new URL(DEFAULT_SOLANA_RPC, window.location.origin).toString()
      : DEFAULT_SOLANA_RPC;

  const connection = new Connection(rpcUrl, 'confirmed');
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = new PublicKey(authority);

  return transaction;
}

/**
 * Sign a message with the session key.
 */
export function signWithSessionKey(
  sessionKey: SessionKey,
  message: Uint8Array
): { signature: string; proof: SessionProof } {
  // Verify session key is still valid
  if (!isSessionKeyValid(sessionKey)) {
    throw new Error('Session key has expired');
  }

  // Sign the message with the session key's secret key
  const signature = nacl.sign.detached(message, sessionKey.secretKey);
  const signatureBase58 = bs58.encode(signature);

  const proof: SessionProof = {
    signature: signatureBase58,
    sessionKey: sessionKey.publicKey,
    attestationTx: sessionKey.attestationTx
  };

  return { signature: signatureBase58, proof };
}

/**
 * Verify a session delegation (for testing/display purposes).
 * This validates that the attestation transaction was signed by the authority.
 */
export function verifySessionDelegation(
  attestationTxBase64: string,
  expectedAuthority: string,
  expectedSessionKey: string
): { valid: boolean; error?: string } {
  try {
    const txBytes = Buffer.from(attestationTxBase64, 'base64');
    const tx = Transaction.from(txBytes);

    // Check that the transaction has the expected fee payer (authority)
    if (!tx.feePayer || tx.feePayer.toBase58() !== expectedAuthority) {
      return { valid: false, error: 'Authority mismatch' };
    }

    // Check that the transaction has exactly one signature from the authority
    const authoritySig = tx.signatures.find(
      sig => sig.publicKey.toBase58() === expectedAuthority
    );
    if (!authoritySig || !authoritySig.signature) {
      return { valid: false, error: 'Missing authority signature' };
    }

    // Verify the signature
    const isValid = nacl.sign.detached.verify(
      tx.serializeMessage(),
      authoritySig.signature,
      new PublicKey(expectedAuthority).toBytes()
    );

    if (!isValid) {
      return { valid: false, error: 'Invalid signature' };
    }

    // Parse the memo to verify session key
    const memoInstruction = tx.instructions.find(
      ix => ix.programId.equals(MEMO_PROGRAM_ID)
    );
    if (!memoInstruction) {
      return { valid: false, error: 'No memo instruction found' };
    }

    const memoText = memoInstruction.data.toString('utf-8');
    if (!memoText.includes(`Session: ${expectedSessionKey}`)) {
      return { valid: false, error: 'Session key mismatch in attestation' };
    }

    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Verification failed' };
  }
}

/**
 * Store a session key in sessionStorage (cleared on tab close).
 */
export function storeSessionKey(sessionKey: SessionKey): void {
  if (typeof window === 'undefined') return;

  const storageKey = `${SESSION_KEY_PREFIX}${sessionKey.authority}`;

  // Store in sessionStorage (cleared when tab closes)
  const data = {
    publicKey: sessionKey.publicKey,
    secretKey: Array.from(sessionKey.secretKey), // Convert Uint8Array to array for JSON
    authority: sessionKey.authority,
    expiresAt: sessionKey.expiresAt,
    attestationTx: sessionKey.attestationTx
  };

  sessionStorage.setItem(storageKey, JSON.stringify(data));

  console.log('[Sifar] Session key stored for', sessionKey.authority.slice(0, 8) + '...');
}

/**
 * Load a session key from sessionStorage.
 */
export function loadSessionKey(authority: string): SessionKey | null {
  if (typeof window === 'undefined') return null;

  const storageKey = `${SESSION_KEY_PREFIX}${authority}`;
  const stored = sessionStorage.getItem(storageKey);

  if (!stored) return null;

  try {
    const data = JSON.parse(stored);
    return {
      publicKey: data.publicKey,
      secretKey: new Uint8Array(data.secretKey),
      authority: data.authority,
      expiresAt: data.expiresAt,
      attestationTx: data.attestationTx
    };
  } catch {
    console.warn('[Sifar] Failed to parse stored session key');
    return null;
  }
}

/**
 * Clear a session key from storage.
 */
export function clearSessionKey(authority: string): void {
  if (typeof window === 'undefined') return;

  const storageKey = `${SESSION_KEY_PREFIX}${authority}`;
  sessionStorage.removeItem(storageKey);

  console.log('[Sifar] Session key cleared for', authority.slice(0, 8) + '...');
}

/**
 * Check if a session key is valid (exists and not expired).
 */
export function isSessionKeyValid(sessionKey: SessionKey | null): boolean {
  if (!sessionKey) return false;
  return Date.now() < sessionKey.expiresAt;
}

/**
 * Get session key info for display (without exposing secret key).
 */
export function getSessionKeyInfo(authority: string): SessionKeyInfo | null {
  const sessionKey = loadSessionKey(authority);
  if (!sessionKey) return null;

  return {
    publicKey: sessionKey.publicKey,
    authority: sessionKey.authority,
    expiresAt: sessionKey.expiresAt,
    hasAttestation: !!sessionKey.attestationTx
  };
}

/**
 * Parse expiration time from attestation memo.
 */
export function parseAttestationExpiry(attestationTxBase64: string): number | null {
  try {
    const txBytes = Buffer.from(attestationTxBase64, 'base64');
    const tx = Transaction.from(txBytes);

    const memoInstruction = tx.instructions.find(
      ix => ix.programId.equals(MEMO_PROGRAM_ID)
    );
    if (!memoInstruction) return null;

    const memoText = memoInstruction.data.toString('utf-8');
    const expiresMatch = memoText.match(/Expires: (\d+)/);
    if (!expiresMatch) return null;

    return parseInt(expiresMatch[1], 10);
  } catch {
    return null;
  }
}
