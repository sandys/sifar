import { describe, expect, it } from 'vitest';
import {
  getSafeWalletConnectUriLog,
  parseWalletConnectUri
} from './walletConnectUri';

const NOW = 1_700_000_000;
const TOPIC = '11'.repeat(32);
const SYMMETRIC_KEY = '22'.repeat(32);

function createUri(expiryTimestamp = NOW + 300) {
  return `wc:${TOPIC}@2?expiryTimestamp=${expiryTimestamp}&relay-protocol=irn&symKey=${SYMMETRIC_KEY}`;
}

describe('WalletConnect pairing URI validation', () => {
  it('accepts a valid v2 URI and exposes only safe metadata for logs', () => {
    const info = parseWalletConnectUri(createUri(), NOW);

    expect(info).toMatchObject({
      topic: TOPIC,
      version: 2,
      relayProtocol: 'irn',
      expiryTimestamp: NOW + 300,
      expiresInSeconds: 300
    });
    const safeLog = getSafeWalletConnectUriLog(info);
    expect(safeLog).toMatchObject({
      topicPrefix: '11111111...',
      expiresInSeconds: 300
    });
    expect(JSON.stringify(safeLog)).not.toContain(SYMMETRIC_KEY);
  });

  it('rejects expired pairing URIs before invoking the SDK', () => {
    expect(() => parseWalletConnectUri(createUri(NOW), NOW)).toThrow(
      'has expired'
    );
  });

  it('rejects malformed topics, versions, keys, and whitespace', () => {
    expect(() =>
      parseWalletConnectUri(createUri().replace(TOPIC, 'bad-topic'), NOW)
    ).toThrow('pairing topic');
    expect(() =>
      parseWalletConnectUri(createUri().replace('@2?', '@1?'), NOW)
    ).toThrow('v2');
    expect(() =>
      parseWalletConnectUri(createUri().replace(SYMMETRIC_KEY, 'short'), NOW)
    ).toThrow('symmetric key');
    expect(() => parseWalletConnectUri(`${createUri()}\ninvalid`, NOW)).toThrow(
      'spaces or line breaks'
    );
  });
});
