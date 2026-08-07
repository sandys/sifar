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
  const passphraseOnDeviceOnly = useAppStore(
    (state) => state.passphraseOnDeviceOnly
  );
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

  const submitPassphrase = () => {
    if (!passphrase) return;
    TrezorConnect.uiResponse({
      type: 'ui-receive_passphrase',
      payload: { passphrase }
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

    if (passphraseOnDeviceOnly && !allowOnDevice) {
      body = (
        <p className="text-sm text-ember">
          This device does not allow on-device passphrase entry. Disconnect and
          disable passphrase, or use a supported model.
        </p>
      );
      footer = (
        <Button variant="ghost" fullWidth onClick={handleCancel}>
          Close
        </Button>
      );
    } else if (passphraseOnDeviceOnly) {
      body = (
        <p className="text-sm text-steel">
          Enter your passphrase directly on the Trezor device.
        </p>
      );
      footer = (
        <div className="grid gap-2">
          <Button size="lg" fullWidth onClick={submitOnDevice}>
            Continue on Device
          </Button>
          <Button variant="ghost" fullWidth onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      );
    } else {
      body = (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submitPassphrase();
          }}
        >
          <p className="text-sm text-steel">
            Enter your passphrase, or type it directly on the device.
          </p>
          <input
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
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
            onClick={submitPassphrase}
            disabled={!passphrase}
          >
            Submit Passphrase
          </Button>
          {allowOnDevice && (
            <Button variant="ghost" fullWidth onClick={submitOnDevice}>
              Enter on Device
            </Button>
          )}
          <Button variant="ghost" fullWidth onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      );
    }
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
