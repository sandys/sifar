import { TrezorPrompt } from '@/components/TrezorPrompt';
import { SessionApproval } from '@/components/SessionApproval';
import { TransactionPreview } from '@/components/TransactionPreview';
import { SigningFlow } from '@/components/SigningFlow';
import { WalletDisplay } from '@/components/WalletDisplay';
import { DebugPanel } from '@/components/DebugPanel';
import { TrezorUsbClient } from './trezor-usb-client';

export default function TrezorUsbPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1db_0%,_#f6f1e8_45%,_#efe2d0_100%)] px-4 pb-16 pt-10 text-ink">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header className="rounded-3xl border border-amber-200/40 bg-white/70 p-6 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.6)]">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">
            Vault Bridge V1
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold">
            Direct WebUSB Trezor
          </h1>
          <p className="mt-4 text-sm text-steel">
            This page forces passphrase entry on the device. Chrome will request
            WebUSB permission first, then the Trezor will prompt on-device.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3 text-xs text-steel">
            <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-3">
              Chrome + WebUSB only
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-3">
              Solana accounts, no storage
            </div>
          </div>
        </header>

        <TrezorPrompt />
        <TrezorUsbClient />
        <WalletDisplay />
        <SessionApproval />
        <TransactionPreview />
        <SigningFlow />
        <DebugPanel />
      </div>
    </main>
  );
}
