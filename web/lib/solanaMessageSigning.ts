import { Buffer } from 'buffer';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {
  decodeSolanaPublicKey,
  equalBytes,
  parseSolanaOffchainMessageV1,
  serializeSolanaOffchainMessageV1
} from './solanaOffchainMessage';

type VerifyMessageResultParams = {
  message: string;
  signerAddress: string;
  signatureHex: string;
  signedDataHex: string;
};

type VerifiedMessageResult = {
  signatureBytes: Uint8Array;
  signedDataBytes: Uint8Array;
  signature: string;
  signedMessage: string;
};

function decodeHex(value: string, label: string): Uint8Array {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw new Error(`${label} is not valid hex`);
  }
  return Buffer.from(value, 'hex');
}

export function verifyTrezorSolanaMessageResult({
  message,
  signerAddress,
  signatureHex,
  signedDataHex
}: VerifyMessageResultParams): VerifiedMessageResult {
  const signerPublicKey = decodeSolanaPublicKey(signerAddress);
  const signatureBytes = decodeHex(signatureHex, 'Trezor message signature');
  if (signatureBytes.length !== 64) {
    throw new Error('Trezor message signature must be 64 bytes');
  }

  const signedDataBytes = decodeHex(signedDataHex, 'Trezor signed data');
  const expected = serializeSolanaOffchainMessageV1(message, [signerPublicKey]);
  if (!equalBytes(signedDataBytes, expected)) {
    throw new Error('Trezor returned different OCMS v1 signed data');
  }

  const parsed = parseSolanaOffchainMessageV1(signedDataBytes);
  if (
    parsed.message !== message ||
    parsed.signers.length !== 1 ||
    !equalBytes(parsed.signers[0], signerPublicKey)
  ) {
    throw new Error('Trezor returned invalid OCMS v1 signed data');
  }
  if (
    !nacl.sign.detached.verify(
      signedDataBytes,
      signatureBytes,
      signerPublicKey
    )
  ) {
    throw new Error('Trezor message signature failed local verification');
  }

  return {
    signatureBytes,
    signedDataBytes,
    signature: bs58.encode(signatureBytes),
    signedMessage: bs58.encode(signedDataBytes)
  };
}
