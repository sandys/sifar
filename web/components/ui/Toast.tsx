'use client';

export function Toast({
  message,
  tone = 'info'
}: {
  message: string | null;
  tone?: 'info' | 'error' | 'success';
}) {
  if (!message) return null;

  const styles = {
    info: 'bg-white border-amber-200 text-steel',
    error: 'bg-black text-white border-black',
    success: 'bg-moss text-white border-moss'
  };

  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm shadow-lg ${styles[tone]}`}
    >
      {message}
    </div>
  );
}
