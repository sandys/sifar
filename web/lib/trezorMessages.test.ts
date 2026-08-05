import { describe, expect, it } from 'vitest';
import {
  decodeMessage,
  encodeMessage,
  parseConfigure
} from '@trezor/protobuf';
import baseMessages from '@trezor/protobuf/messages.json';
import {
  SOLANA_MESSAGE_SIGNATURE_TYPE,
  SOLANA_SIGN_MESSAGE_TYPE,
  addStableSolanaMessageDefinitions,
  getFirmwareVersion,
  supportsStableSolanaOcmsV1
} from './trezorMessages';

describe('stable Solana message protobuf patch', () => {
  it('adds the firmware 2.12.4 OCMS v1 request and response schema', () => {
    const patched = addStableSolanaMessageDefinitions(baseMessages);
    const nested = patched.nested!;

    expect(nested.MessageType.values.SolanaSignMessage).toBe(906);
    expect(nested.MessageType.values.SolanaMessageSignature).toBe(907);
    expect(nested.SolanaSignMessage.fields.message).toMatchObject({
      id: 4,
      type: 'SolanaOffchainMessageV1',
      rule: 'required'
    });
    expect(nested.SolanaMessageSignature.fields.signed_data).toMatchObject({
      id: 2,
      type: 'bytes'
    });
    expect((baseMessages as any).nested.SolanaSignMessage).toBeUndefined();
  });

  it('round-trips message IDs 906 and 907 through @trezor/protobuf', () => {
    const root = parseConfigure(
      addStableSolanaMessageDefinitions(baseMessages) as any
    );
    const signerHex = '11'.repeat(32);
    const request = encodeMessage(root, 'SolanaSignMessage' as any, {
      address_n: [0x8000002c, 0x800001f5, 0x80000000, 0x80000000],
      chunkify: true,
      message: {
        message: 'physical test',
        signers: [signerHex]
      }
    });

    expect(request.messageType).toBe(SOLANA_SIGN_MESSAGE_TYPE);
    expect(
      decodeMessage(root, SOLANA_SIGN_MESSAGE_TYPE, request.message)
    ).toMatchObject({
      type: 'SolanaSignMessage',
      message: {
        chunkify: true,
        message: {
          message: 'physical test',
          signers: [signerHex]
        }
      }
    });

    const response = encodeMessage(root, 'SolanaMessageSignature' as any, {
      signature: '22'.repeat(64),
      signed_data: '33'.repeat(80)
    });
    expect(response.messageType).toBe(SOLANA_MESSAGE_SIGNATURE_TYPE);
    expect(
      decodeMessage(root, SOLANA_MESSAGE_SIGNATURE_TYPE, response.message)
    ).toMatchObject({
      type: 'SolanaMessageSignature',
      message: {
        signature: '22'.repeat(64),
        signed_data: '33'.repeat(80)
      }
    });
  });

  it('requires the stable Core firmware release that introduced OCMS v1', () => {
    const previousRelease = {
      major_version: 2,
      minor_version: 12,
      patch_version: 3
    };
    const stableV1Release = {
      major_version: 2,
      minor_version: 12,
      patch_version: 4
    };

    expect(getFirmwareVersion(previousRelease)).toBe('2.12.3');
    expect(supportsStableSolanaOcmsV1(previousRelease)).toBe(false);
    expect(supportsStableSolanaOcmsV1(stableV1Release)).toBe(true);
    expect(supportsStableSolanaOcmsV1(null)).toBe(false);
  });
});
