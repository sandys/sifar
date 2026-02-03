/**
 * URL-based state persistence for WalletConnect modal.
 * Uses hash fragment (#state=...) with base64url-encoded JSON.
 *
 * Security notes:
 * - Only public data in URL: addresses, paths, project ID
 * - No private keys or secrets
 * - Session topics are just reconnection hints
 * - WC sessions actually restore from IndexedDB, not URL
 * - Malformed URLs gracefully ignored (returns null)
 */

/** Compact URL-encoded state schema */
export interface UrlEncodedState {
  /** wcProjectId */
  p: string;
  /** accounts: [address, path] tuples */
  a: Array<[string, string]>;
  /** activeAccountIndex (modal opens here) */
  i: number;
  /** session hints (topic, peerName, walletAddress) */
  s: Array<{ t: string; n: string; w: string }>;
}

/** Restored state with friendly property names */
export interface RestoredState {
  wcProjectId: string;
  accounts: Array<{ address: string; path: string }>;
  activeAccountIndex: number;
  sessionHints: Array<{
    topic: string;
    peerName: string;
    walletAddress: string;
  }>;
}

const STATE_PARAM = 'state';

/** Base64url encode (URL-safe base64 without padding) */
function base64urlEncode(str: string): string {
  // Convert string to UTF-8 bytes, then to base64
  const utf8Bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < utf8Bytes.length; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url decode */
function base64urlDecode(str: string): string {
  // Restore standard base64 characters
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  const pad = base64.length % 4;
  if (pad) {
    base64 += '='.repeat(4 - pad);
  }
  // Decode base64 to binary, then UTF-8
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** Encode state object to base64url string */
export function encodeUrlState(state: UrlEncodedState): string {
  const json = JSON.stringify(state);
  return base64urlEncode(json);
}

/** Decode base64url string to state object, returns null if invalid */
export function decodeUrlState(encoded: string): RestoredState | null {
  try {
    const json = base64urlDecode(encoded);
    const parsed = JSON.parse(json) as UrlEncodedState;

    // Validate required fields
    if (
      typeof parsed.p !== 'string' ||
      !Array.isArray(parsed.a) ||
      typeof parsed.i !== 'number'
    ) {
      console.warn('[urlState] Invalid state structure');
      return null;
    }

    // Validate accounts array
    const accounts = parsed.a
      .filter(
        (tuple): tuple is [string, string] =>
          Array.isArray(tuple) &&
          tuple.length === 2 &&
          typeof tuple[0] === 'string' &&
          typeof tuple[1] === 'string'
      )
      .map(([address, path]) => ({ address, path }));

    if (accounts.length === 0) {
      console.warn('[urlState] No valid accounts in state');
      return null;
    }

    // Validate activeAccountIndex
    const activeAccountIndex = Math.max(
      0,
      Math.min(parsed.i, accounts.length - 1)
    );

    // Parse session hints (optional)
    const sessionHints = Array.isArray(parsed.s)
      ? parsed.s
          .filter(
            (s): s is { t: string; n: string; w: string } =>
              typeof s === 'object' &&
              s !== null &&
              typeof s.t === 'string' &&
              typeof s.n === 'string' &&
              typeof s.w === 'string'
          )
          .map((s) => ({
            topic: s.t,
            peerName: s.n,
            walletAddress: s.w
          }))
      : [];

    return {
      wcProjectId: parsed.p,
      accounts,
      activeAccountIndex,
      sessionHints
    };
  } catch (err) {
    console.warn('[urlState] Failed to decode state:', err);
    return null;
  }
}

/** Read state from window.location.hash */
export function getStateFromHash(): RestoredState | null {
  if (typeof window === 'undefined') return null;

  try {
    const hash = window.location.hash;
    console.log('[urlState] getStateFromHash called, hash length:', hash.length);
    if (!hash || hash.length < 2) return null;

    // Parse hash parameters (without the leading #)
    const params = new URLSearchParams(hash.slice(1));
    const encoded = params.get(STATE_PARAM);
    console.log('[urlState] encoded state length:', encoded?.length ?? 0);

    if (!encoded) return null;

    return decodeUrlState(encoded);
  } catch (err) {
    console.error('[urlState] getStateFromHash error:', err);
    return null;
  }
}

/** Update window.location.hash with state (without triggering reload) */
export function setStateToHash(state: UrlEncodedState): void {
  if (typeof window === 'undefined') return;

  const encoded = encodeUrlState(state);
  const newHash = `#${STATE_PARAM}=${encoded}`;

  // Use replaceState to avoid adding to history on every update
  window.history.replaceState(null, '', newHash);
}

/** Clear state from hash */
export function clearStateFromHash(): void {
  if (typeof window === 'undefined') return;

  // Remove hash entirely
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

/** Check if URL has state without fully decoding */
export function hasStateInHash(): boolean {
  if (typeof window === 'undefined') return false;

  const hash = window.location.hash;
  if (!hash || hash.length < 2) return false;

  const params = new URLSearchParams(hash.slice(1));
  return params.has(STATE_PARAM);
}
