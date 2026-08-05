import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import {
  MAX_WALLETCONNECT_MESSAGE_BYTES,
  OCMS_V1_VERSION,
  SIGNING_DOMAIN,
  decodeSolanaPublicKey,
  decodeWalletConnectMessage,
  equalBytes,
  parseSolanaOffchainMessageV1,
  serializeSolanaOffchainMessageV1
} from './solanaOffchainMessage';

describe('Solana OCMS v1', () => {
  it('serializes the exact stable firmware signing payload', () => {
    const signer = new Uint8Array(32).fill(7);
    const message = 'Hello, Solana!';
    const serialized = serializeSolanaOffchainMessageV1(message, [signer]);
    const expected = new Uint8Array([
      ...SIGNING_DOMAIN,
      OCMS_V1_VERSION,
      1,
      ...signer,
      ...new TextEncoder().encode(message)
    ]);

    expect(equalBytes(serialized, expected)).toBe(true);
    expect(parseSolanaOffchainMessageV1(serialized)).toEqual({
      message,
      messageBytes: new TextEncoder().encode(message),
      signers: [signer]
    });
  });

  it('sorts signers canonically and rejects duplicates', () => {
    const high = new Uint8Array(32).fill(2);
    const low = new Uint8Array(32).fill(1);
    const parsed = parseSolanaOffchainMessageV1(
      serializeSolanaOffchainMessageV1('multi', [high, low])
    );

    expect(equalBytes(parsed.signers[0], low)).toBe(true);
    expect(equalBytes(parsed.signers[1], high)).toBe(true);
    expect(() =>
      serializeSolanaOffchainMessageV1('duplicate', [low, low])
    ).toThrow('duplicates');
  });

  it('preserves valid UTF-8 and rejects malformed envelopes', () => {
    const signer = new Uint8Array(32).fill(3);
    const serialized = serializeSolanaOffchainMessageV1('Hello, world!', [
      signer
    ]);
    const badVersion = Uint8Array.from(serialized);
    badVersion[SIGNING_DOMAIN.length] = 2;

    expect(parseSolanaOffchainMessageV1(serialized).message).toBe(
      'Hello, world!'
    );
    expect(() => parseSolanaOffchainMessageV1(badVersion)).toThrow(
      'Unsupported Solana off-chain version'
    );
    expect(() => serializeSolanaOffchainMessageV1('', [signer])).toThrow(
      'cannot be empty'
    );
  });
});

describe('WalletConnect Solana message decoding', () => {
  it('decodes the WalletConnect message as base58, not base64', () => {
    const bytes = new TextEncoder().encode('Sign in to the dApp');
    const decoded = decodeWalletConnectMessage(bs58.encode(bytes));

    expect(decoded.text).toBe('Sign in to the dApp');
    expect(equalBytes(decoded.bytes, bytes)).toBe(true);
    expect(() => decodeWalletConnectMessage('SGVsbG8=')).toThrow('base58');
  });

  it('rejects binary, empty, and oversized messages', () => {
    expect(() => decodeWalletConnectMessage('')).toThrow('missing');
    expect(() => decodeWalletConnectMessage(bs58.encode([0xff, 0xfe]))).toThrow(
      'UTF-8'
    );
    expect(() =>
      decodeWalletConnectMessage(
        bs58.encode(new Uint8Array(MAX_WALLETCONNECT_MESSAGE_BYTES + 1).fill(65))
      )
    ).toThrow('exceeds');
  });

  it('requires an exact 32-byte Solana public key', () => {
    const key = new Uint8Array(32).fill(9);
    expect(equalBytes(decodeSolanaPublicKey(bs58.encode(key)), key)).toBe(true);
    expect(() => decodeSolanaPublicKey(bs58.encode(new Uint8Array(31)))).toThrow(
      'length'
    );
  });
});
