'use client';

import { useAppStore } from '@/lib/store';

export function LoadingOverlay() {
  const appReady = useAppStore((state) => state.appReady);

  if (appReady) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/90">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <p className="text-sm text-zinc-400">Initializing...</p>
      </div>
    </div>
  );
}
