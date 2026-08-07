'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { Capabilities } from '@/lib/capabilities';

/**
 * Shown when this browser cannot reach a Trezor.
 *
 * A full step, not a sheet: the user is blocked rather than interrupted.
 * Deliberately renders no Connect button and no QR scanner — pairing a dApp to
 * a wallet that can never sign would leave the dApp waiting forever, so this
 * fails closed.
 */
export function UnsupportedScreen({
  capabilities
}: {
  capabilities: Capabilities;
}) {
  const [copied, setCopied] = useState(false);
  const { platform, browserHint, secureContext } = capabilities;

  const copyLink = async () => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  let headline = 'Signing isn’t possible in this browser.';
  let explanation =
    'Sifar talks to a Trezor over WebUSB, which this browser does not support.';

  if (!secureContext) {
    headline = 'Sifar needs a secure connection.';
    explanation =
      'WebUSB only works over HTTPS. Open this page on its https:// address and try again.';
  } else if (platform === 'ios') {
    explanation =
      'iOS and iPadOS do not expose WebUSB to any browser. Safari, Chrome and Firefox on iOS all run Apple’s engine, so none of them can talk to a Trezor. This is a platform restriction, not a problem with your device or with Sifar.';
  } else if (browserHint === 'inapp') {
    explanation =
      'You’re in an app’s built-in browser, which does not expose WebUSB. Open this link in Chrome instead.';
  } else if (platform === 'android') {
    explanation =
      'This Android browser does not implement WebUSB. Chrome does — open this link there, with your Trezor on a USB-OTG cable.';
  } else {
    explanation =
      'Chrome and Edge implement WebUSB; Firefox and Safari do not. Open this link in Chrome or Edge.';
  }

  return (
    <section className="grid gap-4 rounded-3xl border border-amber-200/60 bg-white/70 p-5">
      <h2 className="font-display text-xl font-semibold text-ink">{headline}</h2>
      <p className="text-base text-steel">{explanation}</p>

      {secureContext && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-sm font-semibold text-ink">To use Sifar</p>
          <p className="mt-1 text-sm text-steel">
            Android with Chrome, and the Trezor attached over a USB-OTG cable.
            A desktop Chrome or Edge browser works too.
          </p>
        </div>
      )}

      <Button variant="ghost" fullWidth onClick={copyLink}>
        {copied ? 'Link copied' : 'Copy this link'}
      </Button>

      <p className="text-sm text-steel">
        Nothing was sent anywhere. Sifar holds no keys and made no network calls
        on your behalf.
      </p>
    </section>
  );
}
