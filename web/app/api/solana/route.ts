import { NextResponse } from 'next/server';

const DEFAULT_RPCS = [
  'https://api.mainnet-beta.solana.com'
];

const REQUEST_TIMEOUT_MS = 15000;

function getRpcUrls() {
  const primary =
    process.env.SOLANA_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC || '';
  const fallbackEnv =
    process.env.SOLANA_RPC_FALLBACKS ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_FALLBACKS ||
    '';
  const fallbacks = fallbackEnv
    ? fallbackEnv.split(',').map((item) => item.trim()).filter(Boolean)
    : [];
  const urls = [primary, ...fallbacks, ...DEFAULT_RPCS].filter(Boolean);
  return Array.from(new Set(urls));
}

/**
 * Host only — never the full URL.
 *
 * Provider URLs carry the API key in the query string, so logging or returning
 * a raw URL leaks the credential into container logs and, for the 502 path,
 * into a response any visitor can trigger.
 */
function safeLabel(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-rpc-url';
  }
}

function getErrorCode(payload: any): number | undefined {
  return payload?.error?.code ?? payload?.code;
}

function isRetryable(status: number, payload?: any) {
  const code = getErrorCode(payload);
  return (
    status === 403 ||
    status === 429 ||
    // A provider outage should fall through to the next endpoint too.
    status >= 500 ||
    code === 403 ||
    code === 429
  );
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.text();
  let lastError: unknown = null;
  let lastStatus: number | null = null;
  let lastText: string | null = null;
  let lastRetryAfter: string | null = null;

  for (const url of getRpcUrls()) {
    const label = safeLabel(url);
    try {
      console.warn('[SolanaProxy] ->', label);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body,
        // Without this a stalled provider holds the route handler open.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      const text = await response.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      if (!response.ok && isRetryable(response.status, json)) {
        lastError = new Error(`RPC ${label} returned ${response.status}`);
        lastStatus = response.status;
        lastText = text;
        lastRetryAfter = response.headers.get('retry-after');
        continue;
      }

      if (response.ok && isRetryable(200, json)) {
        lastError = new Error(`RPC ${label} returned ${getErrorCode(json)}`);
        lastStatus = 429;
        lastText = text;
        lastRetryAfter = null;
        continue;
      }

      return new NextResponse(text, {
        status: response.status,
        headers: {
          'content-type': 'application/json'
        }
      });
    } catch (error) {
      lastError = error;
      console.warn(
        '[SolanaProxy] failed',
        label,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : 'RPC request failed';
  if (lastStatus && lastText) {
    return new NextResponse(lastText, {
      status: lastStatus,
      headers: {
        'content-type': 'application/json',
        ...(lastRetryAfter ? { 'retry-after': lastRetryAfter } : {})
      }
    });
  }

  return NextResponse.json(
    { jsonrpc: '2.0', error: { code: -32000, message } },
    { status: 502 }
  );
}
