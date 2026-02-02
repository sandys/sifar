'use client';

import { useMemo, useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';

export function WalletDisplay() {
  const solanaAccounts = useAppStore((state) => state.solanaAccounts);
  const activeAccountIndex = useAppStore((state) => state.activeAccountIndex);
  const solanaAddress = useAppStore((state) => state.solanaAddress);
  const solanaBalance = useAppStore((state) => state.solanaBalance);
  const splTokens = useAppStore((state) => state.splTokens);
  const trezorDeviceInfo = useAppStore((state) => state.trezorDeviceInfo);
  const setActiveAccount = useAppStore((state) => state.setActiveAccount);
  const refreshSolanaAccountBalance = useAppStore(
    (state) => state.refreshSolanaAccountBalance
  );
  const [page, setPage] = useState(0);
  const pageSize = 5;

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(solanaAccounts.length / pageSize)),
    [solanaAccounts.length]
  );

  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(Math.max(0, totalPages - 1));
    }
  }, [page, totalPages]);

  const pageAccounts = useMemo(() => {
    const start = page * pageSize;
    return solanaAccounts.slice(start, start + pageSize);
  }, [page, pageSize, solanaAccounts]);

  if (!solanaAddress) {
    return null;
  }

  return (
    <section className="rounded-3xl border border-amber-200/40 bg-white/80 p-5">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-700">
          Connected Wallet
        </p>
        {trezorDeviceInfo ? (
          <p className="text-sm text-steel">
            {trezorDeviceInfo.label} · {trezorDeviceInfo.model} · FW{' '}
            {trezorDeviceInfo.firmwareVersion}
          </p>
        ) : null}
        <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-3 text-sm">
          <p className="text-xs text-steel">Solana Address</p>
          <p className="mt-1 font-mono text-sm">{solanaAddress}</p>
        </div>
        {solanaAccounts.length > 0 && (
          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-700">
              Accounts ({solanaAccounts.length})
            </p>
            {pageAccounts.map((account, index) => {
              const absoluteIndex = page * pageSize + index;
              return (
                <div
                  key={account.address}
                  onClick={() => setActiveAccount(absoluteIndex)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      setActiveAccount(absoluteIndex);
                    }
                  }}
                  className={`flex items-start justify-between gap-3 rounded-2xl border px-3 py-2 text-left text-sm transition ${
                    absoluteIndex === activeAccountIndex
                      ? 'border-ember bg-ember/10'
                      : 'border-amber-100 bg-white'
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-start gap-2">
                      <p className="break-all font-mono text-[11px]">
                        {account.address}
                      </p>
                      <button
                        type="button"
                        className="shrink-0 rounded-md border border-amber-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-steel"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigator.clipboard.writeText(account.address);
                        }}
                      >
                        Copy
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-steel">
                      Path {account.path.replace('m/', '')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-steel">SOL</p>
                    <div className="flex items-center justify-end gap-2">
                      <p
                        className={`font-display text-sm ${
                          account.balanceStatus === 'error'
                            ? 'text-ember'
                            : ''
                        }`}
                      >
                        {account.balanceStatus === 'loading' && '…'}
                        {account.balanceStatus === 'error' && '⚠'}
                        {account.balanceStatus === 'ok' &&
                          account.balance !== null
                          ? account.balance.toFixed(3)
                          : ''}
                      </p>
                      <button
                        type="button"
                        className="rounded-md border border-amber-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-steel"
                        onClick={(event) => {
                          event.stopPropagation();
                          refreshSolanaAccountBalance(absoluteIndex);
                        }}
                      >
                        ↻
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-steel">
                <button
                  type="button"
                  className="rounded-lg border border-amber-200 px-2 py-1"
                  onClick={() => setPage((prev) => Math.max(0, prev - 1))}
                  disabled={page === 0}
                >
                  Prev
                </button>
                <span>
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  type="button"
                  className="rounded-lg border border-amber-200 px-2 py-1"
                  onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
                  disabled={page >= totalPages - 1}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl border border-amber-100 bg-white p-3">
            <p className="text-xs text-steel">SOL Balance</p>
            <p className="mt-2 font-display text-xl">
              {solanaBalance !== null ? solanaBalance.toFixed(4) : '—'}
            </p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-white p-3">
            <p className="text-xs text-steel">Tokens</p>
            <p className="mt-2 font-display text-xl">{splTokens.length}</p>
          </div>
        </div>
        {splTokens.length > 0 && (
          <div className="mt-2 grid gap-2">
            {splTokens.slice(0, 6).map((token) => (
              <div
                key={token.mint}
                className="flex items-center justify-between rounded-xl border border-amber-100 bg-white px-3 py-2 text-sm"
              >
                <span>{token.symbol}</span>
                <span className="font-mono">
                  {token.balance.toLocaleString(undefined, {
                    maximumFractionDigits: 6
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
