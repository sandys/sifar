'use client';

import { useMemo, useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { WalletConnectModal } from '@/components/WalletConnectModal';

export function WalletDisplay() {
  const solanaAccounts = useAppStore((state) => state.solanaAccounts);
  const activeAccountIndex = useAppStore((state) => state.activeAccountIndex);
  const solanaAddress = useAppStore((state) => state.solanaAddress);
  const solanaBalance = useAppStore((state) => state.solanaBalance);
  const splTokens = useAppStore((state) => state.splTokens);
  const trezorDeviceInfo = useAppStore((state) => state.trezorDeviceInfo);
  const activeSessions = useAppStore((state) => state.activeSessions);
  const pendingRequest = useAppStore((state) => state.pendingRequest);
  const setActiveAccount = useAppStore((state) => state.setActiveAccount);
  const refreshSolanaAccountBalance = useAppStore(
    (state) => state.refreshSolanaAccountBalance
  );
  const [page, setPage] = useState(0);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<Set<number>>(() => new Set());
  const [wcModalIndex, setWcModalIndex] = useState<number | null>(null);
  const [filterConnected, setFilterConnected] = useState(false);
  const pageSize = 5;

  // Count sessions per address
  const sessionCountByAddress = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const session of activeSessions) {
      counts[session.walletAddress] = (counts[session.walletAddress] || 0) + 1;
    }
    return counts;
  }, [activeSessions]);

  // Total accounts with sessions
  const accountsWithSessions = useMemo(
    () => solanaAccounts.filter((a) => sessionCountByAddress[a.address] > 0),
    [solanaAccounts, sessionCountByAddress]
  );

  // Filtered accounts based on filter state
  const filteredAccounts = useMemo(
    () => (filterConnected ? accountsWithSessions : solanaAccounts),
    [filterConnected, accountsWithSessions, solanaAccounts]
  );

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredAccounts.length / pageSize)),
    [filteredAccounts.length]
  );

  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(Math.max(0, totalPages - 1));
    }
  }, [page, totalPages]);

  const pageAccounts = useMemo(() => {
    const start = page * pageSize;
    return filteredAccounts.slice(start, start + pageSize);
  }, [page, pageSize, filteredAccounts]);

  useEffect(() => {
    if (!copiedAddress) return;
    const timer = setTimeout(() => setCopiedAddress(null), 1200);
    return () => clearTimeout(timer);
  }, [copiedAddress]);

  useEffect(() => {
    if (wcModalIndex === null) return;
    if (!solanaAccounts[wcModalIndex]) {
      setWcModalIndex(null);
    }
  }, [solanaAccounts, wcModalIndex]);

  // Auto-open modal when there's a pending signing request
  useEffect(() => {
    if (!pendingRequest) return;
    // Find the wallet associated with this session
    const session = activeSessions.find((s) => s.topic === pendingRequest.topic);
    if (session) {
      const walletIndex = solanaAccounts.findIndex(
        (a) => a.address === session.walletAddress
      );
      if (walletIndex >= 0 && wcModalIndex !== walletIndex) {
        setWcModalIndex(walletIndex);
      }
    }
  }, [pendingRequest, activeSessions, solanaAccounts, wcModalIndex]);

  if (!solanaAddress) {
    return null;
  }

  return (
    <section className="rounded-3xl border border-amber-200/40 bg-white/80 p-5">
      <div className="flex flex-col gap-2">
        <h2 className="font-jomhuria text-2xl tracking-wide text-amber-800">
          Device Wallets
        </h2>
        {solanaAccounts.length > 0 && (
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-700">
                Accounts
              </p>
              {accountsWithSessions.length > 0 && (
                <div className="flex rounded-lg border border-amber-200 bg-amber-50/50 text-[10px] font-semibold uppercase tracking-wide">
                  <button
                    type="button"
                    onClick={() => setFilterConnected(false)}
                    className={`rounded-l-lg px-3 py-1 transition ${
                      !filterConnected
                        ? 'bg-amber-600 text-white'
                        : 'text-amber-700 hover:bg-amber-100'
                    }`}
                  >
                    All ({solanaAccounts.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterConnected(true)}
                    className={`rounded-r-lg px-3 py-1 transition ${
                      filterConnected
                        ? 'bg-green-600 text-white'
                        : 'text-green-700 hover:bg-green-100'
                    }`}
                  >
                    Connected ({accountsWithSessions.length})
                  </button>
                </div>
              )}
            </div>
            {pageAccounts.map((account) => {
              // Find the real index in solanaAccounts (not filtered)
              const absoluteIndex = solanaAccounts.findIndex(
                (a) => a.address === account.address
              );
              const sessionCount = sessionCountByAddress[account.address] || 0;
              const isRefreshing =
                refreshing.has(absoluteIndex) ||
                account.balanceStatus === 'loading';
              return (
                <div
                  key={account.address}
                  onClick={() => {
                    setActiveAccount(absoluteIndex);
                    setWcModalIndex(absoluteIndex);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      setActiveAccount(absoluteIndex);
                      setWcModalIndex(absoluteIndex);
                    }
                  }}
                  className={`flex items-start justify-between gap-3 rounded-2xl border px-3 py-2 text-left text-sm transition ${
                    absoluteIndex === activeAccountIndex
                      ? 'border-ember bg-ember/10'
                      : sessionCount > 0
                        ? 'border-green-300 bg-green-50'
                        : 'border-amber-100 bg-white'
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-start gap-2">
                      <p className="break-all font-mono text-[11px]">
                        {account.address}
                      </p>
                      {sessionCount > 0 && (
                        <span className="shrink-0 rounded-full bg-green-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                          {sessionCount} {sessionCount === 1 ? 'Session' : 'Sessions'}
                        </span>
                      )}
                      <button
                        type="button"
                        className={`shrink-0 rounded-md border border-amber-200 px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                          copiedAddress === account.address
                            ? 'bg-amber-200 text-ink'
                            : 'text-steel'
                        }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          navigator.clipboard.writeText(account.address);
                          setCopiedAddress(account.address);
                        }}
                      >
                        {copiedAddress === account.address ? 'Copied' : 'Copy'}
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
                          setRefreshing((prev) => {
                            const next = new Set(prev);
                            next.add(absoluteIndex);
                            return next;
                          });
                          refreshSolanaAccountBalance(absoluteIndex)
                            .catch(() => {})
                            .finally(() => {
                              setRefreshing((prev) => {
                                const next = new Set(prev);
                                next.delete(absoluteIndex);
                                return next;
                              });
                            });
                        }}
                      >
                        <span
                          className={`inline-block transition-transform ${
                            isRefreshing ? 'animate-spin' : ''
                          }`}
                        >
                          ↻
                        </span>
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
      <WalletConnectModal
        open={wcModalIndex !== null}
        account={
          wcModalIndex !== null ? solanaAccounts[wcModalIndex] : undefined
        }
        onClose={() => setWcModalIndex(null)}
      />
    </section>
  );
}
