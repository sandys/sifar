import { describe, expect, it } from 'vitest';
import {
  decodeMessage,
  encodeMessage,
  parseConfigure
} from '@trezor/protobuf';
import baseMessages from '@trezor/protobuf/messages.json';
import {
  getResumableDeviceSessionId,
  isLegacyOnDevicePassphraseRequest,
  normalizeDeviceSessionId,
  PASSPHRASE_ENTRY_CAPABILITY,
  supportsOnDevicePassphrase
} from './trezorSession';

describe('Trezor passphrase capability detection', () => {
  it('accepts both protobuf enum representations', () => {
    expect(
      supportsOnDevicePassphrase({
        capabilities: [PASSPHRASE_ENTRY_CAPABILITY]
      })
    ).toBe(true);
    expect(
      supportsOnDevicePassphrase({
        capabilities: ['Capability_PassphraseEntry']
      })
    ).toBe(true);
  });

  it('does not infer capability from unrelated feature fields', () => {
    expect(supportsOnDevicePassphrase(null)).toBe(false);
    expect(supportsOnDevicePassphrase({ capabilities: [] })).toBe(false);
    expect(
      supportsOnDevicePassphrase({ passphrase_protection: true })
    ).toBe(false);
  });

  it('recognizes legacy requests that require immediate on-device ack', () => {
    expect(isLegacyOnDevicePassphraseRequest({ _on_device: true })).toBe(true);
    expect(isLegacyOnDevicePassphraseRequest({ on_device: true })).toBe(true);
    expect(isLegacyOnDevicePassphraseRequest({ _on_device: false })).toBe(false);
    expect(isLegacyOnDevicePassphraseRequest(null)).toBe(false);
  });
});

describe('firmware session IDs', () => {
  it('normalizes protobuf byte values to lowercase hex', () => {
    expect(normalizeDeviceSessionId(new Uint8Array([0, 15, 160, 255]))).toBe(
      '000fa0ff'
    );
    expect(normalizeDeviceSessionId(' 00A0FF ')).toBe('00a0ff');
  });

  it('rejects empty, odd-length, and non-hex IDs', () => {
    expect(normalizeDeviceSessionId('')).toBeNull();
    expect(normalizeDeviceSessionId('abc')).toBeNull();
    expect(normalizeDeviceSessionId('not-hex')).toBeNull();
    expect(normalizeDeviceSessionId(new Uint8Array())).toBeNull();
  });

  it('returns the protobuf hex representation for Initialize', () => {
    expect(getResumableDeviceSessionId('000FA0FF')).toBe('000fa0ff');
    expect(getResumableDeviceSessionId(null)).toBeNull();
  });

  it('round-trips the session ID through the installed protobuf encoder', () => {
    const root = parseConfigure(baseMessages as any);
    const encoded = encodeMessage(root, 'Initialize' as any, {
      session_id: getResumableDeviceSessionId('000fa0ff')
    });

    expect(decodeMessage(root, encoded.messageType, encoded.message)).toMatchObject({
      type: 'Initialize',
      message: { session_id: '000fa0ff' }
    });
  });
});
