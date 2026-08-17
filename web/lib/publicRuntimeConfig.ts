export interface PublicRuntimeConfig {
  walletConnectProjectId: string | null;
}

export function parsePublicRuntimeConfig(value: unknown): PublicRuntimeConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('Runtime configuration response is invalid.');
  }

  const projectId = (value as Record<string, unknown>).walletConnectProjectId;
  if (projectId !== null && typeof projectId !== 'string') {
    throw new Error('WalletConnect Project ID has an invalid type.');
  }

  return {
    walletConnectProjectId: projectId?.trim() || null
  };
}

export async function fetchPublicRuntimeConfig(
  fetcher: typeof fetch = fetch
): Promise<PublicRuntimeConfig> {
  const response = await fetcher('/api/runtime-config', {
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Runtime configuration failed (${response.status}).`);
  }

  return parsePublicRuntimeConfig(await response.json());
}
