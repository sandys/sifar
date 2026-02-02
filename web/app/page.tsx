import { Scanner } from '@/components/Scanner';
import { TrezorConnect } from '@/components/TrezorConnect';
import { WalletDisplay } from '@/components/WalletDisplay';
import { SessionApproval } from '@/components/SessionApproval';
import { TransactionPreview } from '@/components/TransactionPreview';
import { SigningFlow } from '@/components/SigningFlow';
import { StatusBar } from '@/components/StatusBar';
import { StatusToast } from '@/components/StatusToast';
import { TrezorPrompt } from '@/components/TrezorPrompt';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1db_0%,_#f6f1e8_45%,_#efe2d0_100%)] px-4 pb-16 pt-10 text-ink">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header className="rounded-3xl border border-amber-200/40 bg-white/70 p-6 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.6)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">
                Vault Bridge V1
              </p>
              <h1 className="mt-2 font-display text-3xl font-semibold">
                Stateless hardware wallet bridge
              </h1>
            </div>
            <div className="rounded-full bg-ember px-3 py-1 text-xs font-semibold text-white">
              Android + Chrome only
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-steel">
            Connect a Trezor over USB-OTG, scan a WalletConnect QR, and sign every
            transaction on hardware. No extension, no native app, no storage.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3 text-xs text-steel">
            <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-3">
              Requires Chrome on Android with WebUSB
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-3">
              Trezor device + USB-OTG cable
            </div>
          </div>
        </header>

        <StatusBar />
        <StatusToast />
        <TrezorPrompt />
        <TrezorConnect />
        <WalletDisplay />

        <section className="rounded-3xl border border-amber-200/40 bg-white/80 p-5">
          <h2 className="font-display text-xl">Scan WalletConnect QR</h2>
          <p className="mt-2 text-sm text-steel">
            Point the camera at a QR code from jup.ag or any WalletConnect-enabled dApp.
          </p>
          <div className="mt-4">
            <Scanner />
          </div>
        </section>

        <SessionApproval />
        <TransactionPreview />
        <SigningFlow />
      </div>
    </main>
  );
}
