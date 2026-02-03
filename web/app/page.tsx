import { Scanner } from '@/components/Scanner';
import { TrezorConnect } from '@/components/TrezorConnect';
import { WalletDisplay } from '@/components/WalletDisplay';
import { SessionApproval } from '@/components/SessionApproval';
import { StatusBar } from '@/components/StatusBar';
import { StatusToast } from '@/components/StatusToast';
import { TrezorPrompt } from '@/components/TrezorPrompt';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1db_0%,_#f6f1e8_45%,_#efe2d0_100%)] px-4 pb-16 pt-10 text-ink">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <TrezorPrompt />
        <TrezorConnect />
        <StatusBar />
        <StatusToast />
        <WalletDisplay />

        <section className="rounded-3xl border border-amber-200/40 bg-white/80 p-5">
          <h2 className="font-jomhuria text-3xl tracking-wide">Scan WalletConnect QR</h2>
          <p className="mt-2 text-sm text-steel">
            Point the camera at a QR code from jup.ag or any WalletConnect-enabled dApp.
          </p>
          <div className="mt-4">
            <Scanner />
          </div>
        </section>

        <SessionApproval />
      </div>
    </main>
  );
}
