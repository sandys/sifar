'use client';

import { useMemo, useState } from 'react';
import TrezorConnect from '@/lib/trezorConnect';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/Button';

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
            className="rounded-xl border border-amber-100 bg-white px-4 py-3 text-lg font-semibold"
            onClick={() => onAppend(digit)}
          >
            {digit}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-steel">
        <span>Entered: {'•'.repeat(value.length)}</span>
        <div className="flex gap-2">
          <button type="button" className="underline" onClick={onBackspace}>
            Back
          </button>
          <button type="button" className="underline" onClick={onClear}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

export function TrezorPrompt() {
  const { trezorUiRequest, passphraseOnDeviceOnly, setTrezorUiRequest } =
    useAppStore();
  const [pin, setPin] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const visible = !!trezorUiRequest;
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
      default:
        return 'Trezor';
    }
  }, [trezorUiRequest?.type]);

  if (!visible) return null;

  const handleCancel = () => {
    TrezorConnect.cancel('User cancelled');
    setTrezorUiRequest(null);
  };

  const renderBody = () => {
    if (!trezorUiRequest) return null;

    if (trezorUiRequest.type === 'ui-request_pin') {
      return (
        <div className="grid gap-4">
          <p className="text-sm text-steel">
            Look at the PIN matrix on your Trezor screen and tap the matching
            positions below.
          </p>
          <PinPad
            value={pin}
            onAppend={(digit) => setPin((prev) => prev + digit)}
            onBackspace={() => setPin((prev) => prev.slice(0, -1))}
            onClear={() => setPin('')}
          />
          <div className="flex gap-3">
            <Button variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                TrezorConnect.uiResponse({
                  type: 'ui-receive_pin',
                  payload: { pin }
                });
                setTrezorUiRequest(null);
                setPin('');
              }}
              disabled={pin.length === 0}
            >
              Submit PIN
            </Button>
          </div>
        </div>
      );
    }

    if (trezorUiRequest.type === 'ui-request_passphrase') {
      const allowOnDevice = trezorUiRequest.payload?.onDeviceAllowed;
      if (passphraseOnDeviceOnly) {
        if (!allowOnDevice) {
          return (
            <div className="grid gap-3">
              <p className="text-sm text-ember">
                This device does not allow on-device passphrase entry. Disconnect
                and disable passphrase or use a supported model.
              </p>
              <Button variant="ghost" onClick={handleCancel}>
                Close
              </Button>
            </div>
          );
        }
        return (
          <div className="grid gap-4">
            <p className="text-sm text-steel">
              Enter your passphrase directly on the Trezor device.
            </p>
            <Button
              onClick={() => {
                TrezorConnect.uiResponse({
                  type: 'ui-receive_passphrase',
                  payload: { onDevice: true }
                });
                setTrezorUiRequest(null);
              }}
            >
              Continue
            </Button>
            <Button variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        );
      }
      return (
        <div className="grid gap-4">
          <p className="text-sm text-steel">
            Enter your passphrase or choose to type it directly on the device.
          </p>
          <input
            type="password"
            className="w-full rounded-xl border border-amber-100 bg-white px-3 py-2 text-sm"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="Passphrase"
          />
          <div className="flex flex-wrap gap-3">
            <Button variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
            {allowOnDevice && (
              <Button
                variant="ghost"
                onClick={() => {
                  TrezorConnect.uiResponse({
                    type: 'ui-receive_passphrase',
                    payload: { onDevice: true }
                  });
                  setTrezorUiRequest(null);
                  setPassphrase('');
                }}
              >
                Enter on Device
              </Button>
            )}
            <Button
              onClick={() => {
                TrezorConnect.uiResponse({
                  type: 'ui-receive_passphrase',
                  payload: { passphrase }
                });
                setTrezorUiRequest(null);
                setPassphrase('');
              }}
              disabled={!passphrase}
            >
              Submit Passphrase
            </Button>
          </div>
        </div>
      );
    }

    if (trezorUiRequest.type === 'ui-select_device') {
      const devices = trezorUiRequest.payload?.devices || [];
      return (
        <div className="grid gap-3">
          <p className="text-sm text-steel">
            Multiple Trezor devices detected. Choose which one to use.
          </p>
          <div className="grid gap-2">
            {devices.map((device: any) => (
              <button
                key={device.path}
                type="button"
                className="rounded-xl border border-amber-100 bg-white px-3 py-2 text-left text-sm"
                onClick={() => {
                  TrezorConnect.uiResponse({
                    type: 'ui-receive_device',
                    payload: { path: device.path }
                  });
                  setTrezorUiRequest(null);
                }}
              >
                <div className="font-semibold">Device {device.path}</div>
                <div className="text-xs text-steel">
                  VID {device.vendor} · PID {device.product}
                </div>
              </button>
            ))}
          </div>
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      );
    }

    if (trezorUiRequest.type === 'ui-request_button') {
      return (
        <div className="grid gap-3">
          <p className="text-sm text-steel">
            Confirm the action on your Trezor device to continue.
          </p>
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      );
    }

    if (trezorUiRequest.type === 'ui-no_transport') {
      return (
        <div className="grid gap-3">
          <p className="text-sm text-steel">
            No Trezor detected. Make sure it is connected via USB-OTG and unlocked.
          </p>
          <Button variant="ghost" onClick={handleCancel}>
            Close
          </Button>
        </div>
      );
    }

    return (
      <div className="grid gap-3">
        <p className="text-sm text-steel">Follow the instructions on your device.</p>
        <Button variant="ghost" onClick={handleCancel}>
          Close
        </Button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-4 pb-8 pt-16">
      <div className="w-full max-w-md rounded-3xl border border-amber-200/40 bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg">{title}</h3>
        </div>
        {renderBody()}
      </div>
    </div>
  );
}
