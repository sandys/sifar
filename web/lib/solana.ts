import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { DEFAULT_SOLANA_RPC } from './constants';

// api.mainnet.solana.com is not a public Solana endpoint; listing it first only
// bought a DNS failure before every real fallback attempt.
const FALLBACK_RPCS = [
  'https://api.mainnet-beta.solana.com'
];

function normalizeUrl(url: string) {
  if (url.startsWith('/')) {
    if (typeof window !== 'undefined') {
      return new URL(url, window.location.origin).toString();
    }
    return '';
  }
  return url;
}

function getRpcUrls() {
  const envUrl = DEFAULT_SOLANA_RPC;
  if (envUrl.startsWith('/')) {
    const normalized = normalizeUrl(envUrl);
    return normalized ? [normalized] : [];
  }
  const fallbackEnv = process.env.NEXT_PUBLIC_SOLANA_RPC_FALLBACKS;
  const fallbacks = fallbackEnv
    ? fallbackEnv.split(',').map((item) => item.trim()).filter(Boolean)
    : [];
  const urls = [envUrl, ...fallbacks, ...FALLBACK_RPCS]
    .map((value) => (value ? normalizeUrl(value) : ''))
    .filter((value): value is string => !!value);
  return Array.from(new Set(urls));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
}

function getErrorCode(error: unknown) {
  const anyError = error as any;
  return (
    anyError?.code ??
    anyError?.error?.code ??
    anyError?.data?.code ??
    anyError?.cause?.code
  );
}

function shouldRetryRpc(error: unknown) {
  const message = getErrorMessage(error);
  const code = getErrorCode(error);
  return (
    code === 403 ||
    code === 429 ||
    message.includes('403') ||
    message.includes('429') ||
    message.includes('Access forbidden') ||
    message.includes('fetch') ||
    message.includes('Failed to fetch')
  );
}

async function withRpc<T>(
  fn: (connection: Connection, url: string) => Promise<T>
): Promise<T> {
  const urls = getRpcUrls();
  let lastError: unknown;
  for (const url of urls) {
    const resolvedUrl =
      url.startsWith('/') && typeof window !== 'undefined'
        ? new URL(url, window.location.origin).toString()
        : url;
    try {
      const connection = new Connection(resolvedUrl, 'confirmed');
      return await fn(connection, resolvedUrl);
    } catch (error) {
      lastError = error;
      // eslint-disable-next-line no-console
      console.warn('[SolanaRPC] failed', resolvedUrl, getErrorMessage(error));
      if (!shouldRetryRpc(error)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('RPC failed');
}

const TOKEN_REGISTRY: Record<
  string,
  { symbol: string; name: string; decimals: number; logoUri?: string }
> = {
  So11111111111111111111111111111111111111112: {
    symbol: 'SOL',
    name: 'Wrapped SOL',
    decimals: 9
  },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6
  },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6
  },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: {
    symbol: 'JUP',
    name: 'Jupiter',
    decimals: 6
  },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: {
    symbol: 'BONK',
    name: 'Bonk',
    decimals: 5
  },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: {
    symbol: 'mSOL',
    name: 'Marinade SOL',
    decimals: 9
  }
};

async function getSolBalance(address: string): Promise<number> {
  return withRpc(async (connection) => {
    const pubkey = new PublicKey(address);
    const lamports = await connection.getBalance(pubkey);
    return lamports / LAMPORTS_PER_SOL;
  });
}

async function getSPLTokenBalances(address: string): Promise<
  Array<{
    mint: string;
    symbol: string;
    name: string;
    balance: number;
    decimals: number;
    logoUri?: string;
  }>
> {
  return withRpc(async (connection) => {
    const pubkey = new PublicKey(address);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      pubkey,
      {
        programId: TOKEN_PROGRAM_ID
      }
    );

    const tokens = tokenAccounts.value
      .map((account) => {
        const data = account.account.data.parsed.info;
        const mint = data.mint;
        const balance = data.tokenAmount.uiAmount;
        const decimals = data.tokenAmount.decimals;

        if (balance === 0) return null;

        const info = TOKEN_REGISTRY[mint];
        return {
          mint,
          symbol: info?.symbol || `${mint.slice(0, 4)}...`,
          name: info?.name || 'Unknown Token',
          balance,
          decimals,
          logoUri: info?.logoUri
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.balance || 0) - (a?.balance || 0));

    return tokens as any[];
  });
}

export async function getAllBalances(address: string) {
  const [sol, tokens] = await Promise.all([
    getSolBalance(address),
    getSPLTokenBalances(address)
  ]);

  return { sol, tokens };
}
