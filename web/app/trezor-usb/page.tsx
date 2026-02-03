import { TrezorPrompt } from '@/components/TrezorPrompt';
import { SessionApproval } from '@/components/SessionApproval';
import { WalletDisplay } from '@/components/WalletDisplay';
import { DebugPanel } from '@/components/DebugPanel';
import { TrezorUsbClient } from './trezor-usb-client';

export default function TrezorUsbPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1db_0%,_#f6f1e8_45%,_#efe2d0_100%)] px-4 pb-16 pt-10 text-ink">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <TrezorPrompt />
        <TrezorUsbClient />
        <WalletDisplay />
        <SessionApproval />
        <DebugPanel />
      </div>
    </main>
  );
}
