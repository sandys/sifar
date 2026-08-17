'use client';

import { Buffer } from 'buffer';
import TrezorConnect from './trezorConnect';
import { decodeSolanaPublicKey } from './solanaOffchainMessage';
import {
  getDeviceSessionState,
  shutdownDeviceSession
} from './deviceSession';

let initPromise: Promise<void> | null = null;

class TrezorDisconnectedError extends Error {
  constructor() {
    super('Trezor_Disconnected');
    this.name = 'TrezorDisconnectedError';
  }
}

/**
 * Defence in depth. The deviceSession arbiter is the real gate — it never
 * submits an op against a closed gate — but any device entry point still
 * refuses to run once the session is torn down, so a stray direct call cannot
 * re-acquire the device behind the arbiter's back.
 */
function assertDeviceConnected() {
  if (getDeviceSessionState().status === 'disconnected') {
    throw new TrezorDisconnectedError();
  }
}

function ensureBuffer() {
  if (typeof globalThis.Buffer === 'undefined') {
    globalThis.Buffer = Buffer;
  }
}

async function initTrezor() {
  // Memoize the in-flight init. `initialized = true` only ran after the await,
  // so two concurrent callers (handleConnect fires getTrezorDeviceInfo without
  // awaiting it, then calls getSolanaAddress) both saw false and each built a
  // transport. The second overwrote the first while the first kept listening,
  // which left the device talking to an orphaned transport.
  if (initPromise) return initPromise;

  ensureBuffer();
  initPromise = TrezorConnect.init({
    manifest: {
      email: 'dev@vaultbridge.io',
      appUrl: 'https://vaultbridge.io'
    },
    debug: process.env.NODE_ENV === 'development'
  });

  try {
    await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

export async function requestWebUSBDevice() {
  await initTrezor();
  await TrezorConnect.requestWebUSBDevice();
}

export async function getSolanaAddress(
  accountIndex = 0,
  showOnTrezor = true
): Promise<{ address: string; path: string }> {
  assertDeviceConnected();
  await initTrezor();

  const path = `m/44'/501'/${accountIndex}'/0'`;
  const result = await TrezorConnect.solanaGetAddress({
    path,
    showOnTrezor
  });

  if (!result.success) {
    throw new TrezorError(result.payload.error, result.payload.code);
  }

  return {
    address: result.payload.address,
    path
  };
}

export async function signSolanaTransaction(
  serializedTx: Uint8Array,
  derivationPath: string
): Promise<{ signature: string }> {
  assertDeviceConnected();
  await initTrezor();
  ensureBuffer();

  const hexTx = Buffer.from(serializedTx).toString('hex');
  const result = await TrezorConnect.solanaSignTransaction({
    path: derivationPath,
    serializedTx: hexTx
  });

  if (!result.success) {
    throw new TrezorError(result.payload.error, result.payload.code);
  }

  return { signature: result.payload.signature };
}

export async function signSolanaMessage(
  message: string,
  derivationPath: string,
  signerAddresses: string[]
): Promise<{ signature: string; signedData: string }> {
  assertDeviceConnected();
  await initTrezor();
  ensureBuffer();

  const signers = signerAddresses.map((address) =>
    Buffer.from(decodeSolanaPublicKey(address)).toString('hex')
  );
  const result = await TrezorConnect.solanaSignMessage({
    path: derivationPath,
    message,
    signers,
    chunkify: true
  });

  if (!result.success) {
    throw new TrezorError(result.payload.error, result.payload.code);
  }

  return {
    signature: result.payload.signature,
    signedData: result.payload.signedData
  };
}

/**
 * Re-derive an address with `show_display`, so the Trezor prints it and the
 * user physically confirms before it is shared with anything.
 *
 * Enumeration deliberately runs silently — 200 confirmations would be
 * unusable — so this is the gate for the one address that actually gets
 * exposed. The returned address is compared against what enumeration found:
 * a mismatch means the host cannot be trusted about which key it is using, so
 * it fails closed.
 */
export async function confirmSolanaAddressOnDevice(
  accountIndex: number,
  expectedAddress: string
): Promise<void> {
  const { address } = await getSolanaAddress(accountIndex, true);
  if (address !== expectedAddress) {
    throw new TrezorError(
      `Device returned a different address than enumeration found ` +
        `(expected ${expectedAddress}, device says ${address}). Refusing to continue.`
    );
  }
}

export async function getTrezorDeviceInfo(): Promise<{
  label: string;
  model: string;
  firmwareVersion: string;
} | null> {
  assertDeviceConnected();
  await initTrezor();

  const result = await TrezorConnect.getFeatures();
  if (!result.success) return null;

  const features = result.payload;
  return {
    label: features.label || 'Trezor',
    model: features.model || 'Unknown',
    firmwareVersion: `${features.major_version}.${features.minor_version}.${features.patch_version}`
  };
}

export async function disconnectTrezor(): Promise<void> {
  // The arbiter owns teardown now: it closes the gate synchronously, waits out
  // any in-flight lock (or runs a bounded teardown lock), then disposes the
  // transport. Clearing initPromise here means the next connect re-runs
  // TrezorConnect.init rather than reusing a resolved promise for a disposed
  // transport.
  await shutdownDeviceSession();
  initPromise = null;
}

class TrezorError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'TrezorError';
    this.code = code;
  }
}
