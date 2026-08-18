import { describe, expect, it } from 'vitest';
import { SOLANA_MAINNET_CAIP2 } from './constants';
import { getSolanaProposalRequest } from './walletconnect';

describe('getSolanaProposalRequest', () => {
  it('collects Solana chains, methods, and events from both namespaces', () => {
    const request = getSolanaProposalRequest(
      {
        solana: {
          chains: [SOLANA_MAINNET_CAIP2],
          methods: ['solana_signTransaction'],
          events: ['accountsChanged']
        }
      },
      {
        'solana:devnet': {
          methods: ['solana_signMessage'],
          events: []
        }
      }
    );

    expect(request.chains).toEqual([
      SOLANA_MAINNET_CAIP2,
      'solana:devnet'
    ]);
    expect(request.methods).toEqual([
      'solana_signTransaction',
      'solana_signMessage'
    ]);
    expect(request.events).toEqual(['accountsChanged']);
  });

  it('does not present methods from unrelated namespaces as Solana access', () => {
    const request = getSolanaProposalRequest(
      {
        solana: {
          chains: [SOLANA_MAINNET_CAIP2],
          methods: ['solana_signTransaction']
        },
        eip155: {
          chains: ['eip155:1'],
          methods: ['eth_sendTransaction', 'personal_sign'],
          events: ['chainChanged']
        }
      },
      undefined
    );

    expect(request.methods).toEqual(['solana_signTransaction']);
    expect(request.chains).toEqual([SOLANA_MAINNET_CAIP2]);
    expect(request.events).toEqual([]);
  });
});
