'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';
import {
  decodeTransactionSync,
  type DecodedTransaction,
  type DecodedRow
} from '@/lib/solanaDecode';
import { fetchDecodeContext } from '@/lib/decodeContext';
import { formatRawUnits, formatUnits, groupDigits, shortenAddress } from '@/lib/format';

function AmountText({ row }: { row: DecodedRow }) {
  if (!row.amount) return null;
  const { raw, decimals, symbol } = row.amount;

  // Decimals unknown: show the integer and say so. Never render a decimal
  // point we cannot justify — "12.345678 USDC" when the truth is 12345678 base
  // units is a worse failure than admitting ignorance.
  if (decimals === null) {
    return (
      <span className="font-display text-base text-ink">
        {formatRawUnits(raw)}
      </span>
    );
  }
  return (
    <span className="font-display text-base text-ink">
      {groupDigits(formatUnits(raw, decimals))}
      {symbol ? ` ${symbol}` : ''}
    </span>
  );
}

function Row({ row }: { row: DecodedRow }) {
  const unknown = row.kind === 'unrecognized';
  return (
    <li
      className={`rounded-2xl border p-4 ${
        unknown ? 'border-amber-300 bg-amber-50/70' : 'border-amber-200 bg-white/80'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink">{row.title}</p>
          <p className="text-sm text-steel">{row.programLabel}</p>
        </div>
        <AmountText row={row} />
      </div>

      {(row.from || row.to) && (
        <dl className="mt-2 grid gap-1 text-sm">
          {row.from && (
            <div className="flex justify-between gap-3">
              <dt className="text-steel">From</dt>
              <dd className="font-mono text-ink">{shortenAddress(row.from)}</dd>
            </div>
          )}
          {row.to && (
            <div className="flex justify-between gap-3">
              <dt className="text-steel">To</dt>
              <dd className="font-mono text-ink">{shortenAddress(row.to)}</dd>
            </div>
          )}
          {row.mint && (
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Token</dt>
              <dd className="font-mono text-ink">{shortenAddress(row.mint)}</dd>
            </div>
          )}
        </dl>
      )}

      {unknown && (
        <p className="mt-2 break-all font-mono text-xs text-steel">
          {row.programId}
        </p>
      )}

      {row.warnings.map((warning) => (
        <p key={warning} className="mt-2 text-sm text-ember">
          {warning}
        </p>
      ))}
    </li>
  );
}

/**
 * Decoded view of what a signing request contains.
 *
 * Decodes synchronously on first render so the sheet paints immediately, then
 * upgrades to `full` once lookup tables and mint decimals arrive. Signing is
 * never blocked on that fetch.
 */
export function TransactionSummary({ request }: { request: any }) {
  const splTokens = useAppStore((state) => state.splTokens);
  const [decoded, setDecoded] = useState<DecodedTransaction | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const rawBytes: Uint8Array | undefined =
    request?.rawBytes ?? request?.transactions?.[0]?.rawBytes;

  useEffect(() => {
    if (!rawBytes) {
      setDecoded(null);
      return;
    }

    // Decimals and symbols we already hold locally, for free.
    const mintDecimals: Record<string, number> = {};
    const mintSymbols: Record<string, string> = {};
    for (const token of splTokens) {
      mintDecimals[token.mint] = token.decimals;
      if (token.symbol) mintSymbols[token.mint] = token.symbol;
    }

    setDecoded(decodeTransactionSync(rawBytes, { mintDecimals, mintSymbols }));

    let cancelled = false;
    fetchDecodeContext(rawBytes)
      .then((ctx) => {
        // Guard against a late resolution painting onto a different request.
        if (cancelled) return;
        setDecoded(
          decodeTransactionSync(rawBytes, {
            ...ctx,
            mintDecimals: { ...mintDecimals, ...ctx.mintDecimals },
            mintSymbols
          })
        );
      })
      .catch(() => {
        // Keep the partial decode; the banner already says it is incomplete.
      });

    return () => {
      cancelled = true;
    };
    // requestId keys the effect so a new request always re-decodes.
  }, [rawBytes, request?.requestId, splTokens]);

  if (!rawBytes || !decoded) return null;

  return (
    <div className="grid gap-3">
      {decoded.confidence !== 'full' && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-ink">
          {decoded.confidence === 'failed'
            ? 'Sifar could not decode this transaction. Verify it entirely on your Trezor.'
            : 'Partial decode — some accounts could not be resolved. Verify every line on your Trezor.'}
        </p>
      )}

      {decoded.rows.length > 0 && (
        <ul className="grid gap-2">
          {decoded.rows.map((row, index) => (
            <Row key={`${row.programId}-${index}`} row={row} />
          ))}
        </ul>
      )}

      {decoded.feePayer && (
        <p className="text-sm text-steel">
          Fee payer{' '}
          <span className="font-mono text-ink">
            {shortenAddress(decoded.feePayer)}
          </span>
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowRaw((prev) => !prev)}
        className="min-h-[44px] text-left text-sm font-semibold text-steel underline"
      >
        {showRaw ? 'Hide raw details' : 'Show raw details'}
      </button>

      {showRaw && (
        <div className="grid gap-1 rounded-2xl border border-amber-200 bg-white/70 p-4 text-sm text-steel">
          <p>Bytes: {rawBytes.length}</p>
          <p>Instructions: {decoded.rows.length}</p>
          <p>Version: {decoded.version === 0 ? 'v0' : 'legacy'}</p>
          {decoded.requiredSigners.map((signer) => (
            <p key={signer} className="break-all font-mono text-xs">
              signer {signer}
            </p>
          ))}
          {decoded.unresolvedLookupTables.map((table) => (
            <p key={table} className="break-all font-mono text-xs text-ember">
              unresolved table {table}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
