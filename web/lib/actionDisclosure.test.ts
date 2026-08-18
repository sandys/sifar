import { describe, expect, it } from 'vitest';
import {
  accountDiscoveryDisclosure,
  addressVerificationDisclosure,
  sessionProposalDisclosure,
  signingRequestDisclosure,
  walletConnectPairingDisclosure
} from './actionDisclosure';

describe('non-signing disclosures', () => {
  it('labels discovery, address verification, pairing, and approval explicitly', () => {
    const disclosures = [
      accountDiscoveryDisclosure(),
      accountDiscoveryDisclosure(true),
      addressVerificationDisclosure({
        address: 'Address111111111111111111111111111111111',
        path: "m/44'/501'/0'/0'"
      }),
      walletConnectPairingDisclosure({
        topic: 'a'.repeat(64),
        version: 2,
        relayProtocol: 'irn',
        expiryTimestamp: 2_000_000_000,
        expiresInSeconds: 120
      }),
      sessionProposalDisclosure({
        dappName: 'Example dApp',
        address: 'Address111111111111111111111111111111111',
        chains: ['solana:mainnet'],
        methods: ['solana_signTransaction']
      })
    ];

    for (const disclosure of disclosures) {
      expect(disclosure.level).toBe('not-signing');
      expect(disclosure.badge).toBe('Not signing');
      expect(disclosure.happens.length).toBeGreaterThan(20);
      expect(disclosure.shared.length).toBeGreaterThan(0);
      expect(disclosure.agreement.length).toBeGreaterThan(20);
      expect(disclosure.primaryLabel.length).toBeGreaterThan(0);
    }
  });

  it('shows the exact address and path before physical verification', () => {
    const disclosure = addressVerificationDisclosure({
      address: 'C7Vhv5VERyZR1waPhAu3gaxk9M7cqqCuCuywnC2ThQHn',
      path: "m/44'/501'/7'/0'"
    });
    const rendered = JSON.stringify(disclosure);

    expect(rendered).toContain('C7Vhv5VERyZR1waPhAu3gaxk9M7cqqCuCuywnC2ThQHn');
    expect(rendered).toContain("m/44'/501'/7'/0'");
  });

  it('never repeats the WalletConnect topic in pairing copy', () => {
    const topic = '0123456789abcdef'.repeat(4);
    const disclosure = walletConnectPairingDisclosure({
      topic,
      version: 2,
      relayProtocol: 'irn',
      expiryTimestamp: null,
      expiresInSeconds: null
    });

    expect(JSON.stringify(disclosure)).not.toContain(topic);
  });
});

describe('signing disclosures', () => {
  it.each([
    ['solana_signMessage', 'signing', 'Sign Message with Trezor'],
    ['solana_signTransaction', 'signing', 'Sign Transaction with Trezor'],
    ['solana_signAllTransactions', 'signing', 'Review Batch on Trezor'],
    [
      'solana_signAndSendTransaction',
      'signing-and-sending',
      'Sign and Broadcast with Trezor'
    ]
  ])('describes %s before its action', (type, level, primaryLabel) => {
    const disclosure = signingRequestDisclosure({
      type,
      transactionCount: 3
    });

    expect(disclosure.level).toBe(level);
    expect(disclosure.badge).toMatch(/Will sign/i);
    expect(disclosure.primaryLabel).toBe(primaryLabel);
    expect(disclosure.shared.length).toBeGreaterThan(0);
    expect(disclosure.agreement).toMatch(/only if|Sign only/i);
  });

  it('states the transaction count for a batch', () => {
    const disclosure = signingRequestDisclosure({
      type: 'solana_signAllTransactions',
      transactionCount: 7
    });

    expect(disclosure.summary).toContain('7 transactions');
  });
});
