import { Buffer } from 'buffer';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';
import { serializeSolanaOffchainMessageV1 } from './solanaOffchainMessage';
import { verifyTrezorSolanaMessageResult } from './solanaMessageSigning';

describe('Trezor Solana message result verification', () => {
  const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(17));
  const signerAddress = bs58.encode(keyPair.publicKey);
  const message = 'Verify this physical Trezor result';
  const signedData = serializeSolanaOffchainMessageV1(message, [
    keyPair.publicKey
  ]);
  const signature = nacl.sign.detached(signedData, keyPair.secretKey);

  it('accepts a signature over the exact OCMS v1 bytes', () => {
    const result = verifyTrezorSolanaMessageResult({
      message,
      signerAddress,
      signatureHex: Buffer.from(signature).toString('hex'),
      signedDataHex: Buffer.from(signedData).toString('hex')
    });

    expect(result.signature).toBe(bs58.encode(signature));
    expect(result.signedMessage).toBe(bs58.encode(signedData));
  });

  it('rejects a signature for another key', () => {
    const other = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(18));
    const wrongSignature = nacl.sign.detached(signedData, other.secretKey);

    expect(() =>
      verifyTrezorSolanaMessageResult({
        message,
        signerAddress,
        signatureHex: Buffer.from(wrongSignature).toString('hex'),
        signedDataHex: Buffer.from(signedData).toString('hex')
      })
    ).toThrow('failed local verification');
  });

  it('rejects changed firmware signed data before responding', () => {
    const changed = serializeSolanaOffchainMessageV1(`${message}!`, [
      keyPair.publicKey
    ]);
    const changedSignature = nacl.sign.detached(changed, keyPair.secretKey);

    expect(() =>
      verifyTrezorSolanaMessageResult({
        message,
        signerAddress,
        signatureHex: Buffer.from(changedSignature).toString('hex'),
        signedDataHex: Buffer.from(changed).toString('hex')
      })
    ).toThrow('different OCMS v1 signed data');
  });
});
