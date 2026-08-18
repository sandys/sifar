'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';

const TONE_STYLES = {
  info: 'border-amber-200 bg-white text-ink',
  warn: 'border-amber-400 bg-amber-50 text-ink',
  error: 'border-red-300 bg-red-50 text-ink'
};

const AUTO_DISMISS_MS = 6000;

/**
 * Surfaces `statusMessage`.
 *
 * Until now this store field only rendered inside DebugPanel, so messages the
 * user genuinely needed — "Signing request expired", "dApp disconnected.
 * Pending request cancelled" — were invisible in normal use.
 */
export function ToastHost() {
  const statusMessage = useAppStore((state) => state.statusMessage);
  const statusTone = useAppStore((state) => state.statusTone);
  const statusNonce = useAppStore((state) => state.statusNonce);
  const setStatus = useAppStore((state) => state.setStatus);
  const [visible, setVisible] = useState(false);

  // Keyed on the nonce, not the text, so the same message firing twice
  // re-shows rather than looking stuck.
  useEffect(() => {
    if (!statusMessage) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [statusMessage, statusNonce]);

  if (!statusMessage || !visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center px-4"
      style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      <div
        role="status"
        aria-live="polite"
        onClick={() => setStatus(null)}
        className={`pointer-events-auto w-full max-w-md cursor-pointer rounded-2xl border px-4 py-3 text-sm shadow-lg ${
          TONE_STYLES[statusTone] ?? TONE_STYLES.info
        }`}
      >
        {statusMessage}
      </div>
    </div>
  );
}
