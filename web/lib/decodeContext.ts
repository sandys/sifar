'use client';

import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  VersionedTransaction
} from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import { DEFAULT_SOLANA_RPC } from './constants';

/**
 * Network-backed context for transaction decoding: address lookup tables and
 * mint decimals.
 *
 * This runs on the signing critical path, so it is deliberately cheap — one
 * batched account fetch, a per-tab cache, and never a blocker. If it fails the
 * caller keeps its partial decode and shows the amber banner.
 */

const tableCache = new Map<string, AddressLookupTableAccount>();
const decimalsCache = new Map<string, number>();

function rpcUrl(): string {
  return DEFAULT_SOLANA_RPC.startsWith('/') && typeof window !== 'undefined'
    ? new URL(DEFAULT_SOLANA_RPC, window.location.origin).toString()
    : DEFAULT_SOLANA_RPC;
}

export interface FetchedDecodeContext {
  lookupTables: AddressLookupTableAccount[];
  mintDecimals: Record<string, number>;
  errors: string[];
}

export async function fetchDecodeContext(
  raw: Uint8Array
): Promise<FetchedDecodeContext> {
  const result: FetchedDecodeContext = {
    lookupTables: [],
    mintDecimals: {},
    errors: []
  };

  let message: any;
  try {
    message = VersionedTransaction.deserialize(raw).message;
  } catch {
    return result;
  }

  const lookups = message.addressTableLookups ?? [];
  if (lookups.length === 0) return result;

  const wanted: string[] = lookups.map((l: any) => l.accountKey.toBase58());
  const cached = wanted
    .map((key) => tableCache.get(key))
    .filter(Boolean) as AddressLookupTableAccount[];
  const missing = wanted.filter((key) => !tableCache.has(key));

  result.lookupTables.push(...cached);
  if (missing.length === 0) return result;

  try {
    const connection = new Connection(rpcUrl(), 'confirmed');
    // One batched call rather than N: 429s from public RPC are a live problem
    // in this app, and this sits on the path where the user is waiting.
    const infos = await connection.getMultipleAccountsInfo(
      missing.map((key) => new PublicKey(key))
    );
    infos.forEach((info, index) => {
      const key = missing[index];
      if (!info) {
        result.errors.push(`Lookup table ${key} not found`);
        return;
      }
      const account = new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: AddressLookupTableAccount.deserialize(info.data)
      });
      // Tables are append-only, so caching for the tab's lifetime is safe.
      tableCache.set(key, account);
      result.lookupTables.push(account);
    });
  } catch (err: any) {
    result.errors.push(err?.message || 'Could not fetch address lookup tables');
  }

  return result;
}

/** Decimals for a mint, cached. Returns null rather than guessing. */
export async function fetchMintDecimals(
  mint: string,
  programId?: PublicKey
): Promise<number | null> {
  if (decimalsCache.has(mint)) return decimalsCache.get(mint)!;
  try {
    const connection = new Connection(rpcUrl(), 'confirmed');
    const info = await getMint(
      connection,
      new PublicKey(mint),
      'confirmed',
      programId
    );
    decimalsCache.set(mint, info.decimals);
    return info.decimals;
  } catch {
    return null;
  }
}
