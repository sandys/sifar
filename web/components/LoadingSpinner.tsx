'use client';

export function LoadingSpinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-amber-200/50 bg-white/80 px-4 py-3 text-sm text-steel">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" />
      <span>{label || 'Loading…'}</span>
    </div>
  );
}
