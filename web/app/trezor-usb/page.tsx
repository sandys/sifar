import { TrezorPrompt } from '@/components/TrezorPrompt';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { ToastHost } from '@/components/ToastHost';
import { SheetHost } from '@/components/SheetHost';
import { TrezorUsbClient } from './trezor-usb-client';

export default function TrezorUsbPage() {
  return (
    <main className="app-shell bg-[radial-gradient(circle_at_top,_#fff1db_0%,_#f6f1e8_45%,_#efe2d0_100%)] px-4 text-ink" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(3rem, env(safe-area-inset-bottom))' }}>
      <LoadingOverlay />
      <ToastHost />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        {/* Portals to the top of the stack, so a device prompt is always
            reachable over any sheet. Position here is irrelevant. */}
        <TrezorPrompt />
        <TrezorUsbClient />
        <SheetHost />
      </div>
    </main>
  );
}
