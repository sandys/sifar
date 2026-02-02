'use client';

import { useEffect } from 'react';

export function Sheet({
  open,
  onClose,
  title,
  children
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-3xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          {title ? <h3 className="font-display text-lg">{title}</h3> : <div />}
          <button
            onClick={onClose}
            className="rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold"
          >
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
