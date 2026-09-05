'use client';

import { useEffect, useMemo, useState } from 'react';
import TrezorConnect from '@/lib/trezorConnect';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';

function PinPad({
  value,
  onAppend,
  onBackspace,
  onClear
}: {
  value: string;
  onAppend: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}) {
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-3 gap-2">
        {digits.map((digit) => (
          <button
            key={digit}
            type="button"
            aria-label={`PIN position ${digit}`}
            className="min-h-[64px] rounded-2xl border border-amber-100 bg-white text-2xl font-semibold text-ink active:bg-amber-50"
            onClick={() => onAppend(digit)}
          >
            •
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span
          className="font-mono text-base tracking-[0.3em] text-ink"
          aria-live="polite"
          aria-label={`${value.length} digits entered`}
        >
          {value.length ? '•'.repeat(value.length) : '—'}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBackspace}
            disabled={value.length === 0}
          >
            Back
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={value.length === 0}
          >
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TrezorPrompt() {
  const trezorUiRequest = useAppStore((state) => state.trezorUiRequest);
  const setTrezorUiRequest = useAppStore((state) => state.setTrezorUiRequest);
  const [pin, setPin] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const visible = !!trezorUiRequest;

  // Clear entered secrets whenever the prompt closes or changes kind. Leaving
  // them resident meant a cancelled 4-digit PIN was prefilled into the next
  // prompt, so four more taps sent an 8-character PIN and burned a retry
  // against the device's wipe counter.
  useEffect(() => {
    if (!visible) {
      setPin('');
      setPassphrase('');
    }
  }, [visible, trezorUiRequest?.type]);

  const title = useMemo(() => {
    switch (trezorUiRequest?.type) {
      case 'ui-request_pin':
        return 'Enter PIN';
      case 'ui-request_passphrase':
        return 'Enter Passphrase';
      case 'ui-request_button':
        return 'Confirm on Trezor';
      case 'ui-select_device':
        return 'Select Trezor';
      case 'ui-no_transport':
        return 'No Trezor Detected';
      case 'ui-invalid_pin':
        return 'Invalid PIN';
      case 'ui-invalid_passphrase':
        return 'Invalid Passphrase';
      case 'ui-error':
        return 'Trezor Error';
      default:
        return 'Trezor';
    }
  }, [trezorUiRequest?.type]);

  const handleCancel = () => {
    TrezorConnect.cancel('User cancelled');
    setTrezorUiRequest(null);
    setPin('');
    setPassphrase('');
  };

  if (!visible) return null;

  const type = trezorUiRequest?.type;

  const submitPin = () => {
    TrezorConnect.uiResponse({ type: 'ui-receive_pin', payload: { pin } });
    setTrezorUiRequest(null);
    setPin('');
  };

  const submitPassphrase = (value: string) => {
    TrezorConnect.uiResponse({
      type: 'ui-receive_passphrase',
      payload: { passphrase: value }
    });
    setTrezorUiRequest(null);
    setPassphrase('');
  };

  const submitOnDevice = () => {
    TrezorConnect.uiResponse({
      type: 'ui-receive_passphrase',
      payload: { onDevice: true }
    });
    setTrezorUiRequest(null);
    setPassphrase('');
  };

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (type === 'ui-request_pin') {
    body = (
      <div className="grid gap-4">
        <p className="text-sm text-steel">
          Look at the PIN matrix on your Trezor screen and tap the matching
          positions below. The layout is scrambled on the device, so these
          buttons show no numbers.
        </p>
        <PinPad
          value={pin}
          onAppend={(digit) => setPin((prev) => prev + digit)}
          onBackspace={() => setPin((prev) => prev.slice(0, -1))}
          onClear={() => setPin('')}
        />
      </div>
    );
    footer = (
      <div className="grid gap-2">
        <Button size="lg" fullWidth onClick={submitPin} disabled={!pin.length}>
          Submit PIN
        </Button>
        <Button variant="ghost" fullWidth onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    );
  } else if (type === 'ui-request_passphrase') {
    const allowOnDevice = trezorUiRequest?.payload?.onDeviceAllowed;
    body = (
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (passphrase) submitPassphrase(passphrase);
        }}
      >
        <div className="grid gap-2 text-sm text-steel">
          <p>
            A passphrase selects a wallet on your Trezor. A different value
            opens a different wallet, so enter it exactly.
          </p>
          <p>
            Browser entry is sent only to this attached Trezor over USB. Sifar
            clears it immediately and never sends it to a dApp, WalletConnect,
            an RPC provider, logs, or storage.
          </p>
        </div>
        <input
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          className="min-h-[48px] w-full rounded-2xl border border-amber-100 bg-white px-4 text-ink"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder="Passphrase"
        />
        {/* Submit lives here too so the on-screen keyboard's Go key works. */}
        <button type="submit" className="sr-only" tabIndex={-1}>
          Submit Passphrase
        </button>
      </form>
    );
    footer = (
      <div className="grid gap-2">
        <Button
          size="lg"
          fullWidth
          onClick={() => submitPassphrase(passphrase)}
          disabled={!passphrase}
        >
          Continue with Passphrase
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onClick={() => submitPassphrase('')}
        >
          Use No Passphrase
        </Button>
        {allowOnDevice && (
          <Button variant="ghost" fullWidth onClick={submitOnDevice}>
            Enter on Trezor Instead
          </Button>
        )}
        <Button variant="ghost" fullWidth onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    );
  } else if (type === 'ui-select_device') {
    const devices = trezorUiRequest?.payload?.devices || [];
    body = (
      <div className="grid gap-3">
        <p className="text-sm text-steel">
          Multiple Trezor devices detected. Choose which one to use.
        </p>
        <div className="grid gap-2">
          {devices.map((device: any) => (
            <button
              key={device.path}
              type="button"
              className="min-h-[56px] rounded-2xl border border-amber-100 bg-white px-4 py-3 text-left active:bg-amber-50"
              onClick={() => {
                TrezorConnect.uiResponse({
                  type: 'ui-receive_device',
                  payload: { path: device.path }
                });
                setTrezorUiRequest(null);
              }}
            >
              <div className="text-base font-semibold">
                Device {device.path}
              </div>
              <div className="text-sm text-steel">
                VID {device.vendor} · PID {device.product}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
    footer = (
      <Button variant="ghost" fullWidth onClick={handleCancel}>
        Cancel
      </Button>
    );
  } else if (type === 'ui-request_button') {
    body = (
      <div className="grid gap-3">
        <p className="text-base text-ink">
          Check the details on your Trezor screen and confirm there.
        </p>
        <p className="text-sm text-steel">
          The device screen is what you are approving. Nothing on this phone can
          change it.
        </p>
      </div>
    );
    footer = (
      <Button variant="ghost" fullWidth onClick={handleCancel}>
        Cancel
      </Button>
    );
  } else if (type === 'ui-no_transport') {
    body = (
      <p className="text-sm text-steel">
        No Trezor detected. Make sure it is connected and unlocked, then try
        again.
      </p>
    );
    footer = (
      <Button variant="ghost" fullWidth onClick={handleCancel}>
        Close
      </Button>
    );
  } else if (type === 'ui-invalid_pin') {
    const attemptsLeft = trezorUiRequest?.payload?.attemptsLeft;
    body = (
      <div className="grid gap-3">
        <p className="text-sm text-ember">
          The Trezor rejected that PIN.
        </p>
        {typeof attemptsLeft === 'number' && (
          <p className="text-sm text-ink">
            {attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} left before
            the device wipes itself.
          </p>
        )}
        <p className="text-sm text-steel">
          The keypad positions are scrambled on the device each time, so match
          the layout on the Trezor screen rather than a remembered pattern.
          Close this and retry the action to get a fresh PIN prompt.
        </p>
      </div>
    );
    footer = (
      <Button variant="ghost" fullWidth onClick={handleCancel}>
        Close
      </Button>
    );
  } else if (type === 'ui-invalid_passphrase') {
    body = (
      <div className="grid gap-3">
        <p className="text-sm text-ember">
          The Trezor did not accept that passphrase.
        </p>
        <p className="text-sm text-steel">
          A passphrase selects a wallet rather than unlocking one, so a typo
          silently opens a different wallet with different addresses. Close
          this and retry the action to enter it again.
        </p>
      </div>
    );
    footer = (
      <Button variant="ghost" fullWidth onClick={handleCancel}>
        Close
      </Button>
    );
  } else if (type === 'ui-error') {
    body = (
      <div className="grid gap-3">
        <p className="text-sm text-ember">
          {trezorUiRequest?.payload?.message || 'Trezor reported an error.'}
        </p>
        <p className="text-sm text-steel">
          Close this prompt and try again. If it repeats, reconnect your Trezor.
        </p>
      </div>
    );
    footer = (
      <Button variant="ghost" fullWidth onClick={handleCancel}>
        Close
      </Button>
    );
  } else {
    body = (
      <p className="text-sm text-steel">
        Follow the instructions on your device.
      </p>
    );
    footer = (
      <Button variant="ghost" fullWidth onClick={handleCancel}>
        Close
      </Button>
    );
  }

  return (
    <Sheet
      open={visible}
      title={title}
      layer="device"
      // Never dismissible: a backdrop tap or stray swipe part-way through
      // callWithUi orphans a device operation with the Trezor still waiting.
      // Cancel is the only exit, and it calls TrezorConnect.cancel().
      dismissible={false}
      footer={footer}
    >
      {body}
    </Sheet>
  );
}
