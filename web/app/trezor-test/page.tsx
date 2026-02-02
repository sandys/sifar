import { TrezorTestClient } from './trezor-test-client';

export default function TrezorTestPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1db_0%,_#f6f1e8_45%,_#efe2d0_100%)] px-4 pb-16 pt-10 text-ink">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header className="rounded-3xl border border-amber-200/40 bg-white/70 p-6">
          <h1 className="font-display text-2xl font-semibold">
            Trezor Test Harness
          </h1>
          <p className="mt-2 text-sm text-steel">
            This page is used by automated tests. It does not persist any state.
          </p>
        </header>
        <TrezorTestClient />
      </div>
    </main>
  );
}
