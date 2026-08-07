'use client';

import { useMemo, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/Button';
import { accountLabelFromPath, shortenAddress } from '@/lib/format';

/** Shown before "show all" for large enumerations. */
const INITIAL_VISIBLE = 10;

/**
 * Accounts step: pick which hardware account to use.
 *
 * Replaces the old 5-per-page pager, which for a 200-account device meant 40
 * pages behind two ~26px buttons. Search plus a bounded initial list scales
 * without pagination or a virtualization dependency.
 */
export function WalletDisplay() {
  const solanaAccounts = useAppStore((state) => state.solanaAccounts);
  const activeAccountIndex = useAppStore((state) => state.activeAccountIndex);
  const activeSessions = useAppStore((state) => state.activeSessions);
  const selectAccount = useAppStore((state) => state.selectAccount);
  const refreshSolanaAccountBalance = useAppStore(
    (state) => state.refreshSolanaAccountBalance
  );

  const [query, setQuery] = useState('');
  const [filterConnected, setFilterConnected] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const sessionCountByAddress = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const session of activeSessions) {
      counts[session.walletAddress] = (counts[session.walletAddress] || 0) + 1;
    }
    return counts;
  }, [activeSessions]);

  const connectedCount = useMemo(
    () => solanaAccounts.filter((a) => sessionCountByAddress[a.address] > 0).length,
    [solanaAccounts, sessionCountByAddress]
  );

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    return solanaAccounts
      .map((account, index) => ({ account, index }))
      .filter(({ account, index }) => {
        if (filterConnected && !sessionCountByAddress[account.address]) {
          return false;
        }
        if (!term) return true;
        // A bare number jumps straight to that account index, which is how you
        // find "account 137" without scrolling past 136 rows.
        if (/^\d+$/.test(term)) return index === Number(term);
        return account.address.toLowerCase().includes(term);
      });
  }, [solanaAccounts, query, filterConnected, sessionCountByAddress]);

  const visible = showAll || query.trim() ? matches : matches.slice(0, INITIAL_VISIBLE);
  const hidden = matches.length - visible.length;

  if (solanaAccounts.length === 0) return null;

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">
          Choose an account
        </h2>
        <p className="mt-1 text-sm text-steel">
          The dApp you link next will be bound to this account. Only it can sign.
        </p>
      </div>

      <input
        type="search"
        inputMode="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search address or account number"
        aria-label="Search accounts"
        className="min-h-[48px] w-full rounded-2xl border border-amber-200 bg-white px-4 text-ink placeholder:text-steel/60"
      />

      {connectedCount > 0 && (
        <div className="flex gap-2" role="group" aria-label="Filter accounts">
          <Button
            size="sm"
            variant={filterConnected ? 'ghost' : 'primary'}
            onClick={() => setFilterConnected(false)}
            aria-pressed={!filterConnected}
          >
            All ({solanaAccounts.length})
          </Button>
          <Button
            size="sm"
            variant={filterConnected ? 'primary' : 'ghost'}
            onClick={() => setFilterConnected(true)}
            aria-pressed={filterConnected}
          >
            Connected ({connectedCount})
          </Button>
        </div>
      )}

      {visible.length === 0 && (
        <p className="rounded-2xl border border-amber-200 bg-white/70 px-4 py-6 text-center text-sm text-steel">
          No accounts match “{query}”.
        </p>
      )}

      <ul className="grid gap-2">
        {visible.map(({ account, index }) => {
          const sessions = sessionCountByAddress[account.address] || 0;
          const isActive = index === activeAccountIndex;
          return (
            <li key={account.address} className="list-row">
              {/* One tap target per row. The old row was a role="button" div
                  wrapping two more buttons that relied on stopPropagation —
                  a mis-tap generator on touch. */}
              <button
                type="button"
                onClick={() => selectAccount(index)}
                className={`flex min-h-[68px] w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                  isActive
                    ? 'border-ember bg-white'
                    : 'border-amber-200 bg-white/70 active:bg-white'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-base text-ink">
                      {shortenAddress(account.address)}
                    </span>
                    {sessions > 0 && (
                      <span className="rounded-full bg-moss px-2 py-0.5 text-xs font-semibold text-white">
                        {sessions}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm text-steel">
                    {accountLabelFromPath(account.path)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-display text-base text-ink">
                    {account.balanceStatus === 'loading'
                      ? '…'
                      : account.balanceStatus === 'error'
                        ? '—'
                        : `${account.balance ?? 0}`}
                  </span>
                  <span className="block text-xs text-steel">SOL</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {hidden > 0 && (
        <Button variant="ghost" fullWidth onClick={() => setShowAll(true)}>
          Show all {matches.length} accounts
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => refreshSolanaAccountBalance(activeAccountIndex)}
      >
        Refresh selected balance
      </Button>
    </section>
  );
}
