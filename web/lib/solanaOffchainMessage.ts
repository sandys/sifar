import bs58 from 'bs58';

const SIGNING_DOMAIN = new Uint8Array([
  0xff, 0x73, 0x6f, 0x6c, 0x61, 0x6e, 0x61, 0x20,
  0x6f, 0x66, 0x66, 0x63, 0x68, 0x61, 0x69, 0x6e
]);
const OCMS_V1_VERSION = 1;
const SOLANA_PUBLIC_KEY_BYTES = 32;
const MAX_SIGNERS = 255;
const MAX_WALLETCONNECT_MESSAGE_BYTES = 4096;

type ParsedOffchainMessageV1 = {
  message: string;
  messageBytes: Uint8Array;
  signers: Uint8Array[];
};

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must contain valid UTF-8 text`);
  }
}

function encodeUtf8(message: string): Uint8Array {
  if (!message) {
    throw new Error('Solana off-chain message cannot be empty');
  }
  const bytes = new TextEncoder().encode(message);
  if (decodeUtf8(bytes, 'Solana off-chain message') !== message) {
    throw new Error('Solana off-chain message contains invalid Unicode');
  }
  return bytes;
}

export function decodeSolanaPublicKey(address: string): Uint8Array {
  let publicKey: Uint8Array;
  try {
    publicKey = bs58.decode(address);
  } catch {
    throw new Error('Invalid Solana signer address');
  }
  if (publicKey.length !== SOLANA_PUBLIC_KEY_BYTES) {
    throw new Error('Invalid Solana signer address length');
  }
  return publicKey;
}

export function decodeWalletConnectMessage(encoded: unknown): {
  bytes: Uint8Array;
  text: string;
} {
  if (typeof encoded !== 'string' || !encoded) {
    throw new Error('WalletConnect request is missing a base58 message');
  }

  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(encoded);
  } catch {
    throw new Error('WalletConnect message is not valid base58');
  }
  if (bytes.length === 0) {
    throw new Error('WalletConnect message cannot be empty');
  }
  if (bytes.length > MAX_WALLETCONNECT_MESSAGE_BYTES) {
    throw new Error(
      `WalletConnect message exceeds ${MAX_WALLETCONNECT_MESSAGE_BYTES} bytes`
    );
  }

  return {
    bytes,
    text: decodeUtf8(bytes, 'WalletConnect message')
  };
}

export function serializeSolanaOffchainMessageV1(
  message: string,
  signerPublicKeys: Uint8Array[]
): Uint8Array {
  if (
    signerPublicKeys.length === 0 ||
    signerPublicKeys.length > MAX_SIGNERS
  ) {
    throw new Error('Solana off-chain message requires 1 to 255 signers');
  }

  const signers = signerPublicKeys.map((signer) => {
    if (signer.length !== SOLANA_PUBLIC_KEY_BYTES) {
      throw new Error('Solana signer public key must be 32 bytes');
    }
    return Uint8Array.from(signer);
  });
  signers.sort(compareBytes);
  for (let index = 1; index < signers.length; index += 1) {
    if (equalBytes(signers[index - 1], signers[index])) {
      throw new Error('Solana off-chain signer list contains duplicates');
    }
  }

  const messageBytes = encodeUtf8(message);
  const result = new Uint8Array(
    SIGNING_DOMAIN.length + 2 + signers.length * SOLANA_PUBLIC_KEY_BYTES +
      messageBytes.length
  );
  let offset = 0;
  result.set(SIGNING_DOMAIN, offset);
  offset += SIGNING_DOMAIN.length;
  result[offset] = OCMS_V1_VERSION;
  offset += 1;
  result[offset] = signers.length;
  offset += 1;
  for (const signer of signers) {
    result.set(signer, offset);
    offset += signer.length;
  }
  result.set(messageBytes, offset);
  return result;
}

export function parseSolanaOffchainMessageV1(
  serialized: Uint8Array
): ParsedOffchainMessageV1 {
  const minimumLength = SIGNING_DOMAIN.length + 2 + SOLANA_PUBLIC_KEY_BYTES + 1;
  if (serialized.length < minimumLength) {
    throw new Error('Solana off-chain message is too short');
  }
  if (!equalBytes(serialized.slice(0, SIGNING_DOMAIN.length), SIGNING_DOMAIN)) {
    throw new Error('Invalid Solana off-chain signing domain');
  }

  let offset = SIGNING_DOMAIN.length;
  if (serialized[offset] !== OCMS_V1_VERSION) {
    throw new Error(`Unsupported Solana off-chain version: ${serialized[offset]}`);
  }
  offset += 1;
  const signerCount = serialized[offset];
  offset += 1;
  if (signerCount === 0) {
    throw new Error('Solana off-chain message has no signers');
  }
  if (
    serialized.length <=
    offset + signerCount * SOLANA_PUBLIC_KEY_BYTES
  ) {
    throw new Error('Solana off-chain message has no content');
  }

  const signers: Uint8Array[] = [];
  for (let index = 0; index < signerCount; index += 1) {
    const signer = serialized.slice(offset, offset + SOLANA_PUBLIC_KEY_BYTES);
    offset += SOLANA_PUBLIC_KEY_BYTES;
    if (index > 0 && compareBytes(signers[index - 1], signer) >= 0) {
      throw new Error('Solana off-chain signers are not canonical');
    }
    signers.push(signer);
  }

  const messageBytes = serialized.slice(offset);
  return {
    message: decodeUtf8(messageBytes, 'Solana off-chain message'),
    messageBytes,
    signers
  };
}

export {
  MAX_WALLETCONNECT_MESSAGE_BYTES,
  OCMS_V1_VERSION,
  SIGNING_DOMAIN
};
