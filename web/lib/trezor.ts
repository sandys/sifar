'use client';

import { Buffer } from 'buffer';
import TrezorConnect from './trezorConnect';

let initialized = false;

function ensureBuffer() {
  if (typeof globalThis.Buffer === 'undefined') {
    globalThis.Buffer = Buffer;
  }
}

export async function initTrezor() {
  if (initialized) return;
  ensureBuffer();

  await TrezorConnect.init({
    manifest: {
      email: 'dev@vaultbridge.io',
      appUrl: 'https://vaultbridge.io'
    },
    debug: process.env.NODE_ENV === 'development'
  });

  initialized = true;
}

export async function requestWebUSBDevice() {
  await initTrezor();
  await TrezorConnect.requestWebUSBDevice();
}

export async function getSolanaAddress(
  accountIndex = 0,
  showOnTrezor = true
): Promise<{ address: string; path: string }> {
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

export async function getSolanaAddresses(count = 3) {
  const accounts: Array<{ address: string; path: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const { address, path } = await getSolanaAddress(i, i === 0);
    accounts.push({ address, path });
  }
  return accounts;
}

export async function signSolanaTransaction(
  serializedTx: Uint8Array,
  derivationPath: string
): Promise<{ signature: string }> {
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
  message: Uint8Array,
  derivationPath: string
): Promise<{ signature: string }> {
  await initTrezor();
  ensureBuffer();

  const hexMessage = Buffer.from(message).toString('hex');
  const result = await TrezorConnect.solanaSignTransaction({
    path: derivationPath,
    serializedTx: hexMessage
  });

  if (!result.success) {
    throw new TrezorError(result.payload.error, result.payload.code);
  }

  return { signature: result.payload.signature };
}

export async function checkTrezorAvailable(): Promise<boolean> {
  try {
    await initTrezor();
    const result = await TrezorConnect.getFeatures();
    return result.success;
  } catch {
    return false;
  }
}

export async function getTrezorDeviceInfo(): Promise<{
  label: string;
  model: string;
  firmwareVersion: string;
} | null> {
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

class TrezorError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'TrezorError';
    this.code = code;
  }
}
