'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { clearSessionKey, loadSessionKey } from '@/lib/sessionKey';

function formatTimeRemaining(expiresAt: number): string {
  const now = Date.now();
  const remaining = expiresAt - now;

  if (remaining <= 0) return 'expired';

  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

interface SessionKeyStatusProps {
  authority: string;
  compact?: boolean;
}

export function SessionKeyStatus({ authority, compact = false }: SessionKeyStatusProps) {
  const sessionKey = useAppStore((state) => state.sessionKey);
  const setSessionKey = useAppStore((state) => state.setSessionKey);
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  // Update time remaining every minute
  useEffect(() => {
    if (!sessionKey || sessionKey.authority !== authority) return;

    const updateTime = () => {
      setTimeRemaining(formatTimeRemaining(sessionKey.expiresAt));
    };

    updateTime();
    const interval = setInterval(updateTime, 60000);

    return () => clearInterval(interval);
  }, [sessionKey, authority]);

  // Check if session key is expired and clear it
  useEffect(() => {
    if (!sessionKey) return;
    if (Date.now() >= sessionKey.expiresAt) {
      clearSessionKey(sessionKey.authority);
      setSessionKey(null);
    }
  }, [sessionKey, setSessionKey]);

  // No session key or different authority
  if (!sessionKey || sessionKey.authority !== authority) {
    return null;
  }

  const isExpired = Date.now() >= sessionKey.expiresAt;

  const handleRevoke = () => {
    clearSessionKey(authority);
    setSessionKey(null);
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-[10px]">
        <span className={`h-2 w-2 rounded-full ${isExpired ? 'bg-red-500' : 'bg-green-500'}`} />
        <span className="text-steel">
          Session key {isExpired ? 'expired' : `(${timeRemaining})`}
        </span>
        <button
          type="button"
          onClick={handleRevoke}
          className="rounded border border-red-200 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-red-600 hover:bg-red-50"
        >
          Revoke
        </button>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border p-2 ${isExpired ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${isExpired ? 'bg-red-500' : 'bg-green-500'}`} />
          <span className={`text-xs font-semibold ${isExpired ? 'text-red-700' : 'text-green-700'}`}>
            {isExpired ? 'Session Key Expired' : 'Session Key Active'}
          </span>
        </div>
        <button
          type="button"
          onClick={handleRevoke}
          className="rounded border border-red-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-600 hover:bg-red-100"
        >
          Revoke
        </button>
      </div>
      <p className="mt-1 text-[10px] text-steel">
        {isExpired
          ? 'This session key has expired. Create a new one to sign messages.'
          : `Expires in ${timeRemaining}. Messages will be signed with this key.`}
      </p>
      <p className="mt-1 font-mono text-[9px] text-steel/70 truncate">
        Key: {sessionKey.publicKey.slice(0, 8)}...{sessionKey.publicKey.slice(-8)}
      </p>
    </div>
  );
}
