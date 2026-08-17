import { describe, expect, it, vi } from 'vitest';
import {
  fetchPublicRuntimeConfig,
  parsePublicRuntimeConfig
} from './publicRuntimeConfig';

describe('public runtime configuration', () => {
  it('normalizes a runtime WalletConnect Project ID', () => {
    expect(
      parsePublicRuntimeConfig({ walletConnectProjectId: '  project-id  ' })
    ).toEqual({ walletConnectProjectId: 'project-id' });
  });

  it('accepts a missing runtime Project ID without inventing one', () => {
    expect(parsePublicRuntimeConfig({ walletConnectProjectId: null })).toEqual({
      walletConnectProjectId: null
    });
  });

  it('rejects malformed or failed responses', async () => {
    expect(() => parsePublicRuntimeConfig({ walletConnectProjectId: 42 })).toThrow(
      'invalid type'
    );

    const fetcher = vi.fn().mockResolvedValue(
      new Response('unavailable', { status: 503 })
    ) as typeof fetch;
    await expect(fetchPublicRuntimeConfig(fetcher)).rejects.toThrow('(503)');
  });
});
